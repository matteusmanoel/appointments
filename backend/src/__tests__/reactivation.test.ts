import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { DISPATCH_PRIORITY, scheduledTypePurpose } from "../outbound/dispatch-policy.js";
import {
  REACTIVATION_REMOVED_REASON,
  cancelQueuedReactivation,
  enqueueReactivation,
  listReactivationSuggestions,
  reactivationMessage,
} from "../outbound/reactivation.js";
import { buildBirthdayMessage, buildFollowUp30d } from "../outbound/templates.js";

const TZ = "America/Sao_Paulo";

describe("reativação", () => {
  it("counts as reactivation, after reminder, waitlist and plan billing", () => {
    expect(scheduledTypePurpose("reactivation")).toBe("reactivation");
    const order = Object.entries(DISPATCH_PRIORITY)
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => key);
    expect(order).toEqual(["reminder", "waitlist", "plan_billing", "reactivation", "manual", "campaign"]);
  });

  it("uses the birthday text only for a birthday, and the follow-up text for the other reasons", () => {
    const link = "https://app.example/b/cavalier";
    expect(reactivationMessage({ reason: "birthday", clientName: "Mateus", bookingLink: link })).toBe(
      buildBirthdayMessage({ clientName: "Mateus", bookingLink: link }),
    );
    for (const reason of ["waitlist_missed", "no_visit", "talked_without_booking"]) {
      expect(reactivationMessage({ reason, clientName: "Mateus", bookingLink: link })).toBe(
        buildFollowUp30d({ clientName: "Mateus", bookingLink: link }),
      );
    }
  });

  it("uses the operator text only on a birthday batch, and the standard text when that field is blank", () => {
    const link = "https://app.example/b/cavalier";
    expect(
      reactivationMessage({
        reason: "birthday",
        clientName: "Mateus",
        bookingLink: link,
        bodyOverride: "Feliz aniversário, te esperamos essa semana",
      }),
    ).toBe("Feliz aniversário, te esperamos essa semana\n\nPara não receber mais mensagens, responda PARAR.");
    expect(
      reactivationMessage({ reason: "birthday", clientName: "Mateus", bookingLink: link, bodyOverride: "  " }),
    ).toBe(buildBirthdayMessage({ clientName: "Mateus", bookingLink: link }));
    expect(
      reactivationMessage({
        reason: "no_visit",
        clientName: "Mateus",
        bookingLink: link,
        bodyOverride: "texto que não vale para este motivo",
      }),
    ).toBe(buildFollowUp30d({ clientName: "Mateus", bookingLink: link }));
  });
});

describe("reativação (DB)", () => {
  let barbershopId: string | null = null;
  let barberId = "";
  let serviceId = "";
  let personId = "";
  let milestoneId = "";
  let windowId = "";
  let optedOutId = "";
  let sentId = "";

  const list = (windowDays?: number) => listReactivationSuggestions(barbershopId!, windowDays);
  const one = async (id: string, windowDays?: number) => (await list(windowDays)).filter((row) => row.clientId === id);

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      const check = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'scheduled_messages_type_check'`,
      );
      if (!check.rows[0]?.def.includes("reactivation")) return;
    } catch {
      return;
    }

    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug)
       VALUES ('Test Reactivation', '5511900000101', 'pro', $1)
       RETURNING id`,
      [`test-reactivation-${Date.now()}`],
    );
    barbershopId = shop.rows[0]!.id;
    await pool.query(
      `INSERT INTO public.barbershop_ai_settings (barbershop_id, timezone) VALUES ($1, $2)`,
      [barbershopId, TZ],
    );
    barberId = (
      await pool.query<{ id: string }>(
        `INSERT INTO public.barbers (barbershop_id, name) VALUES ($1, 'Barbeiro') RETURNING id`,
        [barbershopId],
      )
    ).rows[0]!.id;
    serviceId = (
      await pool.query<{ id: string }>(
        `INSERT INTO public.services (barbershop_id, name, price) VALUES ($1, 'Corte', 40) RETURNING id`,
        [barbershopId],
      )
    ).rows[0]!.id;

    const insertClient = async (name: string, phone: string, optOut = false) => {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO public.clients (barbershop_id, name, phone, marketing_opt_out)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [barbershopId, name, phone, optOut],
      );
      return r.rows[0]!.id;
    };
    personId = await insertClient("Pessoa Quatro", "5545999990101");
    milestoneId = await insertClient("Visita Trinta", "5545999990102");
    windowId = await insertClient("Visita Vinte", "5545999990103");
    optedOutId = await insertClient("Opt Out", "5545999990104", true);
    sentId = await insertClient("Ja Enviado", "5545999990105");

    const visit = async (clientId: string, daysAgo: number) => {
      await pool.query(
        `INSERT INTO public.appointments
           (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time,
            duration_minutes, price, commission_amount, status)
         VALUES ($1, $2, $3, $4, ((now() AT TIME ZONE $5)::date - $6::int), '10:00', 30, 40, 16, 'completed')`,
        [barbershopId, clientId, barberId, serviceId, TZ, daysAgo],
      );
    };
    await visit(personId, 30);
    await visit(milestoneId, 30);
    await visit(windowId, 20);
    await visit(optedOutId, 30);
    await visit(sentId, 45);

    await pool.query(
      `UPDATE public.clients
       SET birth_date = make_date(
         1990,
         EXTRACT(MONTH FROM (now() AT TIME ZONE $2)::date)::int,
         EXTRACT(DAY FROM (now() AT TIME ZONE $2)::date)::int
       )
       WHERE id = $1`,
      [personId, TZ],
    );
    await pool.query(
      `INSERT INTO public.appointment_waitlist (barbershop_id, client_phone, client_name, desired_date, desired_time, status)
       VALUES ($1, '5545999990101', 'Pessoa Quatro', ((now() AT TIME ZONE $2)::date - 1), '10:00', 'active')`,
      [barbershopId, TZ],
    );
    await pool.query(
      `INSERT INTO public.ai_conversations (barbershop_id, external_thread_id, last_message_at)
       VALUES ($1, '5545999990101', now() - interval '40 days')`,
      [barbershopId],
    );
    await pool.query(
      `INSERT INTO public.scheduled_messages
         (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key)
       VALUES (
         $1, 'reactivation', '5545999990105',
         jsonb_build_object('client_id', $2::text, 'reason', 'no_visit'),
         'sent', now(),
         'reactivation:' || $2::text || ':' || to_char((now() AT TIME ZONE $3)::date, 'YYYY-MM')
       )`,
      [barbershopId, sentId, TZ],
    );
  });

  afterAll(async () => {
    if (!barbershopId) return;
    await pool.query(`DELETE FROM public.scheduled_messages WHERE barbershop_id = $1`, [barbershopId]).catch(() => {});
    await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [barbershopId]).catch(() => {});
  });

  it("shows one person once, with the highest-priority reason", async () => {
    if (!barbershopId) return;
    const rows = await one(personId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("waitlist_missed");
  });

  it("uses the visit milestones unless a custom window replaces them", async () => {
    if (!barbershopId) return;
    expect((await one(milestoneId))[0]?.reason).toBe("no_visit");
    expect((await one(milestoneId))[0]?.detail).toBe("30");
    expect(await one(windowId)).toHaveLength(0);

    const narrowed = await one(windowId, 20);
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]!.detail).toBe("20");
    expect(await one(milestoneId, 20)).toHaveLength(0);
  });

  it("leaves out opt-out, the queue and a send already recorded this month", async () => {
    if (!barbershopId) return;
    expect(await one(optedOutId)).toHaveLength(0);
    expect(await one(sentId)).toHaveLength(0);
    const queued = await enqueueReactivation(barbershopId, [milestoneId]);
    expect(queued.queued).toBe(1);
    expect(await one(milestoneId)).toHaveLength(0);
  });

  it("falls through the reasons as each stronger signal goes away", async () => {
    if (!barbershopId) return;
    await pool.query(`DELETE FROM public.appointment_waitlist WHERE barbershop_id = $1`, [barbershopId]);
    expect((await one(personId))[0]?.reason).toBe("no_visit");

    await pool.query(
      `UPDATE public.appointments
       SET scheduled_date = (now() AT TIME ZONE $2)::date - 10
       WHERE barbershop_id = $1 AND client_id = $3`,
      [barbershopId, TZ, personId],
    );
    expect((await one(personId))[0]?.reason).toBe("birthday");

    await pool.query(
      `UPDATE public.appointments SET status = 'cancelled' WHERE barbershop_id = $1 AND client_id = $2`,
      [barbershopId, personId],
    );
    await pool.query(`UPDATE public.clients SET birth_date = NULL WHERE id = $1`, [personId]);
    expect((await one(personId))[0]?.reason).toBe("talked_without_booking");
  });

  it("queues tomorrow at 09:00 and does not create or debit credits", async () => {
    if (!barbershopId) return;
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM public.barbershop_message_credits WHERE barbershop_id = $1`,
      [barbershopId],
    );
    const result = await enqueueReactivation(
      barbershopId,
      [personId, sentId, "00000000-0000-4000-8000-000000000001"],
      "Feliz aniversário, te esperamos essa semana",
    );
    expect(result.queued).toBe(1);
    const row = await pool.query<{ matches: boolean; reason: string; body_override: string | null }>(
      `SELECT run_after = (((now() AT TIME ZONE $2)::date + 1) + time '09:00') AT TIME ZONE $2 AS matches,
              payload_json->>'reason' AS reason,
              payload_json->>'body_override' AS body_override
       FROM public.scheduled_messages
       WHERE barbershop_id = $1 AND type = 'reactivation' AND status = 'queued'
         AND payload_json->>'client_id' = $3`,
      [barbershopId, TZ, personId],
    );
    expect(row.rows[0]?.matches).toBe(true);
    expect(row.rows[0]?.reason).toBe("talked_without_booking");
    expect(row.rows[0]?.body_override).toBe("Feliz aniversário, te esperamos essa semana");
    const again = await enqueueReactivation(barbershopId, [personId]);
    expect(again.queued).toBe(0);
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM public.barbershop_message_credits WHERE barbershop_id = $1`,
      [barbershopId],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(await one(personId)).toHaveLength(0);
  });

  it("lets the operator take someone off the queue", async () => {
    if (!barbershopId) return;
    const queued = await pool.query<{ id: string }>(
      `SELECT id FROM public.scheduled_messages
       WHERE barbershop_id = $1 AND type = 'reactivation' AND status = 'queued'
         AND payload_json->>'client_id' = $2`,
      [barbershopId, personId],
    );
    expect(await cancelQueuedReactivation(barbershopId, queued.rows[0]!.id)).toBe(true);
    const skipped = await pool.query<{ last_error: string }>(
      `SELECT last_error FROM public.scheduled_messages WHERE id = $1`,
      [queued.rows[0]!.id],
    );
    expect(skipped.rows[0]!.last_error).toBe(REACTIVATION_REMOVED_REASON);
    expect(await one(personId)).toHaveLength(0);
    expect(await cancelQueuedReactivation(barbershopId, queued.rows[0]!.id)).toBe(false);
  });
});
