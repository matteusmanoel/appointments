import { runKnowledgeWorkerCycle } from "./knowledge-worker.js";

export async function handler(): Promise<{ statusCode: number; body: string }> {
  try {
    const result = await runKnowledgeWorkerCycle({ maxJobs: 2 });
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (e) {
    console.error("[lambda-knowledge] error:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal error" }),
    };
  }
}
