import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent: Array<{ to: string; text: string }> = [];
vi.mock("../integrations/whatsapp/index.js", async (orig) => {
  const mod = await orig<typeof import("../integrations/whatsapp/index.js")>();
  return { ...mod, getWhatsAppOrNull: async () => ({ sendText: async (to: string, text: string) => void sent.push({ to, text }) }) };
});

import { pool } from "../db.js";
import { enqueueInboundMessage } from "../integrations/whatsapp/inbound.js";
import { isOptOutMessage, normalizeOptOutText, OPT_OUT_ACK_MESSAGE } from "../lib/opt-out.js";
import { createPublicRoutesFixtures, deletePublicRoutesFixtures, type PublicRoutesFixture } from "./helpers/public-routes.js";

describe("isOptOutMessage: só a mensagem inteira", () => {
  it("reconhece PARAR/SAIR com caixa, pontuação, acento e espaços", () => {
    for (const t of ["parar", "PARAR", "Parar.", " parar! ", "SAIR", "sair!!", "Não quero receber", "nao quero receber.", "Cancelar inscrição", "opt out", "Sair da lista", "remover", "STOP", "parar 🙏"])
      expect(isOptOutMessage(t), t).toBe(true);
  });
  it("NÃO reconhece a palavra no meio de uma frase (antes: includes('parar') && length < 50)", () => {
    for (const t of ["vou parar aí às 18h", "pode parar na frente?", "sair às 18h?", "quero marcar", "pararam de vir", "não posso parar agora", "", "   "])
      expect(isOptOutMessage(t), t).toBe(false);
  });
  it("normalização", () => expect(normalizeOptOutText("  Não  QUERO, receber!! ")).toBe("nao quero receber"));
});

describe("inbound: opt-out grava, registra origem, confirma e NÃO abre turno do agente", () => {
  let fx: PublicRoutesFixture;
  const phone = "5511988880001";
  let seq = 0;
  const inbound = (text: string, p = phone) =>
    enqueueInboundMessage({ provider: "uazapi", barbershopId: fx.barbershopId, fromPhone: p, text, providerEventId: `evt-optout-${Date.now()}-${seq++}`, payload: {}, logPrefix: "test" });
  const client = async (p = phone) =>
    (await pool.query("SELECT marketing_opt_out, marketing_opt_out_source, marketing_opt_out_at FROM public.clients WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = $2", [fx.barbershopId, p])).rows[0];
  const jobs = async () => (await pool.query("SELECT count(*)::int AS n FROM public.ai_jobs WHERE barbershop_id = $1", [fx.barbershopId])).rows[0].n;

  beforeAll(async () => {
    fx = await createPublicRoutesFixtures({});
  });
  afterAll(async () => {
    await deletePublicRoutesFixtures([fx.barbershopId]);
  });

  it("«Parar.» de número sem cadastro: cria o registro com opt-out + origem, confirma ao cliente, sem job de IA", async () => {
    sent.length = 0;
    await inbound("Parar.");
    const c = await client();
    expect(c.marketing_opt_out).toBe(true);
    expect(c.marketing_opt_out_source).toBe("whatsapp_keyword");
    expect(c.marketing_opt_out_at).toBeTruthy();
    expect(sent).toEqual([{ to: phone, text: OPT_OUT_ACK_MESSAGE }]);
    expect(await jobs()).toBe(0);
  });

  it("frase com «parar» no meio NÃO marca opt-out, NÃO confirma e segue para o agente (job criado)", async () => {
    sent.length = 0;
    const other = "5511988880002";
    await inbound("vou parar aí às 18h", other);
    expect(await client(other)).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(await jobs()).toBe(1);
  });

  it("cliente já cadastrado: só marca (origem preservada na 2ª vez)", async () => {
    const p = "5511988880003";
    await pool.query("INSERT INTO public.clients (barbershop_id, name, phone) VALUES ($1, 'Ana', $2)", [fx.barbershopId, p]);
    await inbound("SAIR", p);
    const first = await client(p);
    expect(first.marketing_opt_out).toBe(true);
    await inbound("sair", p);
    expect((await client(p)).marketing_opt_out_at).toEqual(first.marketing_opt_out_at);
  });
});
