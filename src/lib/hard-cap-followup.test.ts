import { describe, expect, it } from "vitest";
import { conversationNeedsHardCapFollowup, IA_PAUSED_BY_LIMIT_LABEL } from "./hard-cap-followup";

describe("conversationNeedsHardCapFollowup", () => {
  it("só acende com needs_human_followup=true e o texto visível à atendente é «IA pausada por limite»", () => {
    expect(IA_PAUSED_BY_LIMIT_LABEL).toBe("IA pausada por limite");
    expect(conversationNeedsHardCapFollowup({ needs_human_followup: true })).toBe(true);
    expect(conversationNeedsHardCapFollowup({ needs_human_followup: false })).toBe(false);
    expect(conversationNeedsHardCapFollowup({})).toBe(false);
    expect(conversationNeedsHardCapFollowup(null)).toBe(false);
  });
});
