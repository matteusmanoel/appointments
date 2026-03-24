import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { getNextSlots, checkAvailability } from "../ai/tools.js";

/**
 * Tests that completed_time shortens occupancy so the freed slot appears in getNextSlots
 * and checkAvailability considers the slot available.
 */
describe("completed_time occupancy", () => {
  let barbershopId: string | null = null;
  let barberId: string | null = null;
  let clientId: string | null = null;
  let serviceId: string | null = null;
  let dateStr: string;
  let appointmentId: string | null = null;

  beforeAll(async () => {
    try {
      const shop = await pool.query<{ id: string }>(
        "SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1"
      );
      barbershopId = shop.rows[0]?.id ?? null;
      if (!barbershopId) return;
      const [barber, client, service] = await Promise.all([
        pool.query<{ id: string }>(
          "SELECT id FROM public.barbers WHERE barbershop_id = $1 AND status IN ('active','break') LIMIT 1",
          [barbershopId]
        ),
        pool.query<{ id: string }>(
          "SELECT id FROM public.clients WHERE barbershop_id = $1 LIMIT 1",
          [barbershopId]
        ),
        pool.query<{ id: string }>(
          "SELECT id FROM public.services WHERE barbershop_id = $1 AND is_active = true LIMIT 1",
          [barbershopId]
        ),
      ]);
      barberId = barber.rows[0]?.id ?? null;
      clientId = client.rows[0]?.id ?? null;
      serviceId = service.rows[0]?.id ?? null;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateStr = tomorrow.toISOString().slice(0, 10);
    } catch {
      barbershopId = null;
      barberId = null;
      clientId = null;
      serviceId = null;
      dateStr = "";
    }
  });

  afterAll(async () => {
    if (appointmentId && barbershopId) {
      await pool.query("DELETE FROM public.appointment_services WHERE appointment_id = $1", [appointmentId]);
      await pool.query("DELETE FROM public.appointments WHERE id = $1 AND barbershop_id = $2", [appointmentId, barbershopId]);
    }
  });

  it("getNextSlots returns 13:30 when appointment 13:00-14:00 is completed at 13:30", async () => {
    if (!barbershopId || !barberId || !clientId || !serviceId) return;
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.appointments (
         barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time,
         duration_minutes, price, commission_amount, status, completed_time
       ) VALUES ($1, $2, $3, $4, $5::date, '13:00'::time, 60, 50, 20, 'completed', '13:30'::time)
       RETURNING id`,
      [barbershopId, clientId, barberId, serviceId, dateStr]
    );
    appointmentId = r.rows[0]?.id ?? null;
    if (!appointmentId) {
      throw new Error("Insert appointment failed (missing completed_time column?)");
    }

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
    expect(times.some((t) => t === "13:30" || t === "13:35"), `expected 13:30 or 13:35 in ${JSON.stringify(times)}`).toBe(true);
  });

  it("checkAvailability returns available for 13:30 when appointment 13:00-14:00 is completed at 13:30", async () => {
    if (!barbershopId || !barberId || !serviceId) return;
    const result = (await checkAvailability(barbershopId, {
      date: dateStr,
      time: "13:30",
      barber_id: barberId,
      service_id: serviceId,
    })) as { requested?: { available?: boolean }; why_unavailable?: string };

    expect(result.requested?.available).toBe(true);
  });
});
