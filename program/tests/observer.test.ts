/// <reference path="../src/shared/schema.d.ts" />

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    name: "",
    nameIsCustom: false,
    hostPattern: "example.com",
    isRegex: false,
    selector: ".ad",
    css: "display: none",
    forceReapply: true,
    enabled: true,
    ...overrides,
  };
}

/** Flush enough microtask cycles for async IIFEs and MutationObserver callbacks. */
async function flushAsync() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

type ObserverRecord = {
  target: Node;
  options?: MutationObserverInit;
  disconnected: boolean;
};

function installTrackingMutationObserver() {
  const OriginalMutationObserver = globalThis.MutationObserver;
  const records = new Map<object, ObserverRecord[]>();

  class TrackingMutationObserver {
    private readonly key = {};

    constructor(_callback: MutationCallback) {}

    observe(target: Node, options?: MutationObserverInit): void {
      records.set(this.key, [{ target, options, disconnected: false }]);
    }

    disconnect(): void {
      const observerRecords = records.get(this.key);
      if (!observerRecords) return;
      observerRecords.forEach((record) => {
        record.disconnected = true;
      });
    }

    takeRecords(): MutationRecord[] {
      return [];
    }
  }

  vi.stubGlobal("MutationObserver", TrackingMutationObserver as typeof MutationObserver);

  return {
    records,
    restore() {
      vi.stubGlobal("MutationObserver", OriginalMutationObserver);
    },
  };
}

describe("observer", () => {
  let originalPushState: typeof history.pushState;
  let originalReplaceState: typeof history.replaceState;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    // Replace head/body elements entirely so stale MutationObservers from the
    // previous test continue watching the detached node and cannot pollute this test.
    document.documentElement.replaceChild(
      document.createElement("head"),
      document.head
    );
    document.documentElement.replaceChild(
      document.createElement("body"),
      document.body
    );
    originalPushState = history.pushState;
    originalReplaceState = history.replaceState;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  });

  it("does nothing when no forceReapply rules exist", async () => {
    const rule = makeRule({ id: "no-reapply", forceReapply: false });

    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore
    await import("../src/content/observer");
    await flushAsync();

    // history.pushState should not have been patched to trigger re-injection
    expect(history.pushState === originalPushState).toBe(true);

    expect(document.querySelectorAll("[data-quietcss-rule-id]")).toHaveLength(0);
  });

  it("does nothing when hostname is empty", async () => {
    vi.stubGlobal("location", { hostname: "" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [makeRule()], blinds: [] },
        }),
      },
    });

    // @ts-ignore
    await import("../src/content/observer");
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

    await expect(
      (async () => {
        // @ts-ignore
        await import("../src/content/observer");
        await flushAsync();
      })()
    ).resolves.toBeUndefined();

    expect(document.querySelectorAll("[data-quietcss-rule-id]")).toHaveLength(0);
  });

  it("handles an unexpected RULES_DATA response without throwing", async () => {
    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ type: "UNKNOWN", payload: {} }),
      },
    });

    await expect(
      (async () => {
        // @ts-ignore
        await import("../src/content/observer");
        await flushAsync();
      })()
    ).resolves.toBeUndefined();

    expect(document.querySelectorAll("[data-quietcss-rule-id]")).toHaveLength(0);
  });

  it("re-injects a style tag when it is removed from document.head (Scenario A)", async () => {
    const rule = makeRule({ id: "head-obs-rule", selector: ".ad", css: "display: none" });

    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore
    await import("../src/content/observer");
    await flushAsync();

    // Simulate injector.ts having already injected the style tag
    const style = document.createElement("style");
    style.setAttribute("data-quietcss-rule-id", "head-obs-rule");
    document.head.appendChild(style);

    // Simulate SPA framework removing the style tag
    document.head.removeChild(style);
    const removedStyle = document.head.querySelector('[data-quietcss-rule-id="head-obs-rule"]');
    expect(removedStyle).toBeNull();
    await flushAsync();

    const reinjected = document.querySelector('[data-quietcss-rule-id="head-obs-rule"]');
    expect(reinjected).not.toBeNull();
  });

  it("applies inline overrides to newly added elements matching forceReapply rules (Scenario A body)", async () => {
    const rule = makeRule({ id: "body-obs-rule", selector: ".target", css: "display: none" });

    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore
    await import("../src/content/observer");
    await flushAsync();

    const el = document.createElement("div");
    el.className = "target";
    document.body.appendChild(el);

    // Flush MutationObserver microtasks, then advance fake timer past debounce
    await flushAsync();
    vi.runAllTimers();

    expect(el.style.getPropertyValue("display")).toBe("none");
  });

  it("applies inline overrides to descendants of an added element matching the rule selector", async () => {
    const rule = makeRule({ id: "body-descendant-rule", selector: ".inner", css: "opacity: 0" });

    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore
    await import("../src/content/observer");
    await flushAsync();

    const wrapper = document.createElement("div");
    const parentInner = document.createElement("span");
    const childInner = document.createElement("p");
    parentInner.className = "inner";
    childInner.className = "inner";
    parentInner.appendChild(childInner);
    wrapper.appendChild(parentInner);
    document.body.appendChild(wrapper);

    await flushAsync();
    vi.runAllTimers();

    expect(parentInner.style.getPropertyValue("opacity")).toBe("0");
    expect(childInner.style.getPropertyValue("opacity")).toBe("0");
  });

  it("re-injects forceReapply rules on pushState navigation (Scenario B)", async () => {
    const rule = makeRule({ id: "spa-push-rule", selector: ".yt", css: "display: none" });

    vi.stubGlobal("location", { hostname: "youtube.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore
    await import("../src/content/observer");
    await flushAsync();

    history.pushState({}, "", "/watch?v=abc123");
    await flushAsync();

    const styleTag = document.querySelector('[data-quietcss-rule-id="spa-push-rule"]');
    expect(styleTag).not.toBeNull();
    expect(styleTag?.textContent).toContain(".yt");
  });

  it("re-injects forceReapply rules on replaceState navigation (Scenario B)", async () => {
    const rule = makeRule({ id: "spa-replace-rule", selector: ".yt", css: "display: none" });

    vi.stubGlobal("location", { hostname: "youtube.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore
    await import("../src/content/observer");
    await flushAsync();

    history.replaceState({}, "", "/watch?v=xyz");
    await flushAsync();

    expect(document.querySelector('[data-quietcss-rule-id="spa-replace-rule"]')).not.toBeNull();
  });

  it("re-injects forceReapply rules on popstate navigation (Scenario B)", async () => {
    const rule = makeRule({ id: "spa-pop-rule", selector: ".yt", css: "display: none" });

    vi.stubGlobal("location", { hostname: "youtube.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore
    await import("../src/content/observer");
    await flushAsync();

    window.dispatchEvent(new PopStateEvent("popstate"));
    await flushAsync();

    expect(document.querySelector('[data-quietcss-rule-id="spa-pop-rule"]')).not.toBeNull();
  });

  it("does not accumulate duplicate style tags across multiple navigations", async () => {
    const rule = makeRule({ id: "no-dup-rule", selector: ".yt", css: "display: none" });

    vi.stubGlobal("location", { hostname: "youtube.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore
    await import("../src/content/observer");
    await flushAsync();

    history.pushState({}, "", "/watch?v=1");
    await flushAsync();
    history.pushState({}, "", "/watch?v=2");
    await flushAsync();
    history.pushState({}, "", "/watch?v=3");
    await flushAsync();

    const tags = document.querySelectorAll('[data-quietcss-rule-id="no-dup-rule"]');
    expect(tags).toHaveLength(1);
  });

  it("does not activate for disabled forceReapply rules", async () => {
    const rule = makeRule({ id: "disabled-reapply", forceReapply: true, enabled: false });

    vi.stubGlobal("location", { hostname: "example.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    // @ts-ignore
    await import("../src/content/observer");
    await flushAsync();

    history.pushState({}, "", "/navigate");
    await flushAsync();

    expect(document.querySelectorAll("[data-quietcss-rule-id]")).toHaveLength(0);
  });

  it("disconnects and re-connects head/body observers cleanly across navigations", async () => {
    const tracking = installTrackingMutationObserver();
    const rule = makeRule({ id: "observer-lifecycle", selector: ".yt", css: "display: none" });

    vi.stubGlobal("location", { hostname: "youtube.com" });
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          type: "RULES_DATA",
          payload: { rules: [rule], blinds: [] },
        }),
      },
    });

    try {
      // @ts-ignore
      await import("../src/content/observer");
      await flushAsync();

      history.pushState({}, "", "/watch?v=1");
      await flushAsync();
      history.replaceState({}, "", "/watch?v=2");
      await flushAsync();

      const allRecords = Array.from(tracking.records.values()).flat();
      const headRecords = allRecords.filter((record) => record.target === document.head);
      const bodyRecords = allRecords.filter((record) => record.target === document.body);
      const latestHeadRecord = headRecords[headRecords.length - 1];
      const latestBodyRecord = bodyRecords[bodyRecords.length - 1];

      expect(headRecords).toHaveLength(3);
      expect(bodyRecords).toHaveLength(3);
      expect(headRecords.filter((record) => !record.disconnected)).toHaveLength(1);
      expect(bodyRecords.filter((record) => !record.disconnected)).toHaveLength(1);
      // expect all but the last head and body records to be disconnected,
      // indicating clean disconnect/reconnect across navigations
      expect(headRecords.slice(0, -1).every((record) => record.disconnected)).toBe(true);
      expect(bodyRecords.slice(0, -1).every((record) => record.disconnected)).toBe(true);
      expect(latestHeadRecord?.options).toEqual({ childList: true });
      expect(latestBodyRecord?.options).toEqual({ childList: true, subtree: true });
    } finally {
      tracking.restore();
    }
  });
});
