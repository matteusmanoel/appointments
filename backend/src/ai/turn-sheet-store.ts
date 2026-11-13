import { pool } from "../db.js";
import { buildTurnSheetRow, type TurnSheetRow } from "./turn-sheet.js";

/** Grava a ficha. Falha de insert não pode derrubar o job: o chamador ignora o erro. */
export async function persistTurnSheet(input: Record<string, unknown>): Promise<void> {
  const row = buildTurnSheetRow(input);
  if (!row) return;
  await insertTurnSheet(row);
}

export async function insertTurnSheet(row: TurnSheetRow): Promise<void> {
  await pool.query(
    `INSERT INTO public.ai_turn_sheets (
       barbershop_id, conversation_id, job_id, provider_event_id, at,
       inbound_preview, reply_preview, phone_mask, decision_owner,
       canonical_state, conversation_state, intent, routing,
       tools_requested, tools_executed, silenced_by, outbound
     )
     VALUES (
       $1, $2, $3, $4, $5::timestamptz,
       $6, $7, $8, $9,
       $10, $11, $12::jsonb, $13::jsonb,
       $14::jsonb, $15::jsonb, $16, $17::jsonb
     )
     ON CONFLICT (job_id) DO UPDATE SET
       at = EXCLUDED.at,
       inbound_preview = EXCLUDED.inbound_preview,
       reply_preview = EXCLUDED.reply_preview,
       phone_mask = EXCLUDED.phone_mask,
       decision_owner = EXCLUDED.decision_owner,
       canonical_state = EXCLUDED.canonical_state,
       conversation_state = EXCLUDED.conversation_state,
       intent = EXCLUDED.intent,
       routing = EXCLUDED.routing,
       tools_requested = EXCLUDED.tools_requested,
       tools_executed = EXCLUDED.tools_executed,
       silenced_by = EXCLUDED.silenced_by,
       outbound = EXCLUDED.outbound`,
    [
      row.barbershopId,
      row.conversationId,
      row.jobId,
      row.providerEventId,
      row.at,
      row.inboundPreview,
      row.replyPreview,
      row.phoneMask,
      row.decisionOwner,
      row.canonicalState,
      row.conversationState,
      JSON.stringify(row.intent),
      JSON.stringify(row.routing),
      JSON.stringify(row.toolsRequested),
      JSON.stringify(row.toolsExecuted),
      row.silencedBy,
      JSON.stringify(row.outbound),
    ],
  );
}
