import { pool } from "../db.js";
import { brPhoneMatchKeys, canonicalizeBrPhoneDigits } from "../lib/phone-match.js";

/**
 * Limpa conversa WhatsApp, agendamentos e o cliente deste telefone nesta barbearia.
 * Usado pelo comando /deletar em testes ponta a ponta.
 */
export async function wipeWhatsAppTestContext(params: {
  barbershopId: string;
  phone: string;
}): Promise<{ ok: true; clients: number; appointments: number; conversations: number }> {
  const ghosts = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients
     WHERE barbershop_id = $1
       AND (
         phone IS NULL
         OR btrim(phone) = ''
         OR lower(phone) IN ('undefined', 'null')
         OR length(regexp_replace(phone, '[^0-9]', '', 'g')) < 10
       )`,
    [params.barbershopId],
  ).catch(() => ({ rows: [] as Array<{ id: string }> }));
  const ghostIds = ghosts.rows.map((r) => r.id);
  if (ghostIds.length) {
    const ghostAppts = await pool.query<{ id: string }>(
      `SELECT id FROM public.appointments WHERE client_id = ANY($1::uuid[])`,
      [ghostIds],
    ).catch(() => ({ rows: [] as Array<{ id: string }> }));
    const ghostApptIds = ghostAppts.rows.map((r) => r.id);
    if (ghostApptIds.length) {
      await pool.query(`DELETE FROM public.appointment_services WHERE appointment_id = ANY($1::uuid[])`, [ghostApptIds]).catch(() => {});
      await pool.query(`DELETE FROM public.appointments WHERE id = ANY($1::uuid[])`, [ghostApptIds]).catch(() => {});
    }
    await pool.query(`DELETE FROM public.clients WHERE id = ANY($1::uuid[])`, [ghostIds]).catch(() => {});
  }

  const canonical = canonicalizeBrPhoneDigits(params.phone) ?? params.phone.replace(/\D/g, "");
  if (!canonical) return { ok: true, clients: 0, appointments: 0, conversations: 0 };
  const keys = brPhoneMatchKeys(canonical);

  const clients = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients
     WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[])`,
    [params.barbershopId, keys],
  );
  const clientIds = clients.rows.map((r) => r.id);

  const convs = await pool.query<{ id: string }>(
    `SELECT id FROM public.ai_conversations
     WHERE barbershop_id = $1 AND channel = 'whatsapp'
       AND regexp_replace(external_thread_id, '[^0-9]', '', 'g') = ANY($2::text[])`,
    [params.barbershopId, keys],
  );
  const conversationIds = convs.rows.map((r) => r.id);

  const appts = clientIds.length
    ? await pool.query<{ id: string }>(
        `SELECT id FROM public.appointments WHERE barbershop_id = $1 AND client_id = ANY($2::uuid[])`,
        [params.barbershopId, clientIds],
      )
    : { rows: [] as Array<{ id: string }> };
  const appointmentIds = appts.rows.map((r) => r.id);

  if (appointmentIds.length) {
    await pool.query(`DELETE FROM public.appointment_services WHERE appointment_id = ANY($1::uuid[])`, [
      appointmentIds,
    ]).catch(() => {});
    await pool.query(`DELETE FROM public.scheduled_messages WHERE appointment_id = ANY($1::uuid[])`, [
      appointmentIds,
    ]).catch(() => {});
    await pool.query(`DELETE FROM public.agenda_activity WHERE appointment_id = ANY($1::uuid[])`, [
      appointmentIds,
    ]).catch(() => {});
    await pool.query(`DELETE FROM public.appointments WHERE id = ANY($1::uuid[])`, [appointmentIds]);
  }

  if (conversationIds.length) {
    await pool.query(`DELETE FROM public.ai_jobs WHERE conversation_id = ANY($1::uuid[])`, [conversationIds]).catch(
      () => {},
    );
    await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = ANY($1::uuid[])`, [conversationIds]);
    await pool.query(`DELETE FROM public.ai_handoff_events WHERE conversation_id = ANY($1::uuid[])`, [
      conversationIds,
    ]).catch(() => {});
    await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = ANY($1::uuid[])`, [
      conversationIds,
    ]).catch(() => {});
    await pool.query(`DELETE FROM public.ai_conversations WHERE id = ANY($1::uuid[])`, [conversationIds]);
  }

  await pool.query(
    `DELETE FROM public.whatsapp_inbound_events
     WHERE barbershop_id = $1 AND regexp_replace(from_phone, '[^0-9]', '', 'g') = ANY($2::text[])`,
    [params.barbershopId, keys],
  ).catch(() => {});

  if (clientIds.length) {
    await pool.query(`DELETE FROM public.service_redemptions WHERE client_id = ANY($1::uuid[])`, [clientIds]).catch(
      () => {},
    );
    await pool.query(`DELETE FROM public.reward_redemptions WHERE client_id = ANY($1::uuid[])`, [clientIds]).catch(
      () => {},
    );
    await pool.query(`DELETE FROM public.client_plan_subscriptions WHERE client_id = ANY($1::uuid[])`, [
      clientIds,
    ]).catch(() => {});
    await pool.query(`DELETE FROM public.appointment_waitlist WHERE client_id = ANY($1::uuid[])`, [clientIds]).catch(
      () => {},
    );
    await pool.query(`DELETE FROM public.client_ai_memory WHERE client_id = ANY($1::uuid[])`, [clientIds]).catch(
      () => {},
    );
    await pool.query(`DELETE FROM public.clients WHERE id = ANY($1::uuid[])`, [clientIds]);
  }

  return {
    ok: true,
    clients: clientIds.length,
    appointments: appointmentIds.length,
    conversations: conversationIds.length,
  };
}

/**
 * Apaga só os agendamentos (e dependências) dos telefones informados.
 * Preserva cliente, memória, conversas e mensagens — o aprendizado orgânico
 * dentro de um run de benchmark continua, sem herdar horários de outro cenário.
 */
export async function wipeTestAppointments(params: {
  barbershopId: string;
  phones: string[];
}): Promise<{ ok: true; appointments: number }> {
  const keys = [
    ...new Set(
      params.phones.flatMap((phone) => {
        const canonical = canonicalizeBrPhoneDigits(phone) ?? phone.replace(/\D/g, "");
        return canonical ? brPhoneMatchKeys(canonical) : [];
      }),
    ),
  ];
  if (!keys.length) return { ok: true, appointments: 0 };

  const clients = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients
     WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[])`,
    [params.barbershopId, keys],
  );
  const clientIds = clients.rows.map((r) => r.id);
  if (!clientIds.length) return { ok: true, appointments: 0 };

  const appts = await pool.query<{ id: string }>(
    `SELECT id FROM public.appointments WHERE barbershop_id = $1 AND client_id = ANY($2::uuid[])`,
    [params.barbershopId, clientIds],
  );
  const appointmentIds = appts.rows.map((r) => r.id);
  if (!appointmentIds.length) return { ok: true, appointments: 0 };

  await pool.query(`DELETE FROM public.appointment_services WHERE appointment_id = ANY($1::uuid[])`, [
    appointmentIds,
  ]).catch(() => {});
  await pool.query(`DELETE FROM public.scheduled_messages WHERE appointment_id = ANY($1::uuid[])`, [
    appointmentIds,
  ]).catch(() => {});
  await pool.query(`DELETE FROM public.agenda_activity WHERE appointment_id = ANY($1::uuid[])`, [
    appointmentIds,
  ]).catch(() => {});
  await pool.query(`DELETE FROM public.appointments WHERE id = ANY($1::uuid[])`, [appointmentIds]);

  return { ok: true, appointments: appointmentIds.length };
}
