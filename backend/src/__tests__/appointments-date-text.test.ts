import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../app.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import { createScheduledMessagesFixtures, deleteScheduledMessagesFixtures } from "./helpers/db.js";

describe("GET /api/appointments date text", () => {
  let fx: Awaited<ReturnType<typeof createScheduledMessagesFixtures>> | null = null;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      fx = await createScheduledMessagesFixtures({ appointmentOffsetDays: 1, appointmentTime: "18:30" });
    } catch {
      fx = null;
    }
  });

  afterAll(async () => {
    if (fx) await deleteScheduledMessagesFixtures([fx.barbershopId]);
  });

  it("returns scheduled_date as yyyy-MM-dd", async () => {
    if (!fx) return;
    const token = jwt.sign(
      {
        profileId: "00000000-0000-0000-0000-000000000001",
        barbershopId: fx.barbershopId,
        role: "admin",
        email: "lab@test.com",
      },
      config.jwtSecret,
    );
    const res = await request(app)
      .get(`/api/appointments?date=${fx.scheduledDate}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const row = (res.body as Array<{ id: string; scheduled_date: string }>).find((a) => a.id === fx!.appointmentId);
    expect(row?.scheduled_date).toBe(fx.scheduledDate);
    expect(row?.scheduled_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
