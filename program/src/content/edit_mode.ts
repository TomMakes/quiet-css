// edit_mode.ts — Mode state machine; coordinates all content scripts
//
// Encapsulated in EditMode class to prevent namespace pollution.
// Exports a singleton instance: `editMode`
//
// State machine:
//   BROWSE (default)
//     └── EDIT
//           ├── STYLE   (calls picker.activate/deactivate)
//           └── BLIND   (draw mode — implemented in Build Step 9)
//
// Messages received (relayed by background service worker):
//   ENTER_EDIT_MODE { submode: "style" | "blind" }
//   EXIT_EDIT_MODE  {}

type QCEditMode = "BROWSE" | "STYLE" | "BLIND";

class EditMode {
  private _editMode: QCEditMode = "BROWSE";

  constructor(
    private _picker: Picker,
    private _overlay: HighlightOverlay
  ) {
    browser.runtime.onMessage.addListener(
      (message: unknown): Promise<QCMessage> | undefined => {
        const msg = message as QCMessage;

        switch (msg.type) {
          case "ENTER_EDIT_MODE": {
            const submode = msg.payload.submode as string;
            if (submode === "style") {
              this._enterStyleMode();
            } else if (submode === "blind") {
              this._enterBlindMode();
            }
            return Promise.resolve({ type: "OK", payload: {} });
          }

          case "EXIT_EDIT_MODE": {
            this._exitEditMode();
            return Promise.resolve({ type: "OK", payload: {} });
          }
        }

        // Not handled here; let other listeners see it.
        return undefined;
      }
    );
  }

  private _enterStyleMode(): void {
    if (this._editMode === "STYLE") return;
    if (this._editMode !== "BROWSE") this._exitEditMode();
    this._editMode = "STYLE";
    this._picker.activate();
  }

  private _enterBlindMode(): void {
    // Full implementation in Build Step 9.
    if (this._editMode !== "BROWSE") this._exitEditMode();
    this._editMode = "BLIND";
  }

  private _exitEditMode(): void {
    if (this._editMode === "STYLE") {
      this._picker.deactivate();
    }
    // Blind mode teardown arrives in Build Step 9.
    this._editMode = "BROWSE";
    this._overlay.hideOverlay();
  }
}

// Create singleton instance and inject dependencies
const editMode = new EditMode(picker, highlightOverlay);
