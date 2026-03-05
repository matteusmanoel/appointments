import { runScheduledMessagesCycle } from "./scheduled-messages-worker.js";
import { pool } from "../db.js";

export async function handler(): Promise<{ statusCode: number; body: string }> {
  try {
    const result = await runScheduledMessagesCycle({ maxBatches: 20 });
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (e) {
    console.error("[lambda-scheduled] error:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal error" }),
    };
  }
}
