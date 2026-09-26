import "../src/load-env.js";
/**
 * Bateria só dos cenários ainda abertos na avaliação humana.
 * npx tsx scripts/run-open-battery.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pool } from "../src/db.js";
import { sendText } from "../src/integrations/whatsapp/evolution-client.js";
import { LAB_EVOLUTION_INSTANCE } from "../src/integrations/whatsapp/inbound-allowlist.js";
import { getWhatsAppOrNull } from "../src/integrations/whatsapp/index.js";
import { wipeWhatsAppTestContext } from "../src/ai/wipe-test-context.js";
import { brPhoneMatchKeys, canonicalizeBrPhoneDigits } from "../src/lib/phone-match.js";
import { buildReminder24h, buildReminder2hPending, buildReminder2hConfirmed } from "../src/outbound/templates.js";
import { seedHarnessAppointment, seedSlotBlockers, seedPlanSubscription } from "../benchmark/scenarios/barbershop/seed-appointment.js";

const SHOP_PHONE = "5545988432998";
const CLIENT_PHONE = "5545988230845";
const TURN_TIMEOUT_MS = 120_000;

type Msg = { role: string; content: string | null; tool_name: string | null; created_at: string };
type Turn = { user: string; reply: string; tools: string[] };

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

function replyText(msgs: Msg[]): string {
  return msgs
    .filter((m) => m.role === "assistant" && (m.content ?? "").trim())
    .map((m) => (m.content ?? "").trim())
    .join("\n---\n");
}

function toolsOf(msgs: Msg[]): string[] {
  return [...new Set(msgs.map((m) => m.tool_name).filter((n): n is string => !!n))];
}

async function agenda(shopId: string): Promise<unknown[]> {
  const keys = brPhoneMatchKeys(canonicalizeBrPhoneDigits(CLIENT_PHONE) ?? CLIENT_PHONE);
  const r = await pool.query(
    `SELECT a.status, a.scheduled_date::text AS date, left(a.scheduled_time::text, 5) AS time,
            b.name AS barber, c.name AS client, c.phone, c.name_confirmed
     FROM public.appointments a
     JOIN public.barbers b ON b.id = a.barber_id
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.barbershop_id = $1 AND a.status <> 'cancelled'
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = ANY($2::text[])
     ORDER BY a.scheduled_date, a.scheduled_time`,
    [shopId, keys],
  );
  return r.rows;
}

async function play(shopId: string, lines: string[]): Promise<Turn[]> {
  const turns: Turn[] = [];
  for (const line of lines) {
    const mark = new Date();
    console.log(">", line);
    await sendText(LAB_EVOLUTION_INSTANCE, SHOP_PHONE, line);
    const msgs = await waitReply(shopId, mark);
    const reply = replyText(msgs);
    console.log("<", reply.slice(0, 500).replace(/\n/g, " | ") || "(sem resposta)");
    turns.push({ user: line, reply, tools: toolsOf(msgs) });
  }
  return turns;
}

async function ensureThread(shopId: string): Promise<string> {
  const phone = canonicalizeBrPhoneDigits(CLIENT_PHONE) ?? CLIENT_PHONE;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, last_message_at, updated_at)
     VALUES ($1, 'whatsapp', $2, now(), now())
     ON CONFLICT (barbershop_id, channel, external_thread_id)
     DO UPDATE SET updated_at = now()
     RETURNING id`,
    [shopId, phone],
  );
  return r.rows[0].id;
}

/** Manda o template real do lembrete pelo número da loja e grava na conversa. */
async function dispatchReminder(shopId: string, body: string): Promise<void> {
  const session = await getWhatsAppOrNull(shopId);
  if (!session) throw new Error("WhatsApp da loja indisponível");
  await session.sendText(CLIENT_PHONE, body);
  const conversationId = await ensureThread(shopId);
  await pool.query(
    `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
    [conversationId, body],
  );
  const appt = await pool.query<{ id: string; scheduled_date: string; scheduled_time: string }>(
    `SELECT a.id, a.scheduled_date::text, a.scheduled_time::text
     FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.barbershop_id = $1 AND a.status <> 'cancelled'
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = ANY($2::text[])
     ORDER BY a.scheduled_date DESC LIMIT 1`,
    [shopId, brPhoneMatchKeys(canonicalizeBrPhoneDigits(CLIENT_PHONE) ?? CLIENT_PHONE)],
  );
  const row = appt.rows[0];
  if (row) {
    await pool.query(
      `INSERT INTO public.agenda_activity (barbershop_id, appointment_id, type, actor, client_phone, scheduled_date, scheduled_time, summary)
       VALUES ($1, $2, 'reminder_sent', 'system', $3, $4::date, $5::time, 'lembrete da bateria')`,
      [shopId, row.id, CLIENT_PHONE, row.scheduled_date, row.scheduled_time],
    );
  }
}

async function tomorrowIso(): Promise<string> {
  const r = await pool.query<{ d: string }>(
    `SELECT ((timezone('America/Sao_Paulo', now()))::date + 1)::text AS d`,
  );
  return r.rows[0].d;
}

async function todayIso(): Promise<string> {
  const r = await pool.query<{ d: string }>(
    `SELECT (timezone('America/Sao_Paulo', now()))::date::text AS d`,
  );
  return r.rows[0].d;
}

type Case = {
  id: string;
  title: string;
  setup?: (shopId: string) => Promise<void>;
  reminder?: (shopId: string) => Promise<string>;
  lines: string[];
};

async function main(): Promise<void> {
  const shopId = await barbershopId();
  const outDir = path.resolve(process.cwd(), ".lab");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "open-battery.json");
  const today = await todayIso();
  const tomorrow = await tomorrowIso();
  const cases: Case[] = [
    {
      id: "3",
      title: "Aceite pede o nome antes de gravar",
      lines: [
        "Quero agendar um corte e barba com o Lucas na próxima segunda as 10h",
        "Sim",
        "Mateus",
      ],
    },
    {
      id: "5",
      title: "Reagendar o horário que já existe",
      setup: (id) =>
        seedHarnessAppointment({
          barbershopId: id,
          clientPhone: CLIENT_PHONE,
          offsetDays: 1,
          time: "10:00",
          serviceNameIncludes: "corte e barba",
          barberNameIncludes: "Lucas",
          clientName: "Mateus",
        }),
      lines: [
        "Quero reagendar meu corte para terça as 13h, o Lucas teria disponibilidade?",
        "Sim",
      ],
    },
    {
      id: "8",
      title: "Aceite do Eduardo pede o nome e grava",
      setup: (id) => seedSlotBlockers({ barbershopId: id, offsetDays: 1, time: "17:00", barberNameIncludes: "Lucas" }),
      lines: ["Corte e barba amanhã às 17h com o Lucas", "Fica sim", "Por gentileza", "Mateus"],
    },
    {
      id: "9",
      title: "Barbeiro, hora e dia pinados vão para a fila",
      setup: (id) => seedSlotBlockers({ barbershopId: id, offsetDays: 0, time: "18:00", barberNameIncludes: "Lucas" }),
      lines: [
        "O lucas pode me atender hoje as 18? Ou após",
        "Corte e barba",
        "Seria só com o Lucas mesmo, consegue me avisar se surgir um encaixe?",
      ],
    },
    {
      id: "10",
      title: "PIX uma vez só",
      lines: ["Pode me mandar a chave pix para já deixar certo?"],
    },
    {
      id: "11",
      title: "Lembrete 24h e resposta no contexto",
      setup: (id) =>
        seedHarnessAppointment({
          barbershopId: id,
          clientPhone: CLIENT_PHONE,
          offsetDays: 1,
          time: "15:00",
          serviceNameIncludes: "corte e barba",
          barberNameIncludes: "Lucas",
          clientName: "Mateus",
        }),
      reminder: async () =>
        buildReminder24h({
          clientName: "Mateus",
          date: tomorrow,
          time: "15:00",
          serviceNames: "Corte e Barba",
          barberName: "Lucas Lima",
          todayIso: today,
        }),
      lines: ["Estarei aí"],
    },
    {
      id: "12",
      title: "Lembrete 2h sem resposta ao 24h",
      setup: (id) =>
        seedHarnessAppointment({
          barbershopId: id,
          clientPhone: CLIENT_PHONE,
          offsetDays: 0,
          time: "18:00",
          serviceNameIncludes: "corte e barba",
          barberNameIncludes: "Lucas",
          clientName: "Mateus",
        }),
      reminder: async () =>
        buildReminder2hPending({
          clientName: "Mateus",
          date: today,
          time: "18:00",
          serviceNames: "Corte e Barba",
          barberName: "Lucas Lima",
          todayIso: today,
        }),
      lines: ["Vou sim"],
    },
    {
      id: "13",
      title: "Lembrete 2h depois da presença no 24h",
      setup: async (id) => {
        await seedHarnessAppointment({
          barbershopId: id,
          clientPhone: CLIENT_PHONE,
          offsetDays: 0,
          time: "18:00",
          serviceNameIncludes: "corte e barba",
          barberNameIncludes: "Lucas",
          clientName: "Mateus",
        });
        await pool.query(
          `UPDATE public.appointments a SET status = 'confirmed', updated_at = now()
           FROM public.clients c
           WHERE a.client_id = c.id AND a.barbershop_id = $1
             AND regexp_replace(c.phone, '[^0-9]', '', 'g') = ANY($2::text[])`,
          [id, brPhoneMatchKeys(canonicalizeBrPhoneDigits(CLIENT_PHONE) ?? CLIENT_PHONE)],
        );
      },
      reminder: async () =>
        buildReminder2hConfirmed({
          clientName: "Mateus",
          date: today,
          time: "18:00",
          serviceNames: "Corte e Barba",
          barberName: "Lucas Lima",
          todayIso: today,
        }),
      lines: ["Vou sim"],
    },
    {
      id: "14",
      title: "Remarcar depois do cancelamento",
      setup: (id) =>
        seedHarnessAppointment({
          barbershopId: id,
          clientPhone: CLIENT_PHONE,
          offsetDays: 1,
          time: "13:00",
          serviceNameIncludes: "corte e barba",
          barberNameIncludes: "Lucas",
          clientName: "Mateus",
        }),
      lines: ["Surgiu um imprevisto, não vou poder ir", "Quero remarcar"],
    },
    {
      id: "16",
      title: "Primeiro horário com o serviço já conhecido",
      setup: (id) =>
        seedHarnessAppointment({
          barbershopId: id,
          clientPhone: CLIENT_PHONE,
          offsetDays: 0,
          time: "15:00",
          serviceNameIncludes: "corte e barba",
          barberNameIncludes: "Eduardo",
          clientName: "Mateus",
        }),
      lines: ["Quero reagendar para amanhã no primeiro horário, é possível?"],
    },
    {
      id: "18",
      title: "Plano vencido no telefone do teste",
      setup: (id) =>
        seedPlanSubscription({
          barbershopId: id,
          clientPhone: CLIENT_PHONE,
          clientName: "Mateus",
          planNameIncludes: "corte e barba",
        }),
      lines: ["Quero pagar meu plano mensal de 200,00 que está atrasado"],
    },
  ];

  const report: unknown[] = [];
  for (const item of cases) {
    console.log(`\n=== cenario ${item.id} ${item.title} ===`);
    await wipeWhatsAppTestContext({ barbershopId: shopId, phone: CLIENT_PHONE });
    if (item.setup) await item.setup(shopId);
    let reminder = "";
    if (item.reminder) {
      reminder = await item.reminder(shopId);
      console.log("lembrete:", reminder.slice(0, 180).replace(/\n/g, " | "));
      await dispatchReminder(shopId, reminder);
    }
    const turns = await play(shopId, item.lines);
    const after = await agenda(shopId);
    report.push({ id: item.id, title: item.title, reminder, turns, after });
    writeFileSync(outFile, JSON.stringify(report, null, 2));
  }
  console.log("\nreport", outFile);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await pool.end().catch(() => {});
  process.exit(1);
});
