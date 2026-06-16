// service_worker.ts — Storage I/O, message relay, tab tracking
// Build Step 2: Full storage handlers for rules and blinds.

import { createRule, createBlind, validateRule } from "../shared/schema_utils.js";

const RULES_KEY = "quietcss_rules";
const BLINDS_KEY = "quietcss_blinds";

// ---------- Hostname matching ----------

function matchesHost(pattern: string, isRegex: boolean, hostname: string, url: string): boolean {
  if (isRegex) {
    try {
      return new RegExp(pattern).test(url);
    } catch {
      return false;
    }
  }
  return hostname.includes(pattern);
}

// ---------- Storage helpers ----------

async function getAllRules(): Promise<Rule[]> {
  const data = await browser.storage.local.get(RULES_KEY);
  return (data[RULES_KEY] as Rule[] | undefined) ?? [];
}

async function getAllBlinds(): Promise<Blind[]> {
  const data = await browser.storage.local.get(BLINDS_KEY);
  return (data[BLINDS_KEY] as Blind[] | undefined) ?? [];
}

async function saveAllRules(rules: Rule[]): Promise<void> {
  await browser.storage.local.set({ [RULES_KEY]: rules });
}

async function saveAllBlinds(blinds: Blind[]): Promise<void> {
  await browser.storage.local.set({ [BLINDS_KEY]: blinds });
}

async function broadcastTabChanged(tabId: number): Promise<void> {
  try {
    const tab = await browser.tabs.get(tabId);
    const url = tab.url ?? "";
    const hostname = url ? new URL(url).hostname : "";

    browser.runtime.sendMessage({
      type: "TAB_CHANGED",
      payload: { tabId, hostname, url },
    }).catch(() => {
      // Sidebar may be closed; suppress connection errors.
    });
  } catch (err) {
    console.warn("[QuietCSS SW] Failed to broadcast tab change:", err);
  }
}

browser.tabs.onActivated.addListener(activeInfo => {
  void broadcastTabChanged(activeInfo.tabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    void broadcastTabChanged(tabId);
  }
});

// ---------- Message handler ----------

browser.runtime.onMessage.addListener(
  (message: unknown, _sender: browser.runtime.MessageSender) => {
    const msg = message as QCMessage;
    console.log("[QuietCSS SW] Received message:", msg.type);

    switch (msg.type) {

      case "PING":
        return Promise.resolve({ type: "PONG", payload: { echo: msg } });

      case "GET_RULES": {
        const hostname = msg.payload.hostname as string;
        const url = (msg.payload.url as string | undefined) ?? "";
        return (async () => {
          const allRules = await getAllRules();
          const allBlinds = await getAllBlinds();
          const rules = allRules.filter(r => matchesHost(r.hostPattern, r.isRegex, hostname, url));
          const blinds = allBlinds.filter(b => matchesHost(b.hostPattern, b.isRegex, hostname, url));
          return { type: "RULES_DATA", payload: { rules, blinds } };
        })();
      }

      case "SAVE_RULE": {
        const incoming = msg.payload.rule as Partial<Rule>;
        return (async () => {
          const rules = await getAllRules();
          const rule = createRule(incoming);
          const validationResult = validateRule(rule);
          if (validationResult.valid === false) {
            return { type: "ERROR", payload: { error: validationResult.error } };
          }
          const idx = rules.findIndex(r => r.id === rule.id);
          if (idx >= 0) {
            rules[idx] = rule;
          } else {
            rules.push(rule);
          }
          await saveAllRules(rules);
          return { type: "RULE_SAVED", payload: { rule } };
        })();
      }

      case "DELETE_RULE": {
        const id = msg.payload.id as string;
        return (async () => {
          const rules = await getAllRules();
          await saveAllRules(rules.filter(r => r.id !== id));
          return { type: "RULE_DELETED", payload: { id } };
        })();
      }

      case "TOGGLE_RULE": {
        const id = msg.payload.id as string;
        const enabled = msg.payload.enabled as boolean;
        return (async () => {
          const rules = await getAllRules();
          const rule = rules.find(r => r.id === id);
          if (!rule) return { type: "ERROR", payload: { error: `Rule ${id} not found` } };
          rule.enabled = enabled;
          await saveAllRules(rules);
          return { type: "RULE_UPDATED", payload: { rule } };
        })();
      }

      case "SAVE_BLIND": {
        const incoming = msg.payload.blind as Partial<Blind>;
        return (async () => {
          const blinds = await getAllBlinds();
          const blind = createBlind(incoming);
          const idx = blinds.findIndex(b => b.id === blind.id);
          if (idx >= 0) {
            blinds[idx] = blind;
          } else {
            blinds.push(blind);
          }
          await saveAllBlinds(blinds);
          return { type: "BLIND_SAVED", payload: { blind } };
        })();
      }

      case "DELETE_BLIND": {
        const id = msg.payload.id as string;
        return (async () => {
          const blinds = await getAllBlinds();
          await saveAllBlinds(blinds.filter(b => b.id !== id));
          return { type: "BLIND_DELETED", payload: { id } };
        })();
      }

      case "TOGGLE_BLIND": {
        const id = msg.payload.id as string;
        const enabled = msg.payload.enabled as boolean;
        return (async () => {
          const blinds = await getAllBlinds();
          const blind = blinds.find(b => b.id === id);
          if (!blind) return { type: "ERROR", payload: { error: `Blind ${id} not found` } };
          blind.enabled = enabled;
          await saveAllBlinds(blinds);
          return { type: "BLIND_UPDATED", payload: { blind } };
        })();
      }

      // ── Content ↔ Sidebar relay ──────────────────────────────────────────

      // Sidebar → Content: forward edit-mode and rule-update commands to the active tab.
      case "ENTER_EDIT_MODE":
      case "EXIT_EDIT_MODE":
      case "HIGHLIGHT_SELECTOR":
      case "APPLY_RULE_PREVIEW":
      case "REMOVE_RULE_PREVIEW":
      case "INJECT_RULE":
      case "REMOVE_RULE":
      case "GENERATE_SELECTOR": {
        return (async () => {
          const tabs = await browser.tabs.query({ active: true, currentWindow: true });
          const tabId = tabs[0]?.id;
          if (tabId == null) {
            return { type: "ERROR", payload: { error: "No active tab found" } };
          }
          try {
            await browser.tabs.sendMessage(tabId, { type: msg.type, payload: msg.payload });
            return { type: "OK", payload: {} };
          } catch (err) {
            console.warn("[QuietCSS SW] Relay to content script failed:", err);
            return { type: "ERROR", payload: { error: String(err) } };
          }
        })();
      }

      // Content → Sidebar: push element-picker results to all extension pages.
      case "ELEMENT_PICKED":
      case "BLIND_DRAWN":
      case "SELECTOR_GENERATED": {
        // Fire-and-forget broadcast; sidebar may not always be open.
        browser.runtime.sendMessage({ type: msg.type, payload: msg.payload }).catch(() => {
          // Sidebar not open — suppress the "Could not establish connection" error.
        });
        return Promise.resolve({ type: "OK", payload: {} });
      }

      default:
        console.warn("[QuietCSS SW] Unknown message type:", msg.type);
        return undefined;
    }
  }
);

export {};
