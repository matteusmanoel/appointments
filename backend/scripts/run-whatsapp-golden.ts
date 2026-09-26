import "../src/load-env.js";
/**
 * Dispara os golden scenarios pelo WhatsApp da instância de teste.
 * Sem juiz LLM: compara tools, estado da agenda e o texto da resposta.
 *
 * npx tsx scripts/run-whatsapp-golden.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pool } from "../src/db.js";
import { sendText } from "../src/integrations/whatsapp/evolution-client.js";
import { LAB_EVOLUTION_INSTANCE } from "../src/integrations/whatsapp/inbound-allowlist.js";
import { wipeWhatsAppTestContext } from "../src/ai/wipe-test-context.js";
import { brPhoneMatchKeys, canonicalizeBrPhoneDigits } from "../src/lib/phone-match.js";
import { goldenScenarios } from "../benchmark/scenarios/barbershop/golden.js";

const SHOP_PHONE = "5545988432998";
const CLIENT_PHONE = "5545988230845";
const TURN_TIMEOUT_MS = 120_000;

type Msg = { role: string; content: string | null; tool_name: string | null; created_at: string };

async function barbershopId(): Promise<string> {
  const r = await pool.query<{ id: string }>(`SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1`);
  if (!r.rows[0]) throw new Error("sem barbearia");
  return r.rows[0].id;
}

async function messagesSince(shopId: string, since: Date): Promise<Msg[]> {
  const keys = brPhoneMatchKeys(canonicalizeBrPhoneDigits(CLIENT_PHONE) ?? CLIENT_PHONE);
  const r = await pool.query<Msg>(
    `SELECT m.role, m.content, m.tool_name, m.created_at::text
     FROM public.ai_messages m
     JOIN public.ai_conversations c ON c.id = m.conversation_id
     WHERE c.barbershop_id = $1 AND c.channel = 'whatsapp'
       AND regexp_replace(c.external_thread_id, '[^0-9]', '', 'g') = ANY($2::text[])
       AND m.created_at > $3
     ORDER BY m.created_at`,
    [shopId, keys, since.toISOString()],
  );
  return r.rows;
}

async function jobsBusy(shopId: string): Promise<boolean> {
  const keys = brPhoneMatchKeys(canonicalizeBrPhoneDigits(CLIENT_PHONE) ?? CLIENT_PHONE);
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM public.ai_jobs j
     JOIN public.ai_conversations c ON c.id = j.conversation_id
     WHERE j.barbershop_id = $1 AND j.status IN ('queued', 'processing')
       AND regexp_replace(c.external_thread_id, '[^0-9]', '', 'g') = ANY($2::text[])`,
    [shopId, keys],
  );
  return Number(r.rows[0]?.n ?? 0) > 0;
}

async function waitReply(shopId: string, since: Date): Promise<Msg[]> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  let lastCount = -1;
  let stableSince = 0;
  while (Date.now() < deadline) {
    const msgs = await messagesSince(shopId, since);
    const busy = await jobsBusy(shopId);
    const assistant = msgs.some((m) => m.role === "assistant" && (m.content ?? "").trim());
    if (assistant && !busy) {
      if (msgs.length === lastCount) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince > 4000) return msgs;
      } else {
        lastCount = msgs.length;
        stableSince = 0;
      }
    } else {
      stableSince = 0;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return messagesSince(shopId, since);
}

async function agenda(shopId: string): Promise<unknown[]> {
  const r = await pool.query(
    `SELECT a.status, a.scheduled_date::text AS date, a.scheduled_time::text AS time,
            b.name AS barber, s.name AS service, c.name AS client, c.phone
     FROM public.appointments a
     JOIN public.barbers b ON b.id = a.barber_id
     LEFT JOIN public.services s ON s.id = a.service_id
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.barbershop_id = $1
     ORDER BY a.scheduled_date, a.scheduled_time`,
    [shopId],
  );
  return r.rows;
}

function replyText(msgs: Msg[]): string {
  return msgs
    .filter((m) => m.role === "assistant" && (m.content ?? "").trim())
    .map((m) => (m.content ?? "").trim())
    .join("\n");
}

function tools(msgs: Msg[]): string[] {
  return [...new Set(msgs.map((m) => m.tool_name).filter((n): n is string => !!n))];
}

async function main(): Promise<void> {
  const shopId = await barbershopId();
  const outDir = path.resolve(process.cwd(), ".lab");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "golden-whatsapp-report.json");
  const report: unknown[] = [];

  for (const scenario of goldenScenarios) {
    const started = new Date();
    console.log(`\n=== ${scenario.id} ===`);
    await wipeWhatsAppTestContext({ barbershopId: shopId, phone: CLIENT_PHONE });
    if (scenario.setup) {
      await scenario.setup({ barbershopId: shopId, clientPhone: CLIENT_PHONE });
    }
    const before = await agenda(shopId);
    const turns: unknown[] = [];
    for (const turn of scenario.turns) {
      const mark = new Date();
      console.log(">", turn.content);
      await sendText(LAB_EVOLUTION_INSTANCE, SHOP_PHONE, turn.content);
      const msgs = await waitReply(shopId, mark);
      const reply = replyText(msgs);
      console.log("<", reply.slice(0, 400).replace(/\n/g, " | ") || "(sem resposta)");
      turns.push({ user: turn.content, reply, tools: tools(msgs), timedOut: !reply });
    }
    const after = await agenda(shopId);
    const called = [...new Set(turns.flatMap((t) => (t as { tools: string[] }).tools))];
    const missing = (scenario.expected.mustCallTools ?? []).filter((name) => !called.includes(name));
    const row = {
      id: scenario.id,
      name: scenario.name,
      expect: scenario.golden?.expect ?? [],
      forbid: scenario.golden?.forbid ?? [],
      dbAfter: scenario.golden?.dbAfter ?? "",
      finalState: scenario.expected.finalState ?? null,
      missingTools: missing,
      calledTools: called,
      before,
      after,
      turns,
      startedAt: started.toISOString(),
    };
    report.push(row);
    writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log("tools", called.join(",") || "—", "missing", missing.join(",") || "—");
  }

  console.log("\nreport", outFile);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await pool.end().catch(() => {});
  process.exit(1);
});
