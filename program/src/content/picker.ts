// picker.ts — Hover highlight + element selection
//
// Encapsulated in Picker class to prevent namespace pollution.
// Exports a singleton instance: `picker`
// Activated by edit_mode.ts when the sidebar enters STYLE sub-mode.
// Depends on highlightOverlay instance from highlight_overlay.ts
//
// Public API:
//   activate()   — start hover-highlight + click-to-pick behaviour
//   deactivate() — clean up all listeners and state

class Picker {
  private readonly _COMPUTED_STYLE_KEYS = [
    "display", "visibility", "opacity", "animation",
    "position", "z-index", "background", "border",
  ] as const;

  private _pickerActive = false;
  private _pickerLocked = false;         // true after an element is clicked
  private _lockedElement: Element | null = null;
  private _pickerCursorTag: HTMLStyleElement | null = null;
  private readonly _boundHover = (event: MouseEvent) => this._onHover(event);
  private readonly _boundClick = (event: MouseEvent) => this._onClick(event);

  constructor(private _overlay: HighlightOverlay) {}

  /** Start the element picker. */
  activate(): void {
    if (this._pickerActive) return;
    this._pickerActive = true;
    this._pickerLocked = false;

    // Override cursor to crosshair for every element while picker is active.
    this._pickerCursorTag = document.createElement("style");
    this._pickerCursorTag.id = "quietcss-picker-cursor";
    this._pickerCursorTag.textContent = "* { cursor: crosshair !important; }";
    (document.head ?? document.documentElement).appendChild(this._pickerCursorTag);

    document.addEventListener("mouseover", this._boundHover, { capture: true });
    document.addEventListener("click", this._boundClick, { capture: true });
  }

  /** Stop the element picker and clean up. */
  deactivate(): void {
    if (!this._pickerActive) return;
    this._pickerActive = false;
    this._pickerLocked = false;
    this._lockedElement = null;
    document.removeEventListener("mouseover", this._boundHover, { capture: true });
    document.removeEventListener("click", this._boundClick, { capture: true });
    this._pickerCursorTag?.remove();
    this._pickerCursorTag = null;
  }

  private _onHover(event: MouseEvent): void {
    if (this._pickerLocked) return;
    const target = event.target as Element | null;
    if (!target) return;
    // Ignore the overlay itself.
    if (target.id === "quietcss-highlight-overlay" ||
        target.closest?.("#quietcss-highlight-overlay")) return;
    this._overlay.positionOverlay(target);
  }

  private _onClick(event: MouseEvent): void {
    // Suppress the click so the page does not react to it.
    event.preventDefault();
    event.stopImmediatePropagation();

    if (this._pickerLocked) return;

    const target = event.target as Element | null;
    if (!target) return;
    if (target.id === "quietcss-highlight-overlay" ||
        target.closest?.("#quietcss-highlight-overlay")) return;

    this._pickerLocked = true;
    this._lockedElement = target;

    const result = SelectorGenerator.generateSelector(target);
    this._overlay.lockOverlay(target);

    const computed = window.getComputedStyle(target);
    const computedStyles: Record<string, string> = {};
    for (const key of this._COMPUTED_STYLE_KEYS) {
      computedStyles[key] = computed.getPropertyValue(key);
    }

    browser.runtime.sendMessage({
      type: "ELEMENT_PICKED",
      payload: {
        selector: result.selector,
        confidence: result.confidence,
        computedStyles,
        tagName: target.tagName.toLowerCase(),
      },
    }).catch(() => {
      // Sidebar may not be listening yet — not a fatal error.
    });
  }

  /**
   * Called when the sidebar requests auto-generation for the currently locked element.
   * Sends SELECTOR_GENERATED back to the sidebar via the background.
   */
  handleGenerateSelector(): void {
    if (!this._pickerLocked || !this._lockedElement) return;
    const result = SelectorGenerator.generateSelector(this._lockedElement);
    browser.runtime.sendMessage({
      type: "SELECTOR_GENERATED",
      payload: result,
    }).catch(() => {});
  }
}

// Create singleton instance and inject overlay dependency
const picker = new Picker(highlightOverlay);
