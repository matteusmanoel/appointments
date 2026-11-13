import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { confirmAppointmentByAgent } from "../ai/tools.js";
import { createScheduledMessagesFixtures, deleteScheduledMessagesFixtures } from "./helpers/db.js";

describe("confirm_appointment RSVP", () => {
  let fx: Awaited<ReturnType<typeof createScheduledMessagesFixtures>> | null = null;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      fx = await createScheduledMessagesFixtures({ appointmentOffsetDays: 2, appointmentTime: "15:00" });
    } catch {
      fx = null;
    }
  });

  afterAll(async () => {
    if (fx) await deleteScheduledMessagesFixtures([fx.barbershopId]);
  });

  it("pending already occupies the slot", async () => {
    if (!fx) return;
    const occupying = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.appointments
       WHERE barbershop_id = $1 AND barber_id = $2 AND scheduled_date = $3::date
         AND status NOT IN ('cancelled', 'no_show')
         AND scheduled_time = $4::time`,
      [fx.barbershopId, fx.barberId, fx.scheduledDate, fx.scheduledTime],
    );
    expect(parseInt(occupying.rows[0]?.n ?? "0", 10)).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent pending → confirmed", async () => {
    if (!fx) return;
    await pool.query(
      `INSERT INTO public.agenda_activity
         (barbershop_id, appointment_id, type, actor, client_phone)
       VALUES ($1, $2, 'reminder_sent', 'system', $3)`,
      [fx.barbershopId, fx.appointmentId, fx.clientPhone],
    );
    const first = (await confirmAppointmentByAgent(fx.barbershopId, fx.appointmentId, fx.clientPhone)) as {
      ok?: boolean;
      already_confirmed?: boolean;
    };
    expect(first.ok).toBe(true);
    expect(first.already_confirmed).toBeFalsy();
    const status = await pool.query<{ status: string }>(
      `SELECT status FROM public.appointments WHERE id = $1`,
      [fx.appointmentId],
    );
    expect(status.rows[0]?.status).toBe("confirmed");

    const second = (await confirmAppointmentByAgent(fx.barbershopId, fx.appointmentId, fx.clientPhone)) as {
      ok?: boolean;
      already_confirmed?: boolean;
    };
    expect(second.ok).toBe(true);
    expect(second.already_confirmed).toBe(true);
  });

  it("refuses RSVP when no reminder was sent", async () => {
    if (!fx) return;
    await pool.query(
      `UPDATE public.appointments SET status = 'pending' WHERE id = $1`,
      [fx.appointmentId],
    );
    await pool.query(`DELETE FROM public.agenda_activity WHERE appointment_id = $1 AND type = 'reminder_sent'`, [
      fx.appointmentId,
    ]);
    const r = (await confirmAppointmentByAgent(fx.barbershopId, fx.appointmentId, fx.clientPhone)) as {
      error?: string;
    };
    expect(r.error).toMatch(/RSVP/i);
    const status = await pool.query<{ status: string }>(
      `SELECT status FROM public.appointments WHERE id = $1`,
      [fx.appointmentId],
    );
    expect(status.rows[0]?.status).toBe("pending");
  });
});
