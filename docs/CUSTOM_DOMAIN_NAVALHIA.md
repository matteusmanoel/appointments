# Custom Domain navalhia.com.br — passo a passo (domínio na Hostinger)

Guia para usar **app.navalhia.com.br** (frontend) e **api.navalhia.com.br** (API), com o domínio **navalhia.com.br** comprado na **Hostinger**.

**Por que só o deploy não muda a URL?**

O deploy (`deploy-static.sh` e `deploy-api.sh`) sobe o código para os recursos da AWS (CloudFront + S3, API Gateway + Lambda). Ele **não** associa o domínio **app.navalhia.com.br** / **api.navalhia.com.br** a esses recursos. Quem faz essa associação é o script **`setup-custom-domain.sh`**. Além disso, os CNAMEs na Hostinger precisam apontar para o **CloudFront e o API Gateway que você está usando** (as stacks `navalhia-static-prod` e `navalhia-api-prod`). O script usa essas mesmas stacks e imprime os valores corretos para você colar no DNS.

**Onde cada coisa é feita:**

- **Hostinger** = onde você **gerencia o DNS** do domínio (adicionar CNAMEs). Não é na AWS.
- **AWS** = certificado (ACM), CloudFront e API Gateway; o script `setup-custom-domain.sh` associa app/api a eles (usando as mesmas stacks do deploy).
- **Seu computador** = rodar o script após o certificado ISSUED e, na Hostinger, adicionar os CNAMEs que o script imprimir.

---

## Visão geral do fluxo

| Etapa | Onde | O que fazer |
|-------|------|-------------|
| 1 | **Hostinger** | Adicionar 3 CNAMEs de validação do certificado (ACM). |
| 2 | **Seu computador** | Verificar se o certificado ficou ISSUED e rodar `setup-custom-domain.sh`. |
| 3 | **Hostinger** | Adicionar 2 CNAMEs de tráfego (app → CloudFront, api → API Gateway). |
| 4 | **Seu computador** | Atualizar .env e fazer deploy do front e da API. |

---

## Passo 1 — Validar o certificado SSL (na Hostinger)

O certificado para **navalhia.com.br**, **app.navalhia.com.br** e **api.navalhia.com.br** já foi solicitado na AWS (ACM). Para a AWS considerá-lo válido, ela precisa “enxergar” no DNS que você controla o domínio. Isso é feito com **3 registros CNAME** que **você cria no DNS da Hostinger** (não na AWS).

### 1.1 Onde fazer: Hostinger

1. Acesse o painel da **Hostinger** e entre no gerenciamento do domínio **navalhia.com.br**.
2. Abra a seção de **DNS** / **Gerenciar registros DNS** (onde você já configurou os CNAMEs do SES).
3. **Adicionar registro** para cada linha da tabela abaixo. Tipo = **CNAME**.

**Importante:** estes NÃO são os CNAMEs do SES (DKIM). Não remova os que você já tem para e-mail. São **3 registros novos**, que apontam para `acm-validations.aws`.

| Tipo  | Nome (no campo “Nome”) | Conteúdo / Aponta para |
|-------|-------------------------|-------------------------|
| CNAME | `_979f00c3d3b710e722bf54e797d4ad05` | `_cbd9a87bf8c96d971a3586b5faefb4e0.jkddzztszm.acm-validations.aws.` |
| CNAME | `_232bbd7d38a010286e53a8c381ddce16.app` | `_71972a96a9695e247b4eb7a55dd0bf67.jkddzztszm.acm-validations.aws.` |
| CNAME | `_3dd54d6227a2aab718cd48f53c766cfe.api` | `_9b79a392972ea07d04b59bf3e59e3a36.jkddzztszm.acm-validations.aws.` |

- **Nome:** use exatamente como na tabela. Se a Hostinger completar sozinha com `.navalhia.com.br`, não duplique; deixe só essa parte (ex.: `_979f00c3d3b710e722bf54e797d4ad05`).
- **Conteúdo / Aponta para:** copie o valor completo. O ponto no final (`.`) é opcional em muitos painéis; se a Hostinger rejeitar, tente sem o ponto.
4. Salve os três registros.

### 1.2 Verificar (no seu computador)

Aguarde alguns minutos (até ~30 min) e, no terminal (com AWS CLI configurado), rode:

```bash
aws acm describe-certificate \
  --certificate-arn "arn:aws:acm:us-east-1:321225686266:certificate/57a83321-eb8e-4506-9263-e7a69845979d" \
  --region us-east-1 \
  --query "Certificate.Status" --output text
```

Quando a saída for **`ISSUED`**, o certificado está validado. Siga para o Passo 2.

---

## Passo 2 — Configurar CloudFront e API Gateway (no seu computador, via AWS)

Quando o certificado estiver **ISSUED**, você associa o domínio ao CloudFront e ao API Gateway **rodando o script do projeto**. O script usa as **mesmas stacks** do deploy (`navalhia-static-prod` e `navalhia-api-prod`), então os IDs do CloudFront e do API Gateway são os corretos.

### 2.1 Onde fazer: seu computador (terminal)

No diretório do projeto (depois de já ter rodado `deploy-static.sh` e `deploy-api.sh` pelo menos uma vez):

```bash
./scripts/aws/setup-custom-domain.sh
```

O script vai:

1. Confirmar que o certificado está ISSUED.
2. Ler o **CloudFront distribution ID** e o **API ID** das stacks `navalhia-static-prod` e `navalhia-api-prod`.
3. Atualizar o CloudFront para o alias **app.navalhia.com.br** e usar o certificado ACM.
4. Criar o custom domain **api.navalhia.com.br** no API Gateway e mapear para a sua API.
5. **Imprimir no final os 2 CNAMEs** exatos para você criar na Hostinger (com o domínio do CloudFront e o target do API Gateway que você está usando).

Anote os valores impressos (Nome + Conteúdo). Você usará no Passo 3.

---

## Passo 3 — Apontar app e api para a AWS (na Hostinger)

Depois de rodar o script, o tráfego de **app** e **api** ainda precisa ser direcionado para a AWS. Use **exatamente os valores** que o script imprimiu no final do Passo 2 (o domínio do CloudFront e o target do API Gateway mudam conforme a stack).

### 3.1 Onde fazer: Hostinger

No mesmo painel **Gerenciar registros DNS** do domínio **navalhia.com.br**:

1. **Adicionar registro** — CNAME:
   - **Nome:** `app`
   - **Conteúdo / Aponta para:** *(valor “Conteúdo” da linha “app” que o script mostrou; algo como `d21vsz08u2kyrv.cloudfront.net`)*
2. **Adicionar registro** — CNAME:
   - **Nome:** `api`
   - **Conteúdo / Aponta para:** *(valor “Conteúdo” da linha “api” que o script mostrou; algo como `d-xxxxx.execute-api.us-east-1.amazonaws.com`)*

Salve os dois. Em alguns minutos, **https://app.navalhia.com.br** e **https://api.navalhia.com.br** devem responder.

---

## Passo 4 — Variáveis de ambiente e deploy (no seu computador)

Para o front e a API usarem as novas URLs, atualize o ambiente e faça o deploy.

### 4.1 .env

No **.env** do projeto (e onde você configura o deploy da API):

```env
APP_URL=https://app.navalhia.com.br
VITE_API_URL=https://api.navalhia.com.br
```

Se a API usar CORS, inclua o novo front:

```env
CORS_ORIGIN=https://app.navalhia.com.br,https://navalhia.com.br
```

### 4.2 Deploy do frontend

No diretório do projeto:

```bash
VITE_API_URL=https://api.navalhia.com.br ./scripts/aws/deploy-static.sh
```

### 4.3 Deploy da API

```bash
./scripts/aws/deploy-api.sh
```

---

## Resumo: onde cada coisa é feita

| O que | Onde |
|-------|------|
| **Todos os CNAMEs** (validação do certificado + app + api) | **Hostinger** — painel DNS do domínio navalhia.com.br |
| **Certificado SSL (ACM)** | Já solicitado na **AWS**; só precisa dos 3 CNAMEs na Hostinger para ficar ISSUED |
| **CloudFront + API Gateway (custom domain)** | **AWS**, configurados automaticamente pelo **script** no seu computador |
| **Verificação do certificado e execução do script** | **Seu computador** (AWS CLI + script) |
| **Deploy (front e API)** | **Seu computador** (scripts de deploy) |

Nenhuma configuração de CNAME é feita na AWS para o seu domínio; o DNS de **navalhia.com.br** continua na Hostinger. A AWS só “lê” os CNAMEs que você cria na Hostinger para validar o certificado e, depois, para resolver **app** e **api** para CloudFront e API Gateway.
