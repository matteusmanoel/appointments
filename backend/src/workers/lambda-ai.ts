import { runAiWorkerCycle } from "./ai-worker.js";
import { pool } from "../db.js";

export async function handler(): Promise<{ statusCode: number; body: string }> {
  try {
    const result = await runAiWorkerCycle({ maxJobs: 10 });
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (e) {
    console.error("[lambda-ai] error:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal error" }),
    };
  }
}
