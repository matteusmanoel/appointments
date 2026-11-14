import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });

// Cores e identidade visual (branding.md): #0B0B0B, #7A0C18 (CTA), #FFFFFF, #8C8C8C
const BRAND = {
  bgOuter: "#0B0B0B",
  bgCard: "#1a1a1a",
  text: "#FFFFFF",
  textMuted: "#b3b3b3",
  cta: "#7A0C18",
  ctaHover: "#9a1020",
  border: "#2d2d2d",
};

function ensureNoTrailingSlash(url: string): string {
  return (url || "").replace(/\/$/, "");
}

/**
 * Layout HTML dos e-mails: card centralizado, logo, botão CTA, tipografia maior.
 * Imagens usam baseUrl (ex.: app.navalhia.com.br) para carregar assets de /public.
 */
function buildEmailLayout(opts: {
  baseUrl: string;
  title: string;
  bodyHtml: string;
  buttonText: string;
  buttonUrl: string;
  footerHtml?: string;
}): string {
  const base = ensureNoTrailingSlash(opts.baseUrl);
  const logoUrl = `${base}/logo-named-white.png`;

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(opts.title)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:${BRAND.bgOuter}; font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.bgOuter}; min-height:100vh;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background-color:${BRAND.bgCard}; border-radius: 12px; border: 1px solid ${BRAND.border}; box-shadow: 0 4px 24px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 32px 32px 24px 32px; text-align: center; border-bottom: 1px solid ${BRAND.border};">
              <img src="${logoUrl}" alt="NavalhIA" width="180" height="48" style="display: inline-block; max-width: 180px; height: auto;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px 24px 32px;">
              <h1 style="margin: 0 0 20px 0; font-size: 22px; font-weight: 700; color: ${BRAND.text}; line-height: 1.3;">
                ${opts.title}
              </h1>
              <div style="font-size: 16px; line-height: 1.6; color: ${BRAND.textMuted};">
                ${opts.bodyHtml}
              </div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 28px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(opts.buttonUrl)}" target="_blank" rel="noopener noreferrer"
                       style="display: inline-block; padding: 14px 32px; background-color: ${BRAND.cta}; color: ${BRAND.text}; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                      ${escapeHtml(opts.buttonText)}
                    </a>
                  </td>
                </tr>
              </table>
              ${opts.footerHtml ? `<div style="margin-top: 24px; font-size: 13px; color: ${BRAND.textMuted}; line-height: 1.5;">${opts.footerHtml}</div>` : ""}
            </td>
          </tr>
        </table>
        <p style="margin: 20px 0 0 0; font-size: 12px; color: ${BRAND.textMuted};">
          Agende. Automatize. Cresça. — NavalhIA
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type AiUsageAlertKind = "threshold" | "limit" | "hard_cap";

export type AiUsageAlertEmailParams = {
  to: string;
  barbershopName: string;
  appUrl: string;
  used: number;
  limit: number;
  thresholdPct: number;
  /** threshold = aviso em X% (padrão 80); limit = 100% do plano; hard_cap = teto (2x o limite), IA parada. Padrão: threshold. */
  kind?: AiUsageAlertKind;
};

export type AiUsageAlertTexts = { subject: string; title: string; paragraphs: string[] };

/**
 * Texto do aviso de uso da IA (puro, testável). Usa a margem real do plano: o teto é 2x o limite
 * (usage-limits.ts); no teto a IA para de responder e o agente fica em silêncio com o cliente.
 */
export function buildAiUsageAlertTexts(params: Pick<AiUsageAlertEmailParams, "barbershopName" | "used" | "limit" | "thresholdPct" | "kind">): AiUsageAlertTexts {
  const kind = params.kind ?? "threshold";
  const cap = params.limit * 2;
  const toLimit = Math.max(0, params.limit - params.used);
  const toCap = Math.max(0, cap - params.used);
  const name = params.barbershopName;
  const capWarning = `No teto (${cap} respostas no mês) a IA para de responder: o atendimento automático fica em silêncio com o cliente até o próximo ciclo ou até ampliar o plano. Responda manualmente as conversas.`;
  if (kind === "hard_cap") {
    return {
      subject: "A IA parou de responder: teto de uso atingido - NavalhIA",
      title: "Teto de uso da IA atingido",
      paragraphs: [
        `As respostas de IA de ${name} neste mês chegaram ao teto de ${cap} (${params.used} de ${cap}; o limite do plano é ${params.limit}).`,
        "A IA parou de responder. O atendimento automático fica em silêncio com o cliente até o próximo ciclo. Responda manualmente as conversas.",
        "O atendimento automático volta no próximo mês. Para voltar antes, amplie o plano.",
      ],
    };
  }
  if (kind === "limit") {
    return {
      subject: "Uso da IA em 100% do limite do plano - NavalhIA",
      title: "Limite do plano atingido",
      paragraphs: [
        `As respostas de IA de ${name} neste mês chegaram a 100% do limite do plano (${params.used} de ${params.limit}).`,
        `A IA continua respondendo por mais ${toCap} respostas, até o teto de ${cap}. ${capWarning}`,
        "Para ampliar o limite, veja os planos.",
      ],
    };
  }
  return {
    subject: `Uso da IA em ${params.thresholdPct}% do limite - NavalhIA`,
    title: "Uso da IA no limite",
    paragraphs: [
      `As respostas de IA de ${name} neste mês chegaram a ${params.thresholdPct}% do limite do plano (${params.used} de ${params.limit}).`,
      `Faltam ${toLimit} respostas para o limite do plano; depois dele a IA ainda responde por mais ${params.limit} de margem, até o teto de ${cap}. ${capWarning}`,
      "Para ampliar o limite, veja os planos.",
    ],
  };
}

/** Aviso ao dono sobre o uso mensal da IA (80%, 100% e teto). Só é enviado com AI_USAGE_OWNER_EMAIL_ENABLED=true (ver ai/usage-alert.ts). */
export async function sendAiUsageAlertEmail(params: AiUsageAlertEmailParams): Promise<void> {
  const from = process.env.FROM_EMAIL;
  // Lança (não retorna em silêncio): o aviso do mês só é consumido quando o envio de fato ocorreu.
  if (!from) throw new Error("FROM_EMAIL ausente: aviso de uso da IA não enviado");
  const settingsUrl = `${ensureNoTrailingSlash(params.appUrl)}/app/configuracoes`;
  const t = buildAiUsageAlertTexts(params);
  const textBody = `Olá,\n\n${t.paragraphs.join("\n\n")}\n\nPlanos: ${settingsUrl}`;
  const htmlBody = buildEmailLayout({
    baseUrl: params.appUrl,
    title: t.title,
    bodyHtml: [`<p style="margin: 0 0 12px 0;">Olá,</p>`, ...t.paragraphs.map((p) => `<p style="margin: 0 0 16px 0;">${escapeHtml(p)}</p>`)].join("\n    "),
    buttonText: "Ver planos",
    buttonUrl: settingsUrl,
  });
  await ses.send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [params.to] },
      Message: {
        Subject: { Data: t.subject },
        Body: { Text: { Data: textBody }, Html: { Data: htmlBody } },
      },
    }),
  );
}

export type OnboardingEmailParams = {
  to: string;
  barbershopName: string;
  appUrl: string;
  tempPassword: string;
  apiKey: string;
};

export async function sendOnboardingEmail(params: OnboardingEmailParams): Promise<void> {
  const from = process.env.FROM_EMAIL;
  if (!from) {
    console.warn("[SES] FROM_EMAIL not set; skipping onboarding email");
    return;
  }
  const baseUrl = ensureNoTrailingSlash(params.appUrl);
  const panelUrl = baseUrl;

  const textBody = `
Olá,

Sua conta na NavalhIA ${params.barbershopName} foi criada.

Acesse o painel: ${panelUrl}
Email: ${params.to}
Senha temporária: ${params.tempPassword}

Altere sua senha no primeiro acesso (Configurações ou ao logar).

Para integrar com n8n/WhatsApp, use esta API Key no header X-API-Key:
${params.apiKey}

Guarde esta chave em local seguro; ela não será exibida novamente no painel.
`.trim();

  const bodyHtml = `
    <p style="margin: 0 0 12px 0;">Olá,</p>
    <p style="margin: 0 0 16px 0;">Sua conta na NavalhIA <strong style="color: ${BRAND.text};">${escapeHtml(params.barbershopName)}</strong> foi criada.</p>
    <p style="margin: 0 0 8px 0;"><strong style="color: ${BRAND.text};">Email:</strong> ${escapeHtml(params.to)}</p>
    <p style="margin: 0 0 16px 0;"><strong style="color: ${BRAND.text};">Senha temporária:</strong> <code style="background: ${BRAND.border}; padding: 4px 8px; border-radius: 4px; font-size: 15px;">${escapeHtml(params.tempPassword)}</code></p>
    <p style="margin: 0 0 16px 0;">Altere sua senha no primeiro acesso (Configurações ou ao logar).</p>
    <p style="margin: 0 0 8px 0;"><strong style="color: ${BRAND.text};">Integração n8n/WhatsApp</strong></p>
    <p style="margin: 0 0 8px 0;">Use esta API Key no header <code style="background: ${BRAND.border}; padding: 2px 6px; border-radius: 4px;">X-API-Key</code>:</p>
    <p style="margin: 0 0 0 0; word-break: break-all; font-size: 14px;"><code style="background: ${BRAND.border}; padding: 8px 12px; border-radius: 4px; display: inline-block;">${escapeHtml(params.apiKey)}</code></p>
    <p style="margin: 12px 0 0 0;">Guarde esta chave em local seguro; ela não será exibida novamente no painel.</p>
  `.trim();

  const htmlBody = buildEmailLayout({
    baseUrl: params.appUrl,
    title: `Sua conta ${params.barbershopName} está pronta`,
    bodyHtml,
    buttonText: "Acessar painel",
    buttonUrl: panelUrl,
  });

  try {
    await ses.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [params.to] },
        Message: {
          Subject: { Data: `Acesso ao painel - ${params.barbershopName}` },
          Body: {
            Text: { Data: textBody },
            Html: { Data: htmlBody },
          },
        },
      })
    );
    console.info("[SES] Onboarding email sent to", params.to);
  } catch (err) {
    console.error("[SES] Failed to send onboarding email:", err);
    throw err;
  }
}

export type PasswordResetEmailParams = {
  to: string;
  appUrl: string;
  /** Link de uso único (expira em 30 min) para definir a nova senha. */
  resetUrl: string;
};

export async function sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
  const from = process.env.FROM_EMAIL;
  if (!from) return;

  const baseUrl = ensureNoTrailingSlash(params.appUrl);
  void baseUrl;
  const resetUrl = params.resetUrl;

  const textBody = `
Olá,

Você solicitou a recuperação de senha da sua conta NavalhIA.

Para definir uma nova senha, abra o link abaixo (vale por 30 minutos e só pode ser usado uma vez):

${resetUrl}

Se você não pediu a recuperação de senha, ignore este e-mail. Sua senha atual continua válida.
`.trim();

  const bodyHtml = `
    <p style="margin: 0 0 12px 0;">Olá,</p>
    <p style="margin: 0 0 16px 0;">Você solicitou a recuperação de senha da sua conta NavalhIA.</p>
    <p style="margin: 0 0 16px 0;">Use o botão abaixo para definir uma nova senha. O link vale por 30 minutos e só pode ser usado uma vez.</p>
  `.trim();

  const footerHtml = `
    Se você não pediu a recuperação de senha, ignore este e-mail. Sua senha atual continua válida.
  `.trim();

  const htmlBody = buildEmailLayout({
    baseUrl: params.appUrl,
    title: "Recuperação de senha",
    bodyHtml,
    buttonText: "Definir nova senha",
    buttonUrl: resetUrl,
    footerHtml,
  });

  await ses.send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [params.to] },
      Message: {
        Subject: { Data: "Recuperação de senha - NavalhIA" },
        Body: {
          Text: { Data: textBody },
          Html: { Data: htmlBody },
        },
      },
    })
  );
}

export type PaymentFailedEmailParams = {
  to: string;
  barbershopName: string;
  appUrl: string;
  /** Fim da tolerância (BILLING_GRACE_DAYS) antes de pausar a IA e os envios automáticos. */
  graceEndsAt: Date;
};

/** Aviso ao dono quando a cobrança da assinatura falha. Só é chamado com BILLING_NOTIFY_PAYMENT_FAILED=true (ver lib/billing-notify.ts). */
export async function sendPaymentFailedEmail(params: PaymentFailedEmailParams): Promise<void> {
  const from = process.env.FROM_EMAIL;
  // Lança (não retorna em silêncio): quem chama NÃO pode registrar «enviado» (lib/billing-notify.ts reenvia depois).
  if (!from) throw new Error("FROM_EMAIL ausente: aviso de pagamento não enviado");
  const settingsUrl = `${ensureNoTrailingSlash(params.appUrl)}/app/configuracoes`;
  const until = params.graceEndsAt.toLocaleDateString("pt-BR");
  const textBody = `
Olá,

Não conseguimos cobrar a assinatura da NavalhIA de ${params.barbershopName}.

Atualize a forma de pagamento até ${until} para não pausar o atendimento automático (IA e lembretes).

Atualizar pagamento: ${settingsUrl}
`.trim();
  const htmlBody = buildEmailLayout({
    baseUrl: params.appUrl,
    title: "Problema no pagamento",
    bodyHtml: `
    <p style="margin: 0 0 12px 0;">Olá,</p>
    <p style="margin: 0 0 16px 0;">Não conseguimos cobrar a assinatura da NavalhIA de <strong>${escapeHtml(params.barbershopName)}</strong>.</p>
    <p style="margin: 0 0 16px 0;">Atualize a forma de pagamento até <strong>${escapeHtml(until)}</strong> para não pausar o atendimento automático (IA e lembretes).</p>`.trim(),
    buttonText: "Atualizar pagamento",
    buttonUrl: settingsUrl,
  });
  await ses.send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [params.to] },
      Message: {
        Subject: { Data: "Problema no pagamento da sua assinatura - NavalhIA" },
        Body: { Text: { Data: textBody }, Html: { Data: htmlBody } },
      },
    }),
  );
}
