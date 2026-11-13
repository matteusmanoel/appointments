import { describe, expect, it } from "vitest";
import {
  DAILY_DISPATCH_CAP,
  DISPATCH_PRIORITY,
  decideDispatch,
  isRetiredAutomaticType,
  planBillingNotVigenteReason,
  reminderNotVigenteReason,
  scheduledTypePurpose,
} from "../outbound/dispatch-policy.js";

const now = new Date("2026-09-28T13:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("daily dispatch cap and spacing", () => {
  it("sends when the day has room and the last dispatch is 3 minutes old", () => {
    expect(decideDispatch({ sentToday: 10, lastSentAt: minutesAgo(3) }, now)).toEqual({ kind: "send" });
    expect(decideDispatch({ sentToday: 0, lastSentAt: null }, now)).toEqual({ kind: "send" });
  });

  it("waits for the 3 minute spacing instead of firing back to back", () => {
    const decision = decideDispatch({ sentToday: 1, lastSentAt: minutesAgo(1) }, now);
    expect(decision.kind).toBe("wait");
    if (decision.kind === "wait") expect(decision.until.getTime()).toBe(minutesAgo(-2).getTime());
  });

  it("refuses the 51st dispatch even after the spacing", () => {
    expect(decideDispatch({ sentToday: DAILY_DISPATCH_CAP, lastSentAt: minutesAgo(60) }, now)).toEqual({
      kind: "cap_reached",
    });
  });

  it("gates reminders, manual messages and campaigns", () => {
    expect(scheduledTypePurpose("reminder_24h")).toBe("reminder");
    expect(scheduledTypePurpose("reminder_2h")).toBe("reminder");
    expect(scheduledTypePurpose("manual")).toBe("manual");
    expect(scheduledTypePurpose("campaign")).toBe("campaign");
    expect(scheduledTypePurpose("followup_30d")).toBeNull();
  });
});

describe("cobrança de plano in the gate", () => {
  it("counts as plan billing, after reminders and waitlist, before reactivation", () => {
    expect(scheduledTypePurpose("plan_billing")).toBe("plan_billing");
    expect(scheduledTypePurpose("reactivation")).toBe("reactivation");
    const order = Object.entries(DISPATCH_PRIORITY).sort((a, b) => a[1] - b[1]).map(([k]) => k);
    expect(order).toEqual(["reminder", "waitlist", "plan_billing", "reactivation", "manual", "campaign"]);
  });

  const open = { status: "sent", subscriptionStatus: "active", autoBilling: true };

  it("sends while the month is open", () => {
    expect(planBillingNotVigenteReason({ kind: "due", charge: open })).toBeNull();
    expect(planBillingNotVigenteReason({ kind: "day10", charge: { ...open, status: "pending" } })).toBeNull();
  });

  it("stops once the operator records the receipt or the charge is gone", () => {
    expect(planBillingNotVigenteReason({ kind: "day10", charge: { ...open, status: "paid" } })).toMatch(/paga/);
    expect(planBillingNotVigenteReason({ kind: "due", charge: { ...open, status: "skipped" } })).toMatch(/cancelada/);
    expect(planBillingNotVigenteReason({ kind: "due", charge: null })).toMatch(/não existe/);
  });

  it("stops when the subscription ends", () => {
    expect(
      planBillingNotVigenteReason({ kind: "manual", charge: { ...open, subscriptionStatus: "cancelled" } }),
    ).toMatch(/Assinatura/);
  });

  it("drops automatic sends after the switch is turned off, keeps the operator's manual send", () => {
    const manualOnly = { ...open, autoBilling: false };
    expect(planBillingNotVigenteReason({ kind: "due", charge: manualOnly })).toMatch(/automática/);
    expect(planBillingNotVigenteReason({ kind: "day10", charge: manualOnly })).toMatch(/automática/);
    expect(planBillingNotVigenteReason({ kind: "manual", charge: manualOnly })).toBeNull();
    expect(planBillingNotVigenteReason({ kind: "day5", charge: open })).toMatch(/tipo/);
  });
});

describe("automatic outreach no longer leaves on its own", () => {
  it("retires follow-up, birthday, opening summary and subscription notice", () => {
    for (const type of ["followup_30d", "birthday", "opening_summary", "payment_reminder"]) {
      expect(isRetiredAutomaticType(type)).toBe(true);
    }
    expect(isRetiredAutomaticType("reminder_2h")).toBe(false);
  });
});

describe("lembrete vigente", () => {
  const appointmentId = "489063eb-7415-42d6-96d1-d5d472895c69";
  const base = {
    type: "reminder_2h",
    appointmentId,
    dedupeKey: `reminder_2h:${appointmentId}`,
    payload: { date: "2026-09-28", time: "09:00" },
    appointment: { status: "pending", date: "2026-09-28", time: "09:00" },
  };

  it("keeps the reminder of the current clock", () => {
    expect(reminderNotVigenteReason(base)).toBeNull();
  });

  it("drops a reminder whose appointment is gone", () => {
    expect(reminderNotVigenteReason({ ...base, appointment: null })).toMatch(/não existe/);
  });

  it("drops the old clock after a reschedule", () => {
    expect(
      reminderNotVigenteReason({ ...base, payload: { date: "2026-09-28", time: "17:00" } }),
    ).toMatch(/Relógio/);
  });

  it("keeps a single reminder of each type per appointment", () => {
    expect(reminderNotVigenteReason({ ...base, dedupeKey: "reminder_2h:another" })).toMatch(/duplicado/);
    expect(reminderNotVigenteReason({ ...base, dedupeKey: null })).toMatch(/duplicado/);
  });

  it("drops reminders for cancelled or finished appointments", () => {
    expect(
      reminderNotVigenteReason({ ...base, appointment: { ...base.appointment, status: "cancelled" } }),
    ).toMatch(/cancelado/);
    expect(
      reminderNotVigenteReason({ ...base, appointment: { ...base.appointment, status: "no_show" } }),
    ).toMatch(/não está ativo/);
  });
});
