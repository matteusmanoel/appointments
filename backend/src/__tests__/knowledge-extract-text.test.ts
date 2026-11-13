import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test"; // não inicia o loop de polling do worker ao importar
  process.env.DATABASE_URL ??= "postgres://x:x@127.0.0.1:1/x";
  process.env.JWT_SECRET ??= "teste";
});

import { extractTextFromBuffer } from "../workers/knowledge-worker.js";

function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 20 50 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

describe("extractTextFromBuffer (knowledge-worker)", () => {
  it("lê um PDF real com a API PDFParse do pdf-parse 2.x (regressão: 'pdfParse is not a function')", async () => {
    const text = await extractTextFromBuffer(minimalPdf("Ola NavalhIA conhecimento"), "application/pdf", "a.pdf");
    expect(text).toContain("NavalhIA");
  });

  it("texto simples continua sendo lido como UTF-8", async () => {
    expect(await extractTextFromBuffer(Buffer.from("olá mundo"), "text/plain", "a.txt")).toBe("olá mundo");
  });
});
