import { describe, expect, it } from "vitest";
import { conversationNeedsHardCapFollowup, IA_PAUSED_BY_LIMIT_LABEL } from "./hard-cap-followup";

describe("conversationNeedsHardCapFollowup", () => {
  it("só acende com ia_paused_by_limit=true; needs_human_followup de outro motivo não mostra o badge", () => {
    expect(IA_PAUSED_BY_LIMIT_LABEL).toBe("IA pausada por limite");
    expect(conversationNeedsHardCapFollowup({ ia_paused_by_limit: true })).toBe(true);
    expect(conversationNeedsHardCapFollowup({ ia_paused_by_limit: false })).toBe(false);
    expect(conversationNeedsHardCapFollowup({ needs_human_followup: true })).toBe(false);
    expect(conversationNeedsHardCapFollowup({ needs_human_followup: true, ia_paused_by_limit: false })).toBe(false);
    expect(conversationNeedsHardCapFollowup({})).toBe(false);
    expect(conversationNeedsHardCapFollowup(null)).toBe(false);
  });
});
