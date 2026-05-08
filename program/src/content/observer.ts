// observer.ts — MutationObserver reapply layer (Build Step 4)
//
// Activates only for rules with forceReapply: true.
// Handles two scenarios:
//   Scenario A: A QuietCSS <style> tag is removed from <head> → re-inject it.
//   Scenario B: SPA navigation via pushState/replaceState/popstate → re-run
//               injector logic so rules survive framework-driven page transitions.

(async function initObserver(): Promise<void> {
  const hostname = location.hostname;
  if (!hostname) return;

  let rules: Rule[];
  try {
    const response = (await browser.runtime.sendMessage({
      type: "GET_RULES",
      payload: { hostname },
    })) as { type: string; payload: { rules: Rule[]; blinds: Blind[] } };
    if (!response || response.type !== "RULES_DATA") return;
    rules = response.payload.rules;
  } catch {
    return;
  }

  const reapplyRules = rules.filter((r) => r.enabled && r.forceReapply);
  if (reapplyRules.length === 0) return;

  const ruleMap = new Map<string, Rule>(reapplyRules.map((r) => [r.id, r]));

  function injectStyleTag(rule: Rule): void {
    if (document.querySelector(`[data-quietcss-rule-id="${rule.id}"]`)) return;
    const style = document.createElement("style");
    style.setAttribute("data-quietcss-rule-id", rule.id);
    style.textContent = `${rule.selector} {\n  ${rule.css}\n}`;
    (document.head ?? document.documentElement).appendChild(style);
  }

  function reinjectRule(ruleId: string): void {
    const rule = ruleMap.get(ruleId);
    if (rule) injectStyleTag(rule);
  }

  /** Apply rule CSS as inline !important overrides to any matching elements within `root`. */
  function applyInlineOverrides(root: Element, rule: Rule): void {
    const targets: Element[] = root.matches(rule.selector)
      ? [root]
      : Array.from(root.querySelectorAll(rule.selector));
    for (const el of targets) {
      for (const decl of rule.css.split(";")) {
        const colonIdx = decl.indexOf(":");
        if (colonIdx === -1) continue;
        const prop = decl.slice(0, colonIdx).trim();
        const val = decl.slice(colonIdx + 1).trim();
        if (prop && val) {
          (el as HTMLElement).style.setProperty(prop, val, "important");
        }
      }
    }
  }

  // ── Head Observer ──────────────────────────────────────────────────────────
  // Re-inject any QuietCSS <style> tag that gets removed from <head>.

  let headObserver: MutationObserver | null = null;

  function setupHeadObserver(): void {
    headObserver?.disconnect();
    if (!document.head) return;
    headObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        Array.from(mutation.removedNodes).forEach((node) => {
          const ruleId = (node as HTMLElement).dataset?.quietcssRuleId;
          if (ruleId && ruleMap.has(ruleId)) {
            reinjectRule(ruleId);
          }
        });
      }
    });
    headObserver.observe(document.head, { childList: true });
  }

  // ── Body Observer (debounced) ──────────────────────────────────────────────
  // Apply inline overrides when elements matching forceReapply rules are added.
  // Debounced to avoid firing thousands of times per second on noisy SPAs.

  let bodyObserver: MutationObserver | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingNodes: Element[] = [];

  function processPendingNodes(): void {
    const batch = pendingNodes.splice(0);
    for (const node of batch) {
      for (const rule of reapplyRules) {
        applyInlineOverrides(node, rule);
      }
    }
  }

  function setupBodyObserver(): void {
    bodyObserver?.disconnect();
    if (!document.body) return;
    bodyObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        Array.from(mutation.addedNodes).forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            pendingNodes.push(node as Element);
          }
        });
      }
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processPendingNodes, 50);
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ── SPA Navigation ─────────────────────────────────────────────────────────

  function onNavigation(): void {
    // Disconnect stale observers before re-setting up to prevent accumulation.
    headObserver?.disconnect();
    bodyObserver?.disconnect();
    headObserver = null;
    bodyObserver = null;

    // Re-inject all forceReapply rules for the new page state.
    for (const rule of reapplyRules) {
      injectStyleTag(rule);
    }

    setupHeadObserver();
    if (document.body) {
      setupBodyObserver();
    } else {
      document.addEventListener("DOMContentLoaded", () => setupBodyObserver(), { once: true });
    }
  }

  // Patch pushState / replaceState so framework-driven navigations are caught.
  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args: Parameters<typeof history.pushState>) => {
    originalPushState(...args);
    onNavigation();
  };

  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
    originalReplaceState(...args);
    onNavigation();
  };

  window.addEventListener("popstate", onNavigation);

  // ── Initial Setup ──────────────────────────────────────────────────────────

  function setupWhenReady(): void {
    setupHeadObserver();
    if (document.body) {
      setupBodyObserver();
    } else {
      document.addEventListener("DOMContentLoaded", () => setupBodyObserver(), { once: true });
    }
  }

  if (document.head) {
    setupWhenReady();
  } else {
    // document_start: head not yet parsed — wait for it via a documentElement observer.
    const waitForHead = new MutationObserver(() => {
      if (document.head) {
        waitForHead.disconnect();
        setupWhenReady();
      }
    });
    waitForHead.observe(document.documentElement, { childList: true });
  }
})();

