// schema.d.ts — Global Rule/Blind/QCMessage type declarations

declare interface Rule {
  id: string;
  name: string;
  nameIsCustom: boolean;
  hostPattern: string;
  isRegex: boolean;
  selector: string;
  css: string;
  forceReapply: boolean;
  enabled: boolean;
}

declare interface Blind {
  id: string;
  name: string;
  hostPattern: string;
  isRegex: boolean;
  top: number;
  left: number;
  width: number;
  height: number;
  positionMode: "absolute" | "fixed";
  color: string;
  pattern: "none" | "dots" | "diagonal" | "grid";
  enabled: boolean;
}

declare interface ValidationResult {
  valid: boolean;
  error?: string;
}

declare interface SelectorResult {
  selector: string;
  confidence: "high" | "medium" | "low";
}

declare type QCRelayToContentScriptType =
  | "ENTER_EDIT_MODE"
  | "EXIT_EDIT_MODE"
  | "HIGHLIGHT_SELECTOR"
  | "APPLY_RULE_PREVIEW"
  | "REMOVE_RULE_PREVIEW"
  | "INJECT_RULE"
  | "REMOVE_RULE"
  | "GENERATE_SELECTOR";

declare interface QCRelayToContentScriptPayloadMap {
  ENTER_EDIT_MODE: { submode: "style" | "blind" };
  EXIT_EDIT_MODE: Record<string, never>;
  HIGHLIGHT_SELECTOR: { selector: string };
  APPLY_RULE_PREVIEW: { css: string; selector: string };
  REMOVE_RULE_PREVIEW: { selector: string };
  INJECT_RULE: { rule: Rule };
  REMOVE_RULE: { id: string };
  GENERATE_SELECTOR: Record<string, never>;
}

declare type QCRelayToContentScriptMessage<
  T extends QCRelayToContentScriptType = QCRelayToContentScriptType,
> = {
  [K in T]: {
    type: K;
    payload: QCRelayToContentScriptPayloadMap[K];
  };
}[T];

declare type QCMessage = {
  type: string;
  payload: Record<string, unknown>;
};
