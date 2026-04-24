---
layout: default
title: QuietCSS — Build Plan
---

# QuietCSS — Firefox Extension Build Plan

> **Goal**: A Firefox extension that gives users control over their browsing experience by allowing them to suppress, restyle, or cover distracting visual elements on any webpage. Target audience: intermediate-to-advanced desktop users (keyboard + mouse) who understand how webpages and browsers work.

---

**TypeScript Note:**
All source code is written in TypeScript (.ts/.tsx). The extension is built by compiling TypeScript sources in `src/` to JavaScript in `dist/`. All references to code files in this plan refer to TypeScript sources unless otherwise noted. The extension package uses the compiled JS output in `dist/`.

---

## Table of Contents


1. [Project Structure](#1-project-structure)
2. [TypeScript & Build Setup](#2-typescript--build-setup)
3. [Manifest](#3-manifest)
4. [Shared Modules](#4-shared-modules)
5. [Build Step 1 — Manifest + Sidebar Shell](#5-build-step-1--manifest--sidebar-shell)
6. [Build Step 2 — Storage Layer](#6-build-step-2--storage-layer)
7. [Build Step 3 — Injector](#7-build-step-3--injector)
8. [Build Step 4 — MutationObserver Reapply Layer](#8-build-step-4--mutationobserver-reapply-layer)
9. [Build Step 5 — Element Picker + Highlight Overlay](#9-build-step-5--element-picker--highlight-overlay)
10. [Build Step 6 — CSS Editor Panel](#10-build-step-6--css-editor-panel)
11. [Build Step 7 — Selector Auto-Gen](#11-build-step-7--selector-auto-gen)
12. [Build Step 8 — Regex Toggle](#12-build-step-8--regex-toggle)
13. [Build Step 9 — Blind Draw + Render](#13-build-step-9--blind-draw--render)
14. [Build Step 10 — Export/Import + storage.sync](#14-build-step-10--exportimport--storagesync)
15. [Build Step 11 — Help Button](#15-build-step-11--help-button)
16. [Data Schemas](#16-data-schemas)
17. [Message Passing Reference](#17-message-passing-reference)
18. [Testing Checkpoints](#18-testing-checkpoints)

---


## 1. Project Structure

```
quietcss/
├── src/                        # All TypeScript source files
│   ├── background/
│   │   └── service_worker.ts   # Storage I/O, message relay, tab tracking
│   ├── content/
│   │   ├── injector.ts         # Runs at document_start; injects saved rules + blinds
│   │   ├── observer.ts         # MutationObserver reapply layer
│   │   ├── picker.ts           # Hover highlight + element selection
│   │   ├── highlight_overlay.ts# Persistent selection highlight while sidebar is open
│   │   ├── blind.ts            # Blind render, draw mechanic, z-index guardian
│   │   └── edit_mode.ts        # Mode state machine; coordinates all content scripts
│   ├── sidebar/
│   │   └── sidebar.ts          # UI logic + message passing
│   └── shared/
│       ├── schema.ts           # Rule + Blind constructors and validation
│       ├── selector_gen.ts     # Auto-selector generation (used in content + sidebar)
│       └── pattern_fills.ts    # SVG data URI pattern definitions for blinds
├── sidebar/
│   ├── sidebar.html
│   ├── sidebar.css
├── dist/                       # Compiled JS output for extension packaging
│   └── ...
├── manifest.json               # References files in dist/
├── tsconfig.json               # TypeScript config
├── package.json                # NPM scripts, dependencies
└── ...
```

**Notes:**
- All TypeScript source files live in `src/`.
- The build process compiles `.ts` to `.js` in `dist/`.
- The extension manifest and browser load files from `dist/`.
- Static assets (HTML, CSS, icons) remain outside `src/`.

---


## 2. TypeScript & Build Setup

**Initial Setup:**

1. Add `tsconfig.json` with output to `dist/` and strict type checking.
2. Add `package.json` with scripts:
  - `build`: Compile TypeScript (`tsc`)
  - `watch`: Watch and recompile on changes
  - `lint`: Run ESLint with TypeScript support
  - `clean`: Remove `dist/`
3. Install dependencies: `typescript`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, and any needed type definitions.
4. (Optional) Add Prettier for formatting.

**Build Step:**
- Always run `npm run build` before packaging or testing the extension.
- All code steps require TypeScript compilation to pass with no errors.
- Linting is required before final packaging.

---

## 3. Manifest


**File**: `manifest.json`
**Version**: Manifest V3

```json
{
  "manifest_version": 3,
  "name": "QuietCSS",
  "version": "0.1.0",
  "description": "Take control of your browsing experience. Restyle or cover distracting elements on any webpage.",


  // Permissions required for QuietCSS extension functionality:
  "permissions": [
    // "storage": Needed for persistent storage of user rules and blinds.
    //   Used by: background/service_worker.js (handles all storage I/O for rules/blinds)
    "storage",
    // "activeTab": Allows the extension to inject scripts/styles into the active tab on demand.
    //   Used by: background/service_worker.js (for message relay and script injection)
    "activeTab",
    // "scripting": Required to programmatically inject scripts/styles into web pages.
    //   Used by: content/injector.js, content/observer.js (applies user rules/styles)
    "scripting",
    // "tabs": Enables tracking of tab navigation and sending TAB_CHANGED messages to the sidebar.
    //   Used by: background/service_worker.js (tab tracking, message passing)
    "tabs"
  ],


  "background": {
    "scripts": ["dist/background/service_worker.js"],
    "type": "module"
  },


  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "dist/shared/schema.js",
        "dist/shared/selector_gen.js",
        "dist/shared/pattern_fills.js",
        "dist/content/injector.js",
        "dist/content/observer.js",
        "dist/content/highlight_overlay.js",
        "dist/content/picker.js",
        "dist/content/blind.js",
        "dist/content/edit_mode.js"
      ],
      "run_at": "document_start",
      "all_frames": false
    }
  ],


  "sidebar_action": {
    "default_title": "QuietCSS",
    "default_panel": "sidebar/sidebar.html",
    "default_icon": "icons/icon-48.png"
  },

  "icons": {
    "48": "icons/icon-48.png",
    "96": "icons/icon-96.png"
  }
}
```


**Notes**:
- All JS files referenced in the manifest are built from TypeScript sources in `src/` and output to `dist/`.
- `activeTab` + `scripting` replace the need for broad host permissions.
- `tabs` permission is needed so the background service worker can track navigation events and push `TAB_CHANGED` messages to the sidebar.
- All content scripts are loaded at `document_start` so the injector can apply styles before first paint.
- The comments written in `manifest.json` will be added to the actual manifest so it is easy to track why each permission is included.

---


## 4. Shared Modules

These modules must be written first as they are dependencies of both content scripts and the sidebar.


### `shared/schema.ts`

Defines constructors and validators for the two core data types. Export as plain functions compatible with both module and non-module contexts.

**Rule object:**
```js
function createRule({
  id           = crypto.randomUUID(),
  name         = "",          // Display name. Defaults to selector if empty.
  nameIsCustom = false,       // If true, selector edits do not overwrite name.
  hostPattern  = "",          // Literal hostname or regex string.
  isRegex      = false,
  selector     = "",
  css          = "",
  forceReapply = false,       // Enables MutationObserver reapplication.
  enabled      = true,
} = {}) { ... }
```

**Blind object:**
```js
function createBlind({
  id           = crypto.randomUUID(),
  name         = "",          // Defaults to "Blind [n]" where n is per-host count.
  hostPattern  = "",
  isRegex      = false,
  top          = 0,           // px; page-relative if absolute, viewport if fixed.
  left         = 0,
  width        = 200,
  height       = 100,
  positionMode = "absolute",  // "absolute" | "fixed"
  color        = "#1a1a2e",
  pattern      = "dots",      // "none" | "dots" | "diagonal" | "grid"
  enabled      = true,
} = {}) { ... }
```

**Validators**: Each constructor should validate that `hostPattern` is a non-empty string and, if `isRegex` is true, that the pattern compiles without error (wrap in try/catch; return `{ valid: false, error }` on failure).


### `shared/selector_gen.ts`

Auto-generates a stable CSS selector for a given DOM element. Used by the content script when an element is picked, and optionally by the sidebar to validate user-edited selectors.

**Specificity hierarchy (attempt in order):**
1. `#id` — if the element has an `id` attribute
2. Tag + meaningful classes — filter out utility/state classes (short, numeric, or single-character class names), compose as `tag.class1.class2`
3. Tag + `data-` attribute if present and meaningful
4. Unique attribute combination (e.g. `[aria-label="..."]`)
5. Positional fallback — `:nth-child` path from nearest stable ancestor

The function signature:
```js
function generateSelector(element) {
  // Returns { selector: string, confidence: "high" | "medium" | "low" }
}

function validateSelector(selectorString) {
  // Returns { valid: boolean, error?: string }
  // Uses document.querySelector inside a try/catch.
}
```


### `shared/pattern_fills.ts`

Exports four CSS `background` values as strings, used to style blind overlays.

```js
const PATTERNS = {
  none:     (color) => color,
  dots:     (color) => `radial-gradient(...) ${color}`,
  diagonal: (color) => `repeating-linear-gradient(...) ${color}`,
  grid:     (color) => `...`,
};
// Pattern contrast color is derived from base color automatically (lighten/darken by ~15%).
```

---


## 5. Build Step 1 — Manifest + Sidebar Shell

**Goal**: Confirm that the sidebar opens, the background service worker starts, and a round-trip message can be sent and received.

### Tasks


1. Create the directory structure and `manifest.json` as specified above.
2. Create `src/background/service_worker.ts` with a single message listener that logs received messages and echoes them back.
3. Create `sidebar/sidebar.html` — a minimal HTML page that:
  - Has a `[Styles]` and `[Blinds]` tab button (non-functional yet)
  - Has a "Send test message" button
  - Displays a response area
4. Create `src/sidebar/sidebar.ts` that sends `{ type: "PING", payload: {} }` to the background on button click and displays the response.
5. Compile TypeScript (`npm run build`) and verify output in `dist/`.


### Acceptance Criteria

- [ ] Sidebar opens via the browser toolbar button.
- [ ] Clicking "Send test message" logs the message in the background service worker console.
- [ ] The sidebar displays the echoed response.
- [ ] No console errors on load.
- [ ] TypeScript compiles with no errors.

---


## 6. Build Step 2 — Storage Layer

**Goal**: Implement all storage reads and writes through the background service worker. The sidebar and content scripts never call `browser.storage` directly.

### Background Service Worker — Storage API

The service worker handles the following message types. All storage operations use `browser.storage.local` by default.

| Message (→ Background) | Response (→ Sender) |
|---|---|
| `GET_RULES { hostname }` | `RULES_DATA { rules, blinds }` |
| `SAVE_RULE { rule }` | `RULE_SAVED { rule }` |
| `DELETE_RULE { id }` | `RULE_DELETED { id }` |
| `TOGGLE_RULE { id, enabled }` | `RULE_UPDATED { rule }` |
| `SAVE_BLIND { blind }` | `BLIND_SAVED { blind }` |
| `DELETE_BLIND { id }` | `BLIND_DELETED { id }` |
| `TOGGLE_BLIND { id, enabled }` | `BLIND_UPDATED { blind }` |

**Storage key strategy**: Store all rules in a single key `quietcss_rules` and all blinds in `quietcss_blinds` as JSON arrays. Do not key by hostname — filtering by hostname is done in memory after retrieval. This keeps the storage structure simple and portable for export/import.

**Hardcoded test rule for this step and build step 3** (remove after step is validated):
```js
// Temporarily inject this rule without storage to test injection timing:
{
  selector: ".ytLikeButtonViewModelHost",
  css: "display: none !important;",
  hostPattern: "www.youtube.com",
  isRegex: false,
  enabled: true,
  forceReapply: false
}
```

**Hostname matching logic** (used in storage layer and injector):
```js
function matchesHost(pattern, isRegex, hostname) {
  if (isRegex) {
    try {
      return new RegExp(pattern).test(hostname);
    } catch {
      return false;
    }
  }
  return hostname.includes(pattern);
}
```

### Tasks


1. Implement all message handlers in `src/background/service_worker.ts`.
2. Update `src/sidebar/sidebar.ts` to call `GET_RULES` on load and display the count of rules/blinds returned (even if zero).
3. Add a "Save test rule" button to the sidebar that calls `SAVE_RULE` with a hardcoded rule object, then re-fetches and displays the updated count.
4. TypeScript compilation must pass with no errors.

### Acceptance Criteria

- [ ] Test rule persists across sidebar close/reopen.
- [ ] Test rule persists across browser restart.
- [ ] Deleting the test rule via `DELETE_RULE` removes it from storage.
- [ ] Invalid regex patterns in `hostPattern` do not throw uncaught errors.

---


## 7. Build Step 3 — Injector

**Goal**: On every page load, apply saved rules and render saved blinds for the current hostname before the page paints.


### `content/injector.ts`

Runs at `document_start`.
**Sequence**:
1. Send `GET_RULES { hostname: location.hostname }` to background.
2. Receive `RULES_DATA { rules, blinds }`.
3. For each enabled rule matching the current host: inject a `<style>` tag into `<head>` with the rule's CSS scoped to its selector.
4. For each enabled blind matching the current host: call `blind.js` to render it (blind.js must be tolerant of being called before `document.body` exists — defer to `DOMContentLoaded` if needed).

**Style tag format:**
```html
<style data-quietcss-rule-id="uuid">
  selector {
    css-property: value;
  }
</style>
```

Tagging style elements with the rule ID allows them to be updated or removed without re-injecting everything.

### Tasks

1. Implement `src/content/injector.ts` with the sequence above.
2. Test on a static page to confirm styles apply and the style tag is present in the DOM.
3. Test on `www.youtube.com/watch?v=...` — the right-side recommended video sidebar (`.ytLikeButtonViewModelHost`) should be hidden on page load with no flash.

### Acceptance Criteria

- [ ] `.ytLikeButtonViewModelHost` is not visible on YouTube watch pages on load.
- [ ] No flash of unstyled content (sidebar does not appear and then disappear).
- [ ] Style tag is present in `<head>` with correct `data-quietcss-rule-id` attribute.
- [ ] No errors thrown on pages where no rules exist for the current host.

---


## 8. Build Step 4 — MutationObserver Reapply Layer

**Goal**: Re-apply rules on sites like YouTube where the DOM is torn down and rebuilt during SPA navigation, defeating `document_start` injection.


### `content/observer.ts`

This module activates only for rules that have `forceReapply: true`. It must handle two scenarios:

**Scenario A — Element removed and re-added**: The styled element is removed from the DOM by a JS framework and a new instance is inserted. The injected `<style>` tag in `<head>` survives, but if the new element has inline styles that override it, they must be cleared or the rule must be re-applied as inline styles.

**Scenario B — SPA navigation (`pushState`/`popState`)**: YouTube navigates between pages without a real page load. The `<head>` may be partially or fully replaced, destroying injected `<style>` tags.

**Implementation:**

```js
// Watch for removal of QuietCSS <style> tags and re-inject them.
const headObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.removedNodes) {
      if (node.dataset?.quietcssRuleId) {
        reinjectRule(node.dataset.quietcssRuleId);
      }
    }
  }
});
headObserver.observe(document.head, { childList: true });

// Watch for re-insertion of target elements for inline-style fighting.
const bodyObserver = new MutationObserver((mutations) => {
  // For each forceReapply rule, check if its selector now matches
  // a newly added node. If so, apply styles as inline overrides.
});
bodyObserver.observe(document.body, { childList: true, subtree: true });
```

**SPA navigation detection**: Patch `history.pushState` and `history.replaceState` and listen for `popstate` to detect navigation, then re-run the injector logic.

```js
const originalPushState = history.pushState.bind(history);
history.pushState = (...args) => {
  originalPushState(...args);
  onNavigation();
};
window.addEventListener("popstate", onNavigation);
```

### Tasks

1. Implement `src/content/observer.ts`.
2. Enable the hardcoded YouTube test rule with `forceReapply: true`.
3. On YouTube, navigate from the homepage to a watch page and back using YouTube's own links (not browser back button). Confirm `.ytLikeButtonViewModelHost` is hidden on every watch page, including after multiple navigations.

### Acceptance Criteria

- [ ] `.ytLikeButtonViewModelHost` hidden after YouTube SPA navigation (homepage → video → homepage → video).
- [ ] `.ytLikeButtonViewModelHost` hidden after browser back/forward navigation on YouTube.
- [ ] No performance degradation (observer is not firing thousands of times per second — use debouncing on the body observer if needed).
- [ ] Observer is disconnected and re-connected cleanly on navigation (no duplicate observers accumulating).

---


## 9. Build Step 5 — Element Picker + Highlight Overlay

**Goal**: When the sidebar activates "Style" edit mode, the user can hover over elements on the page to see them highlighted, then click to lock a selection. The sidebar receives the picked element's selector and computed styles.


### Edit Mode State Machine — `content/edit_mode.ts`

Manages two top-level modes and two sub-modes:

```
BROWSE (default)
  └── EDIT
        ├── STYLE   (element picker active)
        └── BLIND   (draw mode active)
```

Mode transitions are triggered by messages from the sidebar:
- `ENTER_EDIT_MODE { submode: "style" | "blind" }` → activate appropriate sub-mode
- `EXIT_EDIT_MODE {}` → return to BROWSE

In EDIT mode, hover highlighting and crosshair cursor behavior are the primary visual indicators that style picking is active.


### `content/picker.ts`

Activates when `submode === "style"`.

**Hover behavior:**
- Listen to `mouseover` events.
- On each event, call `highlight_overlay.js` to position the highlight over `event.target`.
- Suppress default browser behaviors (`cursor` should become `crosshair` via an injected `<style>` tag on `body *` during pick mode — remove this tag on exit).

**Click behavior:**
- Intercept `click` with `capture: true` and `preventDefault()` + `stopPropagation()`.
- Lock the selection: freeze the highlight overlay on the clicked element.
- Send `ELEMENT_PICKED { selector, computedStyles, tagName }` to the background (to be relayed to the sidebar).
- `computedStyles` should include only: `display`, `visibility`, `opacity`, `animation`, `position`, `z-index`, `background`, `border`.


### `content/highlight_overlay.ts`

Renders the selection highlight: a light-blue semi-transparent box over the target element, plus dashed horizontal and vertical crosshair lines extending to the viewport edges.

```
  ┼────────────────────────┼
  │                        │
  ┤  ┌──────────────────┐  ├
  │  │  target element  │  │   ← light blue fill, dashed border
  ┤  └──────────────────┘  ├
  │                        │
  ┼────────────────────────┼
```

Implementation: inject a single `<div id="quietcss-highlight-overlay">` containing four line divs and one fill div. Position all using `getBoundingClientRect()` + `position: fixed`. Update positions on `mouseover` (hover mode) or lock on click (selection mode). On scroll, update position using a `scroll` event listener.

**MutationObserver for selected element**: Once an element is locked, observe its parent with a MutationObserver. If the element is re-rendered (removed and re-inserted), reattach the highlight to the new instance.

### Tasks

1. Implement `src/content/edit_mode.ts` with mode state transitions.
2. Implement `src/content/picker.ts`.
3. Implement `src/content/highlight_overlay.ts`.
4. Wire up the sidebar to send `ENTER_EDIT_MODE { submode: "style" }` on a test button click.
5. Confirm that clicking an element sends `ELEMENT_PICKED` and the data arrives in the sidebar console.

### Acceptance Criteria

- [ ] Hovering over elements shows the highlight overlay tracking the cursor correctly.
- [ ] Crosshair lines extend to viewport edges and update smoothly.
- [ ] Clicking an element locks the highlight and stops it from tracking the mouse.
- [ ] `ELEMENT_PICKED` payload arrives in the sidebar with correct selector and computed styles.
- [ ] Normal page clicks are fully suppressed while in STYLE sub-mode.
- [ ] Exiting edit mode removes the overlay and cursor style.

---


## 10. Build Step 6 — CSS Editor Panel

**Goal**: Build the full sidebar UI for creating, editing, and managing Rules.

### Sidebar Layout — Styles Tab

```
┌────────────────────────────┐
│  ◈ QuietCSS          [?] - │  ← addon name, help, collapse
├────────────────────────────┤
│  [Styles ●] [Blinds]       │
├────────────────────────────┤
│  TARGET SITE/URL           │
│  youtube.com         [.*]  │  ← editable host pattern; [.*] toggles regex mode
│                            │
│  ┌ EDITING ─────────────┐  │
│  │ Name                 │  │
│  │ [#secondary        ] │  │  ← auto-populated from selector (editable)
│  │                      │  │
│  │ Selector             │  │
│  │ [#secondary        ] │  │  ← editable text input
│  │ [⟳ Auto-generate   ] │  │  ← triggers selector_gen.js
│  │                      │  │
│  │ CSS                  │  │
│  │ [                  ] │  │
│  │ [  display: none   ] │  │  ← editable textarea, pre-populated
│  │ [                  ] │  │
│  │ [!important  ☑     ] │  │  ← appends !important to all declarations
│  │ [Force reapply  ☐  ] │  │  ← enables MutationObserver layer
│  │                      │  │
│  │ [Save]    [Cancel]   │  │
│  └──────────────────────┘  │
│                            │
│  SAVED RULES               │
│  ──────────────────────    │
│  Sidebar hider       ● ✕   │  ← name, enable toggle, delete
│    #secondary              │  ← selector shown smaller beneath name
│  Ad overlay blocker  ○ ✕   │
│    .ad-container           │
└────────────────────────────┘
```

### Name Field Behavior

- On `ELEMENT_PICKED`: populate name field with the selector string. Set `nameIsCustom = false`.
- On name field `blur`: if field is empty, repopulate with current selector value. Do not repopulate if `nameIsCustom = true`.
- On name field `input` (user types anything): set `nameIsCustom = true`.
- Editing the selector field does **not** update the name field if `nameIsCustom = true`.
- Editing the selector field **does** update the name field if `nameIsCustom = false` (name stays in sync with selector until user customizes it).

### Saved Rules List

- Each entry shows: `name` (bold), `selector` (muted, smaller), enable toggle (filled circle = enabled, empty = disabled), delete button.
- Clicking a saved rule loads it into the editor panel above.
- Changes to a loaded rule are not saved until "Save" is clicked.

### Tasks

1. Build the full Styles tab HTML/CSS in `sidebar.html` / `sidebar.css`.
2. Implement all name field behaviors in `src/sidebar/sidebar.ts`.
3. Wire `ELEMENT_PICKED` to populate the editor panel.
4. Implement Save, Cancel, enable toggle, and delete.
5. Implement the `!important` toggle (post-processes the CSS textarea content before saving).
6. TypeScript compilation must pass with no errors.

### Acceptance Criteria

- [ ] Picking an element populates target site, name, selector, computed styles in CSS textarea.
- [ ] Name auto-populates to selector; clearing and blurring restores selector as name.
- [ ] Manually setting a name prevents selector edits from overwriting it.
- [ ] Saving a rule adds it to the saved rules list immediately.
- [ ] Toggling enable/disable updates storage and reapplies or removes the style tag on the active page.
- [ ] Deleting a rule removes it from storage and removes its style tag from the active page.

---


## 11. Build Step 7 — Selector Auto-Gen

**Goal**: Implement the `⟳ Auto-generate` button that calls `selector_gen.js` against the currently picked element and populates the selector field.

### Selector Generation Algorithm — `shared/selector_gen.js`

Attempt the following in order, returning the first result with `confidence: "high"` or `"medium"`:

1. **ID selector**: if `element.id` exists and is not empty or auto-generated (heuristic: longer than 2 chars, not purely numeric), return `#${element.id}` with `confidence: "high"`.

2. **Tag + stable classes**: filter `element.classList` to remove classes that look like utility tokens (fewer than 3 chars, purely numeric, contain random-looking substrings of 6+ non-word chars). Compose `tag.class1.class2`. If the resulting selector matches exactly one element in the document, return it with `confidence: "high"`. If it matches 2–5 elements, return with `confidence: "medium"`.

3. **Meaningful data attribute**: look for `data-testid`, `data-id`, `aria-label`, `role` attributes. Compose `tag[attr="value"]`. Check uniqueness as above.

4. **Ancestor-assisted selector**: walk up the DOM tree up to 3 levels, looking for a stable ancestor (one with a high-confidence selector), then compose `ancestor selector > tag`.

5. **Positional fallback**: generate a full `:nth-child` path from `<body>`. Return with `confidence: "low"`.

**Confidence is shown to the user** next to the selector field:
- High → green indicator, no warning
- Medium → yellow indicator, tooltip: "This selector may match multiple elements. Consider refining it."
- Low → orange indicator, tooltip: "This selector is position-based and may break if the page structure changes."

### Tasks

1. Implement `src/shared/selector_gen.ts` with all five strategies.
2. Wire the `⟳ Auto-generate` button in the sidebar: send `GENERATE_SELECTOR {}` to the content script, receive `SELECTOR_GENERATED { selector, confidence }` back.
3. Display confidence indicator next to the selector field.
4. TypeScript compilation must pass with no errors.

### Acceptance Criteria

- [ ] Auto-generate produces a working selector for common elements (YouTube sidebar, Reddit vote buttons, nav bars).
- [ ] Confidence indicator displays correctly for each confidence level.
- [ ] User can override the auto-generated selector by typing in the field.
- [ ] Invalid selectors (syntax error) show a red indicator and block saving until corrected.

---


## 12. Build Step 8 — Regex Toggle

**Goal**: Implement the `[.*]` regex toggle button behavior for the host pattern field.

### Regex Toggle (`[.*]` button)

- Clicking toggles `isRegex` on the current rule being edited, and if `isRegex` is true, makes the toggle button have a blue tint with a pressed button style.
- When `isRegex = true`, validate the hostname pattern in real time. Show a green checkmark for valid, red X for invalid regex.
- When `isRegex = false`, display is plain text with no validation indicator.

### Tasks

1. Implement the `[.*]` toggle click handler in `src/sidebar/sidebar.ts`: flip `isRegex` on the active rule being edited and update the button's visual state.
2. When `isRegex = true`, attach an `input` listener to the host pattern field that validates the pattern as a regex in real time and shows a green checkmark or red X.
3. Clear validation indicators when `isRegex` is toggled off.
4. TypeScript compilation must pass with no errors.

### Acceptance Criteria

- [ ] Clicking `[.*]` toggles the button to a blue/pressed visual state.
- [ ] When regex mode is on, typing a valid regex in the host pattern field shows a green checkmark.
- [ ] When regex mode is on, typing an invalid regex shows a red X.
- [ ] Turning regex mode off removes all validation indicators.
- [ ] `isRegex` state is saved correctly with the rule.

---


## 13. Build Step 9 — Blind Draw + Render

**Goal**: Users can draw rectangular overlay boxes on any page to cover distracting content. Blinds persist and are re-rendered on each visit.

### Sidebar Layout — Blinds Tab

```
┌────────────────────────────┐
│  [Styles] [Blinds ●]       │
├────────────────────────────┤
│  TARGET SITE/URL           │
│  youtube.com         [.*]  │
│                            │
│  [+ Draw new blind]        │  ← enters BLIND sub-mode
│                            │
│  ┌ EDITING ─────────────┐  │
│  │ Name                 │  │
│  │ [Blind 3           ] │  │  ← editable; clears to "Blind [n]" on blur
│  │                      │  │
│  │ Color    [████████]  │  │  ← color picker
│  │ Pattern  [Dots   ▾]  │  │  ← dropdown: None, Dots, Diagonal, Grid
│  │ Position [Page   ▾]  │  │  ← dropdown: "Stick to page" / "Stick to viewport"
│  │                      │  │
│  │ [Save]    [Cancel]   │  │
│  └──────────────────────┘  │
│                            │
│  SAVED BLINDS              │
│  ──────────────────────    │
│  Sidebar hider       ● ✕   │
│  Video autoplay      ● ✕   │
└────────────────────────────┘
```


### `content/blind.ts`

**Blind container**: A single `<div id="quietcss-blinds-container">` is appended as the last child of `<body>`. All blind elements live inside it. A MutationObserver on `<body>` ensures this container is always the last child — if something is appended after it, move it back to last position. This maximizes z-index effectiveness.

**Each blind element:**
```html
<div class="quietcss-blind"
     data-quietcss-blind-id="uuid"
     style="
       position: absolute | fixed;
       top: Npx; left: Npx;
       width: Npx; height: Npx;
       z-index: 2147483647;
       pointer-events: none;
       background: [from pattern_fills.js];
     ">
</div>
```

`pointer-events: none` by default so the user can still interact with the page beneath. In EDIT mode, `pointer-events` is set to `auto` on all blinds to allow repositioning.

**Drawing mechanic:**
1. Enter BLIND sub-mode → cursor becomes `crosshair` on the page.
2. `mousedown` → record start coordinates (`scrollX + clientX`, `scrollY + clientY` for page-relative).
3. `mousemove` → render a live preview div tracking the drag rectangle.
4. `mouseup` → finalize coordinates, send `BLIND_DRAWN { top, left, width, height }` to the sidebar, destroy preview div.
5. Sidebar receives coordinates, opens the edit panel pre-populated, waits for user to save.

**Position mode toggle:**
- "Stick to page" = `position: absolute`, coordinates are page-relative (stored as-is).
- "Stick to viewport" = `position: fixed`, coordinates converted to viewport-relative by subtracting current scroll offset at toggle time.
- The sidebar dropdown handles the toggle; the content script re-renders the blind on `BLIND_UPDATED`.

**Name defaulting:**
- `n` is computed as: count of existing blinds for `hostPattern` + 1, evaluated at save time.
- On name field blur in sidebar: if field is empty, restore to `Blind [n]` where `n` is the blind's position in the current host's list.

**Z-index and modal problem:**
- Blind `z-index` is `2147483647` (32-bit max).
- The blinds container MutationObserver ensures it stays last child of `<body>`.
- This handles the majority of modal implementations. Edge cases where a stacking context is created on `<html>` or `<body>` via `transform`/`filter` cannot be fully solved at the extension level — document this as a known limitation.

### Tasks

1. Implement `src/content/blind.ts` with draw mechanic, render, container guardian.
2. Implement the Blinds tab in the sidebar.
3. Implement name defaulting behavior.
4. Implement position mode toggle.
5. Wire injector to restore saved blinds on page load.

### Acceptance Criteria

- [ ] Drawing a blind on YouTube covers the target area on mouse-up.
- [ ] Blind persists on page reload.
- [ ] Blind persists after YouTube SPA navigation.
- [ ] "Stick to viewport" blind stays fixed during page scroll.
- [ ] "Stick to page" blind scrolls with the page content.
- [ ] Toggling position mode converts coordinates correctly (no jump on toggle).
- [ ] Blind name defaults to `Blind [n]` per host; clearing and blurring restores it.
- [ ] Blind is rendered above YouTube's own UI elements in standard page conditions.
- [ ] Enable/disable toggle shows/hides the blind without deleting it.

---


## 14. Build Step 10 — Export/Import + storage.sync

**Goal**: Allow users to back up and restore all rules and blinds, and optionally sync across browser profiles.

### Export

Triggered by an "Export" button in the sidebar footer. Generates a JSON file and triggers a browser download.

```json
{
  "version": "1",
  "exported": "ISO8601 timestamp",
  "rules": [ ...all rule objects... ],
  "blinds": [ ...all blind objects... ]
}
```

### Import

Triggered by an "Import" button. Opens a file picker (`<input type="file" accept=".json">`). On file selection:
1. Parse and validate the JSON structure.
2. Check `version` field for compatibility.
3. Show a confirmation dialog: "This will add N rules and N blinds. Existing rules with the same ID will be overwritten."
4. Merge into storage (do not wipe existing data unless the user explicitly chooses "Replace all" vs "Merge").

### storage.sync Option

A toggle in the sidebar footer: "Sync rules across devices (uses browser sync storage)".

- When enabled: all subsequent writes go to `browser.storage.sync` in addition to `browser.storage.local`. On load, data from `sync` is merged with `local` (sync takes precedence on conflict by timestamp).
- When disabled: writes go to `local` only.
- Note: `storage.sync` has a 100KB total quota and 8KB per-item limit. Warn the user if the total data size approaches this limit.

### Tasks

1. A footer is added to sidebar with the buttons "Import" and "Export".
1. Implement Export as a JSON download.
2. Implement Import with merge/replace options.
3. Implement the sync toggle and dual-write logic.

### Acceptance Criteria

- [ ] Exported JSON contains all rules and blinds.
- [ ] Importing the exported file on a fresh profile restores all rules and blinds correctly.
- [ ] Enabling sync causes rules saved afterward to appear in `browser.storage.sync`.
- [ ] Import with "Merge" does not delete rules that were not in the imported file.
- [ ] A warning appears if sync storage quota is near the limit.

---


## 15. Build Step 11 — Help Button

**Goal**: Clicking the `[?]` help button in the sidebar header opens the QuietCSS GitHub page in a new browser tab.

### Tasks

1. In `sidebar/sidebar.html`, ensure the `[?]` button in the sidebar header has an `id` (e.g. `id="help-btn"`).
2. In `src/sidebar/sidebar.ts`, add a click listener on `#help-btn` that calls `browser.tabs.create({ url: "https://github.com/TomMakes/quiet-css" })`.
3. No background message passing is needed — `browser.tabs.create` is available directly in the sidebar context.
4. TypeScript compilation must pass with no errors.

### Acceptance Criteria

- [ ] Clicking `[?]` opens `https://github.com/TomMakes/quiet-css` in a new tab.
- [ ] The sidebar remains open after clicking help.
- [ ] No console errors on click.
- [ ] TypeScript compiles with no errors.

---


## 16. Data Schemas

Complete reference for all persisted objects.

### Rule
| Field | Type | Default | Description |
|---|---|---|---|
| `id` | string (UUID) | auto | Unique identifier |
| `name` | string | selector value | User-facing display name |
| `nameIsCustom` | boolean | false | If true, name is not overwritten by selector changes |
| `hostPattern` | string | — | Hostname literal or regex string |
| `isRegex` | boolean | false | Whether hostPattern is treated as regex |
| `selector` | string | — | CSS selector for the target element |
| `css` | string | — | Raw CSS declarations to apply |
| `forceReapply` | boolean | false | Enables MutationObserver reapplication |
| `enabled` | boolean | true | Whether the rule is currently active |

### Blind
| Field | Type | Default | Description |
|---|---|---|---|
| `id` | string (UUID) | auto | Unique identifier |
| `name` | string | "Blind [n]" | User-facing display name |
| `hostPattern` | string | — | Hostname literal or regex string |
| `isRegex` | boolean | false | Whether hostPattern is treated as regex |
| `top` | number | — | Top offset in px |
| `left` | number | — | Left offset in px |
| `width` | number | — | Width in px |
| `height` | number | — | Height in px |
| `positionMode` | string | "absolute" | "absolute" (page) or "fixed" (viewport) |
| `color` | string | "#1a1a2e" | Base fill color (hex) |
| `pattern` | string | "dots" | "none" \| "dots" \| "diagonal" \| "grid" |
| `enabled` | boolean | true | Whether the blind is currently rendered |

---


## 17. Message Passing Reference

All messages follow `{ type: string, payload: object }`. The background service worker relays content↔sidebar messages by forwarding to the currently active tab's content script or to the sidebar port respectively.

### Sidebar → Background

| Type | Payload | Description |
|---|---|---|
| `GET_RULES` | `{ hostname }` | Fetch all rules + blinds matching hostname |
| `SAVE_RULE` | `{ rule }` | Create or update a rule |
| `DELETE_RULE` | `{ id }` | Delete a rule by ID |
| `TOGGLE_RULE` | `{ id, enabled }` | Enable or disable a rule |
| `SAVE_BLIND` | `{ blind }` | Create or update a blind |
| `DELETE_BLIND` | `{ id }` | Delete a blind by ID |
| `TOGGLE_BLIND` | `{ id, enabled }` | Enable or disable a blind |

### Background → Sidebar

| Type | Payload | Description |
|---|---|---|
| `RULES_DATA` | `{ rules, blinds }` | Response to GET_RULES |
| `RULE_SAVED` | `{ rule }` | Confirmation + updated rule object |
| `RULE_DELETED` | `{ id }` | Confirmation of deletion |
| `RULE_UPDATED` | `{ rule }` | Confirmation of toggle |
| `BLIND_SAVED` | `{ blind }` | Confirmation + updated blind object |
| `BLIND_DELETED` | `{ id }` | Confirmation of deletion |
| `BLIND_UPDATED` | `{ blind }` | Confirmation of toggle |
| `TAB_CHANGED` | `{ hostname, tabId }` | Pushed when active tab or URL changes |

### Sidebar → Content (relayed via Background)

| Type | Payload | Description |
|---|---|---|
| `ENTER_EDIT_MODE` | `{ submode }` | Activate "style" or "blind" sub-mode |
| `EXIT_EDIT_MODE` | `{}` | Return to browse mode |
| `HIGHLIGHT_SELECTOR` | `{ selector }` | Re-highlight element matching selector (live preview as user types) |
| `APPLY_RULE_PREVIEW` | `{ selector, css }` | Apply a rule temporarily without saving |
| `REMOVE_RULE_PREVIEW` | `{}` | Remove temporary preview styles |
| `UPDATE_BLIND` | `{ blind }` | Re-render a blind with new properties |
| `REMOVE_BLIND` | `{ id }` | Remove a rendered blind from the page |

### Content → Background (forwarded to Sidebar)

| Type | Payload | Description |
|---|---|---|
| `ELEMENT_PICKED` | `{ selector, computedStyles, tagName }` | User clicked an element in picker mode |
| `BLIND_DRAWN` | `{ top, left, width, height }` | User finished drawing a blind rectangle |
| `SELECTOR_GENERATED` | `{ selector, confidence }` | Result of auto-generation request |

---


## 18. Testing Checkpoints

A high-confidence test for each completed build step. All tests should be performed on both a static page (e.g. `example.com`) and YouTube unless otherwise noted.


| Step | Test | Pass Condition |
|---|---|---|
| 1 | Open sidebar, click test button | Response appears in sidebar; no console errors |
| 2 | Save rule, close browser, reopen | Rule appears in sidebar rule count |
| 3 | Load YouTube watch page | `.ytLikeButtonViewModelHost` absent from layout; no FOUC |
| 4 | Navigate YouTube via its own links 5 times | `.ytLikeButtonViewModelHost` absent every time |
| 5 | Hover over 10 different elements | Highlight tracks cursor accurately |
| 5 | Click an element | Highlight locks; `ELEMENT_PICKED` in sidebar console |
| 6 | Pick element, edit CSS, save | Rule in saved list; style applied on page |
| 6 | Clear name field, click away | Name restores to selector value |
| 7 | Click Auto-generate on YouTube sidebar | Selector field populated; confidence shown |
| 7 | Type invalid selector | Red indicator; Save button disabled |
| 8 | Toggle regex mode, type invalid host pattern | Red X shown; valid pattern shows green checkmark |
| 8 | Toggle regex mode off | Validation indicators cleared |
| 9 | Draw a blind, save | Blind renders on page; persists on reload |
| 9 | Toggle position mode | Blind converts between scroll-fixed and viewport-fixed correctly |
| 10 | Export, import on fresh profile | All rules and blinds restored correctly |
| 10 | Enable sync, save a rule, check storage | Rule present in `browser.storage.sync` |
| 11 | Click `[?]` help button in sidebar header | `https://github.com/TomMakes/quiet-css` opens in a new tab; sidebar stays open |

---

*QuietCSS — less noise, more focus.*
