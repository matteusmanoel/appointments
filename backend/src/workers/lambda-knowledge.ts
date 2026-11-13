import { runKnowledgeWorkerCycle } from "./knowledge-worker.js";

// Exportado só para o `verify:knowledge-zip` exercitar o caminho real de leitura de PDF dentro do zip.
export { extractTextFromBuffer } from "./knowledge-worker.js";

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
