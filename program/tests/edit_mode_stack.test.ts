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
    await runContentScript("src/content/highlight_overlay.ts");
    await runContentScript("src/content/picker.ts");
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
});
