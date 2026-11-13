import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { addToWaitlist, checkAvailability } from "../ai/tools.js";
import { createScheduledMessagesFixtures, deleteScheduledMessagesFixtures } from "./helpers/db.js";

const SHOP = "00000000-0000-0000-0000-000000000001";

describe("tool gates", () => {
  it("refuses check_availability without a service", async () => {
    const r = (await checkAvailability(SHOP, { date: "2026-09-21", time: "18:30" })) as { error?: string };
    expect(r.error).toMatch(/service_id/);
  });

  it("refuses waitlist without a clock and service", async () => {
    const noTime = (await addToWaitlist(SHOP, {
      client_phone: "5511999990001",
      desired_date: "2026-09-21",
      desired_time: "",
      service_id: "00000000-0000-0000-0000-000000000002",
    })) as { error?: string };
    expect(noTime.error).toMatch(/desired_time/);
    const noService = (await addToWaitlist(SHOP, {
      client_phone: "5511999990001",
      desired_date: "2026-09-21",
      desired_time: "18:30",
      service_id: "nao-uuid",
    })) as { error?: string };
    expect(noService.error).toMatch(/service_id/);
  });
});

describe("addToWaitlist dedupe", () => {
  let fx: Awaited<ReturnType<typeof createScheduledMessagesFixtures>> | null = null;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      fx = await createScheduledMessagesFixtures({ appointmentOffsetDays: 4, appointmentTime: "15:00" });
    } catch {
      fx = null;
    }
  });

  afterAll(async () => {
    if (fx) await deleteScheduledMessagesFixtures([fx.barbershopId]);
  });

  it("keeps one active row when the same client asks for the same clock twice", async () => {
    if (!fx) return;
    const first = (await addToWaitlist(fx.barbershopId, {
      client_phone: "5511999990001",
      client_name: "Cliente Test",
      desired_date: fx.scheduledDate,
      desired_time: "16:30",
      service_id: fx.serviceId,
      barber_id: fx.barberId,
    })) as { id?: string; error?: string };
    const second = (await addToWaitlist(fx.barbershopId, {
      client_phone: "5511999990001",
      desired_date: fx.scheduledDate,
      desired_time: "16:30",
      service_id: fx.serviceId,
      barber_id: fx.barberId,
      notes: "pediu de novo",
    })) as { id?: string };
    expect(first.error).toBeUndefined();
    expect(second.id).toBe(first.id);
    const rows = await pool.query(
      `SELECT id FROM public.appointment_waitlist
       WHERE barbershop_id = $1 AND client_phone = '5511999990001' AND status = 'active'
         AND desired_time = '16:30'`,
      [fx.barbershopId],
    );
    expect(rows.rows).toHaveLength(1);
  });
});
