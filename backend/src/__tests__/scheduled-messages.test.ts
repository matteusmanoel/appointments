import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import {
  scheduleReminderForAppointment,
  cancelReminderForAppointment,
  runDailyFollowUp30dSweep,
  runDailyFollowUp30dSweepWithLock,
} from "../outbound/scheduled-messages.js";
import {
  createScheduledMessagesFixtures,
  deleteScheduledMessagesFixtures,
  countScheduledMessagesByDedupe,
  getScheduledMessageRow,
} from "./helpers/db.js";

describe("scheduled-messages", () => {
  let fixtures: Awaited<ReturnType<typeof createScheduledMessagesFixtures>> | null = null;
  let fixturesSweep1: Awaited<ReturnType<typeof createScheduledMessagesFixtures>> | null = null;
  let fixturesSweep2: Awaited<ReturnType<typeof createScheduledMessagesFixtures>> | null = null;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      console.warn("DB not available, skipping scheduled-messages tests");
      return;
    }
    try {
      fixtures = await createScheduledMessagesFixtures({
        billingPlan: "pro",
        appointmentOffsetDays: 1,
        appointmentTime: "14:00",
      });
      fixturesSweep1 = await createScheduledMessagesFixtures({
        billingPlan: "pro",
        appointmentOffsetDays: -31,
        appointmentTime: "10:00",
        clientOptOut: false,
      });
      fixturesSweep2 = await createScheduledMessagesFixtures({
        billingPlan: "pro",
        appointmentOffsetDays: -31,
        appointmentTime: "10:00",
        clientOptOut: false,
      });
    } catch (e) {
      console.error("Fixture creation failed:", e);
    }
  });

  afterAll(async () => {
    const ids: string[] = [];
    if (fixtures) ids.push(fixtures.barbershopId);
    if (fixturesSweep1) ids.push(fixturesSweep1.barbershopId);
    if (fixturesSweep2) ids.push(fixturesSweep2.barbershopId);
    await deleteScheduledMessagesFixtures(ids);
  });

  it("scheduleReminderForAppointment inserts reminder_24h with correct dedupe_key and run_after in future", async () => {
    if (!fixtures) return;
    const dedupeKey = `reminder_24h:${fixtures.appointmentId}`;
    const before = await countScheduledMessagesByDedupe(dedupeKey);

    await scheduleReminderForAppointment({
      barbershopId: fixtures.barbershopId,
      appointmentId: fixtures.appointmentId,
      publicToken: fixtures.publicToken,
      clientPhone: fixtures.clientPhone,
      clientName: "Cliente Test",
      barberName: "Barbeiro Test",
      serviceNames: ["Corte Test"],
      scheduledDate: fixtures.scheduledDate,
      scheduledTime: fixtures.scheduledTime,
      slug: "test-sched",
      timezone: fixtures.aiSettingsTimezone,
    });

    const after = await countScheduledMessagesByDedupe(dedupeKey);
    expect(after).toBe(before + 1);
    const row = await getScheduledMessageRow(dedupeKey);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("queued");
    const payload = row!.payload_json as Record<string, unknown>;
    expect(payload.appointment_id).toBe(fixtures.appointmentId);
    const r = await pool.query<{ run_after: Date }>(
      `SELECT run_after FROM public.scheduled_messages WHERE dedupe_key = $1`,
      [dedupeKey]
    );
    expect(r.rows[0].run_after.getTime()).toBeGreaterThan(Date.now());
  });

  it("scheduleReminderForAppointment does not insert when run_after is in the past", async () => {
    if (!fixtures) return;
    const pastFixtures = await createScheduledMessagesFixtures({
      billingPlan: "pro",
      appointmentOffsetDays: 0,
      appointmentTime: "00:30",
    });
    const dedupeKey = `reminder_24h:${pastFixtures.appointmentId}`;
    const before = await countScheduledMessagesByDedupe(dedupeKey);

    await scheduleReminderForAppointment({
      barbershopId: pastFixtures.barbershopId,
      appointmentId: pastFixtures.appointmentId,
      publicToken: pastFixtures.publicToken,
      clientPhone: pastFixtures.clientPhone,
      clientName: null,
      barberName: "Barbeiro",
      serviceNames: ["Corte"],
      scheduledDate: pastFixtures.scheduledDate,
      scheduledTime: pastFixtures.scheduledTime,
      slug: null,
      timezone: "America/Sao_Paulo",
    });

    const after = await countScheduledMessagesByDedupe(dedupeKey);
    expect(after).toBe(before);
    await deleteScheduledMessagesFixtures([pastFixtures.barbershopId]);
  });

  it("cancelReminderForAppointment marks queued reminder as skipped", async () => {
    if (!fixtures) return;
    const dedupeKey = `reminder_24h:${fixtures.appointmentId}`;
    const queuedBefore = await pool.query(
      `SELECT 1 FROM public.scheduled_messages WHERE dedupe_key = $1 AND status = 'queued'`,
      [dedupeKey]
    );
    if (queuedBefore.rows.length === 0) {
      await pool.query(
        `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key, updated_at)
         VALUES ($1, 'reminder_24h', $2, '{}', 'queued', now() + interval '1 day', $3, now())`,
        [fixtures.barbershopId, fixtures.clientPhone.replace(/\D/g, ""), dedupeKey]
      );
    }

    await cancelReminderForAppointment(fixtures.appointmentId);

    const queued = await pool.query(
      `SELECT 1 FROM public.scheduled_messages WHERE dedupe_key = $1 AND status = 'queued'`,
      [dedupeKey]
    );
    expect(queued.rows.length).toBe(0);
    const row = await getScheduledMessageRow(dedupeKey);
    if (row) expect(row.status).toBe("skipped");
  });

  it("runDailyFollowUp30dSweep enqueues followup_30d and does not duplicate on second run", async () => {
    if (!fixturesSweep1) return;
    const yearMonth = new Date().toISOString().slice(0, 7);
    const dedupeKey = `followup_30d:${fixturesSweep1.barbershopId}:${fixturesSweep1.clientId}:${yearMonth}`;
    const before = await countScheduledMessagesByDedupe(dedupeKey);

    await runDailyFollowUp30dSweep();
    const after1 = await countScheduledMessagesByDedupe(dedupeKey);
    expect(after1).toBeGreaterThanOrEqual(before + 1);

    await runDailyFollowUp30dSweep();
    const after2 = await countScheduledMessagesByDedupe(dedupeKey);
    expect(after2).toBe(after1);
  });

  it("runDailyFollowUp30dSweepWithLock does not duplicate when run concurrently", async () => {
    if (!fixturesSweep1 || !fixturesSweep2) return;
    const yearMonth = new Date().toISOString().slice(0, 7);
    const key1 = `followup_30d:${fixturesSweep1.barbershopId}:${fixturesSweep1.clientId}:${yearMonth}`;
    const key2 = `followup_30d:${fixturesSweep2.barbershopId}:${fixturesSweep2.clientId}:${yearMonth}`;
    const before1 = await countScheduledMessagesByDedupe(key1);
    const before2 = await countScheduledMessagesByDedupe(key2);

    await Promise.all([runDailyFollowUp30dSweepWithLock(), runDailyFollowUp30dSweepWithLock()]);

    const after1 = await countScheduledMessagesByDedupe(key1);
    const after2 = await countScheduledMessagesByDedupe(key2);
    expect(after1).toBeLessThanOrEqual(before1 + 1);
    expect(after2).toBeLessThanOrEqual(before2 + 1);
  });
});
