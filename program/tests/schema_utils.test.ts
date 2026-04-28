/// <reference path="../src/shared/schema.d.ts" />

import { describe, it, expect, vi } from "vitest";
import { createRule, createBlind, validateRule, validateBlind } from "../src/shared/schema_utils";

// ---------- createRule ----------

describe("createRule", () => {
  it("generates a UUID and default field values when no params provided", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" as ReturnType<typeof crypto.randomUUID>
    );
    const rule = createRule();
    expect(rule.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(rule.name).toBe("");
    expect(rule.nameIsCustom).toBe(false);
    expect(rule.hostPattern).toBe("");
    expect(rule.isRegex).toBe(false);
    expect(rule.selector).toBe("");
    expect(rule.css).toBe("");
    expect(rule.forceReapply).toBe(false);
    expect(rule.enabled).toBe(true);
    vi.restoreAllMocks();
  });

  it("preserves all provided values", () => {
    const rule = createRule({
      id: "custom-id",
      name: "My Rule",
      nameIsCustom: true,
      hostPattern: "example.com",
      isRegex: false,
      selector: ".ad-banner",
      css: "display: none !important;",
      forceReapply: true,
      enabled: false,
    });
    expect(rule.id).toBe("custom-id");
    expect(rule.name).toBe("My Rule");
    expect(rule.nameIsCustom).toBe(true);
    expect(rule.hostPattern).toBe("example.com");
    expect(rule.selector).toBe(".ad-banner");
    expect(rule.css).toBe("display: none !important;");
    expect(rule.forceReapply).toBe(true);
    expect(rule.enabled).toBe(false);
  });

  it("falls back to defaults for unspecified fields", () => {
    const rule = createRule({ id: "only-id" });
    expect(rule.id).toBe("only-id");
    expect(rule.name).toBe("");
    expect(rule.enabled).toBe(true);
  });
});

// ---------- createBlind ----------

describe("createBlind", () => {
  it("generates a UUID and default field values when no params provided", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "11111111-2222-3333-4444-555555555555" as ReturnType<typeof crypto.randomUUID>
    );
    const blind = createBlind();
    expect(blind.id).toBe("11111111-2222-3333-4444-555555555555");
    expect(blind.name).toBe("");
    expect(blind.hostPattern).toBe("");
    expect(blind.isRegex).toBe(false);
    expect(blind.top).toBe(0);
    expect(blind.left).toBe(0);
    expect(blind.width).toBe(200);
    expect(blind.height).toBe(100);
    expect(blind.positionMode).toBe("absolute");
    expect(blind.color).toBe("#1a1a2e");
    expect(blind.pattern).toBe("dots");
    expect(blind.enabled).toBe(true);
    vi.restoreAllMocks();
  });

  it("preserves all provided values", () => {
    const blind = createBlind({
      id: "b-id",
      name: "Cover",
      hostPattern: "reddit.com",
      isRegex: true,
      top: 100,
      left: 50,
      width: 400,
      height: 200,
      positionMode: "fixed",
      color: "#ffffff",
      pattern: "grid",
      enabled: false,
    });
    expect(blind.id).toBe("b-id");
    expect(blind.name).toBe("Cover");
    expect(blind.hostPattern).toBe("reddit.com");
    expect(blind.isRegex).toBe(true);
    expect(blind.top).toBe(100);
    expect(blind.left).toBe(50);
    expect(blind.width).toBe(400);
    expect(blind.height).toBe(200);
    expect(blind.positionMode).toBe("fixed");
    expect(blind.color).toBe("#ffffff");
    expect(blind.pattern).toBe("grid");
    expect(blind.enabled).toBe(false);
  });
});

// ---------- validateRule ----------

describe("validateRule", () => {
  const validRule: Rule = {
    id: "r1",
    name: "Test",
    nameIsCustom: false,
    hostPattern: "example.com",
    isRegex: false,
    selector: ".foo",
    css: "display: none;",
    forceReapply: false,
    enabled: true,
  };

  it("returns valid:true for a well-formed rule", () => {
    expect(validateRule(validRule)).toEqual({ valid: true });
  });

  it("returns valid:false when hostPattern is empty string", () => {
    const result = validateRule({ ...validRule, hostPattern: "" });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/hostPattern/);
  });

  it("returns valid:false for a syntactically invalid regex hostPattern", () => {
    const result = validateRule({ ...validRule, hostPattern: "[unclosed", isRegex: true });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/regex/i);
  });

  it("returns valid:true for a valid regex hostPattern", () => {
    const result = validateRule({ ...validRule, hostPattern: "example\\.com$", isRegex: true });
    expect(result.valid).toBe(true);
  });
});

// ---------- validateBlind ----------

describe("validateBlind", () => {
  const validBlind: Blind = {
    id: "b1",
    name: "Cover",
    hostPattern: "example.com",
    isRegex: false,
    top: 0,
    left: 0,
    width: 200,
    height: 100,
    positionMode: "absolute",
    color: "#000",
    pattern: "dots",
    enabled: true,
  };

  it("returns valid:true for a well-formed blind", () => {
    expect(validateBlind(validBlind)).toEqual({ valid: true });
  });

  it("returns valid:false when hostPattern is empty string", () => {
    const result = validateBlind({ ...validBlind, hostPattern: "" });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/hostPattern/);
  });

  it("returns valid:false for a syntactically invalid regex hostPattern", () => {
    const result = validateBlind({ ...validBlind, hostPattern: "(bad", isRegex: true });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/regex/i);
  });

  it("returns valid:true for a valid regex hostPattern", () => {
    const result = validateBlind({ ...validBlind, hostPattern: ".*\\.example\\.com", isRegex: true });
    expect(result.valid).toBe(true);
  });
});
