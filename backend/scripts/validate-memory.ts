/**
 * Validation script for client_ai_memory integration.
 * Run: npx tsx scripts/validate-memory.ts
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://navalhia:navalhia_secret@localhost:5432/navalhia";
}
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "dev-placeholder";

const SEP = "─".repeat(60);

async function run() {
  const { pool } = await import("../src/db.js");
  const {
    getClientMemory,
    buildClientMemoryPromptBlock,
    updateClientMemoryFromAppointmentEvent,
    reinforceMemoryFromHistory,
    clientMemoryTableExists,
  } = await import("../src/ai/memory/client-memory.js");

  console.log("NavalhIA — Client Memory Validation\n" + SEP);

  // =========================================================
  // FASE 1: Migration / schema
  // =========================================================
  console.log("\n[FASE 1] Schema e migration");

  const exists = await clientMemoryTableExists();
  console.log("  client_ai_memory table exists:", exists);

  if (!exists) {
    console.log("  → Aplicando migration...");
    const migration = await import("fs/promises").then(fs =>
      fs.readFile(
        new URL("../../supabase/migrations/20260402120000_client_ai_memory.sql", import.meta.url),
        "utf8"
      )
    );
    try {
      await pool.query(migration);
      console.log("  ✓ Migration aplicada com sucesso.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("already exists")) {
        console.log("  ✓ Objetos já existentes — migration idempotente OK.");
      } else {
        console.error("  ✗ Falha ao aplicar migration:", msg);
        process.exit(1);
      }
    }
  }

  // Validate columns
  const cols = await pool.query<{ column_name: string; data_type: string; column_default: string | null; is_nullable: string }>(
    `SELECT column_name, data_type, column_default, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'client_ai_memory'
     ORDER BY ordinal_position`
  );
  console.log(`\n  Columns (${cols.rows.length}):`);
  for (const c of cols.rows) {
    console.log(`    ${c.column_name.padEnd(32)} ${c.data_type.padEnd(20)} nullable=${c.is_nullable}`);
  }

  // Validate indexes
  const idxs = await pool.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'client_ai_memory' ORDER BY indexname`
  );
  console.log(`\n  Indexes (${idxs.rows.length}):`);
  for (const i of idxs.rows) console.log(`    ${i.indexname}`);

  // Validate constraints
  const constraints = await pool.query<{ conname: string; contype: string }>(
    `SELECT conname, contype FROM pg_constraint
     WHERE conrelid = 'public.client_ai_memory'::regclass ORDER BY conname`
  );
  console.log(`\n  Constraints (${constraints.rows.length}):`);
  for (const c of constraints.rows) {
    const type = { p: "PRIMARY KEY", u: "UNIQUE", f: "FOREIGN KEY", c: "CHECK" }[c.contype] ?? c.contype;
    console.log(`    ${c.conname.padEnd(40)} ${type}`);
  }

  // Validate decay function
  const funcExists = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'decay_client_ai_memory_confidence') AS exists`
  );
  console.log(`\n  decay_client_ai_memory_confidence function: ${funcExists.rows[0].exists ? "✓ exists" : "✗ missing"}`);

  // Validate view
  const viewExists = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.views
     WHERE table_schema='public' AND table_name='v_client_ai_memory_confident') AS exists`
  );
  console.log(`  v_client_ai_memory_confident view: ${viewExists.rows[0].exists ? "✓ exists" : "✗ missing"}`);

  // =========================================================
  // FASE 2: Hook simulation
  // =========================================================
  console.log("\n" + SEP);
  console.log("[FASE 2] Hook simulation");

  // Get a real barbershop that has appointments
  const bsRow = await pool.query<{ id: string; name: string }>(
    `SELECT bs.id, bs.name FROM public.barbershops bs
     WHERE EXISTS (SELECT 1 FROM public.appointments a WHERE a.barbershop_id = bs.id)
     ORDER BY bs.created_at LIMIT 1`
  );
  const bs = bsRow.rows[0];
  if (!bs) {
    console.log("  ✗ No barbershops found — skipping hook tests");
  } else {
    console.log(`\n  Using barbershop: ${bs.name} (${bs.id.slice(0, 8)}...)`);

    const clientRow = await pool.query<{ id: string; name: string; phone: string }>(
      `SELECT c.id, c.name, c.phone
       FROM public.clients c
       JOIN public.appointments a ON a.client_id = c.id
       WHERE a.barbershop_id = $1
       GROUP BY c.id, c.name, c.phone
       ORDER BY COUNT(a.id) DESC
       LIMIT 1`,
      [bs.id]
    );
    const client = clientRow.rows[0];
    if (!client) {
      console.log("  ✗ No clients with appointments found — skipping hook tests");
    } else {
      console.log(`  Using client: ${client.name ?? "unnamed"} (phone: ****${client.phone.slice(-4)})`);
      const clientId = client.id;

      // Snapshot before
      const before = await getClientMemory(bs.id, client.phone);
      console.log(`\n  Memory BEFORE hooks:`);
      console.log(`    overall_confidence: ${before?.overall_confidence ?? "null (no record)"}`);
      console.log(`    preferred_services_conf: ${before?.preferred_services_conf ?? "—"}`);
      console.log(`    preferred_barber_conf: ${before?.preferred_barber_conf ?? "—"}`);
      console.log(`    reactivation_status: ${before?.reactivation_status ?? "—"}`);
      console.log(`    no_show_count: ${before?.no_show_count ?? "—"}`);

      // Fetch a real barber and services for this barbershop
      const barberRow = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM public.barbers WHERE barbershop_id = $1 AND status = 'active' LIMIT 1`,
        [bs.id]
      );
      const barber = barberRow.rows[0];
      const svcRow = await pool.query<{ name: string }>(
        `SELECT DISTINCT COALESCE(aps.service_name, s.name) AS name
         FROM public.appointment_services aps
         LEFT JOIN public.services s ON s.id = aps.service_id
         JOIN public.appointments a ON a.id = aps.appointment_id
         WHERE a.barbershop_id = $1 AND a.client_id = $2
           AND (aps.service_name IS NOT NULL OR s.name IS NOT NULL)
         LIMIT 3`,
        [bs.id, clientId]
      );
      const serviceNames = svcRow.rows.map(r => r.name);

      // --- Test: appointment_created ---
      console.log(`\n  [hook] appointment_created`);
      await updateClientMemoryFromAppointmentEvent({
        eventType: "appointment_created",
        barbershopId: bs.id,
        clientId,
        barberId: barber?.id,
        serviceNames,
      });
      const afterCreated = await getClientMemory(bs.id, client.phone);
      console.log(`    preferred_services: ${JSON.stringify(afterCreated?.preferred_services)}`);
      console.log(`    preferred_services_conf: ${afterCreated?.preferred_services_conf}`);
      console.log(`    preferred_barber_conf: ${afterCreated?.preferred_barber_conf}`);
      console.log(`    overall_confidence: ${afterCreated?.overall_confidence}`);

      // --- Test: appointment_completed ---
      console.log(`\n  [hook] appointment_completed`);
      await updateClientMemoryFromAppointmentEvent({
        eventType: "appointment_completed",
        barbershopId: bs.id,
        clientId,
        barberId: barber?.id,
        serviceNames,
        date: "14:30", // afternoon schedule
      });
      const afterCompleted = await getClientMemory(bs.id, client.phone);
      console.log(`    last_completed_services: ${JSON.stringify(afterCompleted?.last_completed_services)}`);
      console.log(`    preferred_services_conf: ${afterCompleted?.preferred_services_conf}`);
      console.log(`    preferred_barber_conf: ${afterCompleted?.preferred_barber_conf}`);
      console.log(`    reactivation_status: ${afterCompleted?.reactivation_status}`);
      console.log(`    preferred_time_start: ${afterCompleted?.preferred_time_start}`);
      console.log(`    overall_confidence: ${afterCompleted?.overall_confidence}`);

      // --- Test: appointment_no_show ---
      console.log(`\n  [hook] appointment_no_show`);
      const nsCountBefore = afterCompleted?.no_show_count ?? 0;
      await updateClientMemoryFromAppointmentEvent({
        eventType: "appointment_no_show",
        barbershopId: bs.id,
        clientId,
      });
      const afterNoShow = await getClientMemory(bs.id, client.phone);
      console.log(`    no_show_count: ${nsCountBefore} → ${afterNoShow?.no_show_count}`);
      console.log(`    last_no_show_at: ${afterNoShow?.last_no_show_at ? "set" : "null"}`);
      console.log(`    overall_confidence: ${afterNoShow?.overall_confidence}`);
      console.log(`    reactivation_status: ${afterNoShow?.reactivation_status}`);

      // --- Test: appointment_cancelled ---
      console.log(`\n  [hook] appointment_cancelled`);
      await updateClientMemoryFromAppointmentEvent({
        eventType: "appointment_cancelled",
        barbershopId: bs.id,
        clientId,
      });
      const afterCancelled = await getClientMemory(bs.id, client.phone);
      console.log(`    reactivation_status: ${afterCancelled?.reactivation_status}`);

      // --- Test: reinforceMemoryFromHistory ---
      console.log(`\n  [history reinforcement]`);
      await reinforceMemoryFromHistory(bs.id, clientId);
      const afterReinforce = await getClientMemory(bs.id, client.phone);
      console.log(`    preferred_services: ${JSON.stringify(afterReinforce?.preferred_services)}`);
      console.log(`    preferred_services_conf: ${afterReinforce?.preferred_services_conf}`);
      console.log(`    preferred_barber_conf: ${afterReinforce?.preferred_barber_conf}`);
      console.log(`    preferred_days: ${JSON.stringify(afterReinforce?.preferred_days)}`);
      console.log(`    preferred_time_start: ${afterReinforce?.preferred_time_start}`);
      console.log(`    overall_confidence: ${afterReinforce?.overall_confidence}`);

      // =========================================================
      // FASE 3: Real client sample
      // =========================================================
      console.log("\n" + SEP);
      console.log("[FASE 3] Real client sample");

      // Fetch a diverse sample of clients
      const sampleResult = await pool.query<{
        client_id: string;
        client_name: string;
        client_phone: string;
        appt_count: number;
        completed_count: number;
        no_show_count_real: number;
        cancelled_count: number;
        distinct_barbers: number;
        distinct_service_combos: number;
        last_date: string;
      }>(
        `SELECT
           c.id AS client_id,
           c.name AS client_name,
           c.phone AS client_phone,
           COUNT(a.id)::int AS appt_count,
           COUNT(a.id) FILTER (WHERE a.status = 'completed')::int AS completed_count,
           COUNT(a.id) FILTER (WHERE a.status = 'no_show')::int AS no_show_count_real,
           COUNT(a.id) FILTER (WHERE a.status = 'cancelled')::int AS cancelled_count,
           COUNT(DISTINCT a.barber_id)::int AS distinct_barbers,
           COUNT(DISTINCT (
             SELECT string_agg(COALESCE(aps.service_name, s.name), ',' ORDER BY aps.position)
             FROM public.appointment_services aps
             LEFT JOIN public.services s ON s.id = aps.service_id
             WHERE aps.appointment_id = a.id
           ))::int AS distinct_service_combos,
           MAX(a.scheduled_date)::text AS last_date
         FROM public.clients c
         JOIN public.appointments a ON a.client_id = c.id AND a.barbershop_id = $1
         GROUP BY c.id, c.name, c.phone
         HAVING COUNT(a.id) >= 1
         ORDER BY COUNT(a.id) DESC
         LIMIT 12`,
        [bs.id]
      );

      console.log(`\n  Clients found: ${sampleResult.rows.length}\n`);

      // Categorize into profiles
      type ClientProfile = "new" | "recurring_stable" | "recurring_inconsistent" | "no_show_history"
        | "alternates_barber" | "alternates_service" | "low_evidence" | "unclear";

      function classifyClient(row: typeof sampleResult.rows[0]): ClientProfile {
        if (row.appt_count === 1) return "new";
        if (row.no_show_count_real >= 1) return "no_show_history";
        if (row.distinct_barbers >= 3) return "alternates_barber";
        if (row.distinct_service_combos >= 3) return "alternates_service";
        if (row.completed_count >= 3 && row.distinct_barbers === 1 && row.distinct_service_combos === 1) return "recurring_stable";
        if (row.completed_count >= 2) return "recurring_inconsistent";
        return "low_evidence";
      }

      const profiles = new Map<ClientProfile, boolean>();
      const sampleReport: Array<{
        profile: string;
        phone_suffix: string;
        appts: number;
        completed: number;
        no_shows: number;
        cancelled: number;
        barbers: number;
        service_combos: number;
        last_date: string;
        memory_conf: number | null;
        memory_services: string[];
        memory_barber: string | null;
        memory_time: string | null;
        memory_days: number[];
        comm_style: string;
        block_length: number;
        block_preview: string;
        quality: string;
        risk: string;
      }> = [];

      for (const row of sampleResult.rows) {
        const profile = classifyClient(row);
        // Only take first of each profile type for diversity
        if (profiles.get(profile)) continue;
        profiles.set(profile, true);

        const mem = await getClientMemory(bs.id, row.client_phone);
        const block = buildClientMemoryPromptBlock(mem);

        // Quality heuristic
        let quality = "neutral";
        if (block && mem && mem.overall_confidence >= 0.6) quality = "useful";
        else if (!block) quality = "no memory yet";
        else if (block && mem && mem.overall_confidence < 0.5) quality = "below threshold (not injected)";

        // Risk heuristic
        let risk = "low";
        if (mem && mem.preferred_services_conf >= 0.8 && row.completed_count < 2) risk = "HIGH: strong conf with little history";
        else if (mem && mem.no_show_count > 0 && block.includes("costuma fazer")) risk = "medium: no-show client shown strong preference";
        else if (mem && mem.preferred_days.length > 0 && row.appt_count <= 2) risk = "medium: days inferred from very few appointments";

        sampleReport.push({
          profile,
          phone_suffix: "****" + row.client_phone.slice(-4),
          appts: row.appt_count,
          completed: row.completed_count,
          no_shows: row.no_show_count_real,
          cancelled: row.cancelled_count,
          barbers: row.distinct_barbers,
          service_combos: row.distinct_service_combos,
          last_date: row.last_date,
          memory_conf: mem?.overall_confidence ?? null,
          memory_services: mem?.preferred_services ?? [],
          memory_barber: mem?.preferred_barber_name ?? null,
          memory_time: mem?.preferred_time_start ?? null,
          memory_days: mem?.preferred_days ?? [],
          comm_style: mem?.communication_style ?? "unknown",
          block_length: block.length,
          block_preview: block ? block.split("\n").slice(0, 5).join(" | ") : "(empty — no memory injected)",
          quality,
          risk,
        });
      }

      console.log("  Client sample (anonimized):\n");
      for (const r of sampleReport) {
        console.log(`  Profile: ${r.profile} | Phone: ${r.phone_suffix}`);
        console.log(`    Appts: ${r.appts} | Completed: ${r.completed} | No-shows: ${r.no_shows} | Cancelled: ${r.cancelled}`);
        console.log(`    Barbers: ${r.barbers} | Service combos: ${r.service_combos} | Last: ${r.last_date}`);
        console.log(`    Memory conf: ${r.memory_conf ?? "n/a"} | Services: ${JSON.stringify(r.memory_services)} | Barber: ${r.memory_barber ?? "—"}`);
        console.log(`    Time: ${r.memory_time ?? "—"} | Days: ${JSON.stringify(r.memory_days)} | Comm: ${r.comm_style}`);
        console.log(`    Block (${r.block_length} chars): ${r.block_preview}`);
        console.log(`    Quality: ${r.quality} | Risk: ${r.risk}`);
        console.log("");
      }

      // =========================================================
      // FASE 4: Prompt block inspection
      // =========================================================
      console.log(SEP);
      console.log("[FASE 4] Full prompt block examples\n");

      let blockCount = 0;
      for (const r of sampleReport) {
        if (r.block_length > 0 && blockCount < 3) {
          const mem = await getClientMemory(bs.id,
            sampleResult.rows.find(x => "****" + x.client_phone.slice(-4) === r.phone_suffix)?.client_phone ?? ""
          );
          const fullBlock = buildClientMemoryPromptBlock(mem);
          if (fullBlock) {
            console.log(`  --- ${r.profile} (conf=${r.memory_conf}) ---`);
            console.log(fullBlock.split("\n").map(l => "    " + l).join("\n"));
            console.log("");
            blockCount++;
          }
        }
      }
      if (blockCount === 0) {
        console.log("  No memory records with conf >= 0.5 found yet. This is expected on fresh installation.");
        // Show a low-conf example
        const lowConf = sampleReport.find(r => r.memory_conf !== null && r.memory_conf > 0);
        if (lowConf) {
          const rawClient = sampleResult.rows.find(x => "****" + x.client_phone.slice(-4) === lowConf.phone_suffix);
          if (rawClient) {
            const mem = await getClientMemory(bs.id, rawClient.client_phone);
            const fullBlock = buildClientMemoryPromptBlock(mem, { minConfidence: 0.0, minFieldConfidence: 0.0 });
            console.log(`  --- ${lowConf.profile} (conf=${lowConf.memory_conf}, ignoring threshold for inspection) ---`);
            console.log(fullBlock.split("\n").map(l => "    " + l).join("\n"));
          }
        }
      }
    }
  }

  // =========================================================
  // Summary stats
  // =========================================================
  console.log("\n" + SEP);
  console.log("[SUMMARY] Memory table stats");

  const stats = await pool.query<{
    total: number;
    with_services: number;
    with_barber: number;
    with_time: number;
    with_days: number;
    high_conf: number;
    avg_conf: number;
    payment_pending: number;
    no_show_clients: number;
    active_reactivation: number;
  }>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE preferred_services_conf > 0)::int AS with_services,
       COUNT(*) FILTER (WHERE preferred_barber_conf > 0)::int AS with_barber,
       COUNT(*) FILTER (WHERE preferred_time_conf > 0)::int AS with_time,
       COUNT(*) FILTER (WHERE preferred_days_conf > 0)::int AS with_days,
       COUNT(*) FILTER (WHERE overall_confidence >= 0.5)::int AS high_conf,
       ROUND(AVG(overall_confidence)::numeric, 3)::float AS avg_conf,
       COUNT(*) FILTER (WHERE payment_pending = true)::int AS payment_pending,
       COUNT(*) FILTER (WHERE no_show_count > 0)::int AS no_show_clients,
       COUNT(*) FILTER (WHERE reactivation_status = 'active')::int AS active_reactivation
     FROM public.client_ai_memory`
  );
  const s = stats.rows[0];
  console.log(`  Total records: ${s?.total ?? 0}`);
  console.log(`  With services pref: ${s?.with_services ?? 0}`);
  console.log(`  With barber pref: ${s?.with_barber ?? 0}`);
  console.log(`  With time pref: ${s?.with_time ?? 0}`);
  console.log(`  With days pref: ${s?.with_days ?? 0}`);
  console.log(`  High confidence (>=0.5): ${s?.high_conf ?? 0}`);
  console.log(`  Avg confidence: ${s?.avg_conf ?? 0}`);
  console.log(`  Payment pending: ${s?.payment_pending ?? 0}`);
  console.log(`  No-show history: ${s?.no_show_clients ?? 0}`);
  console.log(`  Active reactivation: ${s?.active_reactivation ?? 0}`);

  await pool.end();
  console.log("\n" + SEP);
  console.log("Validation complete.\n");
}

run().catch(err => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
