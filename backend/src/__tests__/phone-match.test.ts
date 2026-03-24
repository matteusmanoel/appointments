import { describe, it, expect } from "vitest";
import {
  normalizeDigits,
  brPhoneMatchKeys,
  brPhonesMatch,
  canonicalizeBrPhoneDigits,
} from "../lib/phone-match.js";

describe("normalizeDigits", () => {
  it("strips non-digits", () => {
    expect(normalizeDigits("+55 (45) 98823-0845")).toBe("5545988230845");
  });
  it("returns empty for null/undefined", () => {
    expect(normalizeDigits(null)).toBe("");
    expect(normalizeDigits(undefined)).toBe("");
  });
});

describe("canonicalizeBrPhoneDigits", () => {
  it("returns null for less than 10 digits", () => {
    expect(canonicalizeBrPhoneDigits("123456789")).toBeNull();
    expect(canonicalizeBrPhoneDigits("")).toBeNull();
  });

  it("adds 55 prefix for 10-digit landline (subscriber 2-5)", () => {
    expect(canonicalizeBrPhoneDigits("4532123456")).toBe("554532123456");
  });

  it("adds 9 for mobile when national 10 digits and subscriber starts with 6-9", () => {
    expect(canonicalizeBrPhoneDigits("45988230845")).toBe("5545988230845");
    expect(canonicalizeBrPhoneDigits("4588230845")).toBe("5545988230845");
  });

  it("keeps 11-digit with 9 as canonical (55 + DDD + 9 + 8)", () => {
    expect(canonicalizeBrPhoneDigits("5545988230845")).toBe("5545988230845");
    expect(canonicalizeBrPhoneDigits("45988230845")).toBe("5545988230845");
  });

  it("collapses 459... and 5545... to same canonical", () => {
    const a = canonicalizeBrPhoneDigits("45988230845");
    const b = canonicalizeBrPhoneDigits("554588230845");
    expect(a).toBe("5545988230845");
    expect(b).toBe("5545988230845");
    expect(a).toBe(b);
  });

  it("accepts digits with spaces/dashes", () => {
    expect(canonicalizeBrPhoneDigits("55 45 98823-0845")).toBe("5545988230845");
  });

  it("landline 10 digits (subscriber 2-5) stays without 9", () => {
    expect(canonicalizeBrPhoneDigits("4532123456")).toBe("554532123456");
  });
});

describe("brPhoneMatchKeys", () => {
  it("returns equivalent keys for same contact", () => {
    const k1 = brPhoneMatchKeys("5545988230845");
    const k2 = brPhoneMatchKeys("45988230845");
    expect(k1).toContain("5545988230845");
    expect(k2).toContain("5545988230845");
    expect(k1.some((x) => k2.includes(x))).toBe(true);
  });
});

describe("brPhonesMatch", () => {
  it("matches 459... and 5545...", () => {
    expect(brPhonesMatch("45988230845", "554588230845")).toBe(true);
  });
  it("matches with and without 55", () => {
    expect(brPhonesMatch("5545988230845", "45988230845")).toBe(true);
  });
  it("returns false for different numbers", () => {
    expect(brPhonesMatch("45988230845", "5511999999999")).toBe(false);
  });
});
