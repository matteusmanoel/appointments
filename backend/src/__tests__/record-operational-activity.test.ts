import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { ensureCriticalSchema } from "../db/ensure-schema.js";
import { recordOperationalActivity } from "../agenda/record-operational-activity.js";

describe("recordOperationalActivity", () => {
  let barbershopId: string | null = null;
  const phone = "5545999990001";

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    await ensureCriticalSchema();
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug)
       VALUES ('Test Operational Activity', '5511900000002', 'pro', $1)
       RETURNING id`,
      [`test-operational-activity-${Date.now()}`],
    );
    barbershopId = shop.rows[0]?.id ?? null;
  });

  afterAll(async () => {
    if (barbershopId) {
      await pool.query(`DELETE FROM public.agenda_activity WHERE barbershop_id = $1`, [barbershopId]).catch(() => {});
      await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [barbershopId]).catch(() => {});
    }
  });

  it("records failure types in the feed and dedupes retries within the window", async () => {
    if (!barbershopId) return;
    for (let i = 0; i < 3; i++) {
      await recordOperationalActivity({
        barbershopId,
        type: "payment_failed",
        clientPhone: phone,
        summary: "Cobrança do plano Mensal não enviada — WhatsApp desconectado",
        dedupeMinutes: 60,
      });
    }
    await recordOperationalActivity({
      barbershopId,
      type: "send_failure",
      clientPhone: phone,
      summary: "Lembrete não entregue — WhatsApp desconectado",
    });
    const rows = await pool.query<{ type: string; actor: string }>(
      `SELECT type, actor FROM public.agenda_activity WHERE barbershop_id = $1 ORDER BY created_at`,
      [barbershopId],
    );
    expect(rows.rows.map((r) => r.type)).toEqual(["payment_failed", "send_failure"]);
    expect(rows.rows.every((r) => r.actor === "system")).toBe(true);
  });
});
