// highlight_overlay.ts — Persistent selection highlight while sidebar is open
//
// Encapsulated in HighlightOverlay class to prevent namespace pollution.
// Exports a singleton instance: `highlightOverlay`
// Consumed by picker.ts and edit_mode.ts
//
// Public API:
//   positionOverlay(el)  — hover mode: track cursor over `el`
//   lockOverlay(el)      — selection mode: freeze overlay on `el`, watch for re-render
//   hideOverlay()        — remove overlay entirely and reset state

class HighlightOverlay {
  private readonly _QC_OVERLAY_ID = "quietcss-highlight-overlay";
  private _overlayRoot: HTMLDivElement | null = null;
  private _fillEl: HTMLDivElement | null = null;
  private _lineTop: HTMLDivElement | null = null;
  private _lineBottom: HTMLDivElement | null = null;
  private _lineLeft: HTMLDivElement | null = null;
  private _lineRight: HTMLDivElement | null = null;
  private _lockedElement: Element | null = null;
  private _hoverTarget: Element | null = null;
  private _lockedObserver: MutationObserver | null = null;

  constructor() {
    // Reposition on scroll so the fixed overlay stays aligned with the element.
    window.addEventListener(
      "scroll",
      () => this._onScroll(),
      { passive: true, capture: true }
    );
  }

  private _onScroll(): void {
    const el = this._lockedElement ?? this._hoverTarget;
    if (el && this._overlayRoot) this._positionToElement(el);
  }

  private _ensureOverlay(): void {
    // Re-acquire refs if the overlay already exists in the DOM.
    const existing = document.getElementById(this._QC_OVERLAY_ID) as HTMLDivElement | null;
    if (existing) {
      if (!this._overlayRoot) {
        this._overlayRoot = existing;
        this._fillEl   = this._overlayRoot.querySelector<HTMLDivElement>(".quietcss-hl-fill");
        this._lineTop   = this._overlayRoot.querySelector<HTMLDivElement>(".quietcss-hl-line-top");
        this._lineBottom = this._overlayRoot.querySelector<HTMLDivElement>(".quietcss-hl-line-bottom");
        this._lineLeft  = this._overlayRoot.querySelector<HTMLDivElement>(".quietcss-hl-line-left");
        this._lineRight  = this._overlayRoot.querySelector<HTMLDivElement>(".quietcss-hl-line-right");
      }
      return;
    }

    this._overlayRoot = document.createElement("div");
    this._overlayRoot.id = this._QC_OVERLAY_ID;
    Object.assign(this._overlayRoot.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "2147483646",
      overflow: "hidden",
    });

    // Semi-transparent fill with dashed border over the target element.
    this._fillEl = document.createElement("div");
    this._fillEl.className = "quietcss-hl-fill";
    Object.assign(this._fillEl.style, {
      position: "fixed",
      background: "rgba(100, 180, 255, 0.22)",
      border: "2px dashed rgba(80, 160, 255, 0.85)",
      boxSizing: "border-box",
      pointerEvents: "none",
      zIndex: "2147483646",
    });

    // Crosshair lines: horizontal pair (top/bottom of element) and
    // vertical pair (left/right of element), each extending to the viewport edge.
    const lineBase = {
      position: "fixed",
      background: "rgba(80, 160, 255, 0.5)",
      pointerEvents: "none",
      zIndex: "2147483645",
    };

    this._lineTop = document.createElement("div");
    this._lineTop.className = "quietcss-hl-line quietcss-hl-line-top";
    Object.assign(this._lineTop.style, lineBase, { height: "1px", left: "0", width: "100vw" });

    this._lineBottom = document.createElement("div");
    this._lineBottom.className = "quietcss-hl-line quietcss-hl-line-bottom";
    Object.assign(this._lineBottom.style, lineBase, { height: "1px", left: "0", width: "100vw" });

    this._lineLeft = document.createElement("div");
    this._lineLeft.className = "quietcss-hl-line quietcss-hl-line-left";
    Object.assign(this._lineLeft.style, lineBase, { width: "1px", top: "0", height: "100vh" });

    this._lineRight = document.createElement("div");
    this._lineRight.className = "quietcss-hl-line quietcss-hl-line-right";
    Object.assign(this._lineRight.style, lineBase, { width: "1px", top: "0", height: "100vh" });

    this._overlayRoot.appendChild(this._lineTop);
    this._overlayRoot.appendChild(this._lineBottom);
    this._overlayRoot.appendChild(this._lineLeft);
    this._overlayRoot.appendChild(this._lineRight);
    this._overlayRoot.appendChild(this._fillEl);

    const attach = () => document.body.appendChild(this._overlayRoot!);
    if (document.body) {
      attach();
    } else {
      document.addEventListener("DOMContentLoaded", attach, { once: true });
    }
  }

  private _positionToElement(el: Element): void {
    if (!this._fillEl || !this._lineTop || !this._lineBottom || !this._lineLeft || !this._lineRight) return;
    const r = el.getBoundingClientRect();
    this._fillEl.style.top    = r.top    + "px";
    this._fillEl.style.left   = r.left   + "px";
    this._fillEl.style.width  = r.width  + "px";
    this._fillEl.style.height = r.height + "px";
    this._lineTop.style.top      = r.top    + "px";
    this._lineBottom.style.top   = r.bottom + "px";
    this._lineLeft.style.left    = r.left   + "px";
    this._lineRight.style.left   = r.right  + "px";
  }

  /** Move the highlight overlay to track `el` (hover/tracking mode). */
  positionOverlay(el: Element): void {
    if (!document.body) return;
    this._hoverTarget = el;
    this._ensureOverlay();
    this._positionToElement(el);
  }

  /** Freeze the highlight on `el`. Stop tracking hover. Watch for DOM re-render. */
  lockOverlay(el: Element): void {
    if (!document.body) return;
    this._hoverTarget = null;
    this._lockedElement = el;
    this._ensureOverlay();
    this._positionToElement(el);

    this._lockedObserver?.disconnect();
    const parent = el.parentElement;
    if (!parent) return;

    // Store a tag + class signature so we can recognise a re-inserted clone.
    const tagName = el.tagName;
    const classNames = Array.from(el.classList).slice(0, 3);

    this._lockedObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const added = node as Element;
          const candidates: Element[] =
            added.tagName === tagName
              ? [added]
              : Array.from(added.querySelectorAll<Element>(tagName));
          for (const candidate of candidates) {
            const matches =
              classNames.length === 0 ||
              classNames.every(c => candidate.classList.contains(c));
            if (matches) {
              this._lockedElement = candidate;
              this._positionToElement(candidate);
              return;
            }
          }
        }
      }
    });
    this._lockedObserver.observe(parent, { childList: true, subtree: true });
  }

  /** Remove the overlay from the DOM and reset all state. */
  hideOverlay(): void {
    this._lockedElement = null;
    this._hoverTarget = null;
    this._lockedObserver?.disconnect();
    this._lockedObserver = null;
    document.getElementById(this._QC_OVERLAY_ID)?.remove();
    this._overlayRoot = null;
    this._fillEl = null;
    this._lineTop = null;
    this._lineBottom = null;
    this._lineLeft = null;
    this._lineRight = null;
  }
}

// Create singleton instance
const highlightOverlay = new HighlightOverlay();
