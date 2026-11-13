import { pool } from "../../../src/db.js";
import { brPhoneMatchKeys, canonicalizeBrPhoneDigits } from "../../../src/lib/phone-match.js";

/** Telefone só dos bloqueios de agenda (não é o cliente do harness). Limpo entre cenários. */
export const HARNESS_BLOCKER_PHONE = "5500000000099";

async function ensureClient(barbershopId: string, phone: string, name: string): Promise<string> {
  const canonical = canonicalizeBrPhoneDigits(phone) ?? phone.replace(/\D/g, "");
  const keys = brPhoneMatchKeys(canonical);
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients
     WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[])
     LIMIT 1`,
    [barbershopId, keys],
  );
  if (existing.rows[0]) {
    await pool.query(
      `UPDATE public.clients SET name = $2, name_confirmed = true, updated_at = now() WHERE id = $1`,
      [existing.rows[0].id, name],
    );
    return existing.rows[0].id;
  }
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (barbershop_id, phone) DO UPDATE SET name = EXCLUDED.name, name_confirmed = true, updated_at = now()
     RETURNING id`,
    [barbershopId, name, canonical],
  );
  return inserted.rows[0].id;
}

async function pickService(
  barbershopId: string,
  serviceNameIncludes?: string,
): Promise<{ id: string; name: string; price: number; duration_minutes: number }> {
  const r = await pool.query<{ id: string; name: string; price: string; duration_minutes: number }>(
    `SELECT id, name, price::text, duration_minutes
     FROM public.services
     WHERE barbershop_id = $1 AND is_active = true
     ORDER BY name`,
    [barbershopId],
  );
  const needle = (serviceNameIncludes ?? "").toLowerCase();
  const row =
    (needle ? r.rows.find((s) => s.name.toLowerCase().includes(needle)) : undefined) ?? r.rows[0];
  if (!row) throw new Error("seed-appointment: nenhum serviço ativo");
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    duration_minutes: Number(row.duration_minutes) || 30,
  };
}

async function insertAppointment(params: {
  barbershopId: string;
  clientId: string;
  barberId: string;
  service: { id: string; name: string; price: number; duration_minutes: number };
  offsetDays: number;
  time: string;
  /** ISO do relógio do cenário. Sem isso, o dia parte do relógio real. */
  anchorIso?: string;
}): Promise<{ id: string; date: string }> {
  const date = await pool.query<{ d: string }>(
    `SELECT (
       COALESCE(
         (timezone('America/Sao_Paulo', $2::timestamptz))::date,
         (timezone('America/Sao_Paulo', now()))::date
       ) + $1::int
     )::text AS d`,
    [params.offsetDays, params.anchorIso ?? null],
  );
  const price = Number.isFinite(params.service.price) ? params.service.price : 0;
  const app = await pool.query<{ id: string }>(
    `INSERT INTO public.appointments (
       barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time,
       duration_minutes, price, commission_amount, status
     )
     VALUES ($1, $2, $3, $4, $5::date, $6::time, $7, $8, 0, 'pending')
     RETURNING id`,
    [
      params.barbershopId,
      params.clientId,
      params.barberId,
      params.service.id,
      date.rows[0].d,
      params.time,
      params.service.duration_minutes,
      price,
    ],
  );
  await pool.query(
    `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
     VALUES ($1, $2, $3, $4, $5, 0)`,
    [app.rows[0].id, params.service.id, price, params.service.duration_minutes, params.service.name],
  );
  return { id: app.rows[0].id, date: date.rows[0].d };
}

/** Horário base do cliente do harness, para cenários de reagendar/cancelar/RSVP. */
export async function seedHarnessAppointment(params: {
  barbershopId: string;
  clientPhone: string;
  offsetDays?: number;
  time?: string;
  serviceNameIncludes?: string;
  /** Substring do nome do barbeiro. Sem isso, usa o primeiro ativo em ordem alfabética. */
  barberNameIncludes?: string;
  clientName?: string;
  /** RSVP de lembrete só confirma se já existe agenda_activity reminder_sent. */
  markReminderSent?: boolean;
  /** Quando o cenário fixa o relógio, o offset conta a partir desse dia. */
  simulatedNow?: string;
}): Promise<void> {
  const clientId = await ensureClient(params.barbershopId, params.clientPhone, params.clientName ?? "Cliente");
  const service = await pickService(params.barbershopId, params.serviceNameIncludes);
  const barber = await pool.query<{ id: string }>(
    `SELECT id FROM public.barbers
     WHERE barbershop_id = $1 AND status IN ('active', 'break')
       AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%')
     ORDER BY name
     LIMIT 1`,
    [params.barbershopId, params.barberNameIncludes ?? null],
  );
  if (!barber.rows[0]) throw new Error("seed-appointment: nenhum barbeiro ativo");
  const created = await insertAppointment({
    barbershopId: params.barbershopId,
    clientId,
    barberId: barber.rows[0].id,
    service,
    offsetDays: params.offsetDays ?? 1,
    time: params.time ?? "14:00",
    anchorIso: params.simulatedNow,
  });
  if (params.markReminderSent) {
    await pool.query(
      `INSERT INTO public.agenda_activity (
         barbershop_id, appointment_id, type, actor, client_phone, scheduled_date, scheduled_time, summary
       )
       VALUES ($1, $2, 'reminder_sent', 'system', $3, $4::date, $5::time, $6)`,
      [
        params.barbershopId,
        created.id,
        params.clientPhone,
        created.date,
        params.time ?? "14:00",
        "Lembrete de benchmark",
      ],
    );
  }
}

/** Retorna o id de um serviço pelo nome (para uso em seeds de fila). */
export async function pickServiceId(barbershopId: string, serviceNameIncludes: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM public.services
     WHERE barbershop_id = $1 AND is_active = true
       AND name ILIKE '%' || $2 || '%'
     ORDER BY name LIMIT 1`,
    [barbershopId, serviceNameIncludes],
  );
  if (!r.rows[0]) throw new Error(`seed: serviço '${serviceNameIncludes}' não encontrado`);
  return r.rows[0].id;
}

/**
 * Insere entrada ativa na fila de espera para o clientPhone informado.
 * Retorna o id da linha criada.
 */
export async function seedWaitlistEntry(params: {
  barbershopId: string;
  clientPhone: string;
  clientName?: string;
  offsetDays: number;
  time: string;
  serviceNameIncludes: string;
  barberNameIncludes?: string;
  simulatedNow?: string;
  /** Se true, a entrada já vem com status 'notified' (dispatch já ocorreu). */
  alreadyNotified?: boolean;
}): Promise<string> {
  const date = await pool.query<{ d: string }>(
    `SELECT (
       COALESCE(
         (timezone('America/Sao_Paulo', $2::timestamptz))::date,
         (timezone('America/Sao_Paulo', now()))::date
       ) + $1::int
     )::text AS d`,
    [params.offsetDays, params.simulatedNow ?? null],
  );
  const dateStr = date.rows[0].d;
  const serviceId = await pickServiceId(params.barbershopId, params.serviceNameIncludes);
  const barber = await pool.query<{ id: string }>(
    `SELECT id FROM public.barbers
     WHERE barbershop_id = $1 AND status IN ('active', 'break')
       AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%')
     ORDER BY name LIMIT 1`,
    [params.barbershopId, params.barberNameIncludes ?? null],
  );
  const barberId = barber.rows[0]?.id ?? null;
  const phone = params.clientPhone.replace(/\D/g, "");
  const status = params.alreadyNotified ? "notified" : "active";
  const r = await pool.query<{ id: string }>(
    `INSERT INTO public.appointment_waitlist
       (barbershop_id, client_phone, client_name, desired_date, desired_time,
        service_id, barber_id, source, status, updated_at)
     VALUES ($1, $2, $3, $4::date, $5::time, $6, $7, 'ai', $8, now())
     RETURNING id`,
    [params.barbershopId, phone, params.clientName ?? null, dateStr, params.time,
     serviceId, barberId, status],
  );
  return r.rows[0].id;
}

/**
 * Cancela todos os appointments do telefone de bloqueio no horário indicado
 * e dispara `recordAgendaChange` para acionar a fila de espera.
 * Usado no setup do cenário g21.
 */
export async function cancelBlockerAndDispatch(params: {
  barbershopId: string;
  offsetDays: number;
  time: string;
  simulatedNow?: string;
}): Promise<void> {
  const dateRow = await pool.query<{ d: string }>(
    `SELECT (
       COALESCE(
         (timezone('America/Sao_Paulo', $2::timestamptz))::date,
         (timezone('America/Sao_Paulo', now()))::date
       ) + $1::int
     )::text AS d`,
    [params.offsetDays, params.simulatedNow ?? null],
  );
  const dateStr = dateRow.rows[0].d;
  // Busca os appointments de bloqueio nesse slot
  const blockers = await pool.query<{ id: string }>(
    `SELECT a.id FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.barbershop_id = $1
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = $2
       AND a.scheduled_date = $3::date
       AND a.scheduled_time = $4::time
       AND a.status NOT IN ('cancelled')`,
    [params.barbershopId, HARNESS_BLOCKER_PHONE, dateStr, params.time],
  );
  const { recordAgendaChangeFromAppointment } = await import("../../../src/agenda/record-agenda-change.js");
  for (const row of blockers.rows) {
    await pool.query(
      `UPDATE public.appointments SET status = 'cancelled', updated_at = now() WHERE id = $1`,
      [row.id],
    );
    // Dispara política de fila — o send WhatsApp vai falhar no sandbox (400) mas registra agenda_activity
    await recordAgendaChangeFromAppointment({
      barbershopId: params.barbershopId,
      appointmentId: row.id,
      type: "cancelled",
      actor: "system",
    }).catch(() => {}); // ignora falha de envio
  }
}

/** Seed de assinatura de plano com cobrança atrasada para testar cenários de plano/PIX. */
export async function seedPlanSubscription(params: {
  barbershopId: string;
  clientPhone: string;
  clientName?: string;
  planNameIncludes: string;
  simulatedNow?: string;
}): Promise<void> {
  const clientId = await ensureClient(params.barbershopId, params.clientPhone, params.clientName ?? "Cliente");
  const plan = await pool.query<{ id: string; price: string }>(
    `SELECT id, price::text FROM public.barbershop_plans
     WHERE barbershop_id = $1 AND name ILIKE '%' || $2 || '%' AND is_active = true
     ORDER BY name LIMIT 1`,
    [params.barbershopId, params.planNameIncludes],
  );
  if (!plan.rows[0]) {
    // Sem plano cadastrado — seed silencioso (o agente dirá que não existe)
    return;
  }
  const planRow = plan.rows[0];
  // Data de vencimento: dia 1 do mês anterior (já vencido)
  const anchorDate = params.simulatedNow
    ? new Date(params.simulatedNow)
    : new Date();
  const dueDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1);
  const dueDateStr = dueDate.toISOString().slice(0, 10);
  const nextBillingStr = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const sub = await pool.query<{ id: string }>(
    `INSERT INTO public.client_plan_subscriptions
       (barbershop_id, client_id, plan_id, billing_day, next_billing_date)
     VALUES ($1, $2, $3, 1, $4::date)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [params.barbershopId, clientId, planRow.id, nextBillingStr],
  );
  if (!sub.rows[0]) return; // já existia
  await pool.query(
    `INSERT INTO public.plan_pix_charges
       (subscription_id, barbershop_id, amount, due_date, status)
     VALUES ($1, $2, $3::numeric, $4::date, 'pending')`,
    [sub.rows[0].id, params.barbershopId, planRow.price, dueDateStr],
  );
}

/** Ocupa o mesmo horário em todos os barbeiros, para forçar indisponibilidade real. */
export async function seedSlotBlockers(params: {
  barbershopId: string;
  offsetDays: number;
  time: string;
  /** Se informado, ocupa só esse barbeiro. Senão, ocupa todos. */
  barberNameIncludes?: string;
  /** Quando o cenário fixa o relógio, o offset conta a partir desse dia. */
  simulatedNow?: string;
  clientPhone?: string;
}): Promise<void> {
  const clientId = await ensureClient(params.barbershopId, HARNESS_BLOCKER_PHONE, "Bloqueio Benchmark");
  const service = await pickService(params.barbershopId);
  const barbers = await pool.query<{ id: string }>(
    `SELECT id FROM public.barbers
     WHERE barbershop_id = $1 AND status IN ('active', 'break')
       AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%')
     ORDER BY name`,
    [params.barbershopId, params.barberNameIncludes ?? null],
  );
  for (const barber of barbers.rows) {
    await insertAppointment({
      barbershopId: params.barbershopId,
      clientId,
      barberId: barber.id,
      service,
      offsetDays: params.offsetDays,
      time: params.time,
      anchorIso: params.simulatedNow,
    });
  }
}
