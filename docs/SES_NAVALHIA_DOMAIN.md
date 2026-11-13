# SES e domínio navalhia.com.br

## Produção sem domínio próprio (us-east-2, padrão atual)

O stack Terraform de produção (`infra/production`, região `us-east-2`) sobe com `attach_custom_domains=false`. Nesse modo:

- **Não** se cria identidade SES de domínio (`aws_sesv2_email_identity.domain`) nem registros DKIM.
- Informe `ses_sender_email` no `terraform.tfvars` (a variável **não tem default**). Vazio = o Terraform não cria identidade de remetente. Preenchido = cria `aws_sesv2_email_identity.sender` e a Lambda usa esse endereço como `FROM_EMAIL`.
- A verificação é **individual**: o SES envia um link para o inbox de `ses_sender_email`. Sem clicar no link, a identidade não envia.
- A conta está em **sandbox** (limite baixo; só entrega para identidades verificadas). E-mail para destinatários **não verificados permanece pendente** (não chega) até você verificar também o destinatário ou solicitar *Production access* no console SES (`us-east-2`).

Quando houver domínio próprio, volte a `attach_custom_domains=true` e use os tokens DKIM do output `ses_dkim_tokens` (o bloco histórico abaixo refere-se a um setup anterior em `us-east-1` / `navalhia.com.br` e não é o que o Terraform de produção cria hoje).

---

## Histórico (navalhia.com.br / us-east-1)

Configuração do Amazon SES para envio de e-mails (onboarding com senha temporária) usando o domínio **navalhia.com.br**.

## Status

- **Identidade de domínio**: criada no SES (us-east-1) para `navalhia.com.br`.
- **Envio**: após adicionar os registros DKIM abaixo e a verificação concluir, use `no-reply@navalhia.com.br` (ou outro endereço @navalhia.com.br) como `FROM_EMAIL`.
- **Sandbox**: a conta SES está em sandbox (limite 200 e-mails/dia; apenas para endereços verificados, a menos que solicite **Production access** no console SES).

## Registros DNS para DKIM (obrigatório)

Adicione estes **3 registros CNAME** no provedor do domínio (onde está o DNS de navalhia.com.br). Assim o SES consegue assinar os e-mails e a entrega melhora.

| Tipo  | Nome (host)                                                      | Valor (destino)                                                |
|-------|-------------------------------------------------------------------|----------------------------------------------------------------|
| CNAME | `u43ap3i5mgxgdnlb4wbgdfjnqri43re4._domainkey`                     | `u43ap3i5mgxgdnlb4wbgdfjnqri43re4.dkim.amazonses.com`          |
| CNAME | `spsbvrrx5u4wkm3famlmrpbgwwpqbpch._domainkey`                     | `spsbvrrx5u4wkm3famlmrpbgwwpqbpch.dkim.amazonses.com`          |
| CNAME | `dz2torwoqya4tszukpdu4vawy5og7ka3._domainkey`                     | `dz2torwoqya4tszukpdu4vawy5og7ka3.dkim.amazonses.com`          |

- **Nome completo** (se o provedor pedir FQDN):  
  `u43ap3i5mgxgdnlb4wbgdfjnqri43re4._domainkey.navalhia.com.br` (e o mesmo padrão para os outros dois).
- Em muitos painéis você informa só o subdomínio:  
  `u43ap3i5mgxgdnlb4wbgdfjnqri43re4._domainkey` (o domínio `navalhia.com.br` já é aplicado automaticamente).

## Verificar status no AWS

```bash
aws sesv2 get-email-identity --email-identity navalhia.com.br --region us-east-1
```

Quando `DkimAttributes.Status` estiver `SUCCESS`, o domínio está verificado para DKIM.

## Variáveis de ambiente (API)

Após a verificação:

```env
FROM_EMAIL=no-reply@navalhia.com.br
APP_URL=https://app.navalhia.com.br
```

Redeploy da API para aplicar: `./scripts/aws/deploy-api.sh`.

## Produção (sair do sandbox)

Para enviar para qualquer e-mail e aumentar limites:

1. Console AWS → **Amazon SES** (us-east-1) → **Account dashboard**.
2. **Request production access**.
3. Preencha: caso de uso (onboarding e recuperação de senha), volume estimado, como os destinatários optam (checkout). Aprovação costuma levar até 24–48 h.

Enquanto estiver em sandbox, adicione e verifique no SES os endereços de e-mail de teste (SES → **Verified identities** → **Create identity** → tipo Email).

## SPF e DMARC (opcional, melhora entregabilidade)

- **SPF**: adicione um registro TXT no domínio raiz `navalhia.com.br` com valor sugerido pelo SES (ex.: `v=spf1 include:amazonses.com ~all`) para autorizar o SES a enviar em nome do domínio.
- **DMARC**: registro TXT em `_dmarc.navalhia.com.br` (ex.: `v=DMARC1; p=none; rua=mailto:admin@navalhia.com.br`) para monitorar relatórios e depois endurecer política (`p=quarantine` ou `p=reject`).
