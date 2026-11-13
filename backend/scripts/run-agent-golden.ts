import "../src/load-env.js";
/**
 * Roda os golden pelo runAgent, com o relógio do cenário.
 * Não passa pelo WhatsApp.
 *
 * GOLDEN_IDS=a,b GOLDEN_OUT=nome.json npx tsx scripts/run-agent-golden.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";
import { runAgent } from "../src/ai/agent.js";
import { wipeWhatsAppTestContext } from "../src/ai/wipe-test-context.js";
import { goldenScenarios } from "../benchmark/scenarios/barbershop/golden.js";
import { HARNESS_BLOCKER_PHONE } from "../benchmark/scenarios/barbershop/seed-appointment.js";

const CLIENT_PHONE = "5545999000101";

async function barbershopId(): Promise<string> {
  const r = await pool.query<{ id: string }>(`SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1`);
  if (!r.rows[0]) throw new Error("sem barbearia");
  return r.rows[0].id;
}

async function clearBlockers(shopId: string): Promise<void> {
  const ids = await pool.query<{ id: string }>(
    `SELECT a.id FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.barbershop_id = $1
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = $2`,
    [shopId, HARNESS_BLOCKER_PHONE],
  );
  const appointmentIds = ids.rows.map((row) => row.id);
  if (!appointmentIds.length) return;
  await pool.query(`DELETE FROM public.appointment_services WHERE appointment_id = ANY($1::uuid[])`, [appointmentIds]);
  await pool.query(`DELETE FROM public.agenda_activity WHERE appointment_id = ANY($1::uuid[])`, [appointmentIds]).catch(() => undefined);
  await pool.query(`DELETE FROM public.appointments WHERE id = ANY($1::uuid[])`, [appointmentIds]);
}

async function clientAgenda(shopId: string): Promise<Array<Record<string, string>>> {
  const r = await pool.query<{
    status: string;
    date: string;
    time: string;
    barber: string;
    service: string;
    client: string;
  }>(
    `SELECT a.status, a.scheduled_date::text AS date, a.scheduled_time::text AS time,
            b.name AS barber, s.name AS service, c.name AS client
     FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     JOIN public.barbers b ON b.id = a.barber_id
     JOIN public.services s ON s.id = a.service_id
     WHERE a.barbershop_id = $1
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = $2
     ORDER BY a.scheduled_date, a.scheduled_time`,
    [shopId, CLIENT_PHONE],
  );
  return r.rows;
}

async function main(): Promise<void> {
  const key = config.openaiApiKey;
  if (!key) throw new Error("OPENAI_API_KEY ausente");
  const wanted = (process.env.GOLDEN_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!wanted.length) throw new Error("GOLDEN_IDS vazio");
  const missing = wanted.filter((id) => !goldenScenarios.some((scenario) => scenario.id === id));
  if (missing.length) throw new Error(`cenário não encontrado: ${missing.join(", ")}`);
  const scenarios = goldenScenarios.filter((scenario) => wanted.includes(scenario.id));
  const shopId = await barbershopId();
  const openai = new OpenAI({ apiKey: key });
  const report: unknown[] = [];
  const outFile = path.join(process.cwd(), ".lab", process.env.GOLDEN_OUT ?? "golden-agent-direto.json");
  mkdirSync(path.dirname(outFile), { recursive: true });

  for (const scenario of scenarios) {
    console.log(`\n=== ${scenario.id} ===`);
    await wipeWhatsAppTestContext({ barbershopId: shopId, phone: CLIENT_PHONE });
    await clearBlockers(shopId);
    if (scenario.setup) {
      await scenario.setup({
        barbershopId: shopId,
        clientPhone: CLIENT_PHONE,
        simulatedNow: scenario.simulatedNow,
      });
    }
    const conversation = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, status)
       VALUES ($1, 'whatsapp', $2, 'active')
       RETURNING id`,
      [shopId, CLIENT_PHONE],
    );
    const conversationId = conversation.rows[0].id;
    const turns: Array<{ user: string; reply: string; state: string | null }> = [];
    for (const turn of scenario.turns) {
      if (turn.role !== "user") continue;
      console.log(">", turn.content);
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
        [conversationId, turn.content],
      );
      const result = await runAgent(shopId, conversationId, CLIENT_PHONE, openai, {
        simulatedNow: scenario.simulatedNow,
      });
      const reply = (result.reply ?? "").replace(/\s+/g, " ").trim();
      console.log("<", reply.slice(0, 400) || "(sem resposta)", result.state ?? "");
      turns.push({ user: turn.content, reply, state: result.state ?? null });
    }
    const after = await clientAgenda(shopId);
    console.log("agenda", after.map((row) => `${row.status} ${row.date} ${row.time} ${row.barber}`).join(" ; ") || "vazia");
    report.push({
      id: scenario.id,
      expect: scenario.golden?.expect ?? [],
      turns,
      after,
    });
    writeFileSync(outFile, JSON.stringify(report, null, 2));
  }
  console.log("\nreport", outFile);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
