/// <reference path="../src/shared/schema.d.ts" />

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

// The service worker calls browser.runtime.onMessage.addListener at module load.
// We capture the handler here so tests can invoke it directly.
type MsgHandler = (
  msg: unknown,
  sender: unknown
) => Promise<unknown> | undefined;

type TabActivatedListener = (activeInfo: { tabId: number }) => void;
type TabUpdatedListener = (
  tabId: number,
  changeInfo: { url?: string },
  tab: { active: boolean }
) => void;

let handler: MsgHandler;
let activatedListener: TabActivatedListener;
let updatedListener: TabUpdatedListener;

const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockTabsGet = vi.fn();
const mockRuntimeSendMessage = vi.fn();

// Stub the browser global BEFORE the dynamic import below so it is in place
// when the module's top-level addListener call executes.
vi.stubGlobal("browser", {
  runtime: {
    sendMessage: mockRuntimeSendMessage,
    onMessage: {
      addListener: (h: MsgHandler) => {
        handler = h;
      },
    },
  },
  tabs: {
    get: mockTabsGet,
    onActivated: {
      addListener: (listener: TabActivatedListener) => {
        activatedListener = listener;
      },
    },
    onUpdated: {
      addListener: (listener: TabUpdatedListener) => {
        updatedListener = listener;
      },
    },
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
    },
  },
});

// Dynamically import the service worker so module-level side effects
// (addListener) run after the stub above is applied.
beforeAll(async () => {
  await import("../src/background/service_worker");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ---------- helpers ----------

const RULES_KEY = "quietcss_rules";
const BLINDS_KEY = "quietcss_blinds";

function getFirstStorageSetCallArgument(): unknown {
  if (!mockStorageSet.mock.calls.length || !mockStorageSet.mock.calls[0].length) {
    expect.fail("mockStorageSet was never called, indicating a failure in function saveAllRules");
  } else {
    return (mockStorageSet.mock.calls as unknown[][])[0][0];
  }
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    name: "",
    nameIsCustom: false,
    hostPattern: "example.com",
    isRegex: false,
    selector: ".ad",
    css: "display: none;",
    forceReapply: false,
    enabled: true,
    ...overrides,
  };
}

function makeBlind(overrides: Partial<Blind> = {}): Blind {
  return {
    id: "b1",
    name: "",
    hostPattern: "example.com",
    isRegex: false,
    top: 0,
    left: 0,
    width: 200,
    height: 100,
    positionMode: "absolute",
    color: "#000",
    pattern: "dots",
    enabled: true,
    ...overrides,
  };
}

describe("service_worker message handler", () => {
  beforeEach(() => {
    mockStorageGet.mockReset();
    mockStorageSet.mockReset();
    mockStorageSet.mockResolvedValue(undefined);
    mockTabsGet.mockReset();
    mockRuntimeSendMessage.mockReset();
  });

  // ---------- PING ----------

  it("PING returns PONG with echo payload", async () => {
    const msg = { type: "PING", payload: {} };
    const result = await (handler(msg, {}) as Promise<unknown>);
    expect(result).toEqual({ type: "PONG", payload: { echo: msg } });
  });

  // ---------- GET_RULES ----------

  it("broadcasts TAB_CHANGED when the active tab changes", async () => {
    // A mock for when broadcastTabChanged gets the new tab values.
    mockTabsGet.mockResolvedValue({ id: 7, url: "https://www.youtube.com/watch?v=abc" });

    activatedListener({ tabId: 7 });
    await Promise.resolve();

    expect(mockRuntimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "TAB_CHANGED",
        payload: expect.objectContaining({
          tabId: 7,
          hostname: "www.youtube.com",
          url: "https://www.youtube.com/watch?v=abc",
        }),
      })
    );
  });

  it("broadcasts TAB_CHANGED when the active tab URL changes", async () => {
    mockTabsGet.mockResolvedValue({ id: 8, url: "https://example.com/page" });

    updatedListener(8, { url: "https://example.com/page" }, { active: true });
    await Promise.resolve();

    expect(mockRuntimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "TAB_CHANGED",
        payload: expect.objectContaining({
          tabId: 8,
          hostname: "example.com",
          url: "https://example.com/page",
        }),
      })
    );
  });

  it("GET_RULES returns rules and blinds matching the hostname", async () => {
    const rule = makeRule({ hostPattern: "example.com" });
    const blind = makeBlind({ hostPattern: "example.com" });
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === RULES_KEY) return { [RULES_KEY]: [rule] };
      if (key === BLINDS_KEY) return { [BLINDS_KEY]: [blind] };
      return {};
    });

    const result = (await (handler(
      { type: "GET_RULES", payload: { hostname: "example.com", url: "https://example.com/page" } },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { rules: Rule[]; blinds: Blind[] } };

    expect(result.type).toBe("RULES_DATA");
    expect(result.payload.rules).toHaveLength(1);
    expect(result.payload.blinds).toHaveLength(1);
  });

  it("GET_RULES filters out entries that do not match the hostname", async () => {
    const rule = makeRule({ hostPattern: "other.com" });
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === RULES_KEY) return { [RULES_KEY]: [rule] };
      if (key === BLINDS_KEY) return {};
      return {};
    });

    const result = (await (handler(
      { type: "GET_RULES", payload: { hostname: "example.com", url: "https://example.com/page" } },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { rules: Rule[] } };

    expect(result.payload.rules).toHaveLength(0);
  });

  it("GET_RULES matches via regex hostPattern against the full URL", async () => {
    const rule = makeRule({ hostPattern: ".*\.youtube\.com", isRegex: true });
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === RULES_KEY) return { [RULES_KEY]: [rule] };
      if (key === BLINDS_KEY) return {};
      return {};
    });

    const result = (await (handler(
      { type: "GET_RULES", payload: { hostname: "www.youtube.com", url: "https://www.youtube.com/watch?v=abc" } },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { rules: Rule[] } };

    expect(result.payload.rules).toHaveLength(1);
  });

  it("GET_RULES regex matches a pattern that includes a URL path segment", async () => {
    // Pattern targets a specific path — would never match the bare hostname alone.
    const rule = makeRule({ hostPattern: "www\.youtube\.com\/", isRegex: true });
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === RULES_KEY) return { [RULES_KEY]: [rule] };
      if (key === BLINDS_KEY) return {};
      return {};
    });

    // URL that matches the pattern.
    const hit = (await (handler(
      { type: "GET_RULES", payload: { hostname: "www.youtube.com", url: "https://www.youtube.com/watch?v=abc" } },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { rules: Rule[] } };
    expect(hit.payload.rules).toHaveLength(1);

    // Bare hostname URL — should NOT match because the pattern requires a slash.
    const miss = (await (handler(
      { type: "GET_RULES", payload: { hostname: "www.youtube.com", url: "https://www.youtube.com" } },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { rules: Rule[] } };
    expect(miss.payload.rules).toHaveLength(0);
  });

  // ---------- SAVE_RULE ----------

  it("SAVE_RULE inserts a new rule and returns RULE_SAVED", async () => {
    mockStorageGet.mockResolvedValue({});

    const result = (await (handler(
      {
        type: "SAVE_RULE",
        payload: { rule: { selector: ".btn", css: "opacity:0;", hostPattern: "example.com" } },
      },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { rule: Rule } };

    expect(result.type).toBe("RULE_SAVED");
    expect(result.payload.rule.selector).toBe(".btn");
    expect(mockStorageSet).toHaveBeenCalledWith(
      expect.objectContaining({
        [RULES_KEY]: expect.arrayContaining([
          expect.objectContaining({ selector: ".btn" }),
        ]),
      })
    );
  });

  it("SAVE_RULE updates an existing rule when the id matches", async () => {
    const existing = makeRule({ id: "r1", selector: ".old" });
    mockStorageGet.mockResolvedValue({ [RULES_KEY]: [existing] });

    await (handler(
      {
        type: "SAVE_RULE",
        payload: { rule: { id: "r1", selector: ".new", css: "display:none;", hostPattern: "example.com" } },
      },
      {}
    ) as Promise<unknown>);

    const saved: Rule[] = (getFirstStorageSetCallArgument() as Record<string, Rule[]>)[RULES_KEY];
    expect(saved).toHaveLength(1);
    expect(saved[0].selector).toBe(".new");
  });

  it("SAVE_RULE returns ERROR when hostPattern is empty", async () => {
    mockStorageGet.mockResolvedValue({});

    const result = (await (handler(
      {
        type: "SAVE_RULE",
        payload: { rule: { selector: ".foo", css: "color:red;", hostPattern: "" } },
      },
      {}
    ) as Promise<unknown>)) as { type: string };

    expect(result.type).toBe("ERROR");
  });

  // ---------- DELETE_RULE ----------

  it("DELETE_RULE removes the rule with the given id", async () => {
    const rule = makeRule({ id: "r1" });
    mockStorageGet.mockResolvedValue({ [RULES_KEY]: [rule] });

    const result = (await (handler(
      { type: "DELETE_RULE", payload: { id: "r1" } },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { id: string } };

    expect(result.type).toBe("RULE_DELETED");
    expect(result.payload.id).toBe("r1");

    const existingRules: Rule[] =
      (getFirstStorageSetCallArgument() as Record<string, Rule[]>)[RULES_KEY];
    expect(existingRules).toHaveLength(0);
  });

  // ---------- TOGGLE_RULE ----------

  it("TOGGLE_RULE disables an enabled rule", async () => {
    const rule = makeRule({ id: "r1", enabled: true });
    mockStorageGet.mockResolvedValue({ [RULES_KEY]: [rule] });

    const result = (await (handler(
      { type: "TOGGLE_RULE", payload: { id: "r1", enabled: false } },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { rule: Rule } };

    expect(result.type).toBe("RULE_UPDATED");
    expect(result.payload.rule.enabled).toBe(false);
    const storedRules: Rule[] =
      (getFirstStorageSetCallArgument() as Record<string, Rule[]>)[RULES_KEY];
    expect(storedRules).toHaveLength(1);
    expect(storedRules[0].enabled).toBe(false);
  });

  it("TOGGLE_RULE returns ERROR when rule id is not found", async () => {
    mockStorageGet.mockResolvedValue({ [RULES_KEY]: [] });

    const result = (await (handler(
      { type: "TOGGLE_RULE", payload: { id: "missing", enabled: true } },
      {}
    ) as Promise<unknown>)) as { type: string };

    expect(result.type).toBe("ERROR");
  });

  // ---------- SAVE_BLIND ----------

  it("SAVE_BLIND inserts a new blind and returns BLIND_SAVED", async () => {
    mockStorageGet.mockResolvedValue({});

    const result = (await (handler(
      {
        type: "SAVE_BLIND",
        payload: { blind: { hostPattern: "example.com", width: 300, height: 150 } },
      },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { blind: Blind } };

    expect(result.type).toBe("BLIND_SAVED");
    expect(result.payload.blind.width).toBe(300);
    const saved: Blind[] =
      (getFirstStorageSetCallArgument() as Record<string, Blind[]>)[BLINDS_KEY];
    expect(saved).toHaveLength(1);
    expect(saved[0].height).toBe(150);
  });

  // ---------- DELETE_BLIND ----------

  it("DELETE_BLIND removes the blind with the given id", async () => {
    const blind = makeBlind({ id: "b1" });
    mockStorageGet.mockResolvedValue({ [BLINDS_KEY]: [blind] });

    const result = (await (handler(
      { type: "DELETE_BLIND", payload: { id: "b1" } },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { id: string } };

    expect(result.type).toBe("BLIND_DELETED");
    expect(result.payload.id).toBe("b1");
    const storedBlinds: Blind[] =
      (getFirstStorageSetCallArgument() as Record<string, Blind[]>)[BLINDS_KEY];
    expect(storedBlinds).toHaveLength(0);
  });

  // ---------- TOGGLE_BLIND ----------

  it("TOGGLE_BLIND enables a disabled blind", async () => {
    const blind = makeBlind({ id: "b1", enabled: false });
    mockStorageGet.mockResolvedValue({ [BLINDS_KEY]: [blind] });

    const result = (await (handler(
      { type: "TOGGLE_BLIND", payload: { id: "b1", enabled: true } },
      {}
    ) as Promise<unknown>)) as { type: string; payload: { blind: Blind } };

    expect(result.type).toBe("BLIND_UPDATED");
    expect(result.payload.blind.enabled).toBe(true);
    const storedBlinds: Blind[] =
      (getFirstStorageSetCallArgument() as Record<string, Blind[]>)[BLINDS_KEY];
    expect(storedBlinds[0].enabled).toBe(true);
  });

  it("TOGGLE_BLIND returns ERROR when blind id is not found", async () => {
    mockStorageGet.mockResolvedValue({ [BLINDS_KEY]: [] });

    const result = (await (handler(
      { type: "TOGGLE_BLIND", payload: { id: "missing", enabled: true } },
      {}
    ) as Promise<unknown>)) as { type: string };

    expect(result.type).toBe("ERROR");
  });

  // ---------- unknown type ----------

  it("unknown message type returns undefined", () => {
    const result = handler({ type: "UNKNOWN", payload: {} }, {});
    expect(result).toBeUndefined();
  });
});
