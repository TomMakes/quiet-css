// sidebar.ts — CSS Editor Panel (Build Step 6) + Blinds Tab (Build Step 9)

// ── Module-level state ─────────────────────────────────────────────────────
let currentHostname = "";
let currentUrl = "";
let allMatchingRules: Rule[] = [];
let allMatchingBlinds: Blind[] = [];
let editingRuleId: string | null = null;
let editingBlindId: string | null = null;
let nameIsCustom = false;
let isRegex = false;
let blindIsRegex = false;
let isPickingElement = false;
let isDrawingBlind = false;
let pendingBlindCoords: { top: number; left: number; width: number; height: number } | null = null;

// ── Utility functions ──────────────────────────────────────────────────────

async function getActiveTabHostname(): Promise<{ hostname: string; url: string }> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0]?.url ?? "";
    return { hostname: url ? new URL(url).hostname : "", url };
  } catch {
    return { hostname: "", url: "" };
  }
}

async function loadRules(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({
      type: "GET_RULES",
      payload: { hostname: currentHostname, url: currentUrl },
    }) as QCMessage;
    if (response.type === "RULES_DATA") {
      allMatchingRules = response.payload.rules as Rule[];
      allMatchingBlinds = response.payload.blinds as Blind[];
    }
  } catch (err) {
    console.error("[QuietCSS Sidebar] loadRules failed:", err);
    allMatchingRules = [];
    allMatchingBlinds = [];
  }
}

async function relayToContentScript<T extends QCRelayToContentScriptType>(
  type: T,
  payload: QCRelayToContentScriptPayloadMap[T],
): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type, payload } as QCRelayToContentScriptMessage<T>);
  } catch {
    // Suppress – content script may not be available on this page.
  }
}

function addImportantToCSS(css: string): string {
  return css
    .split("\n")
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes(":")) return line;
      const withoutSemi = trimmed.endsWith(";") ? trimmed.slice(0, -1).trimEnd() : trimmed;
      if (/!important\s*$/i.test(withoutSemi)) return line;
      return trimmed.endsWith(";")
        ? `${withoutSemi} !important;`
        : `${trimmed} !important`;
    })
    .join("\n");
}

/** A function to offer suggestions on style changes to make based on
 * existing styles. Currently it only suggests that display is set to none.
 */
function suggestCSS(computedStyles: Record<string, string>): string {
  const display = computedStyles["display"];
  if (display === "none") return "display: none;";
  return "display: none;";
}

// ── Render helpers ─────────────────────────────────────────────────────────

function renderRulesList(
  container: HTMLElement,
  rules: Rule[],
  activeRuleId: string | null,
  noRulesMsg: HTMLElement | null,
): void {
  container.querySelectorAll(".rule-item").forEach(el => el.remove());
  if (noRulesMsg) {
    noRulesMsg.style.display = rules.length === 0 ? "" : "none";
  }
  for (const rule of rules) {
    container.appendChild(buildRuleItem(rule, rule.id === activeRuleId));
  }
}

function updateRulesListActiveState(container: HTMLElement, activeRuleId: string | null): void {
  container.querySelectorAll(".rule-item").forEach(el => {
    const item = el as HTMLElement;
    const isActive = item.dataset.ruleId === activeRuleId;
    item.classList.toggle("rule-item--active", isActive);
  });
}

function buildRuleItem(rule: Rule, isActive: boolean): HTMLElement {
  const item = document.createElement("div");
  item.className = "rule-item" + (isActive ? " rule-item--active" : "");
  item.dataset.ruleId = rule.id;

  const row = document.createElement("div");
  row.className = "rule-item-row";

  const nameSpan = document.createElement("span");
  nameSpan.className = "rule-item-name";
  nameSpan.textContent = rule.name || rule.selector;

  const toggleBtn = document.createElement("button");
  toggleBtn.className =
    "rule-toggle-btn" + (rule.enabled ? " rule-toggle-btn--enabled" : "");
  toggleBtn.textContent = rule.enabled ? "●" : "○";
  toggleBtn.title = rule.enabled ? "Disable rule" : "Enable rule";
  toggleBtn.dataset.ruleId = rule.id;
  toggleBtn.dataset.action = "toggle";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "rule-delete-btn";
  deleteBtn.textContent = "✕";
  deleteBtn.title = "Delete rule";
  deleteBtn.dataset.ruleId = rule.id;
  deleteBtn.dataset.action = "delete";

  row.appendChild(nameSpan);
  row.appendChild(toggleBtn);
  row.appendChild(deleteBtn);

  const selectorDiv = document.createElement("div");
  selectorDiv.className = "rule-item-selector";
  selectorDiv.textContent = rule.selector;

  item.appendChild(row);
  item.appendChild(selectorDiv);
  return item;
}

function updateRegexToggleVisual(btn: HTMLButtonElement, active: boolean): void {
  btn.classList.toggle("regex-btn--active", active);
}

function updateHostRegexIndicator(el: HTMLElement | null, valid: boolean): void {
  if (!el) return;
  el.classList.remove("host-regex-indicator--valid", "host-regex-indicator--invalid");
  el.classList.add(valid ? "host-regex-indicator--valid" : "host-regex-indicator--invalid");
  el.textContent = valid ? "✓" : "✕";
}

function clearHostRegexIndicator(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.remove("host-regex-indicator--valid", "host-regex-indicator--invalid");
  el.textContent = "";
}

function validateHostPattern(refs: EditorRefs): void {
  if (!isRegex) {
    clearHostRegexIndicator(refs.hostRegexIndicator);
    return;
  }
  const val = refs.hostPatternInput.value;
  if (!val) {
    clearHostRegexIndicator(refs.hostRegexIndicator);
    return;
  }
  try {
    new RegExp(val);
    updateHostRegexIndicator(refs.hostRegexIndicator, true);
  } catch {
    updateHostRegexIndicator(refs.hostRegexIndicator, false);
  }
}

// ── Editor refs type ───────────────────────────────────────────────────────

interface EditorRefs {
  hostPatternInput: HTMLInputElement;
  regexToggleBtn: HTMLButtonElement;
  hostRegexIndicator: HTMLElement | null;
  nameInput: HTMLInputElement;
  selectorInput: HTMLInputElement;
  selectorConfidenceEl: HTMLElement | null;
  selectorInvalidMsg: HTMLElement | null;
  cssInput: HTMLTextAreaElement;
  importantCheckbox: HTMLInputElement;
  forceReapplyCheckbox: HTMLInputElement;
  rulesListContainer: HTMLElement;
  noRulesMsg: HTMLElement | null;
  saveRuleBtn: HTMLButtonElement | null;
}

interface BlindEditorRefs {
  blindHostPatternInput: HTMLInputElement | null;
  blindRegexToggleBtn: HTMLButtonElement | null;
  blindHostRegexIndicator: HTMLElement | null;
  blindNameInput: HTMLInputElement | null;
  blindColorInput: HTMLInputElement | null;
  blindPatternSelect: HTMLSelectElement | null;
  blindPositionSelect: HTMLSelectElement | null;
  blindsListContainer: HTMLElement | null;
  noBlindsMsg: HTMLElement | null;
  saveBlindBtn: HTMLButtonElement | null;
  drawBlindBtn: HTMLButtonElement | null;
  blindEditorPanel: HTMLElement | null;
}

// ── Selector confidence + validation helpers ───────────────────────────────

type SelectorConfidence = "high" | "medium" | "low" | "invalid";

const CONFIDENCE_LABELS: Record<SelectorConfidence, string> = {
  high:    "● High",
  medium:  "● Medium (?)",
  low:     "● Low (?)",
  invalid: "✕ Invalid (?)",
};

const CONFIDENCE_TOOLTIPS: Partial<Record<SelectorConfidence, string>> = {
  medium:  "This selector may match multiple elements. Consider refining it.",
  low:     "This selector is position-based and may break if the page structure changes.",
};

function updateSelectorConfidence(
  refs: EditorRefs,
  confidence: SelectorConfidence,
  errorMsg?: string,
): void {
  const el = refs.selectorConfidenceEl;
  if (!el) return;
  el.title = CONFIDENCE_TOOLTIPS[confidence] ?? "";
  el.textContent = CONFIDENCE_LABELS[confidence];
  el.className = `selector-confidence selector-confidence--${confidence}`;
  if (refs.selectorInvalidMsg) {
    if (confidence === "invalid" && errorMsg) {
      refs.selectorInvalidMsg.textContent = errorMsg;
      refs.selectorInvalidMsg.style.display = "";
    } else {
      refs.selectorInvalidMsg.textContent = "";
      refs.selectorInvalidMsg.style.display = "none";
    }
  }
  if (refs.saveRuleBtn) {
    refs.saveRuleBtn.disabled = confidence === "invalid";
  }
}

function clearSelectorIndicators(refs: EditorRefs): void {
  if (refs.selectorConfidenceEl) {
    refs.selectorConfidenceEl.title = "";
    refs.selectorConfidenceEl.textContent = "";
    refs.selectorConfidenceEl.className = "selector-confidence";
  }
  if (refs.selectorInvalidMsg) {
    refs.selectorInvalidMsg.textContent = "";
    refs.selectorInvalidMsg.style.display = "none";
  }
  if (refs.saveRuleBtn) {
    refs.saveRuleBtn.disabled = false;
  }
}

function validateSelectorInput(refs: EditorRefs): void {
  const val = refs.selectorInput.value.trim();
  if (!val) {
    clearSelectorIndicators(refs);
    return;
  }
  try {
    document.querySelector(val);
    // If no confidence is set from auto-gen, don't overwrite it with "high"
    // unless the current class indicates invalid.
    const el = refs.selectorConfidenceEl;
    if (!el || el.classList.contains("selector-confidence--invalid") || !el.textContent) {
      // Only clear the invalid state; don't stamp "high" on manually typed selectors
      if (el?.classList.contains("selector-confidence--invalid")) {
        clearSelectorIndicators(refs);
      }
    }
  } catch (e) {
    updateSelectorConfidence(refs, "invalid", String(e));
  }
}

// ── Editor state helpers ───────────────────────────────────────────────────

function populateEditorFromRule(rule: Rule, refs: EditorRefs): void {
  editingRuleId = rule.id;
  nameIsCustom = rule.nameIsCustom;
  isRegex = rule.isRegex;
  refs.hostPatternInput.value = rule.hostPattern;
  refs.nameInput.value = rule.name;
  refs.selectorInput.value = rule.selector;
  refs.cssInput.value = rule.css;
  refs.importantCheckbox.checked = /!important/i.test(rule.css);
  refs.forceReapplyCheckbox.checked = rule.forceReapply;
  updateRegexToggleVisual(refs.regexToggleBtn, isRegex);
  clearSelectorIndicators(refs);
  if (isRegex && rule.hostPattern) {
    validateHostPattern(refs);
  } else {
    clearHostRegexIndicator(refs.hostRegexIndicator);
  }
}

function populateEditorFromPick(
  selector: string,
  computedStyles: Record<string, string>,
  refs: EditorRefs,
): void {
  editingRuleId = null;
  nameIsCustom = false;
  isRegex = false;
  refs.hostPatternInput.value = currentHostname;
  refs.nameInput.value = selector;
  refs.selectorInput.value = selector;
  refs.cssInput.value = suggestCSS(computedStyles);
  refs.importantCheckbox.checked = true;
  refs.forceReapplyCheckbox.checked = false;
  updateRegexToggleVisual(refs.regexToggleBtn, false);
  clearSelectorIndicators(refs);
  clearHostRegexIndicator(refs.hostRegexIndicator);
}

function clearEditor(refs: EditorRefs): void {
  editingRuleId = null;
  nameIsCustom = false;
  isRegex = false;
  refs.hostPatternInput.value = currentHostname;
  refs.nameInput.value = "";
  refs.selectorInput.value = "";
  refs.cssInput.value = "";
  refs.importantCheckbox.checked = true;
  refs.forceReapplyCheckbox.checked = false;
  updateRegexToggleVisual(refs.regexToggleBtn, false);
  clearSelectorIndicators(refs);
  clearHostRegexIndicator(refs.hostRegexIndicator);
}

// ── Rule action helpers ────────────────────────────────────────────────────

async function saveRule(refs: EditorRefs): Promise<void> {
  const selector = refs.selectorInput.value.trim();
  const hostPattern = refs.hostPatternInput.value.trim();
  if (!selector || !hostPattern) return;

  let css = refs.cssInput.value;
  if (refs.importantCheckbox.checked) {
    css = addImportantToCSS(css);
  }

  const rulePartial: Partial<Rule> = {
    ...(editingRuleId ? { id: editingRuleId } : {}),
    name: refs.nameInput.value.trim() || selector,
    nameIsCustom,
    hostPattern,
    isRegex,
    selector,
    css,
    forceReapply: refs.forceReapplyCheckbox.checked,
    enabled: true,
  };

  try {
    const response = await browser.runtime.sendMessage({
      type: "SAVE_RULE",
      payload: { rule: rulePartial },
    }) as QCMessage;
    if (response.type === "RULE_SAVED") {
      const savedRule = response.payload.rule as Rule;
      editingRuleId = savedRule.id;
      await relayToContentScript("INJECT_RULE", { rule: savedRule });
      await loadRules();
      renderRulesList(refs.rulesListContainer, allMatchingRules, editingRuleId, refs.noRulesMsg);
    }
  } catch (err) {
    console.error("[QuietCSS Sidebar] saveRule failed:", err);
  }
}

async function deleteRule(ruleId: string, refs: EditorRefs): Promise<void> {
  try {
    const wasEditing = editingRuleId === ruleId;
    await browser.runtime.sendMessage({ type: "DELETE_RULE", payload: { id: ruleId } });
    await relayToContentScript("REMOVE_RULE", { id: ruleId });
    await loadRules();
    if (wasEditing) clearEditor(refs);
    renderRulesList(refs.rulesListContainer, allMatchingRules, editingRuleId, refs.noRulesMsg);
  } catch (err) {
    console.error("[QuietCSS Sidebar] deleteRule failed:", err);
  }
}

async function toggleRule(ruleId: string, refs: EditorRefs): Promise<void> {
  const rule = allMatchingRules.find(r => r.id === ruleId);
  if (!rule) return;
  const newEnabled = !rule.enabled;
  try {
    const response = await browser.runtime.sendMessage({
      type: "TOGGLE_RULE",
      payload: { id: ruleId, enabled: newEnabled },
    }) as QCMessage;
    if (response.type === "RULE_UPDATED") {
      const updated = response.payload.rule as Rule;
      if (updated.enabled) {
        await relayToContentScript("INJECT_RULE", { rule: updated });
      } else {
        await relayToContentScript("REMOVE_RULE", { id: ruleId });
      }
      await loadRules();
      renderRulesList(refs.rulesListContainer, allMatchingRules, editingRuleId, refs.noRulesMsg);
    }
  } catch (err) {
    console.error("[QuietCSS Sidebar] toggleRule failed:", err);
  }
}

// ── Blind render helpers ───────────────────────────────────────────────────

function renderBlindsList(
  container: HTMLElement | null,
  blinds: Blind[],
  activeBlindId: string | null,
  noMsg: HTMLElement | null,
): void {
  if (!container) return;
  container.querySelectorAll(".blind-item").forEach(el => el.remove());
  if (noMsg) {
    noMsg.style.display = blinds.length === 0 ? "" : "none";
  }
  for (const blind of blinds) {
    container.appendChild(buildBlindItem(blind, blind.id === activeBlindId));
  }
}

function buildBlindItem(blind: Blind, isActive: boolean): HTMLElement {
  const item = document.createElement("div");
  item.className = "rule-item blind-item" + (isActive ? " rule-item--active" : "");
  item.dataset.blindId = blind.id;

  const row = document.createElement("div");
  row.className = "rule-item-row";

  const nameSpan = document.createElement("span");
  nameSpan.className = "rule-item-name";
  nameSpan.textContent = blind.name || "Blind";

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "rule-toggle-btn" + (blind.enabled ? " rule-toggle-btn--enabled" : "");
  toggleBtn.textContent = blind.enabled ? "●" : "○";
  toggleBtn.title = blind.enabled ? "Disable blind" : "Enable blind";
  toggleBtn.dataset.blindId = blind.id;
  toggleBtn.dataset.action = "toggle";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "rule-delete-btn";
  deleteBtn.textContent = "✕";
  deleteBtn.title = "Delete blind";
  deleteBtn.dataset.blindId = blind.id;
  deleteBtn.dataset.action = "delete";

  row.appendChild(nameSpan);
  row.appendChild(toggleBtn);
  row.appendChild(deleteBtn);
  item.appendChild(row);
  return item;
}

// ── Blind editor state helpers ─────────────────────────────────────────────

function populateBlindEditor(blind: Blind, brefs: BlindEditorRefs): void {
  editingBlindId = blind.id;
  blindIsRegex = blind.isRegex;
  pendingBlindCoords = { top: blind.top, left: blind.left, width: blind.width, height: blind.height };
  if (brefs.blindHostPatternInput) brefs.blindHostPatternInput.value = blind.hostPattern;
  if (brefs.blindNameInput) brefs.blindNameInput.value = blind.name;
  if (brefs.blindColorInput) brefs.blindColorInput.value = blind.color;
  if (brefs.blindPatternSelect) brefs.blindPatternSelect.value = blind.pattern;
  if (brefs.blindPositionSelect) brefs.blindPositionSelect.value = blind.positionMode;
  brefs.blindEditorPanel?.classList.remove("editor-panel--hidden");
}

function clearBlindEditor(brefs: BlindEditorRefs): void {
  editingBlindId = null;
  blindIsRegex = false;
  pendingBlindCoords = null;
  if (brefs.blindHostPatternInput) brefs.blindHostPatternInput.value = currentHostname;
  if (brefs.blindNameInput) brefs.blindNameInput.value = "";
  if (brefs.blindColorInput) brefs.blindColorInput.value = "#1a1a2e";
  if (brefs.blindPatternSelect) brefs.blindPatternSelect.value = "dots";
  if (brefs.blindPositionSelect) brefs.blindPositionSelect.value = "absolute";
  brefs.blindEditorPanel?.classList.add("editor-panel--hidden");
}

// ── Blind action helpers ───────────────────────────────────────────────────

async function saveBlind(brefs: BlindEditorRefs): Promise<void> {
  const hostPattern = brefs.blindHostPatternInput?.value.trim() ?? "";
  if (!hostPattern || !pendingBlindCoords) return;

  const hostBlinds = allMatchingBlinds.filter(b => b.hostPattern === hostPattern);
  const n = editingBlindId ? hostBlinds.findIndex(b => b.id === editingBlindId) + 1 : hostBlinds.length + 1;
  const name = brefs.blindNameInput?.value.trim() || `Blind ${n}`;
  const positionMode = (brefs.blindPositionSelect?.value ?? "absolute") as "absolute" | "fixed";
  const color = brefs.blindColorInput?.value ?? "#1a1a2e";
  const pattern = (brefs.blindPatternSelect?.value ?? "dots") as Blind["pattern"];

  const blindPartial: Partial<Blind> = {
    ...(editingBlindId ? { id: editingBlindId } : {}),
    name,
    hostPattern,
    isRegex: blindIsRegex,
    top: pendingBlindCoords.top,
    left: pendingBlindCoords.left,
    width: pendingBlindCoords.width,
    height: pendingBlindCoords.height,
    positionMode,
    color,
    pattern,
    enabled: true,
  };

  try {
    const response = await browser.runtime.sendMessage({
      type: "SAVE_BLIND",
      payload: { blind: blindPartial },
    }) as QCMessage;
    if (response.type === "BLIND_SAVED") {
      const savedBlind = response.payload.blind as Blind;
      editingBlindId = savedBlind.id;
      pendingBlindCoords = {
        top: savedBlind.top,
        left: savedBlind.left,
        width: savedBlind.width,
        height: savedBlind.height,
      };
      await relayToContentScript("UPDATE_BLIND", { blind: savedBlind });
      await loadRules();
      renderBlindsList(brefs.blindsListContainer, allMatchingBlinds, editingBlindId, brefs.noBlindsMsg);
    }
  } catch (err) {
    console.error("[QuietCSS Sidebar] saveBlind failed:", err);
  }
}

async function deleteBlind(blindId: string, brefs: BlindEditorRefs): Promise<void> {
  try {
    const wasEditing = editingBlindId === blindId;
    await browser.runtime.sendMessage({ type: "DELETE_BLIND", payload: { id: blindId } });
    await relayToContentScript("REMOVE_BLIND", { id: blindId });
    await loadRules();
    if (wasEditing) clearBlindEditor(brefs);
    renderBlindsList(brefs.blindsListContainer, allMatchingBlinds, editingBlindId, brefs.noBlindsMsg);
  } catch (err) {
    console.error("[QuietCSS Sidebar] deleteBlind failed:", err);
  }
}

async function toggleBlind(blindId: string, brefs: BlindEditorRefs): Promise<void> {
  const blind = allMatchingBlinds.find(b => b.id === blindId);
  if (!blind) return;
  const newEnabled = !blind.enabled;
  try {
    const response = await browser.runtime.sendMessage({
      type: "TOGGLE_BLIND",
      payload: { id: blindId, enabled: newEnabled },
    }) as QCMessage;
    if (response.type === "BLIND_UPDATED") {
      const updated = response.payload.blind as Blind;
      await relayToContentScript("UPDATE_BLIND", { blind: updated });
      await loadRules();
      renderBlindsList(brefs.blindsListContainer, allMatchingBlinds, editingBlindId, brefs.noBlindsMsg);
    }
  } catch (err) {
    console.error("[QuietCSS Sidebar] toggleBlind failed:", err);
  }
}

// ── DOMContentLoaded ───────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // ── Resolve DOM refs ───────────────────────────────────────────────────
  const tabStylesBtn   = document.getElementById("tab-styles")      as HTMLButtonElement | null;
  const tabBlindsBtn   = document.getElementById("tab-blinds")      as HTMLButtonElement | null;
  const panelStyles    = document.getElementById("panel-styles")    as HTMLElement | null;
  const panelBlinds    = document.getElementById("panel-blinds")    as HTMLElement | null;
  const helpBtn        = document.getElementById("help-btn")        as HTMLButtonElement | null;
  const collapseBtn    = document.getElementById("collapse-btn")    as HTMLButtonElement | null;
  const sidebarContent = document.getElementById("sidebar-content") as HTMLElement | null;
  const saveRuleBtn         = document.getElementById("save-rule-btn")       as HTMLButtonElement | null;
  const cancelRuleBtn       = document.getElementById("cancel-rule-btn")     as HTMLButtonElement | null;
  const autoGenBtn          = document.getElementById("auto-gen-btn")        as HTMLButtonElement | null;
  const selectElementBtn    = document.getElementById("select-element-btn")  as HTMLButtonElement | null;

  const refs: EditorRefs = {
    hostPatternInput:     document.getElementById("host-pattern-input")     as HTMLInputElement,
    regexToggleBtn:       document.getElementById("regex-toggle-btn")       as HTMLButtonElement,
    hostRegexIndicator:   document.getElementById("host-regex-indicator"),
    nameInput:            document.getElementById("rule-name-input")        as HTMLInputElement,
    selectorInput:        document.getElementById("rule-selector-input")    as HTMLInputElement,
    selectorConfidenceEl: document.getElementById("selector-confidence"),
    selectorInvalidMsg:   document.getElementById("selector-invalid-msg"),
    cssInput:             document.getElementById("rule-css-input")         as HTMLTextAreaElement,
    importantCheckbox:    document.getElementById("important-checkbox")     as HTMLInputElement,
    forceReapplyCheckbox: document.getElementById("force-reapply-checkbox") as HTMLInputElement,
    rulesListContainer:   document.getElementById("rules-list")             as HTMLElement,
    noRulesMsg:           document.getElementById("no-rules-msg"),
    saveRuleBtn:          saveRuleBtn,
  };

  const brefs: BlindEditorRefs = {
    blindHostPatternInput:   document.getElementById("blind-host-pattern-input") as HTMLInputElement | null,
    blindRegexToggleBtn:     document.getElementById("blind-regex-toggle-btn")   as HTMLButtonElement | null,
    blindHostRegexIndicator: document.getElementById("blind-host-regex-indicator"),
    blindNameInput:          document.getElementById("blind-name-input")         as HTMLInputElement | null,
    blindColorInput:         document.getElementById("blind-color-input")        as HTMLInputElement | null,
    blindPatternSelect:      document.getElementById("blind-pattern-select")     as HTMLSelectElement | null,
    blindPositionSelect:     document.getElementById("blind-position-select")    as HTMLSelectElement | null,
    blindsListContainer:     document.getElementById("blinds-list"),
    noBlindsMsg:             document.getElementById("no-blinds-msg"),
    saveBlindBtn:            document.getElementById("save-blind-btn")           as HTMLButtonElement | null,
    drawBlindBtn:            document.getElementById("draw-blind-btn")           as HTMLButtonElement | null,
    blindEditorPanel:        document.getElementById("blind-editor-panel"),
  };

  // ── Initialise ─────────────────────────────────────────────────────────
  ({ hostname: currentHostname, url: currentUrl } = await getActiveTabHostname());
  refs.hostPatternInput.value = currentHostname;
  if (brefs.blindHostPatternInput) brefs.blindHostPatternInput.value = currentHostname;
  await loadRules();
  renderRulesList(refs.rulesListContainer, allMatchingRules, editingRuleId, refs.noRulesMsg);
  renderBlindsList(brefs.blindsListContainer, allMatchingBlinds, editingBlindId, brefs.noBlindsMsg);

  // ── Incoming messages ───────────────────────────────────────────────────
  browser.runtime.onMessage.addListener((message: unknown): Promise<QCMessage> | undefined => {
    const msg = message as QCMessage;

    if (msg.type === "ELEMENT_PICKED") {
      const p = msg.payload as {
        selector: string;
        confidence: "high" | "medium" | "low";
        computedStyles: Record<string, string>;
        tagName: string;
      };
      // Element was picked — exit pick mode and reset button.
      isPickingElement = false;
      void relayToContentScript("EXIT_EDIT_MODE", {});
      if (selectElementBtn) {
        selectElementBtn.textContent = "Select Element";
        selectElementBtn.classList.remove("select-element-btn--picking");
      }
      populateEditorFromPick(p.selector, p.computedStyles, refs);
      updateSelectorConfidence(refs, p.confidence);
      updateRulesListActiveState(refs.rulesListContainer, null);
      return Promise.resolve({ type: "ACK", payload: {} });
    }

    if (msg.type === "SELECTOR_GENERATED") {
      const p = msg.payload as { selector: string; confidence: "high" | "medium" | "low" };
      refs.selectorInput.value = p.selector;
      if (!nameIsCustom) {
        refs.nameInput.value = p.selector;
      }
      updateSelectorConfidence(refs, p.confidence);
      return Promise.resolve({ type: "ACK", payload: {} });
    }

    if (msg.type === "TAB_CHANGED") {
      const p = msg.payload as { hostname: string; url?: string };
      currentHostname = p.hostname;
      currentUrl = p.url ?? "";
      refs.hostPatternInput.value = currentHostname;
      if (brefs.blindHostPatternInput) brefs.blindHostPatternInput.value = currentHostname;
      // Cancel any in-progress blind draw on tab change.
      if (isDrawingBlind) {
        isDrawingBlind = false;
        void relayToContentScript("EXIT_EDIT_MODE", {});
        if (brefs.drawBlindBtn) {
          brefs.drawBlindBtn.textContent = "+ Draw new blind";
          brefs.drawBlindBtn.classList.remove("draw-blind-btn--active");
        }
        clearBlindEditor(brefs);
      }
      void loadRules().then(() => {
        renderRulesList(refs.rulesListContainer, allMatchingRules, editingRuleId, refs.noRulesMsg);
        renderBlindsList(brefs.blindsListContainer, allMatchingBlinds, editingBlindId, brefs.noBlindsMsg);
      });
      return Promise.resolve({ type: "ACK", payload: {} });
    }

    if (msg.type === "BLIND_DRAWN") {
      const p = msg.payload as { top: number; left: number; width: number; height: number };
      // Exit draw mode
      isDrawingBlind = false;
      void relayToContentScript("EXIT_EDIT_MODE", {});
      if (brefs.drawBlindBtn) {
        brefs.drawBlindBtn.textContent = "+ Draw new blind";
        brefs.drawBlindBtn.classList.remove("draw-blind-btn--active");
      }
      // Store coords and open editor
      pendingBlindCoords = { top: p.top, left: p.left, width: p.width, height: p.height };
      editingBlindId = null;
      const n = allMatchingBlinds.filter(b => b.hostPattern === currentHostname).length + 1;
      if (brefs.blindNameInput) brefs.blindNameInput.value = `Blind ${n}`;
      if (brefs.blindHostPatternInput) brefs.blindHostPatternInput.value = currentHostname;
      if (brefs.blindColorInput) brefs.blindColorInput.value = "#1a1a2e";
      if (brefs.blindPatternSelect) brefs.blindPatternSelect.value = "dots";
      if (brefs.blindPositionSelect) brefs.blindPositionSelect.value = "absolute";
      brefs.blindEditorPanel?.classList.remove("editor-panel--hidden");
      return Promise.resolve({ type: "ACK", payload: {} });
    }

    if (msg.type === "BLIND_COORDS_ADJUSTED") {
      const p = msg.payload as { id: string; top: number; left: number };
      if (pendingBlindCoords && p.id === editingBlindId) {
        pendingBlindCoords = { ...pendingBlindCoords, top: p.top, left: p.left };
      }
      return Promise.resolve({ type: "ACK", payload: {} });
    }

    return undefined;
  });

  // ── Tab switching ───────────────────────────────────────────────────────
  tabStylesBtn?.addEventListener("click", () => {
    tabStylesBtn.classList.add("tab-btn--active");
    tabBlindsBtn?.classList.remove("tab-btn--active");
    panelStyles?.classList.remove("tab-panel--hidden");
    panelBlinds?.classList.add("tab-panel--hidden");
  });

  tabBlindsBtn?.addEventListener("click", () => {
    tabBlindsBtn.classList.add("tab-btn--active");
    tabStylesBtn?.classList.remove("tab-btn--active");
    panelBlinds?.classList.remove("tab-panel--hidden");
    panelStyles?.classList.add("tab-panel--hidden");
  });

  // ── Header buttons ──────────────────────────────────────────────────────
  helpBtn?.addEventListener("click", () => {
    void browser.tabs.create({ url: "https://github.com/TomMakes/quiet-css" });
  });

  let collapsed = false;
  collapseBtn?.addEventListener("click", () => {
    collapsed = !collapsed;
    sidebarContent?.classList.toggle("sidebar-content--collapsed", collapsed);
    if (collapseBtn) collapseBtn.textContent = collapsed ? "+" : "−";
  });

  // ── Regex toggle ────────────────────────────────────────────────────────
  refs.regexToggleBtn.addEventListener("click", () => {
    isRegex = !isRegex;
    updateRegexToggleVisual(refs.regexToggleBtn, isRegex);
    if (isRegex) {
      validateHostPattern(refs);
    } else {
      clearHostRegexIndicator(refs.hostRegexIndicator);
    }
  });

  refs.hostPatternInput.addEventListener("input", () => {
    if (isRegex) {
      validateHostPattern(refs);
    }
  });

  // ── Name field behaviours ───────────────────────────────────────────────
  refs.nameInput.addEventListener("input", () => {
    nameIsCustom = true;
  });

  refs.nameInput.addEventListener("blur", () => {
    if (!nameIsCustom || refs.nameInput.value.trim() === "") {
      refs.nameInput.value = refs.selectorInput.value;
    }
  });

  // ── Selector syncs name when not custom ────────────────────────────────
  refs.selectorInput.addEventListener("input", () => {
    if (!nameIsCustom) {
      refs.nameInput.value = refs.selectorInput.value;
    }
    validateSelectorInput(refs);
  });

  // ── Select Element toggle ───────────────────────────────────────────────
  selectElementBtn?.addEventListener("click", () => {
    isPickingElement = !isPickingElement;
    if (isPickingElement) {
      selectElementBtn.textContent = "Cancel Selection";
      selectElementBtn.classList.add("select-element-btn--picking");
      void relayToContentScript("ENTER_EDIT_MODE", { submode: "style" });
    } else {
      selectElementBtn.textContent = "Select Element";
      selectElementBtn.classList.remove("select-element-btn--picking");
      void relayToContentScript("EXIT_EDIT_MODE", {});
    }
  });

  // ── Auto-generate (content-script handler wired in Step 7) ─────────────
  // remove this after initial build
  autoGenBtn?.addEventListener("click", () => {
    void relayToContentScript("GENERATE_SELECTOR", {});
  });

  // ── Save ────────────────────────────────────────────────────────────────
  saveRuleBtn?.addEventListener("click", () => { void saveRule(refs); });

  // ── Cancel ──────────────────────────────────────────────────────────────
  cancelRuleBtn?.addEventListener("click", () => {
    clearEditor(refs);
    updateRulesListActiveState(refs.rulesListContainer, null);
  });

  // ── Rules list: click-to-edit / toggle / delete ─────────────────────────
  refs.rulesListContainer.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    const ruleId = target.dataset.ruleId;

    if (action === "delete" && ruleId) {
      e.stopPropagation();
      void deleteRule(ruleId, refs);
      return;
    }

    if (action === "toggle" && ruleId) {
      e.stopPropagation();
      void toggleRule(ruleId, refs);
      return;
    }

    // Click on rule item -> load into editor.
    const item = target.closest?.(".rule-item") as HTMLElement | null;
    if (item?.dataset.ruleId) {
      const rule = allMatchingRules.find(r => r.id === item.dataset.ruleId);
      if (rule) {
        populateEditorFromRule(rule, refs);
        updateRulesListActiveState(refs.rulesListContainer, rule.id);
      }
    }
  });

  // ── Draw blind button ───────────────────────────────────────────────────
  brefs.drawBlindBtn?.addEventListener("click", () => {
    isDrawingBlind = !isDrawingBlind;
    if (isDrawingBlind) {
      if (brefs.drawBlindBtn) {
        brefs.drawBlindBtn.textContent = "Cancel draw";
        brefs.drawBlindBtn.classList.add("draw-blind-btn--active");
      }
      brefs.blindEditorPanel?.classList.add("editor-panel--hidden");
      void relayToContentScript("ENTER_EDIT_MODE", { submode: "blind" });
    } else {
      if (brefs.drawBlindBtn) {
        brefs.drawBlindBtn.textContent = "+ Draw new blind";
        brefs.drawBlindBtn.classList.remove("draw-blind-btn--active");
      }
      void relayToContentScript("EXIT_EDIT_MODE", {});
    }
  });

  // ── Blind position mode change — triggers coord conversion ──────────────
  brefs.blindPositionSelect?.addEventListener("change", async () => {
    if (editingBlindId && pendingBlindCoords) {
      const blind = allMatchingBlinds.find(b => b.id === editingBlindId);
      if (blind) {
        const newMode = (brefs.blindPositionSelect?.value ?? "absolute") as "absolute" | "fixed";
        const updatedBlind: Blind = {
          ...blind,
          positionMode: newMode,
          top: pendingBlindCoords.top,
          left: pendingBlindCoords.left,
          width: pendingBlindCoords.width,
          height: pendingBlindCoords.height,
        };
        await relayToContentScript("UPDATE_BLIND", { blind: updatedBlind });
        // BLIND_COORDS_ADJUSTED response will update pendingBlindCoords
      }
    }
  });

  // ── Save blind ──────────────────────────────────────────────────────────
  brefs.saveBlindBtn?.addEventListener("click", () => { void saveBlind(brefs); });

  // ── Cancel blind ────────────────────────────────────────────────────────
  document.getElementById("cancel-blind-btn")?.addEventListener("click", () => {
    clearBlindEditor(brefs);
    renderBlindsList(brefs.blindsListContainer, allMatchingBlinds, null, brefs.noBlindsMsg);
  });

  // ── Blind name field: clear-to-default on blur ──────────────────────────
  brefs.blindNameInput?.addEventListener("blur", () => {
    if (!brefs.blindNameInput || brefs.blindNameInput.value.trim() !== "") return;
    const hostPattern = brefs.blindHostPatternInput?.value.trim() ?? currentHostname;
    const hostBlinds = allMatchingBlinds.filter(b => b.hostPattern === hostPattern);
    const n = editingBlindId
      ? hostBlinds.findIndex(b => b.id === editingBlindId) + 1
      : hostBlinds.length + 1;
    brefs.blindNameInput.value = `Blind ${n}`;
  });

  // ── Blinds list: click-to-edit / toggle / delete ────────────────────────
  brefs.blindsListContainer?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    const blindId = target.dataset.blindId;

    if (action === "delete" && blindId) {
      e.stopPropagation();
      void deleteBlind(blindId, brefs);
      return;
    }

    if (action === "toggle" && blindId) {
      e.stopPropagation();
      void toggleBlind(blindId, brefs);
      return;
    }

    const item = target.closest?.(".blind-item") as HTMLElement | null;
    if (item?.dataset.blindId) {
      const blind = allMatchingBlinds.find(b => b.id === item.dataset.blindId);
      if (blind) {
        populateBlindEditor(blind, brefs);
        renderBlindsList(brefs.blindsListContainer, allMatchingBlinds, blind.id, brefs.noBlindsMsg);
      }
    }
  });

  // Re-fetch on focus – handles tab switches without a TAB_CHANGED message.
  window.addEventListener("focus", () => {
    void (async () => {
      const tab = await getActiveTabHostname();
      if (tab.hostname !== currentHostname || tab.url !== currentUrl) {
        currentHostname = tab.hostname;
        currentUrl = tab.url;
        refs.hostPatternInput.value = currentHostname;
        if (brefs.blindHostPatternInput) brefs.blindHostPatternInput.value = currentHostname;
      }
      await loadRules();
      renderRulesList(refs.rulesListContainer, allMatchingRules, editingRuleId, refs.noRulesMsg);
      renderBlindsList(brefs.blindsListContainer, allMatchingBlinds, editingBlindId, brefs.noBlindsMsg);
    })();
  });
});

export {};
