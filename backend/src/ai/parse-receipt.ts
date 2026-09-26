export type ReceiptFacts = {
  readable: boolean;
  recipient: string | null;
  transferDate: string | null;
  amount: number | null;
};

export type ReceiptDecision =
  | { ok: true; amount: number | null; transferDate: string }
  | { ok: false; reason: "unreadable" | "mismatch" };

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Destinatário = nome da loja ou chave PIX; data = hoje, ou ontem se madrugada (< 06:00). */
export function decideReceiptAcceptance(params: {
  facts: ReceiptFacts;
  shopName: string;
  pixKey: string;
  todayIso: string;
  yesterdayIso: string;
  nowMins: number;
}): ReceiptDecision {
  if (!params.facts.readable) return { ok: false, reason: "unreadable" };
  const recipient = fold(params.facts.recipient ?? "");
  const shop = fold(params.shopName);
  const key = fold(params.pixKey);
  const keyDigits = digitsOnly(params.pixKey);
  const recDigits = digitsOnly(params.facts.recipient ?? "");
  const destOk =
    Boolean(recipient) &&
    ((shop && recipient.includes(shop)) ||
      (shop && shop.includes(recipient) && recipient.length >= 4) ||
      (key && recipient.includes(key)) ||
      (keyDigits.length >= 8 && recDigits.includes(keyDigits)));
  if (!destOk) return { ok: false, reason: "mismatch" };

  const date = params.facts.transferDate;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: "mismatch" };
  const allowYesterday = params.nowMins < 6 * 60;
  const dateOk = date === params.todayIso || (allowYesterday && date === params.yesterdayIso);
  if (!dateOk) return { ok: false, reason: "mismatch" };

  return { ok: true, amount: params.facts.amount, transferDate: date };
}

export const RECEIPT_FAIL_REPLY =
  "Recebi o comprovante. A equipe confere e te retorna se precisar de algo";
export const RECEIPT_OK_REPLY = "Recebi o comprovante, valeu";
