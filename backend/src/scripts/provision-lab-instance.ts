import "../load-env.js";
/**
 * Cria a instância Evolution navalhia-lab e grava o QR para parear.
 * Não aponta a loja para ela. O agente continua no 2998 e atende qualquer conversa 1:1.
 *
 * npx tsx src/scripts/provision-lab-instance.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInstance, connectInstance, setInstanceSettings, setInstanceWebhook } from "../integrations/whatsapp/evolution-client.js";
import { LAB_EVOLUTION_INSTANCE } from "../integrations/whatsapp/inbound-allowlist.js";

function pickQrBase64(payload: unknown): string | null {
  const stack: unknown[] = [payload];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    const obj = cur as Record<string, unknown>;
    for (const key of ["base64", "qrcode", "code"]) {
      const v = obj[key];
      if (typeof v === "string" && v.length > 80) {
        const cleaned = v.replace(/^data:image\/[a-z]+;base64,/, "");
        if (/^[A-Za-z0-9+/=\s]+$/.test(cleaned.slice(0, 40))) return cleaned.replace(/\s/g, "");
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

async function main(): Promise<void> {
  const webhook =
    process.env.EVOLUTION_WEBHOOK_PUBLIC_URL || "http://api:3000/api/webhooks/evolution";
  let created: unknown = null;
  try {
    created = await createInstance(LAB_EVOLUTION_INSTANCE);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already|exists|403|409/i.test(msg)) throw e;
    console.log("Instância já existe, pedindo QR de novo");
  }
  let qr = pickQrBase64(created);
  if (!qr) {
    const connected = await connectInstance(LAB_EVOLUTION_INSTANCE);
    qr = pickQrBase64(connected);
  }
  if (!qr) throw new Error("Evolution não devolveu QR. Veja o painel da API em :8081");

  await setInstanceWebhook(LAB_EVOLUTION_INSTANCE, webhook).catch((e) => {
    console.warn("webhook:", e instanceof Error ? e.message : e);
  });
  await setInstanceSettings(LAB_EVOLUTION_INSTANCE).catch(() => {});

  const dir = path.resolve(process.cwd(), ".lab");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "navalhia-lab-qr.png");
  writeFileSync(file, Buffer.from(qr, "base64"));
  console.log("QR salvo em", file);
  console.log("Instância de teste pronta. A loja continua na sessão do 2998.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
