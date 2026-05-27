/// <reference path="../src/shared/schema.d.ts" />

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// sidebar.ts calls document.addEventListener("DOMContentLoaded", handler) on
// every import. Track registered listeners so they can be removed between tests.
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

// Minimal HTML providing every element that sidebar.ts references.
const SIDEBAR_HTML = `
  <button id="tab-styles" class="tab-btn tab-btn--active">Styles</button>
  <button id="tab-blinds" class="tab-btn">Blinds</button>
  <section id="panel-styles" class="tab-panel"></section>
  <section id="panel-blinds" class="tab-panel tab-panel--hidden"></section>
  <button id="help-btn">?</button>
  <button id="collapse-btn">−</button>
  <main id="sidebar-content"></main>
  <input  id="host-pattern-input"   type="text" />
  <button id="regex-toggle-btn">[.*]</button>
  <input  id="rule-name-input"      type="text" />
  <input  id="rule-selector-input"  type="text" />
  <textarea id="rule-css-input"></textarea>
  <input  type="checkbox" id="important-checkbox" checked />
  <input  type="checkbox" id="force-reapply-checkbox" />
  <button id="save-rule-btn">Save</button>
  <button id="cancel-rule-btn">Cancel</button>
  <button id="auto-gen-btn">Auto-generate</button>
  <button id="select-element-btn">Select Element</button>
  <div id="rules-list">
    <p id="no-rules-msg">No rules yet.</p>
  </div>
`;

/** Flush enough microtask / promise cycles for async DOMContentLoaded work. */
async function flushAsync() {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

/** Import sidebar, fire DOMContentLoaded, flush. */
async function loadSidebar() {
  await import("../src/sidebar/sidebar");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await flushAsync();
}

// ─────────────────────────────────────────────────────────────────────────────

describe("sidebar — CSS Editor Panel", () => {
  let mockTabsQuery: ReturnType<typeof vi.fn>;
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let capturedListeners: Array<(msg: unknown) => unknown>;

  const HOSTNAME = "www.youtube.com";

  const makeRule = (overrides: Partial<Rule> = {}): Rule => ({
    id: "rule-1",
    name: "Like button hider",
    nameIsCustom: false,
    hostPattern: "www.youtube.com",
    isRegex: false,
    selector: ".ytLikeButtonViewModelHost",
    css: "display: none !important;",
    forceReapply: false,
    enabled: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.resetModules();

    while (_trackedListeners.length > 0) {
      document.removeEventListener("DOMContentLoaded", _trackedListeners.pop()!);
    }
    document.body.innerHTML = SIDEBAR_HTML;
    capturedListeners = [];

    mockTabsQuery = vi.fn().mockResolvedValue([{ url: `https://${HOSTNAME}/watch?v=abc` }]);
    mockSendMessage = vi.fn().mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") {
        return { type: "RULES_DATA", payload: { rules: [], blinds: [] } };
      }
      return { type: "OK", payload: {} };
    });

    vi.stubGlobal("browser", {
      tabs: { query: mockTabsQuery, create: vi.fn() },
      runtime: {
        sendMessage: mockSendMessage,
        onMessage: {
          addListener: vi.fn().mockImplementation((fn: (msg: unknown) => unknown) => {
            capturedListeners.push(fn);
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Initialisation ─────────────────────────────────────────────────────────

  it("sets host-pattern-input to the active tab hostname on load", async () => {
    await loadSidebar();
    const input = document.getElementById("host-pattern-input") as HTMLInputElement;
    expect(input.value).toBe(HOSTNAME);
  });

  it("sends GET_RULES with the active tab hostname on load", async () => {
    await loadSidebar();
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "GET_RULES",
        payload: expect.objectContaining({ hostname: HOSTNAME }),
      })
    );
  });

  it("shows no-rules-msg when no rules are returned", async () => {
    await loadSidebar();
    const msg = document.getElementById("no-rules-msg") as HTMLElement;
    expect(msg.style.display).not.toBe("none");
  });

  it("renders rule items for each returned rule", async () => {
    const rule = makeRule();
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") {
        return { type: "RULES_DATA", payload: { rules: [rule], blinds: [] } };
      }
      return { type: "OK", payload: {} };
    });
    await loadSidebar();
    const items = document.querySelectorAll(".rule-item");
    expect(items.length).toBe(1);
    expect(items[0].querySelector(".rule-item-name")?.textContent).toBe(rule.name);
    expect(items[0].querySelector(".rule-item-selector")?.textContent).toBe(rule.selector);
    expect(items[0].querySelector("rule-toggle-btn--enabled")).toBeTruthy;
  });

  it("hides no-rules-msg when rules are rendered", async () => {
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") {
        return { type: "RULES_DATA", payload: { rules: [makeRule()], blinds: [] } };
      }
      return { type: "OK", payload: {} };
    });
    await loadSidebar();
    const msg = document.getElementById("no-rules-msg") as HTMLElement;
    expect(msg.style.display).toBe("none");
  });

  it("TAB_CHANGED updates the target host and reloads matching rules", async () => {
    const switchedRule = makeRule({ id: "rule-2", hostPattern: "example.com", name: "Example rule" });
    mockSendMessage.mockImplementation(async (msg: { type: string; payload?: { hostname?: string } }) => {
      if (msg.type === "GET_RULES") {
        if (msg.payload?.hostname === HOSTNAME) {
          return { type: "RULES_DATA", payload: { rules: [], blinds: [] } };
        }
        if (msg.payload?.hostname === "example.com") {
          return { type: "RULES_DATA", payload: { rules: [switchedRule], blinds: [] } };
        }
      }
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    for (const listener of capturedListeners) {
      listener({
        type: "TAB_CHANGED",
        payload: {
          tabId: 42,
          hostname: "example.com",
          url: "https://example.com/page",
        },
      });
    }
    await flushAsync();

    const input = document.getElementById("host-pattern-input") as HTMLInputElement;
    expect(input.value).toBe("example.com");
    expect(document.querySelectorAll(".rule-item")).toHaveLength(1);
    expect(document.querySelector(".rule-item-name")?.textContent).toBe(switchedRule.name);
  });

  // ── ELEMENT_PICKED ──────────────────────────────────────────────────────────

  it("ELEMENT_PICKED populates editor with selector, host, and CSS suggestion", async () => {
    await loadSidebar();

    for (const listener of capturedListeners) {
      listener({
        type: "ELEMENT_PICKED",
        payload: {
          selector: "#yt-sidebar",
          computedStyles: { display: "block" },
          tagName: "DIV",
        },
      });
    }
    await flushAsync();

    const selectorInput = document.getElementById("rule-selector-input") as HTMLInputElement;
    const nameInput     = document.getElementById("rule-name-input")     as HTMLInputElement;
    const hostInput     = document.getElementById("host-pattern-input")  as HTMLInputElement;
    const cssInput      = document.getElementById("rule-css-input")      as HTMLTextAreaElement;
    const importantCb   = document.getElementById("important-checkbox")  as HTMLInputElement;

    expect(selectorInput.value).toBe("#yt-sidebar");
    expect(nameInput.value).toBe("#yt-sidebar");
    expect(hostInput.value).toBe(HOSTNAME);
    expect(cssInput.value).toBe("display: none;");
    expect(importantCb.checked).toBe(true);
  });

  // ── Name field behaviours ───────────────────────────────────────────────────

  it("typing in selector updates name when nameIsCustom is false", async () => {
    await loadSidebar();
    const nameInput     = document.getElementById("rule-name-input")    as HTMLInputElement;
    const selectorInput = document.getElementById("rule-selector-input") as HTMLInputElement;

    selectorInput.value = "#new-selector";
    selectorInput.dispatchEvent(new Event("input"));
    await flushAsync();

    expect(nameInput.value).toBe("#new-selector");
  });

  it("typing in name field sets nameIsCustom so selector no longer updates name", async () => {
    await loadSidebar();
    const nameInput     = document.getElementById("rule-name-input")     as HTMLInputElement;
    const selectorInput = document.getElementById("rule-selector-input") as HTMLInputElement;

    nameInput.value = "My rule";
    nameInput.dispatchEvent(new Event("input"));

    selectorInput.value = "#something-else";
    selectorInput.dispatchEvent(new Event("input"));
    await flushAsync();

    expect(nameInput.value).toBe("My rule");
  });

  it("clearing name and blurring restores it from the selector value", async () => {
    await loadSidebar();
    const nameInput     = document.getElementById("rule-name-input")     as HTMLInputElement;
    const selectorInput = document.getElementById("rule-selector-input") as HTMLInputElement;

    selectorInput.value = ".ad-block";
    selectorInput.dispatchEvent(new Event("input"));

    nameInput.value = "";
    nameInput.dispatchEvent(new Event("blur"));
    await flushAsync();

    expect(nameInput.value).toBe(".ad-block");
  });

  // ── Save rule ───────────────────────────────────────────────────────────────

  it("Save sends SAVE_RULE with editor values", async () => {
    const savedRule = makeRule({ id: "r-new", name: "#ad", selector: "#ad", css: "display: none;" });
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") return { type: "RULES_DATA", payload: { rules: [], blinds: [] } };
      if (msg.type === "SAVE_RULE") return { type: "RULE_SAVED", payload: { rule: savedRule } };
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    (document.getElementById("rule-selector-input") as HTMLInputElement).value = "#ad";
    (document.getElementById("rule-name-input")     as HTMLInputElement).value  = "#ad";
    (document.getElementById("host-pattern-input")  as HTMLInputElement).value  = HOSTNAME;
    (document.getElementById("rule-css-input")      as HTMLTextAreaElement).value = "display: none;";
    (document.getElementById("important-checkbox")  as HTMLInputElement).checked = false;

    document.getElementById("save-rule-btn")!.click();
    await flushAsync();

    const saveCall = mockSendMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "SAVE_RULE"
    );
    expect(saveCall).toBeDefined();
    expect((saveCall![0] as { payload: { rule: { selector: string } } }).payload.rule.selector)
      .toBe("#ad");
  });

  it("Save appends !important to each declaration when checkbox is checked", async () => {
    const savedRule = makeRule();
    let capturedRule: Partial<Rule> | undefined;
    mockSendMessage.mockImplementation(async (msg: { type: string; payload: { rule?: Partial<Rule> } }) => {
      if (msg.type === "GET_RULES") return { type: "RULES_DATA", payload: { rules: [], blinds: [] } };
      if (msg.type === "SAVE_RULE") {
        capturedRule = msg.payload.rule;
        return { type: "RULE_SAVED", payload: { rule: savedRule } };
      }
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    (document.getElementById("rule-selector-input") as HTMLInputElement).value = ".ad";
    (document.getElementById("host-pattern-input")  as HTMLInputElement).value  = HOSTNAME;
    (document.getElementById("rule-css-input")      as HTMLTextAreaElement).value =
      "display: none;\nvisibility: hidden;";
    (document.getElementById("important-checkbox")  as HTMLInputElement).checked = true;

    document.getElementById("save-rule-btn")!.click();
    await flushAsync();

    expect(capturedRule?.css).toContain("!important");
    const matches = capturedRule?.css!.match(/!important/gi) ?? [];
    expect(matches.length).toBe(2);
  });

  it("Save does not double-add !important to declarations that already have it", async () => {
    const savedRule = makeRule();
    let capturedCSS = "";
    mockSendMessage.mockImplementation(async (msg: { type: string; payload: { rule?: Partial<Rule> } }) => {
      if (msg.type === "GET_RULES") return { type: "RULES_DATA", payload: { rules: [], blinds: [] } };
      if (msg.type === "SAVE_RULE") {
        capturedCSS = msg.payload.rule?.css ?? "";
        return { type: "RULE_SAVED", payload: { rule: savedRule } };
      }
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    (document.getElementById("rule-selector-input") as HTMLInputElement).value = ".ad";
    (document.getElementById("host-pattern-input")  as HTMLInputElement).value  = HOSTNAME;
    (document.getElementById("rule-css-input")      as HTMLTextAreaElement).value =
      "display: none !important;";
    (document.getElementById("important-checkbox")  as HTMLInputElement).checked = true;

    document.getElementById("save-rule-btn")!.click();
    await flushAsync();

    const matches = capturedCSS.match(/!important/gi) ?? [];
    expect(matches.length).toBe(1);
  });

  it("Save sends INJECT_RULE after RULE_SAVED", async () => {
    const savedRule = makeRule({ id: "r-saved" });
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") return { type: "RULES_DATA", payload: { rules: [], blinds: [] } };
      if (msg.type === "SAVE_RULE") return { type: "RULE_SAVED", payload: { rule: savedRule } };
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    (document.getElementById("rule-selector-input") as HTMLInputElement).value = ".x";
    (document.getElementById("host-pattern-input")  as HTMLInputElement).value  = HOSTNAME;

    document.getElementById("save-rule-btn")!.click();
    await flushAsync();

    const injectCall = mockSendMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "INJECT_RULE"
    );
    expect(injectCall).toBeDefined();
  });

  it("Cancel clears all editor fields", async () => {
    await loadSidebar();

    (document.getElementById("rule-selector-input") as HTMLInputElement).value = "#something";
    (document.getElementById("rule-name-input")     as HTMLInputElement).value  = "My rule";
    (document.getElementById("rule-css-input")      as HTMLTextAreaElement).value = "color: red;";

    document.getElementById("cancel-rule-btn")!.click();
    await flushAsync();

    expect((document.getElementById("rule-selector-input") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("rule-name-input")     as HTMLInputElement).value).toBe("");
    expect((document.getElementById("rule-css-input")      as HTMLTextAreaElement).value).toBe("");
  });

  // ── Click-to-edit ───────────────────────────────────────────────────────────

  it("clicking a rule item loads it into the editor", async () => {
    const rule = makeRule({ id: "r1", selector: "#sidebar", name: "Sidebar hider" });
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") {
        return { type: "RULES_DATA", payload: { rules: [rule], blinds: [] } };
      }
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    const item = document.querySelector(".rule-item") as HTMLElement;
    item.click();
    await flushAsync();

    expect((document.getElementById("rule-selector-input") as HTMLInputElement).value)
      .toBe("#sidebar");
    expect((document.getElementById("rule-name-input") as HTMLInputElement).value)
      .toBe("Sidebar hider");
    // Re-query after re-render to get the fresh DOM node.
    const activeItem = document.querySelector(".rule-item") as HTMLElement;
    expect(activeItem.classList.contains("rule-item--active")).toBe(true);
  });

  // ── Toggle ──────────────────────────────────────────────────────────────────

  it("clicking toggle sends TOGGLE_RULE with flipped enabled state", async () => {
    const rule = makeRule({ enabled: true });
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") {
        return { type: "RULES_DATA", payload: { rules: [rule], blinds: [] } };
      }
      if (msg.type === "TOGGLE_RULE") {
        return { type: "RULE_UPDATED", payload: { rule: { ...rule, enabled: false } } };
      }
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    const toggleBtn = document.querySelector("[data-action='toggle']") as HTMLButtonElement;
    toggleBtn.click();
    await flushAsync();

    const toggleCall = mockSendMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "TOGGLE_RULE"
    );
    expect(toggleCall).toBeDefined();
    expect((toggleCall![0] as { payload: { id: string; enabled: boolean } }).payload)
      .toMatchObject({ id: "rule-1", enabled: false });
  });

  it("toggling off sends REMOVE_RULE to content script", async () => {
    const rule = makeRule({ enabled: true });
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") {
        return { type: "RULES_DATA", payload: { rules: [rule], blinds: [] } };
      }
      if (msg.type === "TOGGLE_RULE") {
        return { type: "RULE_UPDATED", payload: { rule: { ...rule, enabled: false } } };
      }
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    (document.querySelector("[data-action='toggle']") as HTMLButtonElement).click();
    await flushAsync();

    const removeCall = mockSendMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "REMOVE_RULE"
    );
    expect(removeCall).toBeDefined();
  });

  it("toggling on sends INJECT_RULE to content script", async () => {
    const rule = makeRule({ enabled: false });
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") {
        return { type: "RULES_DATA", payload: { rules: [rule], blinds: [] } };
      }
      if (msg.type === "TOGGLE_RULE") {
        return { type: "RULE_UPDATED", payload: { rule: { ...rule, enabled: true } } };
      }
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    (document.querySelector("[data-action='toggle']") as HTMLButtonElement).click();
    await flushAsync();

    const injectCall = mockSendMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "INJECT_RULE"
    );
    expect(injectCall).toBeDefined();
  });

  // ── Delete ──────────────────────────────────────────────────────────────────

  it("clicking delete sends DELETE_RULE and REMOVE_RULE", async () => {
    const rule = makeRule();
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") {
        return { type: "RULES_DATA", payload: { rules: [rule], blinds: [] } };
      }
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    (document.querySelector("[data-action='delete']") as HTMLButtonElement).click();
    await flushAsync();

    const deleteCall = mockSendMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "DELETE_RULE"
    );
    const removeCall = mockSendMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "REMOVE_RULE"
    );
    expect(deleteCall).toBeDefined();
    expect(removeCall).toBeDefined();
  });

  it("deleting the rule being edited clears the editor", async () => {
    const rule = makeRule();
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "GET_RULES") {
        return { type: "RULES_DATA", payload: { rules: [rule], blinds: [] } };
      }
      return { type: "OK", payload: {} };
    });

    await loadSidebar();

    // Load rule into editor first.
    (document.querySelector(".rule-item") as HTMLElement).click();
    await flushAsync();
    expect((document.getElementById("rule-selector-input") as HTMLInputElement).value)
      .toBe(rule.selector);

    // Now delete it.
    (document.querySelector("[data-action='delete']") as HTMLButtonElement).click();
    await flushAsync();

    expect((document.getElementById("rule-selector-input") as HTMLInputElement).value).toBe("");
  });

  // ── Regex toggle ────────────────────────────────────────────────────────────

  it("clicking regex-toggle-btn adds the active CSS class", async () => {
    await loadSidebar();
    const btn = document.getElementById("regex-toggle-btn") as HTMLButtonElement;
    btn.click();
    await flushAsync();
    expect(btn.classList.contains("regex-btn--active")).toBe(true);
  });

  it("clicking regex-toggle-btn twice removes the active CSS class", async () => {
    await loadSidebar();
    const btn = document.getElementById("regex-toggle-btn") as HTMLButtonElement;
    btn.click();
    btn.click();
    await flushAsync();
    expect(btn.classList.contains("regex-btn--active")).toBe(false);
  });

  // ── Select Element button ────────────────────────────────────────────────────

  it("select-element-btn starts as 'Select Element'", async () => {
    await loadSidebar();
    const btn = document.getElementById("select-element-btn") as HTMLButtonElement;
    expect(btn.textContent).toBe("Select Element");
  });

  it("clicking select-element-btn sends ENTER_EDIT_MODE and changes label", async () => {
    await loadSidebar();
    const btn = document.getElementById("select-element-btn") as HTMLButtonElement;
    btn.click();
    await flushAsync();
    expect(btn.textContent).toBe("Cancel Selection");
    expect(btn.classList.contains("select-element-btn--picking")).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ENTER_EDIT_MODE", payload: { submode: "style" } })
    );
  });

  it("clicking Cancel Selection sends EXIT_EDIT_MODE and restores label", async () => {
    await loadSidebar();
    const btn = document.getElementById("select-element-btn") as HTMLButtonElement;
    btn.click();          // → picking mode
    await flushAsync();
    btn.click();          // → cancel
    await flushAsync();
    expect(btn.textContent).toBe("Select Element");
    expect(btn.classList.contains("select-element-btn--picking")).toBe(false);
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "EXIT_EDIT_MODE" })
    );
  });

  it("ELEMENT_PICKED resets select-element-btn to Select Element", async () => {
    await loadSidebar();
    const btn = document.getElementById("select-element-btn") as HTMLButtonElement;
    btn.click();          // enter picking mode
    await flushAsync();
    expect(btn.textContent).toBe("Cancel Selection");

    // Simulate ELEMENT_PICKED arriving from content script.
    const listener = capturedListeners[0];
    listener({ type: "ELEMENT_PICKED", payload: { selector: ".foo", computedStyles: {}, tagName: "div" } });
    await flushAsync();
    expect(btn.textContent).toBe("Select Element");
    expect(btn.classList.contains("select-element-btn--picking")).toBe(false);
  });
});
