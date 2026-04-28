// injector.ts — Runs at document_start; injects saved rules + blinds

(async function init(): Promise<void> {
  const hostname = location.hostname;
  if (!hostname) return;

  // Get rules
  let data: { rules: Rule[]; blinds: Blind[] };
  try {
    const response = await browser.runtime.sendMessage({
      type: "GET_RULES",
      payload: { hostname },
    }) as { type: string; payload: { rules: Rule[]; blinds: Blind[] } };

    if (!response || response.type !== "RULES_DATA") {
        throw new Error("Service worker did not return rules data.")
    }
    data = response.payload;
  } catch (err) {
    console.warn("[QuietCSS] Injector: failed to fetch rules.", err);
    return;
  }

  // Inject a <style> tag for each enabled rule matching this host.
  for (const rule of data.rules) {
    if (rule.enabled) {
      injectStyleTag(rule);
    }
  }

  // Render blinds once body is available — deferred to DOMContentLoaded if needed.
  const enabledBlinds = data.blinds.filter(b => b.enabled);
  if (enabledBlinds.length > 0) {
    const renderBlinds = () => {
      // blind.ts renderBlind(blind) will be wired in Build Step 9.
    };
    if (document.body) {
      renderBlinds();
    } else {
      document.addEventListener("DOMContentLoaded", renderBlinds, { once: true });
    }
  }
})();

function injectStyleTag(rule: Rule): void {
  // Avoid double-injection if called again on same page.
  if (document.querySelector(`[data-quietcss-rule-id="${rule.id}"]`)) return;

  const style = document.createElement("style");
  style.setAttribute("data-quietcss-rule-id", rule.id);
  style.textContent = `${rule.selector} {\n  ${rule.css}\n}`;

  // document.head may not yet exist at document_start; fall back to documentElement.
  (document.head ?? document.documentElement).appendChild(style);
}
