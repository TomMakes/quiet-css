/// <reference path="../src/shared/schema.d.ts" />

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// injector.ts is an IIFE module — it runs immediately on import.
// We reset modules between tests so each scenario gets a fresh execution.
// The browser mock must be in place before the dynamic import.

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

/** Flush enough microtask cycles for the async IIFE to complete after import. */
async function flushAsync() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("injector IIFE", () => {
  beforeEach(() => {
    vi.resetModules();
    // Clean up any injected style tags between tests
    document.head.innerHTML = "";
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects a <style> tag for each enabled rule", async () => {
    const rule = makeRule({ id: "rule-1", selector: ".ad", css: "display:none;" });

    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore: injector needs to be imported for IIFE to kick off
    await import("../src/content/injector");
    await flushAsync();

    const styleTag = document.querySelector('[data-quietcss-rule-id="rule-1"]');
    expect(styleTag).not.toBeNull();
    expect(styleTag?.textContent).toContain(".ad");
    expect(styleTag?.textContent).toContain("display:none;");
  });

  it("does not inject a <style> tag for a disabled rule", async () => {
    const rule = makeRule({ id: "rule-disabled", enabled: false });

    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore: injector needs to be imported for IIFE to kick off
    await import("../src/content/injector");
    await flushAsync();

    expect(document.querySelector('[data-quietcss-rule-id="rule-disabled"]')).toBeNull();
  });

  it("does not double-inject when the same rule id is already present", async () => {
    const rule = makeRule({ id: "rule-dup" });

    // Pre-insert a style tag as if it were already injected
    const existing = document.createElement("style");
    existing.setAttribute("data-quietcss-rule-id", "rule-dup");
    document.head.appendChild(existing);

    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore: injector needs to be imported for IIFE to kick off
    await import("../src/content/injector");
    await flushAsync();

    const tags = document.querySelectorAll('[data-quietcss-rule-id="rule-dup"]');
    expect(tags).toHaveLength(1);
  });

  it("injects nothing when hostname is empty", async () => {
    const rule = makeRule({ id: "rule-non-injected" });

    vi.stubGlobal("location", { hostname: "" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore: injector needs to be imported for IIFE to kick off
    await import("../src/content/injector");
    await flushAsync();

    expect(document.querySelectorAll("[data-quietcss-rule-id]")).toHaveLength(0);
  });

  it("handles a sendMessage error without throwing", async () => {
    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockRejectedValue(new Error("Service worker error")),
      },
    });

    // Should not throw
    await expect(
      (async () => {
        // @ts-ignore: injector needs to be imported for IIFE to kick off
        await import("../src/content/injector");
        await flushAsync();
      })()
    ).resolves.toBeUndefined();

    expect(document.querySelectorAll("[data-quietcss-rule-id]")).toHaveLength(0);
  });

  it("handles an unexpected response type without throwing", async () => {
    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ type: "UNKNOWN", payload: {} }),
      },
    });

    await expect(
      (async () => {
        // @ts-ignore: injector needs to be imported for IIFE to kick off
        await import("../src/content/injector");
        await flushAsync();
      })()
    ).resolves.toBeUndefined();

    expect(document.querySelectorAll("[data-quietcss-rule-id]")).toHaveLength(0);
  });

  it("sends GET_RULES with the current hostname", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      type: "RULES_DATA",
      payload: { rules: [], blinds: [] },
    });

    vi.stubGlobal("location", { hostname: "www.example.com" });
    vi.stubGlobal("browser", { runtime: { sendMessage } });

    // @ts-ignore: injector needs to be imported for IIFE to kick off
    await import("../src/content/injector");
    await flushAsync();

    expect(sendMessage).toHaveBeenCalledWith({
      type: "GET_RULES",
      payload: { hostname: "www.example.com" },
    });
  });
});
