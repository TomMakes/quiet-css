/// <reference path="../src/shared/schema.d.ts" />

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// sidebar.ts calls document.addEventListener("DOMContentLoaded", handler) on
// every import. Because all tests share the same jsdom document, repeatedly
// importing the module accumulates stale listeners. We patch addEventListener
// at module scope to track every DOMContentLoaded handler so we can remove
// them cleanly in beforeEach before each fresh import.
const _trackedListeners: EventListener[] = [];
const _origDocAdd = document.addEventListener.bind(document);
// @ts-ignore — wrapping the overloaded signature
document.addEventListener = (
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
) => {
  if (type === "DOMContentLoaded") {
    _trackedListeners.push(listener as EventListener);
  }
  _origDocAdd(type, listener as EventListener, options as boolean | undefined);
};

const SIDEBAR_HTML = `
  <span id="rules-count"></span>
  <button id="ping-btn">Ping</button>
  <button id="save-test-rule-btn">Save Test Rule</button>
  <pre id="response-area"></pre>
`;

/** Flush enough microtask cycles for async DOMContentLoaded callback to complete. */
async function flushAsync() {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

/** Import sidebar, trigger DOMContentLoaded, and flush all async work. */
async function loadSidebar() {
  await import("../src/sidebar/sidebar");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await flushAsync();
}

describe("sidebar UI", () => {
  let mockTabsQuery: ReturnType<typeof vi.fn>;
  let mockSendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();

    // Remove every DOMContentLoaded listener that was registered by a previous
    // test import so it cannot fire again when we dispatch the event below.
    while (_trackedListeners.length > 0) {
      document.removeEventListener("DOMContentLoaded", _trackedListeners.pop()!);
    }

    document.body.innerHTML = SIDEBAR_HTML;

    mockTabsQuery = vi.fn().mockResolvedValue([{ url: "https://www.youtube.com/watch?v=123" }]);
    mockSendMessage = vi.fn();

    vi.stubGlobal("browser", {
      tabs: { query: mockTabsQuery },
      runtime: { sendMessage: mockSendMessage },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------- DOMContentLoaded init ----------

  it("displays rule and blind counts from GET_RULES on load", async () => {
    mockSendMessage.mockResolvedValue({
      type: "RULES_DATA",
      payload: { rules: [{ id: "r1" }, { id: "r2" }], blinds: [{ id: "b1" }] },
    });

    await loadSidebar();

    const countEl = document.getElementById("rules-count");
    expect(countEl?.textContent).toContain("Rules: 2");
    expect(countEl?.textContent).toContain("Blinds: 1");
    expect(countEl?.textContent).toContain("www.youtube.com");
  });

  it("includes '(no active tab)' in count when no tab URL is available", async () => {
    mockTabsQuery.mockResolvedValue([]);
    mockSendMessage.mockResolvedValue({
      type: "RULES_DATA",
      payload: { rules: [], blinds: [] },
    });

    await loadSidebar();

    const countEl = document.getElementById("rules-count");
    expect(countEl?.textContent).toContain("Rules: 0");
    expect(countEl?.textContent).toContain("Blinds: 0");
    expect(countEl?.textContent).toContain("no active tab");
  });

  it("sends GET_RULES with the active tab's hostname", async () => {
    mockSendMessage.mockResolvedValue({
      type: "RULES_DATA",
      payload: { rules: [], blinds: [] },
    });

    await loadSidebar();

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "GET_RULES",
        payload: expect.objectContaining({ hostname: "www.youtube.com" }),
      })
    );
  });

  it("shows an error message in the count area when GET_RULES fails", async () => {
    mockSendMessage.mockRejectedValue(new Error("SW offline"));

    await loadSidebar();

    const countEl = document.getElementById("rules-count");
    expect(countEl?.textContent).toMatch(/error/i);
  });

  // ---------- Ping button ----------

  it("clicking Ping sends a PING message and renders the response", async () => {
    mockSendMessage
      .mockResolvedValueOnce({ type: "RULES_DATA", payload: { rules: [], blinds: [] } }) // init
      .mockResolvedValueOnce({ type: "PONG", payload: { echo: {} } }); // ping

    await loadSidebar();

    document.getElementById("ping-btn")!.click();
    await flushAsync();

    const responseArea = document.getElementById("response-area");
    expect(responseArea?.textContent).toContain("PONG");
  });

  it("clicking Ping shows an error string when the message call rejects", async () => {
    mockSendMessage
      .mockResolvedValueOnce({ type: "RULES_DATA", payload: { rules: [], blinds: [] } })
      .mockRejectedValueOnce(new Error("connection refused"));

    await loadSidebar();

    document.getElementById("ping-btn")!.click();
    await flushAsync();

    const responseArea = document.getElementById("response-area");
    expect(responseArea?.textContent).toMatch(/error/i);
  });

  // ---------- Save Test Rule button ----------

  it("clicking Save Test Rule sends a SAVE_RULE message", async () => {
    mockSendMessage
      .mockResolvedValueOnce({ type: "RULES_DATA", payload: { rules: [], blinds: [] } }) // init
      .mockResolvedValueOnce({ type: "RULE_SAVED", payload: { rule: {} } }) // save
      .mockResolvedValueOnce({ type: "RULES_DATA", payload: { rules: [{}], blinds: [] } }); // refresh

    await loadSidebar();

    document.getElementById("save-test-rule-btn")!.click();
    await flushAsync();

    const saveCall = mockSendMessage.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "SAVE_RULE"
    );
    expect(saveCall).toBeDefined();
    expect((saveCall![0] as { payload: { rule: { selector: string } } }).payload.rule.selector).toBe(
      ".ytLikeButtonViewModelHost"
    );
  });

  it("clicking Save Test Rule refreshes the rule count afterwards", async () => {
    mockSendMessage
      .mockResolvedValueOnce({ type: "RULES_DATA", payload: { rules: [], blinds: [] } })
      .mockResolvedValueOnce({ type: "RULE_SAVED", payload: { rule: {} } })
      .mockResolvedValueOnce({ type: "RULES_DATA", payload: { rules: [{}], blinds: [] } });

    await loadSidebar();

    document.getElementById("save-test-rule-btn")!.click();
    await flushAsync();

    const countEl = document.getElementById("rules-count");
    expect(countEl?.textContent).toContain("Rules: 1");
  });

  it("clicking Save Test Rule shows the response in the response area", async () => {
    mockSendMessage
      .mockResolvedValueOnce({ type: "RULES_DATA", payload: { rules: [], blinds: [] } })
      .mockResolvedValueOnce({ type: "RULE_SAVED", payload: { rule: { id: "r99" } } })
      .mockResolvedValueOnce({ type: "RULES_DATA", payload: { rules: [{}], blinds: [] } });

    await loadSidebar();

    document.getElementById("save-test-rule-btn")!.click();
    await flushAsync();

    const responseArea = document.getElementById("response-area");
    expect(responseArea?.textContent).toContain("RULE_SAVED");
  });
});
