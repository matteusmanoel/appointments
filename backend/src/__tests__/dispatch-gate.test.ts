import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { ensureCriticalSchema } from "../db/ensure-schema.js";
import { loadDispatchUsage, checkDispatchGate } from "../outbound/dispatch-gate.js";
import { wipeWhatsAppTestContext } from "../ai/wipe-test-context.js";

describe("dispatch gate usage", () => {
  let barbershopId: string | null = null;
  const tz = "America/Sao_Paulo";
  const phone = "5545999990077";

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    await ensureCriticalSchema();
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug)
       VALUES ('Test Dispatch Gate', '5511900000077', 'pro', $1)
       RETURNING id`,
      [`test-dispatch-gate-${Date.now()}`],
    );
    barbershopId = shop.rows[0]?.id ?? null;
  });

  afterAll(async () => {
    if (barbershopId) {
      await pool.query(`DELETE FROM public.scheduled_messages WHERE barbershop_id = $1`, [barbershopId]).catch(() => {});
      await pool.query(`DELETE FROM public.agenda_activity WHERE barbershop_id = $1`, [barbershopId]).catch(() => {});
      await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [barbershopId]).catch(() => {});
    }
  });

  it("counts reminders, waitlist, manual and campaign, and leaves retired follow-up out", async () => {
    if (!barbershopId) return;
    await pool.query(
      `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, updated_at)
       VALUES ($1, 'reminder_2h', $2, '{}'::jsonb, 'sent', now(), now()),
              ($1, 'reminder_24h', $2, '{}'::jsonb, 'sent', now(), now()),
              ($1, 'reminder_24h', $2, '{}'::jsonb, 'queued', now(), now()),
              ($1, 'followup_30d', $2, '{}'::jsonb, 'sent', now(), now())`,
      [barbershopId, phone],
    );
    await pool.query(
      `INSERT INTO public.agenda_activity (barbershop_id, type, actor, client_phone, summary, created_at)
       VALUES ($1, 'waitlist_offered', 'system', $2, 'waitlist_offered', now())`,
      [barbershopId, phone],
    );
    const usage = await loadDispatchUsage(barbershopId, tz);
    expect(usage.sentToday).toBe(3);

    await pool.query(
      `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, updated_at)
       VALUES ($1, 'manual', $2, '{}'::jsonb, 'sent', now(), now()),
              ($1, 'campaign', $2, '{}'::jsonb, 'sent', now(), now())`,
      [barbershopId, phone],
    );
    const withManual = await loadDispatchUsage(barbershopId, tz);
    expect(withManual.sentToday).toBe(5);
    expect(usage.lastSentAt).not.toBeNull();
    expect((await checkDispatchGate(barbershopId, tz)).kind).toBe("wait");
  });

  it("clears queued reminders of a phone whose appointment is already gone on /deletar", async () => {
    if (!barbershopId) return;
    const goneAppointmentId = randomUUID();
    await pool.query(
      `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key, updated_at)
       VALUES ($1, 'reminder_2h', $2, $3::jsonb, 'queued', now() + interval '1 day', $4, now())`,
      [
        barbershopId,
        phone,
        JSON.stringify({ appointment_id: goneAppointmentId, date: "2026-09-28", time: "17:00" }),
        `reminder_2h:${goneAppointmentId}`,
      ],
    );
    await wipeWhatsAppTestContext({ barbershopId, phone });
    const left = await pool.query(
      `SELECT 1 FROM public.scheduled_messages WHERE barbershop_id = $1 AND status = 'queued' AND type LIKE 'reminder_%'`,
      [barbershopId],
    );
    expect(left.rows).toHaveLength(0);
  });
});
