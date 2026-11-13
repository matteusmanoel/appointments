import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { sendShopPix } from "../ai/tools.js";
import { createScheduledMessagesFixtures, deleteScheduledMessagesFixtures } from "./helpers/db.js";

describe("sendShopPix", () => {
  let fx: Awaited<ReturnType<typeof createScheduledMessagesFixtures>> | null = null;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      fx = await createScheduledMessagesFixtures({ appointmentOffsetDays: 2, appointmentTime: "16:00" });
    } catch {
      fx = null;
    }
  });

  afterAll(async () => {
    if (fx) await deleteScheduledMessagesFixtures([fx.barbershopId]);
  });

  it("does not invent a key when pix_key is empty", async () => {
    if (!fx) return;
    await pool.query(`UPDATE public.barbershops SET pix_key = NULL WHERE id = $1`, [fx.barbershopId]);
    const r = (await sendShopPix(fx.barbershopId, fx.clientPhone)) as { error?: string; message?: string };
    expect(r.error).toBe("missing_pix_key");
    expect(r.message).toMatch(/equipe passa a chave/i);
  });

  it("returns the key for the composer and does not send a PIX card", async () => {
    if (!fx) return;
    await pool.query(`UPDATE public.barbershops SET pix_key = 'nvalhia-chave' WHERE id = $1`, [fx.barbershopId]);
    const r = (await sendShopPix(fx.barbershopId, fx.clientPhone)) as {
      ok?: boolean;
      channel?: string;
      pix_key?: string;
      message?: string;
    };
    expect(r.ok).toBe(true);
    expect(r.channel).toBe("compose");
    expect(r.pix_key).toBe("nvalhia-chave");
    expect(r.message).not.toMatch(/nvalhia-chave/);
  });
});
