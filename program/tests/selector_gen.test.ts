/// <reference path="../src/shared/schema.d.ts" />

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { readFile } from "node:fs/promises";

// ── Helpers (same pattern as edit_mode_stack.test.ts) ─────────────────────

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

function fn<T>(name: string): T {
  return vm.runInThisContext(name) as T;
}

type SelectorGeneratorClass = {
  generateSelector: (element: Element) => SelectorResult;
  validateSelector: (selectorString: string) => ValidationResult;
};

function selectorGenerator(): SelectorGeneratorClass {
  return fn<SelectorGeneratorClass>("SelectorGenerator");
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  vi.stubGlobal("CSS", {
    ...(globalThis.CSS ?? {}),
    escape: (v: string) => v.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, "\\$1"),
  });
  await runContentScript("src/shared/selector_gen.ts");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ── validateSelector ───────────────────────────────────────────────────────

describe("validateSelector", () => {
  it("returns valid for a well-formed selector", () => {
    const validateSel = selectorGenerator().validateSelector;
    expect(validateSel("#my-id").valid).toBe(true);
    expect(validateSel(".some-class").valid).toBe(true);
    expect(validateSel("div > span:nth-child(2)").valid).toBe(true);
  });

  it("returns invalid for a broken selector", () => {
    const validateSel = selectorGenerator().validateSelector;
    const result = validateSel("###bad");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns invalid for an empty string", () => {
    const validateSel = selectorGenerator().validateSelector;
    expect(validateSel("").valid).toBe(false);
    expect(validateSel("   ").valid).toBe(false);
  });
});

// ── generateSelector ───────────────────────────────────────────────────────

describe("generateSelector — strategy 1: ID", () => {
  it("returns #id with high confidence when element has a long non-numeric id", () => {
    const gen = selectorGenerator().generateSelector;
    const el = document.createElement("div");
    el.id = "main-content";
    document.body.appendChild(el);
    const result = gen(el);
    el.remove();
    expect(result.selector).toBe("#main-content");
    expect(result.confidence).toBe("high");
  });

  it("skips very short ids (<=2 chars)", () => {
    const gen = selectorGenerator().generateSelector;
    const el = document.createElement("div");
    el.id = "ab";
    // give it a stable class so it doesn't fall through to positional
    el.className = "stable-class";
    document.body.appendChild(el);
    const result = gen(el);
    el.remove();
    expect(result.selector).not.toMatch(/^#ab/);
  });

  it("skips purely numeric ids", () => {
    const gen = selectorGenerator().generateSelector;
    const el = document.createElement("div");
    el.id = "12345";
    el.className = "stable-class";
    document.body.appendChild(el);
    const result = gen(el);
    el.remove();
    expect(result.selector).not.toMatch(/^#12345/);
  });
});

describe("generateSelector — strategy 2: tag + stable classes", () => {
  it("returns tag.class with high confidence when selector is unique", () => {
    const gen = selectorGenerator().generateSelector;
    const el = document.createElement("div");
    el.className = "sidebar-content unique-block";
    document.body.appendChild(el);
    const result = gen(el);
    el.remove();
    expect(result.selector).toContain("div");
    expect(result.selector).toContain("sidebar-content");
    expect(result.confidence).toBe("high");
  });

  it("returns medium confidence when selector matches 2-5 elements", () => {
    const gen = selectorGenerator().generateSelector;
    // Insert 3 identical elements
    const elements = [1, 2, 3].map(() => {
      const el = document.createElement("span");
      el.className = "repeated-item";
      document.body.appendChild(el);
      return el;
    });
    const result = gen(elements[0]);
    elements.forEach(e => e.remove());
    expect(result.selector).toContain("repeated-item");
    expect(result.confidence).toBe("medium");
  });

  it("filters out short/numeric/hash-like class names", () => {
    const gen = selectorGenerator().generateSelector;
    const el = document.createElement("div");
    el.className = "ab 12345 abc123def456 stable-name";
    document.body.appendChild(el);
    const result = gen(el);
    el.remove();
    expect(result.selector).toContain("stable-name");
    expect(result.selector).not.toContain(" ab");
    expect(result.selector).not.toContain(".12345");
  });
});

describe("generateSelector — strategy 3: data attribute", () => {
  it("uses data-testid when present and unique", () => {
    const gen = selectorGenerator().generateSelector;
    const el = document.createElement("button");
    el.setAttribute("data-testid", "submit-btn");
    document.body.appendChild(el);
    const result = gen(el);
    el.remove();
    expect(result.selector).toContain('data-testid="submit-btn"');
    expect(result.confidence).toBe("high");
  });

  it("uses aria-label when present and unique", () => {
    const gen = selectorGenerator().generateSelector;
    const el = document.createElement("nav");
    el.setAttribute("aria-label", "Main navigation");
    document.body.appendChild(el);
    const result = gen(el);
    el.remove();
    expect(result.selector).toContain('aria-label="Main navigation"');
    expect(result.confidence).toBe("high");
  });
});

describe("generateSelector — strategy 4: ancestor-assisted", () => {
  it("composes ancestor selector with descendant path when child class matches too many elements", () => {
    const gen = selectorGenerator().generateSelector;
    const Generator = selectorGenerator() as unknown as {
      generateSelector: (element: Element) => SelectorResult;
      _tryAncestorSelector: (el: Element) => SelectorResult;
    };

    const ancestorSpy = vi.spyOn(Generator as any, "_tryAncestorSelector");

    // Create target inside a well-identified parent
    const parent = document.createElement("div");
    parent.id = "parent-container";
    const child = document.createElement("span");
    child.className = "generic-item";
    parent.appendChild(child);
    document.body.appendChild(parent);

    // Add 6 more .generic-item spans globally so strategy 2 returns null (count > 5)
    const decoys = Array.from({ length: 6 }, () => {
      const d = document.createElement("span");
      d.className = "generic-item";
      document.body.appendChild(d);
      return d;
    });

    const result = gen(child);
    parent.remove();
    decoys.forEach(d => d.remove());

    expect(ancestorSpy).toHaveBeenCalledOnce();
    ancestorSpy.mockRestore();
    // With 7 matches for span.generic-item, strategy 2 returns null.
    // Strategy 4 should kick in using #parent-container as anchor.
    expect(result.selector).toContain("#parent-container");
    expect(result.confidence).not.toBe("low");
  });
});

// These two tests need to be researched further for confirmation.
describe("generateSelector — strategy 5: positional fallback", () => {
  it("guarantees positional fallback is used when earlier strategies cannot identify the target", () => {
    const Generator = selectorGenerator() as unknown as {
      generateSelector: (element: Element) => SelectorResult;
      _positionalSelector: (el: Element) => SelectorResult;
    };

    const positionalSpy = vi.spyOn(Generator as any, "_positionalSelector");

    // No id, no classes, no attributes on target or ancestors.
    const wrapper = document.createElement("section");
    const inner = document.createElement("div");
    const target = document.createElement("p");
    wrapper.appendChild(inner);
    inner.appendChild(target);
    document.body.appendChild(wrapper);

    try {
      const result = Generator.generateSelector(target);

      expect(positionalSpy).toHaveBeenCalledOnce();
      expect(result.confidence).toBe("low");
      expect(result.selector).toMatch(/:nth-child\(/);
    } finally {
      wrapper.remove();
      positionalSpy.mockRestore();
    }
  });
});
