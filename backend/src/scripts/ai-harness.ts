import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

type Check = { name: string; ok: boolean; details?: string };

// Load repo-root .env (docker-compose uses it)
dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
// If DATABASE_URL isn't present locally, default to docker-compose Postgres on localhost.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://navalhia:navalhia_secret@localhost:5432/navalhia";
}

function uuidLeak(text: string): boolean {
  return /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(text);
}

function isGenericGreeting(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("como posso ajudar") ||
    t.includes("o que posso fazer por você") ||
    t.includes("estou aqui para ajudar") ||
    t.includes("como posso te ajudar")
  );
}

async function getBarbershopId(): Promise<string> {
  const { pool } = await import("../db.js");
  const r = await pool.query<{ id: string }>("select id from public.barbershops order by created_at asc limit 1");
  const id = r.rows[0]?.id;
  if (!id) throw new Error("No barbershop found. Run seed first.");
  return id;
}

async function createConversation(barbershopId: string, isSandbox = false): Promise<string> {
  const { pool } = await import("../db.js");
  const external = `harness-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const r = await pool.query<{ id: string }>(
    "insert into public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox) values ($1,'whatsapp',$2,$3) returning id",
    [barbershopId, external, isSandbox]
  );
  return r.rows[0].id;
}

async function addUserMessage(conversationId: string, text: string): Promise<void> {
  const { pool } = await import("../db.js");
  await pool.query(
    "insert into public.ai_messages (conversation_id, role, content) values ($1,'user',$2)",
    [conversationId, text]
  );
}

async function scenarioGreetingAndBooking(openai: OpenAI, barbershopId: string): Promise<Check[]> {
  const checks: Check[] = [];
  const fromPhone = "5545999990000";
  const conversationId = await createConversation(barbershopId);
  const futureDay = String(((Math.floor(Date.now() / 1000) % 28) + 1)).padStart(2, "0");
  const futureDate = `2099-12-${futureDay}`;

  await addUserMessage(conversationId, "Salve");
  const { runAgent } = await import("../ai/agent.js");
  const r1 = await runAgent(barbershopId, conversationId, fromPhone, openai);
  checks.push({
    name: "Greeting is not generic",
    ok: !isGenericGreeting(r1.reply),
    details: r1.reply,
  });
  checks.push({
    name: "Greeting directs to booking/services",
    ok: /serviç|agend/i.test(r1.reply),
    details: r1.reply,
  });

  // Use a far-future explicit date that varies per run to avoid conflicts.
  await addUserMessage(conversationId, `Barba completa, ${futureDate} às 09:00`);
  const r2 = await runAgent(barbershopId, conversationId, fromPhone, openai);
  checks.push({
    name: "Does not ask for phone",
    ok: !/telefone|celular|whats/i.test(r2.reply.toLowerCase()),
    details: r2.reply,
  });
  checks.push({
    name: "No UUID leak",
    ok: !uuidLeak(r2.reply),
    details: r2.reply,
  });

  await addUserMessage(conversationId, "Qualquer um");
  const r3 = await runAgent(barbershopId, conversationId, fromPhone, openai);
  checks.push({
    name: "Asks final confirmation (once) or provides clear next step",
    ok:
      /fecho assim|fechou assim|posso fechar|confirm/i.test(r3.reply.toLowerCase()) ||
      /qual nome|qual seu nome/i.test(r3.reply.toLowerCase()) ||
      /qual .*prefere|prefere qual|quer qual/i.test(r3.reply.toLowerCase()),
    details: r3.reply,
  });
  checks.push({
    name: "No UUID leak (mid)",
    ok: !uuidLeak(r3.reply),
    details: r3.reply,
  });

  // If the agent asked for the name, provide it; otherwise confirm.
  const r3t = r3.reply.toLowerCase();
  if (/qual nome|qual seu nome|pra salvar/i.test(r3t)) {
    await addUserMessage(conversationId, "Mateus");
  } else if (/qual .*prefere|prefere qual|quer qual/i.test(r3t)) {
    await addUserMessage(conversationId, "Qualquer um");
  } else {
    await addUserMessage(conversationId, "Sim");
  }
  const r4 = await runAgent(barbershopId, conversationId, fromPhone, openai);
  const r4t = r4.reply.toLowerCase();
  let final = r4;
  if (final.state !== "appointment_created" && /qual nome|qual seu nome|pra salvar/i.test(r4t)) {
    await addUserMessage(conversationId, "Mateus");
    final = await runAgent(barbershopId, conversationId, fromPhone, openai);
  }
  checks.push({
    name: "Appointment created state",
    ok: final.state === "appointment_created",
    details: `state=${final.state ?? "—"} reply=${final.reply}`,
  });
  checks.push({
    name: "No UUID leak (final)",
    ok: !uuidLeak(final.reply),
    details: final.reply,
  });

  return checks;
}

async function scenarioOutOfScopePizza(openai: OpenAI, barbershopId: string): Promise<Check[]> {
  const checks: Check[] = [];
  const fromPhone = "5545999990001";
  const conversationId = await createConversation(barbershopId);

  await addUserMessage(conversationId, "Preciso comprar uma pizza");
  const { runAgent } = await import("../ai/agent.js");
  const r = await runAgent(barbershopId, conversationId, fromPhone, openai);
  checks.push({
    name: "Does not invent external places",
    ok: !/pizzaria do|pizza na pedra/i.test(r.reply.toLowerCase()),
    details: r.reply,
  });
  checks.push({
    name: "Out of scope response pulls back to booking",
    ok: /agend|serviç|marcar/i.test(r.reply.toLowerCase()),
    details: r.reply,
  });
  return checks;
}

/** When user asks for a non-existent service, agent must list services (e.g. 4 main) and offer to book or see more. */
async function scenarioNonExistentService(openai: OpenAI, barbershopId: string): Promise<Check[]> {
  const checks: Check[] = [];
  const fromPhone = "5545999990002";
  const conversationId = await createConversation(barbershopId);

  await addUserMessage(conversationId, "Vocês tem terapia capilar?");
  const { runAgent } = await import("../ai/agent.js");
  const r = await runAgent(barbershopId, conversationId, fromPhone, openai);
  checks.push({
    name: "Says we don't have that service",
    ok: /não (oferecemos|temos|fazemos)|não oferecemos|não temos/i.test(r.reply),
    details: r.reply,
  });
  checks.push({
    name: "Shows list of available services (at least 2 items or R$)",
    ok: /\d+\.\s*\*?\*?[^*]+\*?\*?\s*-\s*R\$\s*\d|barba|corte|sobrancelha|R\$\s*\d/i.test(r.reply),
    details: r.reply,
  });
  checks.push({
    name: "Offers to book or see options",
    ok: /agend|marcar|ver (os )?serviços|outras opções/i.test(r.reply.toLowerCase()),
    details: r.reply,
  });
  return checks;
}

/** When user asks for a slot "today" without a time, the agent must use get_next_slots with after_time; reply must not suggest a time in the past. */
async function scenarioNoPastSlotsToday(openai: OpenAI, barbershopId: string): Promise<Check[]> {
  const checks: Check[] = [];
  const fromPhone = "5545999990003";
  const conversationId = await createConversation(barbershopId);
  await addUserMessage(conversationId, "Quero cortar o cabelo. Tem horário hoje?");
  const { runAgent } = await import("../ai/agent.js");
  const r = await runAgent(barbershopId, conversationId, fromPhone, openai);
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const nowMins = currentHour * 60 + currentMin;
  const timeMatch = r.reply.match(/\b(\d{1,2}):(\d{2})\b/);
  const suggestedMins = timeMatch
    ? parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10)
    : null;
  checks.push({
    name: "When asking for today, no past time suggested",
    ok: suggestedMins == null || suggestedMins >= nowMins - 15,
    details: r.reply + (suggestedMins != null ? ` (suggested ${suggestedMins} vs now ${nowMins})` : ""),
  });
  return checks;
}

/** First slot tomorrow should come from get_next_slots (e.g. ~09:00 when open), not invented. */
async function scenarioFirstSlotTomorrow(openai: OpenAI, barbershopId: string): Promise<Check[]> {
  const checks: Check[] = [];
  const fromPhone = "5545999990004";
  const conversationId = await createConversation(barbershopId);
  await addUserMessage(conversationId, "Quero agendar um corte. Qual o primeiro horário amanhã?");
  const { runAgent } = await import("../ai/agent.js");
  const r = await runAgent(barbershopId, conversationId, fromPhone, openai);
  const timeMatch = r.reply.match(/\b(\d{1,2}):(\d{2})\b/);
  const suggestedHour = timeMatch ? parseInt(timeMatch[1], 10) : null;
  checks.push({
    name: "First slot tomorrow is a reasonable opening hour (e.g. 7-12)",
    ok:
      (suggestedHour != null && suggestedHour >= 7 && suggestedHour <= 12) ||
      /cheio|lotado|sem hor[aá]rio|não (tenho|tem)|não consegui/i.test(r.reply.toLowerCase()),
    details: r.reply + (suggestedHour != null ? ` (hour=${suggestedHour})` : " (no time found)"),
  });
  return checks;
}

async function scenarioWithProfile(openai: OpenAI, barbershopId: string): Promise<Check[]> {
  const checks: Check[] = [];
  const fromPhone = "5545999990001";
  const conversationId = await createConversation(barbershopId, true);
  await addUserMessage(conversationId, "Oi");
  const { runAgent } = await import("../ai/agent.js");
  const draftProfile = { tonePreset: "formal", emojiLevel: "none", verbosity: "short" };
  const r = await runAgent(barbershopId, conversationId, fromPhone, openai, {
    sandboxDraft: { agent_profile: draftProfile, additional_instructions: null },
  });
  const reply = r.reply;
  const emojiCount = (reply.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  checks.push({
    name: "With formal/no-emoji profile: reply has no emojis",
    ok: emojiCount === 0,
    details: reply.slice(0, 200),
  });
  checks.push({
    name: "With formal profile: reply is not generic greeting",
    ok: !isGenericGreeting(reply),
    details: reply.slice(0, 200),
  });
  return checks;
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in environment (.env).");
    process.exit(2);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const barbershopId = await getBarbershopId();

  const all: { scenario: string; checks: Check[] }[] = [];
  all.push({ scenario: "greeting+booking", checks: await scenarioGreetingAndBooking(openai, barbershopId) });
  all.push({ scenario: "out-of-scope pizza", checks: await scenarioOutOfScopePizza(openai, barbershopId) });
  all.push({ scenario: "non-existent service (list + CTA)", checks: await scenarioNonExistentService(openai, barbershopId) });
  all.push({ scenario: "no past slots today", checks: await scenarioNoPastSlotsToday(openai, barbershopId) });
  all.push({ scenario: "first slot tomorrow", checks: await scenarioFirstSlotTomorrow(openai, barbershopId) });
  all.push({ scenario: "with profile (formal, no emoji)", checks: await scenarioWithProfile(openai, barbershopId) });

  let failed = 0;
  for (const s of all) {
    console.log(`\n=== ${s.scenario} ===`);
    for (const c of s.checks) {
      const status = c.ok ? "PASS" : "FAIL";
      console.log(`${status} - ${c.name}`);
      if (!c.ok && c.details) {
        console.log(`  ↳ ${c.details.replace(/\s+/g, " ").slice(0, 300)}`);
      }
      if (!c.ok) failed++;
    }
  }

  const { pool } = await import("../db.js");
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  try {
    const { pool } = await import("../db.js");
    await pool.end();
  } catch {}
  process.exit(1);
});

