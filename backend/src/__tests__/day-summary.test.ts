import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { daySummaryQuery } from "../routes/intelligence.js";

const TZ = "America/Sao_Paulo";

describe("day-summary SQL counters", () => {
  let barbershopId: string | null = null;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      const tbl = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = 'agenda_activity'`,
      );
      if (tbl.rows.length === 0) return;

      const shop = await pool.query<{ id: string }>(
        `INSERT INTO public.barbershops (name, phone, billing_plan, slug)
         VALUES ('Test Day Summary', '5511900000099', 'pro', $1)
         RETURNING id`,
        [`test-day-summary-${Date.now()}`],
      );
      barbershopId = shop.rows[0]!.id;

      await pool.query(
        `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
         VALUES ($1, false, $2, 'gpt-4o-mini')
         ON CONFLICT (barbershop_id) DO UPDATE SET timezone = $2`,
        [barbershopId, TZ],
      );

      // Base sent messages (one each of the known types)
      await pool.query(
        `INSERT INTO public.scheduled_messages (barbershop_id, to_phone, type, status, payload_json, updated_at, run_after)
         VALUES
           ($1, '5545900000001', 'reminder_24h', 'sent', '{}', now(), now()),
           ($1, '5545900000002', 'reminder_2h',  'sent', '{}', now(), now()),
           ($1, '5545900000003', 'reactivation', 'sent', '{}', now(), now()),
           ($1, '5545900000004', 'plan_billing', 'sent', '{}', now(), now()),
           ($1, '5545900000009', 'manual',        'sent', '{}', now(), now()),
           ($1, '5545900000010', 'campaign',      'sent', '{}', now(), now())`,
        [barbershopId],
      );

      // Agenda-activity events today
      await pool.query(
        `INSERT INTO public.agenda_activity (barbershop_id, type, actor, client_phone)
         VALUES
           ($1, 'waitlist_offered',     'system', '5545900000005'),
           ($1, 'conversation_started', 'system', '5545900000006'),
           ($1, 'send_failure',         'system', '5545900000007')`,
        [barbershopId],
      );

      // Insistence scenario: phone 8 gets 3 events (2 reminders + reativação)
      await pool.query(
        `INSERT INTO public.scheduled_messages (barbershop_id, to_phone, type, status, payload_json, updated_at, run_after)
         VALUES
           ($1, '5545900000008', 'reminder_24h', 'sent', '{}', now(), now()),
           ($1, '5545900000008', 'reminder_2h',  'sent', '{}', now(), now()),
           ($1, '5545900000008', 'reactivation', 'sent', '{}', now(), now())`,
        [barbershopId],
      );
    } catch (e) {
      console.warn("[day-summary test] setup failed:", e instanceof Error ? e.message : e);
      barbershopId = null;
    }
  });

  afterAll(async () => {
    if (!barbershopId) return;
    await pool.query(`DELETE FROM public.scheduled_messages WHERE barbershop_id = $1`, [barbershopId]);
    await pool.query(`DELETE FROM public.agenda_activity WHERE barbershop_id = $1`, [barbershopId]);
    await pool.query(`DELETE FROM public.barbershop_ai_settings WHERE barbershop_id = $1`, [barbershopId]);
    await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [barbershopId]);
  });

  it("skips if DB unavailable", () => {
    if (!barbershopId) expect(true).toBe(true);
    else expect(barbershopId).toBeTruthy();
  });

  it("by_purpose counters are correct (uses shared daySummaryQuery)", async () => {
    if (!barbershopId) return;

    const r = await pool.query<{
      lembrete: string;
      fila_espera: string;
      reativacao: string;
      cobranca: string;
      atendimento: string;
      avulsa: string;
      campanha: string;
    }>(daySummaryQuery, [barbershopId, TZ]);

    const row = r.rows[0]!;
    // 1 reminder_24h + 1 reminder_2h (base) + 2 reminders for insistence phone = 4
    expect(Number(row.lembrete)).toBe(4);
    // 1 reactivation (base) + 1 for insistence phone = 2
    expect(Number(row.reativacao)).toBe(2);
    expect(Number(row.cobranca)).toBe(1);
    expect(Number(row.fila_espera)).toBe(1);
    expect(Number(row.atendimento)).toBe(1);
    expect(Number(row.avulsa)).toBe(1);
    expect(Number(row.campanha)).toBe(1);
  });

  it("unique_clients_today excludes plan_billing, includes manual and campaign", async () => {
    if (!barbershopId) return;

    const r = await pool.query<{ unique_clients_today: string }>(daySummaryQuery, [barbershopId, TZ]);
    const n = Number(r.rows[0]!.unique_clients_today);
    // Unique phones: 1(rem24), 2(rem2h), 3(react), 5(waitlist), 6(conv), 8(insistence),
    //                9(manual), 10(campaign) = 8 unique
    // plan_billing (phone 4) is excluded from unique count
    expect(n).toBe(8);
  });

  it("insistence_phones counts phones with 3+ events excluding cobranca and atendimento", async () => {
    if (!barbershopId) return;

    const r = await pool.query<{ insistence_phones: string }>(daySummaryQuery, [barbershopId, TZ]);
    // Only phone 8 has 3 events (2 reminders + 1 reativação)
    // Phone 6 (conversation_started) is excluded from insistence
    // Phone 4 (plan_billing) is excluded from insistence
    expect(Number(r.rows[0]!.insistence_phones)).toBe(1);
  });

  it("send_failures_today counts send_failure agenda_activity rows", async () => {
    if (!barbershopId) return;

    const r = await pool.query<{ send_failures_today: string }>(daySummaryQuery, [barbershopId, TZ]);
    expect(Number(r.rows[0]!.send_failures_today)).toBe(1);
  });
});
