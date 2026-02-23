import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });

export type OnboardingEmailParams = {
  to: string;
  barbershopName: string;
  appUrl: string;
  tempPassword: string;
  apiKey: string;
};

export async function sendOnboardingEmail(params: OnboardingEmailParams): Promise<void> {
  const from = process.env.FROM_EMAIL;
  if (!from) return;
  const body = `
Olá,

Sua conta na NavalhIA ${params.barbershopName} foi criada.

Acesse o painel: ${params.appUrl}
Email: ${params.to}
Senha temporária: ${params.tempPassword}

Altere sua senha no primeiro acesso (Configurações ou ao logar).

Para integrar com n8n/WhatsApp, use esta API Key no header X-API-Key:
${params.apiKey}

Guarde esta chave em local seguro; ela não será exibida novamente no painel.
`.trim();
  await ses.send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [params.to] },
      Message: {
        Subject: { Data: `Acesso ao painel - ${params.barbershopName}` },
        Body: {
          Text: { Data: body },
        },
      },
    })
  );
}

export type PasswordResetEmailParams = {
  to: string;
  appUrl: string;
  tempPassword: string;
};

export async function sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
  const from = process.env.FROM_EMAIL;
  if (!from) return;
  const body = `
Olá,

Você solicitou a recuperação de senha da sua conta NavalhIA.

Senha temporária: ${params.tempPassword}

Acesse o painel em ${params.appUrl}/login e faça login com esta senha. Na primeira vez você será solicitado a definir uma nova senha.

Se você não pediu a recuperação de senha, ignore este e-mail. Sua senha atual continua válida.
`.trim();
  await ses.send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [params.to] },
      Message: {
        Subject: { Data: "Recuperação de senha - NavalhIA" },
        Body: {
          Text: { Data: body },
        },
      },
    })
  );
}
