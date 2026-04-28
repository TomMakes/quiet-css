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

declare type QCMessage = {
  type: string;
  payload: Record<string, unknown>;
};
