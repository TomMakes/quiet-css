// selector_gen.ts — Auto-selector generation (used in content + sidebar)
//
// Loaded as a classic content script before picker.ts.
// Exposes a single global class to avoid multiple global helper functions.
// Public functions are:
// - generateSelector: Generate a stable CSS selector for a DOM element.
// - validateSelector: Validate a CSS selector string using document.querySelector.
//
// Strategy order:
//   1. #id
//   2. tag.stableClass1.stableClass2  (unique in doc → high; 2-5 matches → medium)
//   3. tag[data-testid="..."] / [aria-label="..."] / [role="..."]
//   4. ancestor > descendant path (up to 3 ancestor levels)
//   5. :nth-child positional fallback (always available, confidence: "low")

class SelectorGenerator {
  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Returns true if a class name looks stable (semantic, not a utility token). */
  private static _isStableClass(cls: string): boolean {
    if (cls.length < 3) return false;
    if (/^\d+$/.test(cls)) return false;
    // Reject hash-like tokens: 6+ hex-only chars or 6+ non-word chars
    if (/^[0-9a-f]{6,}$/i.test(cls)) return false;
    if (/[^a-zA-Z0-9_-]{3,}/.test(cls)) return false;
    return true;
  }

  /** Returns the number of elements matching the selector (capped at 6). */
  private static _countMatches(selector: string): number {
    try {
      const nodes = document.querySelectorAll(selector);
      return Math.min(nodes.length, 6);
    } catch {
      return 0;
    }
  }

  // ── Strategy 1 — ID ──────────────────────────────────────────────────────

  private static _tryIdSelector(el: Element): SelectorResult | null {
    const id = el.getAttribute("id");
    if (!id || id.trim().length <= 2 || /^\d+$/.test(id.trim())) return null;
    return { selector: `#${CSS.escape(id.trim())}`, confidence: "high" };
  }

  // ── Strategy 2 — Tag + stable classes ───────────────────────────────────

  private static _tryClassSelector(el: Element): SelectorResult | null {
    const stable = Array.from(el.classList).filter(SelectorGenerator._isStableClass);
    if (stable.length === 0) return null;
    const selector = el.tagName.toLowerCase() + stable.map(c => `.${CSS.escape(c)}`).join("");
    const count = SelectorGenerator._countMatches(selector);
    if (count === 1) return { selector, confidence: "high" };
    if (count >= 2 && count <= 5) return { selector, confidence: "medium" };
    return null;
  }

  // ── Strategy 3 — Meaningful data / aria attribute ───────────────────────

  private static _tryAttrSelector(el: Element): SelectorResult | null {
    const attrs = ["data-testid", "data-id", "aria-label", "role"] as const;
    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (!val) continue;
      const escaped = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const selector = `${el.tagName.toLowerCase()}[${attr}="${escaped}"]`;
      const count = SelectorGenerator._countMatches(selector);
      if (count === 1) return { selector, confidence: "high" };
      if (count >= 2 && count <= 5) return { selector, confidence: "medium" };
    }
    return null;
  }

  // ── Strategy 4 — Ancestor-assisted ──────────────────────────────────────

  /** Build a CSS selector for el relative to stop (exclusive). */
  private static _relPath(el: Element, stop: Element): string | null {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== stop) {
      const tag = cur.tagName.toLowerCase();
      // Prefer id shortcut since it is unique and allows early stop.
      const cid = cur.getAttribute("id");
      if (cid && cid.trim().length > 2 && !/^\d+$/.test(cid.trim())) {
        parts.unshift(`#${CSS.escape(cid.trim())}`);
        break;
      }
      const stable = Array.from(cur.classList).filter(SelectorGenerator._isStableClass);
      if (stable.length > 0) {
        parts.unshift(tag + stable.map(c => `.${CSS.escape(c)}`).join(""));
      } else {
        const parent = cur.parentElement;
        if (!parent) break;
        const idx = Array.from(parent.children).indexOf(cur) + 1;
        parts.unshift(`${tag}:nth-child(${idx})`);
      }
      cur = cur.parentElement;
    }
    return parts.length > 0 ? parts.join(" > ") : null;
  }

  private static _tryAncestorSelector(el: Element): SelectorResult | null {
    let ancestor = el.parentElement;
    let depth = 0;
    while (ancestor && depth < 3) {
      const ar =
        SelectorGenerator._tryIdSelector(ancestor) ??
        SelectorGenerator._tryClassSelector(ancestor) ??
        SelectorGenerator._tryAttrSelector(ancestor);
      if (ar) {
        const rel = SelectorGenerator._relPath(el, ancestor);
        if (rel) {
          const selector = `${ar.selector} ${rel}`;
          const count = SelectorGenerator._countMatches(selector);
          if (count === 1) return { selector, confidence: "high" };
          if (count >= 2 && count <= 5) return { selector, confidence: "medium" };
        }
      }
      ancestor = ancestor.parentElement;
      depth++;
    }
    return null;
  }

  // ── Strategy 5 — Positional fallback ────────────────────────────────────

  private static _positionalSelector(el: Element): SelectorResult {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur) {
      const tag = cur.tagName.toLowerCase();
      if (tag === "html" || tag === "body") {
        parts.unshift(tag);
        break;
      }
      const parent: Element | null = cur.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const idx = Array.from(parent.children).indexOf(cur) + 1;
      parts.unshift(`${tag}:nth-child(${idx})`);
      cur = parent;
    }
    return { selector: parts.join(" > "), confidence: "low" };
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Generate a stable CSS selector for a DOM element.
   * Returns { selector, confidence: "high" | "medium" | "low" }.
   */
  static generateSelector(element: Element): SelectorResult {
    return (
      SelectorGenerator._tryIdSelector(element) ??
      SelectorGenerator._tryClassSelector(element) ??
      SelectorGenerator._tryAttrSelector(element) ??
      SelectorGenerator._tryAncestorSelector(element) ??
      SelectorGenerator._positionalSelector(element)
    );
  }

  /**
   * Validate a CSS selector string using document.querySelector.
   * Returns { valid: true } or { valid: false, error }.
   */
  static validateSelector(selectorString: string): ValidationResult {
    if (!selectorString || !selectorString.trim()) {
      return { valid: false, error: "Selector cannot be empty." };
    }
    try {
      document.querySelector(selectorString);
      return { valid: true };
    } catch (e) {
      return { valid: false, error: String(e) };
    }
  }
}
