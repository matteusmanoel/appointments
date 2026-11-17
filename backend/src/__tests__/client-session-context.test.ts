import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { emptyBookingDraft, type BookingDraft } from "../ai/booking-draft.js";
import { emptyPendingIntents } from "../ai/agent/pending-intents.js";
import {
  SESSION_DRAFT_TTL_MS,
  findClientIdByPhone,
  narrowSessionForHydration,
  sessionPhoneKeys,
  type ClientSessionContext,
} from "../ai/agent/client-session-context.js";
import { orchestrate } from "../ai/agent/orchestrator.js";
import type { IntentSet, IntentType } from "../ai/agent/types.js";

function session(partial: Partial<BookingDraft>, updatedAt: string, lastIntent = "schedule"): ClientSessionContext {
  return {
    bookingDraft: { ...emptyBookingDraft(), ...partial },
    pendingIntents: { intents: ["cancel"], offered: false },
    lastIntent,
    updatedAt,
  };
}

function intent(primary: IntentType): IntentSet {
  return {
    intents: [primary],
    primary,
    service: null,
    barber: null,
    dateTime: null,
    rawSignals: [],
    confidence: 0.2,
  };
}

describe("contexto de sessão", () => {
  it("casa o telefone do painel (sem 55) com o do WhatsApp e não usa os últimos 10 dígitos", () => {
    const keys = sessionPhoneKeys("5511987654321");
    expect(keys).toContain("11987654321");
    expect(keys).toContain("5511987654321");
    expect(keys).not.toContain("1987654321");
    expect(sessionPhoneKeys("11987654321")).toEqual(expect.arrayContaining(["5511987654321"]));
  });

  it("contexto de 10 minutos carrega data, hora, card e intenções", () => {
    const now = Date.parse("2026-11-16T10:10:00-03:00");
    const card = { kind: "create" as const, issuedAt: "2026-11-16T10:00:00-03:00" };
    const narrowed = narrowSessionForHydration(
      session(
        {
          status: "offered",
          date: "2026-11-17",
          time: "15:00",
          service_name: "Corte",
          confirmCard: card,
        },
        "2026-11-16T10:00:00-03:00",
      ),
      now,
    );
    expect(narrowed.fresh).toBe(true);
    expect(narrowed.bookingDraft.date).toBe("2026-11-17");
    expect(narrowed.bookingDraft.time).toBe("15:00");
    expect(narrowed.bookingDraft.confirmCard?.kind).toBe("create");
    expect(narrowed.bookingDraft.confirmCardReplay).toBe(true);
    expect(narrowed.pendingIntents.intents).toEqual(["cancel"]);
  });

  it("card vencido fica no rascunho sem poder ser confirmado na conversa nova", () => {
    const now = Date.parse("2026-11-16T10:40:00-03:00");
    const narrowed = narrowSessionForHydration(
      session(
        {
          status: "offered",
          date: "2026-11-17",
          time: "15:00",
          confirmCard: { kind: "create", issuedAt: "2026-11-16T10:00:00-03:00" },
        },
        "2026-11-16T10:00:00-03:00",
      ),
      now,
    );
    expect(narrowed.fresh).toBe(true);
    expect(narrowed.bookingDraft.confirmCard?.kind).toBe("create");
    expect(narrowed.bookingDraft.confirmCardReplay).toBeUndefined();
  });

  it("card de slot que já passou não volta vivo", () => {
    const now = Date.parse("2026-11-16T10:10:00-03:00");
    const narrowed = narrowSessionForHydration(
      session(
        {
          status: "offered",
          date: "2026-11-16",
          time: "09:00",
          service_name: "Corte",
          confirmCard: { kind: "create", issuedAt: "2026-11-16T10:00:00-03:00" },
        },
        "2026-11-16T10:00:00-03:00",
      ),
      now,
    );
    expect(narrowed.fresh).toBe(true);
    expect(narrowed.bookingDraft.confirmCard).toBeUndefined();
    expect(narrowed.bookingDraft.confirmCardReplay).toBeUndefined();
    expect(narrowed.bookingDraft.date).toBeUndefined();
    expect(narrowed.bookingDraft.time).toBeUndefined();
    expect(narrowed.bookingDraft.status).toBe("collecting");
    expect(narrowed.bookingDraft.service_name).toBe("Corte");
  });

  it("dia que já passou sai do rascunho mesmo sem card", () => {
    const now = Date.parse("2026-11-17T10:25:00-03:00");
    const narrowed = narrowSessionForHydration(
      session(
        { status: "collecting", date: "2026-11-14", time: "10:30", service_name: "Barba completa" },
        "2026-11-16T22:00:00-03:00",
      ),
      now,
    );
    expect(narrowed.bookingDraft.date).toBeUndefined();
    expect(narrowed.bookingDraft.time).toBeUndefined();
    expect(narrowed.bookingDraft.service_name).toBe("Barba completa");
  });

  it("dia de hoje sem relógio continua valendo", () => {
    const now = Date.parse("2026-11-17T10:25:00-03:00");
    const narrowed = narrowSessionForHydration(
      session({ status: "collecting", date: "2026-11-17" }, "2026-11-17T09:00:00-03:00"),
      now,
    );
    expect(narrowed.bookingDraft.date).toBe("2026-11-17");
  });

  it("rascunho e intenções expiram depois de 24 h; rascunho fechado não leva o serviço", () => {
    const now = Date.parse("2026-11-18T10:00:00-03:00");
    const old = narrowSessionForHydration(
      session(
        {
          status: "offered",
          date: "2026-11-17",
          time: "15:00",
          service_name: "Corte",
          barber_name: "Lucas",
          appointment_id: "11111111-1111-4111-8111-111111111111",
          confirmCard: { kind: "reschedule", issuedAt: "2026-11-16T10:00:00-03:00" },
        },
        new Date(now - SESSION_DRAFT_TTL_MS - 60_000).toISOString(),
      ),
      now,
    );
    expect(old.fresh).toBe(false);
    expect(old.bookingDraft).toEqual(emptyBookingDraft());
    expect(old.pendingIntents).toEqual(emptyPendingIntents());

    const closed = narrowSessionForHydration(
      session({ status: "closed", date: "2026-11-17", time: "15:00", service_name: "Barba" }, new Date(now).toISOString()),
      now,
    );
    expect(closed.fresh).toBe(false);
    expect(closed.bookingDraft).toEqual(emptyBookingDraft());
  });

  it("intenção desconhecida numa conversa nova recente continua a última intenção; «sim» não", () => {
    const base = {
      previousTurnConfidence: undefined,
      hasUpcomingAppointment: false,
      hasActiveBookingDraft: true,
      pendingIntents: { intents: [] as IntentType[], offered: false },
      conversationState: "collecting" as const,
    };
    const continued = orchestrate({
      ...base,
      intentSet: intent("unknown"),
      sessionLastIntent: "reschedule",
      sessionContextFresh: true,
    });
    expect(continued.primaryIntent).toBe("reschedule");

    const affirmed = orchestrate({
      ...base,
      intentSet: intent("unknown"),
      isAffirmative: true,
      sessionLastIntent: "schedule",
      sessionContextFresh: true,
    });
    expect(affirmed.primaryIntent).not.toBe("schedule");

    const stale = orchestrate({
      ...base,
      intentSet: intent("unknown"),
      sessionLastIntent: "cancel",
      sessionContextFresh: false,
    });
    expect(stale.primaryIntent).toBe("unknown");
  });
});

describe("telefone do cliente no tenant", () => {
  const shops: string[] = [];

  afterAll(async () => {
    for (const id of shops) {
      await pool.query(`DELETE FROM public.clients WHERE barbershop_id = $1`, [id]);
      await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [id]);
    }
  });

  it("11 dígitos casa com 10 e com 11 do mesmo DDD, e a chave de 10 não pega outro DDD", async () => {
    const slug = `fone-${Date.now()}`;
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug) VALUES ('Fone', '5500000000099', 'pro', $1) RETURNING id`,
      [slug],
    );
    const barbershopId = shop.rows[0]!.id;
    shops.push(barbershopId);
    const insert = async (name: string, phone: string) => {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO public.clients (barbershop_id, name, phone) VALUES ($1, $2, $3) RETURNING id`,
        [barbershopId, name, phone],
      );
      return row.rows[0]!.id;
    };
    const canonical = await insert("Canonico", "5511987654321");
    const national11 = await insert("Onze", "11987654321");
    const national10 = await insert("Dez", "1187654321");
    const otherDdd = await insert("Rio", "21987654321");

    expect(await findClientIdByPhone(barbershopId, "5511987654321")).toBe(canonical);
    await pool.query(`DELETE FROM public.clients WHERE id = $1`, [canonical]);
    expect(await findClientIdByPhone(barbershopId, "5511987654321")).toBe(national11);
    await pool.query(`DELETE FROM public.clients WHERE id = $1`, [national11]);
    expect(await findClientIdByPhone(barbershopId, "5511987654321")).toBe(national10);
    expect(await findClientIdByPhone(barbershopId, "5511987654321")).not.toBe(otherDdd);
    await pool.query(`DELETE FROM public.clients WHERE id = $1`, [national10]);
    expect(await findClientIdByPhone(barbershopId, "5511987654321")).toBeNull();
    expect(await findClientIdByPhone(barbershopId, "5521987654321")).toBe(otherDdd);
  });
});
