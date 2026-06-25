/// <reference path="../src/shared/schema.d.ts" />
// This file tests the functions of edit_mode.ts, highlight_overlay.ts, and picker.ts

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { readFile } from "node:fs/promises";

type RuntimeMessageHandler = (message: unknown) => Promise<QCMessage> | undefined;

type BrowserStub = {
  runtime: {
    onMessage: {
      addListener: (handler: RuntimeMessageHandler) => void;
    };
    sendMessage: ReturnType<typeof vi.fn>;
  };
};

let messageHandler: RuntimeMessageHandler | undefined;
let allMessageHandlers: RuntimeMessageHandler[] = [];
let browserStub: BrowserStub;

async function runContentScript(relPath: string): Promise<void> {
  const abs = path.resolve(__dirname, "..", relPath);
  const source = await readFile(abs, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      strict: true,
    },
    fileName: relPath,
  });

  vm.runInThisContext(transpiled.outputText, { filename: abs });
}

function getScriptBinding<T>(name: string): T {
  return vm.runInThisContext(name) as T;
}

function rect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return {
        x: left,
        y: top,
        top,
        left,
        width,
        height,
        right: left + width,
        bottom: top + height,
      };
    },
  } as DOMRect;
}

describe("content edit-mode stack", () => {
  beforeAll(async () => {
    browserStub = {
      runtime: {
        onMessage: {
          addListener: (handler: RuntimeMessageHandler) => {
            allMessageHandlers.push(handler);
            messageHandler = handler;
          },
        },
        sendMessage: vi.fn().mockResolvedValue({ type: "OK", payload: {} }),
      },
    };

    vi.stubGlobal("CSS", {
      ...(globalThis.CSS ?? {}),
      escape: (value: string) => value,
    });

    vi.stubGlobal("browser", browserStub);

    await runContentScript("src/shared/selector_gen.ts");
    await runContentScript("src/shared/pattern_fills.ts");
    await runContentScript("src/content/highlight_overlay.ts");
    await runContentScript("src/content/picker.ts");
    await runContentScript("src/content/blind.ts");
    await runContentScript("src/content/edit_mode.ts");
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    browserStub.runtime.sendMessage.mockClear();
    document.documentElement.innerHTML = "<head></head><body></body>";

    const overlay = getScriptBinding<{ hideOverlay: () => void }>("highlightOverlay");
    overlay.hideOverlay();

    const pickerInstance = getScriptBinding<{ deactivate: () => void }>("picker");
    pickerInstance.deactivate();

    const blindRenderer = getScriptBinding<{ deactivateDrawMode: () => void }>("blindRenderer");
    blindRenderer.deactivateDrawMode();
  });

  describe("highlight_overlay.ts", () => {
    it("positionOverlay creates and positions the overlay", () => {
      const overlay = getScriptBinding<{
        positionOverlay: (el: Element) => void;
        hideOverlay: () => void;
      }>("highlightOverlay");

      const rectTop = 10;
      const rectLeft = 20;
      const rectWidth = 200;
      const rectHeight = 50;

      const target = document.createElement("div");
      target.id = "target-a";
      target.getBoundingClientRect = () => rect(rectTop, rectLeft, rectWidth, rectHeight);
      document.body.appendChild(target);

      overlay.positionOverlay(target);

      const root = document.getElementById("quietcss-highlight-overlay");
      const fill = root?.querySelector<HTMLDivElement>(".quietcss-hl-fill");

      expect(root).not.toBeNull();
      expect(fill?.style.top).toBe(`${rectTop}px`);
      expect(fill?.style.left).toBe(`${rectLeft}px`);
      expect(fill?.style.width).toBe(`${rectWidth}px`);
      expect(fill?.style.height).toBe(`${rectHeight}px`);

      overlay.hideOverlay();
    });

    it("hideOverlay removes the overlay and can be called repeatedly", () => {
      const overlay = getScriptBinding<{
        positionOverlay: (el: Element) => void;
        hideOverlay: () => void;
      }>("highlightOverlay");

      const target = document.createElement("div");
      target.getBoundingClientRect = () => rect(1, 2, 3, 4);
      document.body.appendChild(target);

      overlay.positionOverlay(target);
      expect(document.getElementById("quietcss-highlight-overlay")).not.toBeNull();

      overlay.hideOverlay();

      expect(document.getElementById("quietcss-highlight-overlay")).toBeNull();
    });
  });

  describe("picker.ts", () => {
    it("clicking a target locks overlay and sends ELEMENT_PICKED", async () => {
      const pickerInstance = getScriptBinding<{ activate: () => void; deactivate: () => void }>("picker");
      const sendMessage = getScriptBinding<ReturnType<typeof vi.fn>>("browser.runtime.sendMessage");

      const target = document.createElement("button");
      target.id = "save-btn";
      target.getBoundingClientRect = () => rect(1, 2, 3, 4);
      document.body.appendChild(target);

      pickerInstance.activate();
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await Promise.resolve();

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ELEMENT_PICKED",
          payload: expect.objectContaining({
            selector: "#save-btn",
            tagName: "button",
            computedStyles: expect.any(Object),
          }),
        })
      );

      pickerInstance.deactivate();
    });

    it("deactivate removes active hover behavior", () => {
      const pickerInstance = getScriptBinding<{ activate: () => void; deactivate: () => void }>("picker");
      const overlay = getScriptBinding<{ hideOverlay: () => void }>("highlightOverlay");

      const target = document.createElement("div");
      target.className = "tile";
      target.getBoundingClientRect = () => rect(1, 2, 3, 4);
      document.body.appendChild(target);

      pickerInstance.activate();
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      expect(document.getElementById("quietcss-highlight-overlay")).not.toBeNull();

      pickerInstance.deactivate();
      overlay.hideOverlay();

      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      expect(document.getElementById("quietcss-highlight-overlay")).toBeNull();
    });
  });

  describe("edit_mode.ts", () => {
    it("ENTER_EDIT_MODE style activates picker and EXIT_EDIT_MODE tears down overlay", async () => {
      const handler = messageHandler;
      if (!handler) {
        expect.fail("onMessage handler was not registered");
      }

      const target = document.createElement("div");
      target.id = "main-panel";
      target.getBoundingClientRect = () => rect(1, 2, 3, 4);
      document.body.appendChild(target);

      const enterResult = await handler({
        type: "ENTER_EDIT_MODE",
        payload: { submode: "style" },
      });
      expect(enterResult).toEqual({ type: "OK", payload: {} });

      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      expect(document.getElementById("quietcss-highlight-overlay")).not.toBeNull();

      const exitResult = await handler({ type: "EXIT_EDIT_MODE", payload: {} });
      expect(exitResult).toEqual({ type: "OK", payload: {} });
      expect(document.getElementById("quietcss-highlight-overlay")).toBeNull();
    });

    it("GENERATE_SELECTOR sends SELECTOR_GENERATED after element is locked", async () => {
      const handler = messageHandler;
      if (!handler) {
        expect.fail("onMessage handler was not registered");
        return;
      }

      // Enter style mode so picker is active
      await handler({ type: "ENTER_EDIT_MODE", payload: { submode: "style" } });

      // Simulate picking an element by clicking it
      const target = document.createElement("div");
      target.id = "picked-element";
      target.getBoundingClientRect = () => rect(0, 0, 100, 50);
      document.body.appendChild(target);

      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      // At this point picker is locked; GENERATE_SELECTOR should trigger a sendMessage
      browserStub.runtime.sendMessage.mockClear();
      const genResult = await handler({ type: "GENERATE_SELECTOR", payload: {} });
      expect(genResult).toEqual({ type: "OK", payload: {} });

      expect(browserStub.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SELECTOR_GENERATED",
          payload: expect.objectContaining({
            selector: expect.any(String),
            confidence: expect.stringMatching(/^high|medium|low$/),
          }),
        })
      );

      target.remove();
    });

    it("GENERATE_SELECTOR does nothing when picker is not locked", async () => {
      const handler = messageHandler;
      if (!handler) {
        expect.fail("onMessage handler was not registered");
        return;
      }

      // Do NOT enter edit mode — picker is inactive
      browserStub.runtime.sendMessage.mockClear();
      await handler({ type: "GENERATE_SELECTOR", payload: {} });

      expect(browserStub.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("blind.ts", () => {
    function makeBlind(id: string, overrides: Partial<Blind> = {}): Blind {
      return {
        id,
        name: "Test Blind",
        hostPattern: "example.com",
        isRegex: false,
        top: 100,
        left: 50,
        width: 200,
        height: 80,
        positionMode: "absolute",
        color: "#1a1a2e",
        pattern: "none",
        enabled: true,
        ...overrides,
      };
    }

    it("renderBlind creates a blind element with correct position and dimensions", () => {
      const br = getScriptBinding<{ renderBlind: (b: Blind) => void }>("blindRenderer");
      br.renderBlind(makeBlind("render-test-1"));

      const container = document.getElementById("quietcss-blinds-container");
      const el = container?.querySelector<HTMLElement>('[data-quietcss-blind-id="render-test-1"]');

      expect(container).not.toBeNull();
      expect(el).not.toBeNull();
      expect(el?.style.top).toBe("100px");
      expect(el?.style.left).toBe("50px");
      expect(el?.style.width).toBe("200px");
      expect(el?.style.height).toBe("80px");
      expect(el?.style.position).toBe("absolute");
    });

    it("renderBlind with enabled=false hides the element", () => {
      const br = getScriptBinding<{ renderBlind: (b: Blind) => void }>("blindRenderer");
      br.renderBlind(makeBlind("render-test-2", { enabled: false }));

      const container = document.getElementById("quietcss-blinds-container");
      const el = container?.querySelector<HTMLElement>('[data-quietcss-blind-id="render-test-2"]');

      expect(el).not.toBeNull();
      expect(el?.style.display).toBe("none");
    });

    it("renderBlind updating an existing blind re-applies styles", () => {
      const br = getScriptBinding<{ renderBlind: (b: Blind) => void }>("blindRenderer");
      br.renderBlind(makeBlind("render-test-3", { top: 10, left: 10 }));
      br.renderBlind(makeBlind("render-test-3", { top: 99, left: 77 }));

      const container = document.getElementById("quietcss-blinds-container");
      const els = container?.querySelectorAll('[data-quietcss-blind-id="render-test-3"]');

      expect(els?.length).toBe(1);
      expect((els?.[0] as HTMLElement).style.top).toBe("99px");
      expect((els?.[0] as HTMLElement).style.left).toBe("77px");
    });

    it("removeBlind removes the element from the DOM", () => {
      const br = getScriptBinding<{ renderBlind: (b: Blind) => void; removeBlind: (id: string) => void }>("blindRenderer");
      br.renderBlind(makeBlind("remove-test-1"));
      expect(document.querySelector('[data-quietcss-blind-id="remove-test-1"]')).not.toBeNull();

      br.removeBlind("remove-test-1");

      expect(document.querySelector('[data-quietcss-blind-id="remove-test-1"]')).toBeNull();
    });

    it("updateBlind without positionMode change updates element position in place", () => {
      const br = getScriptBinding<{ renderBlind: (b: Blind) => void; updateBlind: (b: Blind) => Blind }>("blindRenderer");
      br.renderBlind(makeBlind("update-test-1", { top: 100, left: 50, positionMode: "absolute" }));

      const result = br.updateBlind(makeBlind("update-test-1", { top: 200, left: 80, positionMode: "absolute" }));

      expect(result.top).toBe(200);
      expect(result.left).toBe(80);
      const el = document.querySelector<HTMLElement>('[data-quietcss-blind-id="update-test-1"]');
      expect(el?.style.top).toBe("200px");
      expect(el?.style.left).toBe("80px");
    });

    it("updateBlind converts coords when positionMode changes absolute → fixed", () => {
      const br = getScriptBinding<{ renderBlind: (b: Blind) => void; updateBlind: (b: Blind) => Blind }>("blindRenderer");
      br.renderBlind(makeBlind("update-test-2", { positionMode: "absolute", top: 100, left: 50 }));

      // Stub non-zero scroll so the coord conversion produces different values than the incoming blind
      Object.defineProperty(window, "scrollY", { value: 40, configurable: true, writable: true });
      Object.defineProperty(window, "scrollX", { value: 20, configurable: true, writable: true });

      const result = br.updateBlind(makeBlind("update-test-2", { positionMode: "fixed", top: 100, left: 50 }));

      // absolute → fixed: subtract scroll
      expect(result.top).toBe(100 - window.scrollY);
      expect(result.left).toBe(50 - window.scrollX);
      expect(result.positionMode).toBe("fixed");
    });

    it("updateBlind converts coords when positionMode changes fixed → absolute", () => {
      const br = getScriptBinding<{ renderBlind: (b: Blind) => void; updateBlind: (b: Blind) => Blind }>("blindRenderer");

      // Stub non-zero scroll so the coord conversion produces different values than the incoming blind
      Object.defineProperty(window, "scrollY", { value: 40, configurable: true, writable: true });
      Object.defineProperty(window, "scrollX", { value: 20, configurable: true, writable: true });

      br.renderBlind(makeBlind("update-test-3", { positionMode: "fixed", top: 100, left: 50 }));

      const result = br.updateBlind(makeBlind("update-test-3", { positionMode: "absolute", top: 100, left: 50 }));

      // fixed → absolute: add scroll
      expect(result.top).toBe(100 + window.scrollY);
      expect(result.left).toBe(50 + window.scrollX);
      expect(result.positionMode).toBe("absolute");
    });

    it("activateDrawMode injects a crosshair cursor style into document head", () => {
      const br = getScriptBinding<{ activateDrawMode: () => void; deactivateDrawMode: () => void }>("blindRenderer");
      br.activateDrawMode();

      const cursorStyle = document.getElementById("quietcss-blind-cursor");
      expect(cursorStyle).not.toBeNull();
      expect(cursorStyle?.textContent).toContain("crosshair");

      br.deactivateDrawMode();
    });

    it("deactivateDrawMode removes the cursor style tag", () => {
      const br = getScriptBinding<{ activateDrawMode: () => void; deactivateDrawMode: () => void }>("blindRenderer");
      br.activateDrawMode();
      expect(document.getElementById("quietcss-blind-cursor")).not.toBeNull();

      br.deactivateDrawMode();

      expect(document.getElementById("quietcss-blind-cursor")).toBeNull();
    });

    it("draw: mousedown + mousemove + mouseup sends BLIND_DRAWN with correct coordinates", async () => {
      const br = getScriptBinding<{ activateDrawMode: () => void }>("blindRenderer");
      br.activateDrawMode();
      browserStub.runtime.sendMessage.mockClear();

      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 20, button: 0 }));
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 110, clientY: 120 }));
      document.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, clientX: 110, clientY: 120, button: 0 }));

      await Promise.resolve();

      expect(browserStub.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "BLIND_DRAWN",
          payload: { top: 20, left: 10, width: 100, height: 100 },
        })
      );
    });

    it("draw: sub-5px drag is ignored and does not send BLIND_DRAWN", async () => {
      const br = getScriptBinding<{ activateDrawMode: () => void }>("blindRenderer");
      br.activateDrawMode();
      browserStub.runtime.sendMessage.mockClear();

      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 20, button: 0 }));
      document.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, clientX: 12, clientY: 22, button: 0 }));

      await Promise.resolve();

      expect(browserStub.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it("UPDATE_BLIND message renders the blind and returns OK", async () => {
      // blind.ts registers its onMessage handler before edit_mode.ts, so it is allMessageHandlers[0]
      const handler = allMessageHandlers[0];
      if (!handler) {
        expect.fail("blind.ts onMessage handler was not registered");
        return;
      }

      const result = await handler({ type: "UPDATE_BLIND", payload: { blind: makeBlind("msg-test-1") } });

      expect(result).toEqual({ type: "OK", payload: {} });
      expect(document.querySelector('[data-quietcss-blind-id="msg-test-1"]')).not.toBeNull();
    });

    it("REMOVE_BLIND message removes the blind and returns OK", async () => {
      const handler = allMessageHandlers[0];
      if (!handler) {
        expect.fail("blind.ts onMessage handler was not registered");
        return;
      }

      const br = getScriptBinding<{ renderBlind: (b: Blind) => void }>("blindRenderer");
      br.renderBlind(makeBlind("msg-test-2"));
      expect(document.querySelector('[data-quietcss-blind-id="msg-test-2"]')).not.toBeNull();

      const result = await handler({ type: "REMOVE_BLIND", payload: { id: "msg-test-2" } });

      expect(result).toEqual({ type: "OK", payload: {} });
      expect(document.querySelector('[data-quietcss-blind-id="msg-test-2"]')).toBeNull();
    });

    it("UPDATE_BLIND sends BLIND_COORDS_ADJUSTED when positionMode changes", async () => {
      const handler = allMessageHandlers[0];
      if (!handler) {
        expect.fail("blind.ts onMessage handler was not registered");
        return;
      }

      // Stub non-zero scroll so the coord conversion produces different values than the incoming blind
      Object.defineProperty(window, "scrollY", { value: 40, configurable: true, writable: true });
      Object.defineProperty(window, "scrollX", { value: 20, configurable: true, writable: true });

      const br = getScriptBinding<{ renderBlind: (b: Blind) => void }>("blindRenderer");
      br.renderBlind(makeBlind("msg-test-3", { positionMode: "absolute", top: 100, left: 50 }));
      browserStub.runtime.sendMessage.mockClear();

      try {
        await handler({
          type: "UPDATE_BLIND",
          payload: { blind: makeBlind("msg-test-3", { positionMode: "fixed", top: 100, left: 50 }) },
        });

        expect(browserStub.runtime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "BLIND_COORDS_ADJUSTED",
            payload: expect.objectContaining({
              id: "msg-test-3",
              top: 60, // 100 - scrollY(40)
              left: 30, // 50 - scrollX(20)
            }),
          })
        );
      } finally {
        Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
        Object.defineProperty(window, "scrollX", { value: 0, configurable: true, writable: true });
      }
    });
  });
});
