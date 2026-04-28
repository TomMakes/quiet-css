// schema_utils.ts — Runtime constructors and validation helpers

export function createRule(params: Partial<Rule> = {}): Rule {
  return {
    id: params.id ?? crypto.randomUUID(),
    name: params.name ?? "",
    nameIsCustom: params.nameIsCustom ?? false,
    hostPattern: params.hostPattern ?? "",
    isRegex: params.isRegex ?? false,
    selector: params.selector ?? "",
    css: params.css ?? "",
    forceReapply: params.forceReapply ?? false,
    enabled: params.enabled ?? true,
  };
}

export function createBlind(params: Partial<Blind> = {}): Blind {
  return {
    id: params.id ?? crypto.randomUUID(),
    name: params.name ?? "",
    hostPattern: params.hostPattern ?? "",
    isRegex: params.isRegex ?? false,
    top: params.top ?? 0,
    left: params.left ?? 0,
    width: params.width ?? 200,
    height: params.height ?? 100,
    positionMode: params.positionMode ?? "absolute",
    color: params.color ?? "#1a1a2e",
    pattern: params.pattern ?? "dots",
    enabled: params.enabled ?? true,
  };
}

export function validateRule(rule: Rule): ValidationResult {
  if (typeof rule.hostPattern !== "string" || rule.hostPattern === "") {
    return { valid: false, error: "hostPattern must be a non-empty string." };
  }
  if (rule.isRegex) {
    try {
      new RegExp(rule.hostPattern);
    } catch (e) {
      return { valid: false, error: `Invalid regex pattern: ${String(e)}` };
    }
  }
  return { valid: true };
}

export function validateBlind(blind: Blind): ValidationResult {
  if (typeof blind.hostPattern !== "string" || blind.hostPattern === "") {
    return { valid: false, error: "hostPattern must be a non-empty string." };
  }
  if (blind.isRegex) {
    try {
      new RegExp(blind.hostPattern);
    } catch (e) {
      return { valid: false, error: `Invalid regex pattern: ${String(e)}` };
    }
  }
  return { valid: true };
}
