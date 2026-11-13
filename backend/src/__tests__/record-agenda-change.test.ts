import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { recordAgendaChangeFromAppointment } from "../agenda/record-agenda-change.js";
import { createScheduledMessagesFixtures, deleteScheduledMessagesFixtures } from "./helpers/db.js";

describe("recordAgendaChange", () => {
  let fx: Awaited<ReturnType<typeof createScheduledMessagesFixtures>> | null = null;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      fx = await createScheduledMessagesFixtures({ appointmentOffsetDays: 3, appointmentTime: "11:00" });
    } catch {
      fx = null;
    }
  });

  afterAll(async () => {
    if (fx) await deleteScheduledMessagesFixtures([fx.barbershopId]);
  });

  it("writes agenda_activity for tool and panel cancel and notifies waitlist once", async () => {
    if (!fx) return;
    await pool.query(
      `INSERT INTO public.appointment_waitlist
        (barbershop_id, client_phone, client_name, desired_date, desired_time, service_id, barber_id, source, status, updated_at)
       VALUES ($1, '5511988887777', 'Wait', $2::date, $3::time, $4, $5, 'ai', 'active', now())`,
      [fx.barbershopId, fx.scheduledDate, fx.scheduledTime, fx.serviceId, fx.barberId],
    );

    const fromTool = await recordAgendaChangeFromAppointment({
      barbershopId: fx.barbershopId,
      appointmentId: fx.appointmentId,
      type: "cancelled",
      actor: "ai",
    });
    expect(fromTool.waitlistCandidate?.client_phone).toBe("5511988887777");

    const activity = await pool.query<{ type: string; actor: string }>(
      `SELECT type, actor FROM public.agenda_activity WHERE barbershop_id = $1 AND appointment_id = $2`,
      [fx.barbershopId, fx.appointmentId],
    );
    expect(activity.rows.some((r: { type: string; actor: string }) => r.type === "cancelled" && r.actor === "ai")).toBe(true);

    const fromPanel = await recordAgendaChangeFromAppointment({
      barbershopId: fx.barbershopId,
      appointmentId: fx.appointmentId,
      type: "cancelled",
      actor: "owner",
    });
    expect(fromPanel.waitlistCandidate).toBeNull();

    const waitlist = await pool.query<{ status: string }>(
      `SELECT status FROM public.appointment_waitlist WHERE barbershop_id = $1 AND client_phone = '5511988887777'`,
      [fx.barbershopId],
    );
    expect(waitlist.rows[0]?.status).toBe("notified");
  });

  it("does not notify a waitlist row for another clock or without time", async () => {
    if (!fx) return;
    await pool.query(`DELETE FROM public.appointment_waitlist WHERE barbershop_id = $1`, [fx.barbershopId]);
    await pool.query(
      `INSERT INTO public.appointment_waitlist
        (barbershop_id, client_phone, client_name, desired_date, desired_time, service_id, barber_id, source, status, updated_at)
       VALUES ($1, '5511911112222', 'Outro', $2::date, '18:30'::time, $3, $4, 'ai', 'active', now())`,
      [fx.barbershopId, fx.scheduledDate, fx.serviceId, fx.barberId],
    );
    await pool.query(
      `INSERT INTO public.appointment_waitlist
        (barbershop_id, client_phone, client_name, desired_date, desired_time, service_id, source, status, updated_at)
       VALUES ($1, '5511933334444', 'SemHora', $2::date, NULL, $3, 'ai', 'active', now())`,
      [fx.barbershopId, fx.scheduledDate, fx.serviceId],
    );
    const r = await recordAgendaChangeFromAppointment({
      barbershopId: fx.barbershopId,
      appointmentId: fx.appointmentId,
      type: "cancelled",
      actor: "ai",
    });
    expect(r.waitlistCandidate).toBeNull();
    const rows = await pool.query<{ status: string; client_phone: string }>(
      `SELECT status, client_phone FROM public.appointment_waitlist WHERE barbershop_id = $1`,
      [fx.barbershopId],
    );
    expect(rows.rows.every((x) => x.status === "active")).toBe(true);
  });

  it("does not notify when the slot is inside the 20-minute cutoff", async () => {
    if (!fx) return;
    const soon = await pool.query<{ d: string; t: string }>(
      `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d,
              to_char((now() AT TIME ZONE 'America/Sao_Paulo') + interval '5 minutes', 'HH24:MI') AS t`,
    );
    const d = soon.rows[0]?.d;
    const t = soon.rows[0]?.t;
    if (!d || !t) return;
    const appt = await pool.query<{ id: string }>(
      `INSERT INTO public.appointments (
         barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time,
         duration_minutes, price, commission_amount, status
       ) VALUES ($1, $2, $3, $4, $5::date, $6::time, 30, 35, 10, 'pending')
       RETURNING id`,
      [fx.barbershopId, fx.clientId, fx.barberId, fx.serviceId, d, t],
    );
    await pool.query(`DELETE FROM public.appointment_waitlist WHERE barbershop_id = $1`, [fx.barbershopId]);
    await pool.query(
      `INSERT INTO public.appointment_waitlist
        (barbershop_id, client_phone, client_name, desired_date, desired_time, service_id, barber_id, source, status, updated_at)
       VALUES ($1, '5511955556666', 'Perto', $2::date, $3::time, $4, $5, 'ai', 'active', now())`,
      [fx.barbershopId, d, t, fx.serviceId, fx.barberId],
    );
    const r = await recordAgendaChangeFromAppointment({
      barbershopId: fx.barbershopId,
      appointmentId: appt.rows[0].id,
      type: "cancelled",
      actor: "ai",
    });
    expect(r.waitlistCandidate).toBeNull();
    const status = await pool.query<{ status: string }>(
      `SELECT status FROM public.appointment_waitlist WHERE barbershop_id = $1 AND client_phone = '5511955556666'`,
      [fx.barbershopId],
    );
    expect(status.rows[0]?.status).toBe("active");
  });
});
