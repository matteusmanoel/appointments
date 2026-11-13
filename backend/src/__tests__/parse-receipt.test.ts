import { describe, it, expect } from "vitest";
import { decideReceiptAcceptance, RECEIPT_FAIL_REPLY } from "../ai/parse-receipt.js";

const shop = { shopName: "Navalhia Centro", pixKey: "chave-pix-loja", todayIso: "2026-09-20", yesterdayIso: "2026-09-19" };

describe("decideReceiptAcceptance", () => {
  it("accepts shop name today and ignores amount as a criterion", () => {
    const r = decideReceiptAcceptance({
      ...shop,
      nowMins: 14 * 60,
      facts: {
        readable: true,
        recipient: "Navalhia Centro",
        transferDate: "2026-09-20",
        amount: 999,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toBe(999);
  });

  it("accepts yesterday only after midnight before 06:00", () => {
    const late = decideReceiptAcceptance({
      ...shop,
      nowMins: 1 * 60,
      facts: {
        readable: true,
        recipient: "chave-pix-loja",
        transferDate: "2026-09-19",
        amount: 55,
      },
    });
    expect(late.ok).toBe(true);
    const afternoon = decideReceiptAcceptance({
      ...shop,
      nowMins: 14 * 60,
      facts: {
        readable: true,
        recipient: "chave-pix-loja",
        transferDate: "2026-09-19",
        amount: 55,
      },
    });
    expect(afternoon.ok).toBe(false);
  });

  it("rejects unreadable or wrong recipient without inventing", () => {
    expect(
      decideReceiptAcceptance({
        ...shop,
        nowMins: 10 * 60,
        facts: { readable: false, recipient: null, transferDate: null, amount: null },
      }).ok,
    ).toBe(false);
    expect(
      decideReceiptAcceptance({
        ...shop,
        nowMins: 10 * 60,
        facts: {
          readable: true,
          recipient: "Outra Loja",
          transferDate: "2026-09-20",
          amount: 55,
        },
      }).ok,
    ).toBe(false);
    expect(RECEIPT_FAIL_REPLY).toMatch(/equipe confere/i);
  });
});
