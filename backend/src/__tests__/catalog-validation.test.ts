import { describe, expect, it } from "vitest";
import { validateToolCatalogArgs } from "../ai/agent/orchestrator.js";
import { guardClientReplyWithReason, summaryCitesItemOutsideCatalog, detectViolations } from "../ai/agent.js";

const SVC_CORTE = "11111111-1111-4111-8111-111111111111";
const SVC_BARBA = "22222222-2222-4222-8222-222222222222";
const BARBER_LUCAS = "33333333-3333-4333-8333-333333333333";
const INVENTED = "99999999-9999-4999-8999-999999999999";
const catalog = { serviceIds: [SVC_CORTE, SVC_BARBA], barberIds: [BARBER_LUCAS] };

describe("validateToolCatalogArgs", () => {
  it("drops invented service and barber ids before check_availability", () => {
    const r = validateToolCatalogArgs(
      "check_availability",
      { date: "2026-09-27", time: "15:00", service_ids: [SVC_CORTE, INVENTED], barber_id: INVENTED },
      catalog,
    );
    expect(r.args).toEqual({ date: "2026-09-27", time: "15:00", service_ids: [SVC_CORTE] });
    expect(r.rejected).toEqual(["service_ids", "barber_id"]);
  });

  it("drops a barber name passed as id on the waitlist and keeps the catalog service", () => {
    const r = validateToolCatalogArgs(
      "add_to_waitlist",
      { desired_date: "2026-09-27", service_id: SVC_BARBA, barber_id: "Gabriel" },
      catalog,
    );
    expect(r.args).toEqual({ desired_date: "2026-09-27", service_id: SVC_BARBA });
    expect(r.rejected).toEqual(["barber_id"]);
  });

  it("leaves catalog ids, blank values and unrelated tools untouched", () => {
    const ok = validateToolCatalogArgs(
      "get_next_slots",
      { service_id: SVC_CORTE, barber_id: "" },
      catalog,
    );
    expect(ok.rejected).toEqual([]);
    expect(ok.args).toEqual({ service_id: SVC_CORTE, barber_id: "" });
    const other = validateToolCatalogArgs("list_plans", { service_id: INVENTED }, catalog);
    expect(other.rejected).toEqual([]);
  });
});

describe("summaryCitesItemOutsideCatalog", () => {
  const services = ["Corte masculino", "Barba", "Corte + Barba"];
  const barbers = ["Lucas", "Mateus"];

  it("flags a summary that offers a service the shop does not have", () => {
    const reply = "*Pigmentação* com *Lucas*\nSábado, 27/09 às *15h*\nValor: *R$ 60,00*\nPosso confirmar?";
    expect(summaryCitesItemOutsideCatalog(reply, services, barbers)).toBe(true);
    expect(detectViolations(reply, { services, barbers })).toContain("service_not_in_catalog");
  });

  it("flags a summary with a barber outside the team", () => {
    const reply = "*Corte masculino* com *Gabriel*\nAmanhã às 10h — R$ 40. Posso confirmar?";
    expect(summaryCitesItemOutsideCatalog(reply, services, barbers)).toBe(true);
  });

  it("accepts summaries built only from catalog items, labels and dates", () => {
    const reply =
      "*Serviço:* *Corte + Barba*\n*Barbeiro:* *Lucas*\n*Sábado, 27/09* às *15h*\n*Total:* R$ 70,00\nPosso confirmar?";
    expect(summaryCitesItemOutsideCatalog(reply, services, barbers)).toBe(false);
  });

  it("ignores replies that are not booking summaries", () => {
    expect(summaryCitesItemOutsideCatalog("Oi! Quer agendar *hoje* ou *amanhã*?", services, barbers)).toBe(false);
  });

  it("output guard silences an invented summary but never a composed one", () => {
    const base = {
      reply: "*Pigmentação* com *Lucas* amanhã às 15h, R$ 60. Posso confirmar?",
      previousAssistant: "",
      userText: "quero pigmentação amanhã 15h",
      opensAt: "09:00",
      closesAt: "19:00",
      catalog: { services, barbers },
    };
    expect(guardClientReplyWithReason({ ...base, composed: false })).toEqual({
      reply: "",
      silencedBy: "catalog_mismatch",
    });
    expect(guardClientReplyWithReason({ ...base, composed: true }).silencedBy).toBeNull();
  });
});
