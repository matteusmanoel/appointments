# DNS na Hostinger — navalhia.com.br (tabela completa)

Use os campos **exatamente** como abaixo no painel **Gerenciar registros DNS** da Hostinger. Campos: **Tipo**, **Nome**, **Destino**, **TTL**.

---

## 1. Certificado SSL (ACM) — 3 registros

Se já existirem, **não duplique**. Só confira se Destino está igual.

| Tipo  | Nome | Destino | TTL  |
|-------|------|---------|------|
| CNAME | `_979f00c3d3b710e722bf54e797d4ad05` | `_cbd9a87bf8c96d971a3586b5faefb4e0.jkddzztszm.acm-validations.aws.` | 14400 |
| CNAME | `_232bbd7d38a010286e53a8c381ddce16.app` | `_71972a96a9695e247b4eb7a55dd0bf67.jkddzztszm.acm-validations.aws.` | 14400 |
| CNAME | `_3dd54d6227a2aab718cd48f53c766cfe.api` | `_9b79a392972ea07d04b59bf3e59e3a36.jkddzztszm.acm-validations.aws.` | 14400 |

---

## 2. App e API (custom domain) — 2 registros

**Importante:** no campo **Destino** use o valor **completo** (com `.cloudfront.net` ou `.execute-api.us-east-1.amazonaws.com`). Não use só o início (ex.: só `d21vsz08u2kyrv`).

| Tipo  | Nome | Destino | TTL  |
|-------|------|---------|------|
| CNAME | `app` | `d21vsz08u2kyrv.cloudfront.net` | 14400 |
| CNAME | `api` | `d-6y6ni309u8.execute-api.us-east-1.amazonaws.com` | 14400 |

---

## Resumo do que fazer na Hostinger

1. **Adicionar ou editar o CNAME do app**
   - Tipo: **CNAME**
   - Nome: **app**
   - Destino: **d21vsz08u2kyrv.cloudfront.net** (inteiro, sem https://)
   - TTL: **14400**

2. **Adicionar ou editar o CNAME da api**
   - Tipo: **CNAME**
   - Nome: **api**
   - Destino: **d-6y6ni309u8.execute-api.us-east-1.amazonaws.com**
   - TTL: **14400**

3. **Não remover**
   - Os 3 CNAMEs que terminam em `acm-validations.aws` (certificado).
   - Os CNAMEs de e-mail (DKIM: `reach-a._domainkey`, `reach-b._domainkey`, etc.).
   - O registro **A** do **@** (84.32.84.32) e o **CNAME** do **www** podem ficar; eles não atrapalham **app** e **api**.

4. **Salvar** e aguardar alguns minutos. Depois testar:
   - https://app.navalhia.com.br
   - https://api.navalhia.com.br/health

---

## Se a Hostinger rejeitar o ponto final no Destino

Alguns painéis não aceitam o ponto (.) no final do Destino. Se der erro nos registros do ACM, tente **sem** o ponto no final, por exemplo:

- `_cbd9a87bf8c96d971a3586b5faefb4e0.jkddzztszm.acm-validations.aws` (sem o último ponto).

Para **app** e **api**, use sempre **sem** ponto no final (como na tabela acima).
