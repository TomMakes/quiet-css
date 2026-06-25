// blind.ts — Blind render, draw mechanic, z-index guardian
//
// Exports a singleton instance: `blindRenderer`
// Depends on patternBackground from pattern_fills.ts (loaded first in manifest).
//
// Public API:
//   renderBlind(blind)    — create or update a blind element on the page
//   removeBlind(id)       — remove a rendered blind by ID
//   updateBlind(blind)    — like renderBlind but converts coords on positionMode change
//   activateDrawMode()    — enter draw-rectangle mode
//   deactivateDrawMode()  — exit draw mode and clean up

const QC_BLINDS_CONTAINER_ID = "quietcss-blinds-container";
const QC_BLIND_ATTR = "data-quietcss-blind-id";

class BlindRenderer {
  // Tracks the last-rendered state of each blind so positionMode changes can be detected.
  private _blindsMap = new Map<string, Blind>();

  private _container: HTMLElement | null = null;
  private _containerObserver: MutationObserver | null = null;

  // Draw mode state
  private _drawActive = false;
  private _drawStart: { pageX: number; pageY: number; clientX: number; clientY: number } | null = null;
  private _previewEl: HTMLElement | null = null;
  private _drawCursorTag: HTMLStyleElement | null = null;

  private readonly _boundMouseDown = (e: MouseEvent) => this._onDrawMouseDown(e);
  private readonly _boundMouseMove = (e: MouseEvent) => this._onDrawMouseMove(e);
  private readonly _boundMouseUp   = (e: MouseEvent) => this._onDrawMouseUp(e);

  // ── Container management ───────────────────────────────────────────────────

  private _ensureContainer(): HTMLElement {
    if (this._container && document.body?.contains(this._container)) {
      return this._container;
    }
    let el = document.getElementById(QC_BLINDS_CONTAINER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = QC_BLINDS_CONTAINER_ID;
      // The container itself is visually inert — just a grouping element.
      Object.assign(el.style, {
        position: "static",
        display: "contents",
      });
      document.body.appendChild(el);
    }
    this._container = el;
    this._startContainerGuardian();
    return el;
  }

  /** Keep the blinds container as the last child of body to maximise z-index effectiveness. */
  private _startContainerGuardian(): void {
    if (this._containerObserver) return;
    this._containerObserver = new MutationObserver(() => {
      if (!this._container) return;
      if (document.body?.lastElementChild !== this._container) {
        document.body?.appendChild(this._container);
      }
    });
    this._containerObserver.observe(document.body, { childList: true });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  /** Create or update a blind element. Defers to DOMContentLoaded if body is not ready. */
  renderBlind(blind: Blind): void {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", () => this.renderBlind(blind), { once: true });
      return;
    }
    const container = this._ensureContainer();
    let el = container.querySelector<HTMLElement>(`[${QC_BLIND_ATTR}="${CSS.escape(blind.id)}"]`);
    if (!el) {
      el = document.createElement("div");
      el.className = "quietcss-blind";
      el.setAttribute(QC_BLIND_ATTR, blind.id);
      container.appendChild(el);
    }
    this._blindsMap.set(blind.id, { ...blind });
    if (!blind.enabled) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    Object.assign(el.style, {
      position:      blind.positionMode,
      top:           `${blind.top}px`,
      left:          `${blind.left}px`,
      width:         `${blind.width}px`,
      height:        `${blind.height}px`,
      zIndex:        "2147483647",
      pointerEvents: "none",
      background:    patternBackground(blind.pattern, blind.color),
      border:        "none",
      margin:        "0",
      padding:       "0",
      boxSizing:     "border-box",
      overflow:      "hidden",
    });
  }

  /** Remove a rendered blind by ID. */
  removeBlind(id: string): void {
    this._blindsMap.delete(id);
    const container = document.getElementById(QC_BLINDS_CONTAINER_ID);
    container?.querySelector(`[${QC_BLIND_ATTR}="${CSS.escape(id)}"]`)?.remove();
  }

  /**
   * Update a blind. If positionMode changed, converts coordinates using current
   * scroll offset so the blind stays visually in the same place on screen.
   * Returns the (possibly adjusted) blind that was rendered.
   */
  updateBlind(blind: Blind): Blind {
    const existing = this._blindsMap.get(blind.id);
    let adjusted = blind;
    if (existing && existing.positionMode !== blind.positionMode) {
      if (blind.positionMode === "fixed") {
        // absolute → fixed: subtract current scroll
        adjusted = { ...blind, top: blind.top - window.scrollY, left: blind.left - window.scrollX };
      } else {
        // fixed → absolute: add current scroll
        adjusted = { ...blind, top: blind.top + window.scrollY, left: blind.left + window.scrollX };
      }
    }
    this.renderBlind(adjusted);
    return adjusted;
  }

  // ── Draw mode ──────────────────────────────────────────────────────────────

  activateDrawMode(): void {
    if (this._drawActive) return;
    this._drawActive = true;
    // Inject crosshair cursor
    this._drawCursorTag = document.createElement("style");
    this._drawCursorTag.id = "quietcss-blind-cursor";
    this._drawCursorTag.textContent = "* { cursor: crosshair !important; }";
    (document.head ?? document.documentElement).appendChild(this._drawCursorTag);
    document.addEventListener("mousedown", this._boundMouseDown, { capture: true });
  }

  deactivateDrawMode(): void {
    if (!this._drawActive) return;
    this._drawActive = false;
    this._drawStart = null;
    document.removeEventListener("mousedown", this._boundMouseDown, { capture: true });
    document.removeEventListener("mousemove", this._boundMouseMove, { capture: true });
    document.removeEventListener("mouseup",   this._boundMouseUp,   { capture: true });
    this._previewEl?.remove();
    this._previewEl = null;
    this._drawCursorTag?.remove();
    this._drawCursorTag = null;
  }

  private _onDrawMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // ignore non-left clicks
    e.preventDefault();
    e.stopImmediatePropagation();
    this._drawStart = {
      pageX:   e.clientX + window.scrollX,
      pageY:   e.clientY + window.scrollY,
      clientX: e.clientX,
      clientY: e.clientY,
    };
    this._previewEl = document.createElement("div");
    Object.assign(this._previewEl.style, {
      position:      "fixed",
      border:        "2px dashed rgba(100, 160, 255, 0.9)",
      background:    "rgba(100, 160, 255, 0.15)",
      zIndex:        "2147483647",
      pointerEvents: "none",
      boxSizing:     "border-box",
      top:           `${e.clientY}px`,
      left:          `${e.clientX}px`,
      width:         "0",
      height:        "0",
    });
    document.body.appendChild(this._previewEl);
    document.addEventListener("mousemove", this._boundMouseMove, { capture: true });
    document.addEventListener("mouseup",   this._boundMouseUp,   { capture: true });
  }

  private _onDrawMouseMove(e: MouseEvent): void {
    if (!this._drawStart || !this._previewEl) return;
    const left   = Math.min(this._drawStart.clientX, e.clientX);
    const top    = Math.min(this._drawStart.clientY, e.clientY);
    const width  = Math.abs(e.clientX - this._drawStart.clientX);
    const height = Math.abs(e.clientY - this._drawStart.clientY);
    Object.assign(this._previewEl.style, {
      left:   `${left}px`,
      top:    `${top}px`,
      width:  `${width}px`,
      height: `${height}px`,
    });
  }

  private _onDrawMouseUp(e: MouseEvent): void {
    document.removeEventListener("mousemove", this._boundMouseMove, { capture: true });
    document.removeEventListener("mouseup",   this._boundMouseUp,   { capture: true });
    this._previewEl?.remove();
    this._previewEl = null;
    if (!this._drawStart) return;
    const start = this._drawStart;
    this._drawStart = null;
    const endPageX = e.clientX + window.scrollX;
    const endPageY = e.clientY + window.scrollY;
    const top    = Math.round(Math.min(start.pageY, endPageY));
    const left   = Math.round(Math.min(start.pageX, endPageX));
    const width  = Math.round(Math.abs(endPageX - start.pageX));
    const height = Math.round(Math.abs(endPageY - start.pageY));
    // Ignore accidental sub-5px drags (this may be over-engineering)
    if (width < 5 || height < 5) return;
    browser.runtime.sendMessage({
      type: "BLIND_DRAWN",
      payload: { top, left, width, height },
    }).catch(() => {});
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────
const blindRenderer = new BlindRenderer();

// ── Message handler ────────────────────────────────────────────────────────
browser.runtime.onMessage.addListener((message: unknown): Promise<QCMessage> | undefined => {
  const msg = message as QCMessage;

  if (msg.type === "UPDATE_BLIND") {
    const incoming = msg.payload.blind as Blind;
    const adjusted = blindRenderer.updateBlind(incoming);
    // If coords were converted due to positionMode change, notify the sidebar.
    if (adjusted.top !== incoming.top || adjusted.left !== incoming.left) {
      browser.runtime.sendMessage({
        type: "BLIND_COORDS_ADJUSTED",
        payload: { id: adjusted.id, top: adjusted.top, left: adjusted.left },
      }).catch(() => {});
    }
    return Promise.resolve({ type: "OK", payload: {} });
  }

  if (msg.type === "REMOVE_BLIND") {
    const id = msg.payload.id as string;
    blindRenderer.removeBlind(id);
    return Promise.resolve({ type: "OK", payload: {} });
  }

  return undefined;
});
