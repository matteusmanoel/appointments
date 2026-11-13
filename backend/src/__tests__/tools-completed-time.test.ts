import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { getNextSlots, checkAvailability } from "../ai/tools.js";

/**
 * Tests that completed_time shortens occupancy so the freed slot appears in getNextSlots
 * and checkAvailability considers the slot available.
 *
 * Uses self-contained fixtures (dedicated barbershop + barber + service) so the test
 * is not dependent on real DB data or the day-of-week the CI happens to run on.
 */
describe("completed_time occupancy", () => {
  let barbershopId: string | null = null;
  let barberId: string | null = null;
  let serviceId: string | null = null;
  let dateStr: string | null = null;
  let appointmentId: string | null = null;

  const allDaysHours = {
    monday:    { start: "09:00", end: "18:00" },
    tuesday:   { start: "09:00", end: "18:00" },
    wednesday: { start: "09:00", end: "18:00" },
    thursday:  { start: "09:00", end: "18:00" },
    friday:    { start: "09:00", end: "18:00" },
    saturday:  { start: "09:00", end: "18:00" },
    sunday:    { start: "09:00", end: "18:00" },
  };

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }

    // ── Dedicated barbershop with known business hours for all 7 days ────────
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Test CompletedTime Shop', '5511900000001', 'pro',
               $1, $2::jsonb)
       RETURNING id`,
      [
        `test-completed-time-${Date.now()}`,
        JSON.stringify(allDaysHours),
      ]
    );
    barbershopId = shop.rows[0]?.id ?? null;
    if (!barbershopId) return;

    await pool.query(
      `INSERT INTO public.barbershop_ai_settings (barbershop_id, timezone)
       VALUES ($1, 'America/Sao_Paulo')
       ON CONFLICT (barbershop_id) DO UPDATE SET timezone = 'America/Sao_Paulo'`,
      [barbershopId]
    );

    // ── Barber with schedule for all 7 days ───────────────────────────────────
    const barber = await pool.query<{ id: string }>(
      `INSERT INTO public.barbers (barbershop_id, name, status, schedule)
       VALUES ($1, 'Barbeiro Completed Test', 'active', $2::jsonb)
       RETURNING id`,
      [barbershopId, JSON.stringify(allDaysHours)]
    );
    barberId = barber.rows[0]?.id ?? null;

    // ── Service with 30-min duration ──────────────────────────────────────────
    const service = await pool.query<{ id: string }>(
      `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active)
       VALUES ($1, 'Corte Completed Test', 30, 30, true)
       RETURNING id`,
      [barbershopId]
    );
    serviceId = service.rows[0]?.id ?? null;

    // ── Pick next Mon–Sat (always open in allDaysHours) ───────────────────────
    // Using generate_series avoids fragility when the test runs on a Saturday night.
    const nextOpen = await pool.query<{ d: string }>(
      `SELECT (CURRENT_DATE + d)::text AS d
       FROM generate_series(1, 7) AS d
       WHERE extract(dow from CURRENT_DATE + d)::int BETWEEN 1 AND 6
       LIMIT 1`
    );
    dateStr = nextOpen.rows[0]?.d ?? null;
    if (!dateStr || !barberId || !serviceId) return;

    // ── Client fixture ────────────────────────────────────────────────────────
    const client = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone)
       VALUES ($1, 'Cliente Completed Test', '5511900000002')
       ON CONFLICT (barbershop_id, phone) DO UPDATE SET name = 'Cliente Completed Test'
       RETURNING id`,
      [barbershopId]
    );
    const clientId = client.rows[0]?.id ?? null;
    if (!clientId) return;

    // ── Insert appointment 13:00-14:00 (60 min), completed at 13:30 ──────────
    const appt = await pool.query<{ id: string }>(
      `INSERT INTO public.appointments (
         barbershop_id, client_id, barber_id, service_id,
         scheduled_date, scheduled_time, duration_minutes,
         price, commission_amount, status, completed_time
       ) VALUES ($1, $2, $3, $4, $5::date, '13:00'::time, 60, 30, 12, 'completed', '13:30'::time)
       RETURNING id`,
      [barbershopId, clientId, barberId, serviceId, dateStr]
    );
    appointmentId = appt.rows[0]?.id ?? null;

    if (!appointmentId) {
      throw new Error("Insert appointment failed — completed_time column may be missing from schema.");
    }
  });

  afterAll(async () => {
    if (!barbershopId) return;
    // Clean up in dependency order
    if (appointmentId) {
      await pool.query(
        "DELETE FROM public.appointment_services WHERE appointment_id = $1",
        [appointmentId]
      );
      await pool.query("DELETE FROM public.appointments WHERE id = $1", [appointmentId]);
    }
    await pool.query("DELETE FROM public.services WHERE barbershop_id = $1", [barbershopId]);
    await pool.query("DELETE FROM public.barbers WHERE barbershop_id = $1", [barbershopId]);
    await pool.query(
      "DELETE FROM public.barbershops WHERE id = $1 AND slug LIKE 'test-completed-time-%'",
      [barbershopId]
    );
  });

  it("getNextSlots returns 13:30 when appointment 13:00-14:00 is completed at 13:30", async () => {
    if (!barbershopId || !barberId || !serviceId || !dateStr || !appointmentId) return;

    const result = (await getNextSlots(barbershopId, {
      date: dateStr,
      service_id: serviceId,
      barber_id: barberId,
      after_time: "13:00",
      limit: 10,
    })) as { error?: string; slots?: Array<{ time: string }> };

    expect(result.error).toBeUndefined();
    expect(result.slots).toBeDefined();
    const times = (result.slots ?? []).map((s) => s.time);
    expect(
      times.some((t) => t === "13:30" || t === "13:35"),
      `expected 13:30 or 13:35 in [${times.join(", ")}]`
    ).toBe(true);
  });

  it("checkAvailability returns available for 13:30 when appointment 13:00-14:00 is completed at 13:30", async () => {
    if (!barbershopId || !barberId || !serviceId || !dateStr || !appointmentId) return;

    const result = (await checkAvailability(barbershopId, {
      date: dateStr,
      time: "13:30",
      barber_id: barberId,
      service_id: serviceId,
    })) as { requested?: { available?: boolean }; why_unavailable?: string };

    expect(result.requested?.available).toBe(true);
  });
});
