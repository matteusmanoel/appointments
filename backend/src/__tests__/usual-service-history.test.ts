import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { getClientFavoriteServices } from "../ai/tools.js";
import { createGoldenFixture, dbAvailable, deleteGoldenFixture, type GoldenFixture } from "./golden/runner.js";

// Histórico do "de sempre": só agendamento concluído conta. no_show, cancelado e passado nunca fechado ficam fora.
describe("getClientFavoriteServices: só conta o que foi concluído", () => {
  let ok = false;
  let fx: GoldenFixture | null = null;

  const addPast = async (daysAgo: number, status: string, serviceId: string, serviceName: string) => {
    const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const appt = (
      await pool.query<{ id: string }>(
        `INSERT INTO public.appointments
           (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
         VALUES ($1, $2, $3, $4, $5::date, '15:00', 30, 55, 0, $6) RETURNING id`,
        [fx!.barbershopId, fx!.clientId, fx!.barbers.lucas, serviceId, date, status],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
       VALUES ($1, $2, 55, 30, $3, 0)`,
      [appt, serviceId, serviceName],
    );
  };

  beforeAll(async () => {
    ok = await dbAvailable();
    if (!ok) return;
    fx = await createGoldenFixture("usual-history", { name: "Mateus", pastVisit: true }); // 1 Corte concluído há 10 dias
  });
  afterAll(async () => {
    if (fx) await deleteGoldenFixture(fx);
  });

  it("no_show, cancelado e pendente passado não viram 'costume' nem 'último'", async () => {
    if (!ok || !fx) return;
    for (const [days, status] of [
      [3, "no_show"],
      [5, "no_show"],
      [7, "cancelled"],
      [9, "pending"],
      [11, "confirmed"],
    ] as const) {
      await addPast(days, status, fx.services.corteBarba, "Corte e Barba");
    }
    const fav = await getClientFavoriteServices(fx.barbershopId, fx.clientPhone);
    expect(fav?.last?.service_ids).toEqual([fx.services.corte]);
    expect(fav?.frequent.map((f) => f.service_ids)).toEqual([[fx.services.corte]]);
    expect(fav?.frequent[0]?.count).toBe(1);
  });

  it("concluídos repetidos viram o mais frequente", async () => {
    if (!ok || !fx) return;
    await addPast(20, "completed", fx.services.corteBarba, "Corte e Barba");
    await addPast(30, "completed", fx.services.corteBarba, "Corte e Barba");
    const fav = await getClientFavoriteServices(fx.barbershopId, fx.clientPhone);
    expect(fav?.frequent[0]).toMatchObject({ service_ids: [fx.services.corteBarba], count: 2 });
    // o último concluído continua sendo o Corte de 10 dias atrás
    expect(fav?.last?.service_ids).toEqual([fx.services.corte]);
  });

  it("outro tenant com o mesmo telefone não aparece", async () => {
    if (!ok || !fx) return;
    const other = await createGoldenFixture("usual-history-b", { name: "Outro", pastVisit: true });
    try {
      const fav = await getClientFavoriteServices(other.barbershopId, fx.clientPhone);
      expect(fav).toBeNull();
    } finally {
      await deleteGoldenFixture(other);
    }
  });
});
