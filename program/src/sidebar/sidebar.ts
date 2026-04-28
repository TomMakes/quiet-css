// sidebar.ts — UI logic + message passing
// Build Step 2: GET_RULES on load, display rule/blind count, save test rule.

// Hardcoded test rule for Build Steps 2 and 3 (remove after validation).
const TEST_RULE = {
  selector: ".ytLikeButtonViewModelHost",
  css: "display: none !important;",
  hostPattern: "www.youtube.com",
  isRegex: false,
  enabled: true,
  forceReapply: false,
};

async function getActiveTabHostname(): Promise<string> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0]?.url;
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

async function fetchAndDisplayCount(hostname: string): Promise<void> {
  const countEl = document.getElementById("rules-count");
  if (!countEl) return;
  try {
    const response = await browser.runtime.sendMessage({
      type: "GET_RULES",
      payload: { hostname },
    }) as QCMessage;
    if (response.type === "RULES_DATA") {
      const rules = response.payload.rules as unknown[];
      const blinds = response.payload.blinds as unknown[];
      countEl.textContent =
        `Rules: ${rules.length} | Blinds: ${blinds.length}` +
        (hostname ? ` (${hostname})` : " (no active tab)");
    }
  } catch (err) {
    countEl.textContent = `Error loading rules: ${String(err)}`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const pingBtn = document.getElementById("ping-btn") as HTMLButtonElement | null;
  const saveTestRuleBtn = document.getElementById("save-test-rule-btn") as HTMLButtonElement | null;
  const responseArea = document.getElementById("response-area") as HTMLPreElement | null;

  const hostname = await getActiveTabHostname();
  await fetchAndDisplayCount(hostname);

  pingBtn?.addEventListener("click", async () => {
    try {
      const response = await browser.runtime.sendMessage({ type: "PING", payload: {} });
      if (responseArea) responseArea.textContent = JSON.stringify(response, null, 2);
    } catch (err) {
      if (responseArea) responseArea.textContent = `Error: ${String(err)}`;
    }
  });

  saveTestRuleBtn?.addEventListener("click", async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: "SAVE_RULE",
        payload: { rule: TEST_RULE },
      }) as QCMessage;
      if (responseArea) responseArea.textContent = JSON.stringify(response, null, 2);
      await fetchAndDisplayCount(hostname);
    } catch (err) {
      if (responseArea) responseArea.textContent = `Error: ${String(err)}`;
    }
  });
});

export {};
