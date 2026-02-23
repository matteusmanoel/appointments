# MVP rápido, baixo custo e pronto para escalar (NavalhIA)

Este documento descreve uma estratégia de lançamento do NavalhIA com foco em:

- **desenvolvimento rápido** (time-to-market),
- **baixo custo de manutenção** (infra simples, poucos serviços para operar),
- **pré-projeto para escalabilidade** (crescer com “alavancas” claras, evitando reescrita).

Ele complementa (não substitui) os documentos existentes:

- `docs/AWS_MVP_DEPLOY_PLAN.md` (deploy atual e fases sugeridas)
- `docs/RUNBOOK.md` (checklists de operação e venda)

---

## Objetivo do MVP (o que precisa existir para vender)

### Produto (venda)
- **Landing + app** publicados e com fluxo de compra/onboarding funcional.
- **Painel de gestão** já existente (serviços, barbeiros, clientes, agenda, configurações).
- **Configurações essenciais**: dados do estabelecimento, horário de funcionamento, link público.

### Operação (mínimo para dormir em paz)
- **CORS restrito**, **rate limit**, **alarmes**, **budget** configurados (ver `docs/RUNBOOK.md`).
- **Logs com retenção curta** (14 dias já está no stack da API) e capacidade de debug rápido.

### Plataforma (pré-escala)
- Tudo já nasce **multi-tenant** (ou seja: qualquer endpoint que “mexe em dados” precisa estar corretamente escopado por estabelecimento/tenant).
- Decisões “difíceis de reverter” ficam encapsuladas (ex.: provedor WhatsApp).

---

## Princípios de arquitetura (para evitar dívida cara)

- **Serverless onde der**: Lambda + API Gateway reduz operação e custo no início.
- **Uma região, um ambiente** no começo: reduzir variáveis até achar o product-market-fit.
- **Dados como fonte da verdade**: agenda e disponibilidade sempre decididas pelo backend (não por automação externa).
- **Automação não pode virar core sem controle**: integrações (n8n, etc.) são úteis, mas o fluxo crítico (agendamento) deve ser determinístico e testável.
- **Evoluir por gatilhos**: só adicionar filas, caches e workers quando métricas reais exigirem.

---

## Base atual (o que vocês já têm e por que é boa para MVP)

Pelo `docs/AWS_MVP_DEPLOY_PLAN.md` e stacks em `infra/`:

- **Frontend + docs**: S3 privado + CloudFront (baixo custo, CDN, ótimo para venda).
- **API**: API Gateway (HTTP API) + Lambda (barato, escalável automaticamente).
- **Banco**: Supabase Postgres (gerenciado, baixo atrito de setup).
- **Operação mínima**: alarmes CloudWatch e parâmetros para Stripe/Email no stack da API.

Pontos de atenção já endereçados no stack:

- `DATABASE_SSL=true` e `DATABASE_POOL_MAX=5` (evita explosão de conexões em Lambda).
- Retenção de logs em 14 dias (bom para custo).

---

## Estratégia de lançamento em fases (com “trilhos” de escala)

### Fase 0 — “Colocar no ar e vender” (dias)
Objetivo: vender e onboardar os primeiros clientes com o mínimo de operação.

**Recomendado manter simples**
- API e front no ar via stacks existentes.
- Checkout e provisionamento funcionando (mesmo que com fluxo simples).
- Documentação pública (OpenAPI/Redoc) publicada em `/docs`.

**Entregas obrigatórias**
- **CORS restrito** para o(s) CloudFront(s) (não usar `*` após abrir vendas).
- **Rate limit** ativo.
- **Budget/alerts** configurados.
- **Backups Supabase** conferidos (PITR/snapshots conforme plano).

Critério de saída:
- onboarding de um cliente real concluído sem intervenção manual “técnica”.

---

### Fase 1 — “MVP de WhatsApp plug-and-play” (1–2 sprints)
Objetivo: conectar WhatsApp e já agendar via conversa, sem customização por cliente.

#### O que é “plug-and-play” (definição objetiva)
Dentro do SaaS, o dono do estabelecimento:

1) cadastra/valida **número WhatsApp** (idealmente WhatsApp Business),
2) clica **Conectar**,
3) **lê um QR Code**,
4) vê status **Conectado**,
5) o bot passa a agendar usando serviços/barbeiros/horários que já estão no painel.

#### Recomendação de desenho (para não travar o produto no futuro)
Mesmo que o primeiro provedor seja a Uazapi, implemente internamente uma **camada de provedor**:

- `WhatsAppProvider.createInstance(tenant)`
- `WhatsAppProvider.getQr(tenant)`
- `WhatsAppProvider.getStatus(tenant)`
- `WhatsAppProvider.setWebhook(tenant, url, secret)`
- `WhatsAppProvider.sendMessage(tenant, to, payload)`
- `WhatsAppProvider.disconnect(tenant)`

Isso mantém o projeto preparado para:
- trocar/combinar provedores (ex.: Uazapi agora, Cloud API oficial depois),
- oferecer “planos” diferentes por estabelecimento (ex.: oficial vs QR-based).

#### Onde rodar o “cérebro” do chatbot no MVP
**Recomendação**: o **core do agendamento** (decisão e reserva de horário) deve ficar no **backend**.

- A IA deve ajudar a **interpretar intenção** e **preencher parâmetros**, mas a confirmação de disponibilidade e criação de agendamento é do backend.
- Isso evita overbooking e garante consistência (já existe tratamento de conflito 409 no produto).

O que pode ficar fora do backend (opcional, no MVP):
- automações periféricas (lembrete, NPS, campanhas) via n8n.

---

### Fase 2 — “Crescer com previsibilidade” (quando vendas acelerarem)
Objetivo: aguentar aumento de volume sem refatoração grande e sem downtime.

**Sinais (gatilhos) para evoluir**
- picos de webhook/eventos do WhatsApp gerando timeouts
- aumento de 5xx/latência em horários de pico
- backlog de tarefas (lembretes, confirmações) competindo com requests de usuários do painel

**Mudanças típicas**
- separar ingestão de eventos (webhook) de processamento:
  - `POST /webhooks/whatsapp/*` persiste e enfileira
  - workers processam em background
- adicionar **fila** (SQS) e **DLQ** para tolerância a falhas
- introduzir “workers” (Lambda assíncrona ou ECS Fargate) para:
  - interpretação/IA,
  - reprocessamento,
  - envios em lote com throttling.

---

### Fase 3 — “Boom de usuários” (escala operacional)
Objetivo: escalar com custos controlados e SLO claro.

**Evoluções comuns**
- mover partes quentes de Lambda para **ECS Fargate** (mantendo API Gateway e CloudFront)
- cache e rate-limit por tenant (Redis/ElastiCache) quando necessário
- separar banco:
  - continuar com Supabase enquanto der (operacionalmente simples),
  - migrar para RDS quando:
    - limite de conexões/IOPS virar gargalo,
    - necessidade de read replicas,
    - necessidade de tuning/observabilidade mais profunda,
    - custo/controle justificar.

---

## Decisão estratégica: n8n como runtime do chatbot vs automação dentro do projeto

### Recomendação para MVP (rápido e barato)
- **Use n8n para prototipar e automações periféricas**, mas **não coloque o core do agendamento** (decisão e reserva) dentro do n8n.
- O core deve ser do backend para manter:
  - consistência transacional,
  - testabilidade,
  - previsibilidade de escala/custo,
  - observabilidade por tenant.

### Se vocês precisarem MUITO do n8n no começo
Se a prioridade for “lançar em dias” com um fluxo n8n já pronto:
- mantenha um **workflow único** (não um por estabelecimento),
- o workflow chama o backend para **toda** decisão de disponibilidade e criação do agendamento,
- trate o n8n como **orquestrador** e não como “fonte da verdade”.

Isso reduz (mas não elimina) o risco de virar core acidentalmente.

---

## MVP de WhatsApp: segurança e multi-tenant (mínimo aceitável)

### 1) Isolamento por estabelecimento (tenant)
Tudo que entra via WhatsApp precisa ser mapeado para:
- `tenant_id` / `barbershop_id`
- `whatsapp_instance_id` (ou equivalente do provedor)

Não confie em `barbershop_id` vindo do payload externo.

### 2) Segredos e tokens
- Tokens do provedor (ex.: token da instância) devem ser armazenados:
  - criptografados em repouso (KMS/criptografia app-level) **ou**
  - em secret manager por tenant (custo maior; usar só quando necessário).
- Nunca logar token/QR/base64.

### 3) Webhooks
Regras para evitar incidentes e vazamento entre tenants:

- **Endpoint único por provedor** (ex.: `/webhooks/whatsapp/uazapi`) e roteamento interno por instância/tenant.
- **Autenticação do webhook**:
  - se o provedor suportar assinatura/secret: validar sempre;
  - se não suportar: usar pelo menos *rate limit*, correlação por instância e, se possível, allowlist de IPs.
- **Idempotência**:
  - persistir o evento com chave única (`provider_event_id` ou hash do payload) e ignorar duplicados;
  - tratar reentregas como normais.
- **Fail-safe**:
  - responder `2xx` rápido (após persistir/enfileirar) para não gerar retries agressivos.

---

## Desenho recomendado do WhatsApp “plug-and-play” (MVP)

### Componentes (mínimos)
- **Tela de Configurações > WhatsApp** (front)
- **Endpoints no backend** para onboarding e status
- **Webhook receiver** para eventos de mensagem
- **Conversation engine** (core do bot) no backend

### Fluxo de onboarding (QR)
1) Usuário clica “Conectar WhatsApp”.
2) Backend cria a instância no provedor e grava:
   - `provider = "uazapi"`
   - `provider_instance_name/id`
   - `provider_instance_token` (criptografado)
   - `status = disconnected`
3) Backend configura webhook do provedor apontando para sua API.
4) Front exibe QR (via endpoint do backend) e atualiza status (poll curto).
5) Ao conectar, backend marca `status=connected` e registra `connected_at`.

### Fluxo de mensagem (produção)
1) Provedor chama seu webhook com o evento de mensagem recebida.
2) Backend:
   - resolve `tenant` pela instância/token do provedor,
   - persiste o evento,
   - enfileira processamento (opcional no MVP; recomendado quando volume crescer),
   - executa o **Conversation Engine**.
3) Conversation Engine decide ações:
   - pedir dados faltantes,
   - sugerir horários,
   - criar agendamento (sempre via regras do backend),
   - confirmar/cancelar/remarcar.
4) Backend envia resposta pelo provedor (texto / lista / botões — manter simples no MVP).

---

## IA no MVP: como usar sem quebrar consistência

### Posição recomendada da IA
- A IA é **assistente de entendimento e linguagem**.
- O backend é o **árbitro** de regras e disponibilidade.

### Guardrails (mínimos)
- **Nunca** deixar a IA “criar agendamento” diretamente sem passar por um endpoint transacional do backend.
- Usar uma abordagem de “ferramentas” internas:
  - `list_services`
  - `list_barbers`
  - `get_availability(date_range, service, barber?)`
  - `create_appointment(...)` (retorna 409 em conflito)
- Se `create_appointment` retornar conflito, a IA deve:
  - pedir alternativa e sugerir 2–3 horários próximos (sempre consultando novamente).

### Controle de custo (IA)
- Definir **limites por tenant**:
  - mensagens/mês incluídas,
  - throttle por minuto/hora em picos,
  - fallback para respostas “determinísticas” quando atingir limite.
- Começar com **respostas curtas** e poucos turnos.

---

## Modelo de dados (mínimo) para suportar WhatsApp e escala

Mesmo que as tabelas exatas mudem, o MVP precisa guardar pelo menos:

- **Conexão WhatsApp por estabelecimento**
  - `barbershop_whatsapp_connections`
  - campos típicos: `barbershop_id`, `provider`, `instance_id/name`, `token_encrypted`, `status`, `connected_at`, `disconnected_at`, `last_error`, `created_at`
- **Eventos recebidos (auditoria + idempotência)**
  - `whatsapp_inbound_events`
  - campos típicos: `barbershop_id`, `provider`, `provider_event_id` (ou hash), `from_phone`, `payload_json`, `received_at`
- **Sessão/conversa (estado)**
  - `whatsapp_conversations`
  - campos típicos: `barbershop_id`, `contact_phone`, `state`, `state_json`, `last_message_at`, `created_at`, `updated_at`

Isso te permite:
- debugar incidentes por tenant,
- reprocessar eventos,
- evoluir o bot sem “perder contexto”.

---

## Escalabilidade com baixo custo: alavancas e gatilhos

### Alavancas de escala (ordem típica)
1) **Otimizar Lambda** (memory/timeouts/logs/pool) antes de mudar arquitetura.
2) **Fila (SQS) + DLQ** quando webhook/processamento competir com requests do painel.
3) **Workers** (Lambda assíncrona ou ECS Fargate) para:
   - IA e interpretação,
   - jobs agendados (lembretes),
   - reprocessamento e retries.
4) **Cache/Redis** quando precisar:
   - rate limit por tenant,
   - sessões de conversa com baixa latência,
   - reduzir consultas repetidas.
5) **Banco**: manter Supabase enquanto suportar; migrar para RDS por necessidade real.

### Gatilhos práticos (sugestão)
- **Latência p95 da API > 800ms** em horário de pico por 3 dias: revisar queries, índices e uso do pool.
- **Erros 5xx > 1%**: priorizar idempotência, retries e isolamento de rotas críticas.
- **Webhooks gerando timeouts/retries**: responder rápido e mover processamento para fila.
- **Conexões do banco saturando**: reduzir `DATABASE_POOL_MAX`, mover tarefas pesadas para worker, considerar RDS/pooler.

---

## Operação e observabilidade (MVP “profissional” com pouco trabalho)

### Logs estruturados e correlação
- Gerar `request_id` por request e propagar para:
  - logs do backend,
  - registros de evento inbound,
  - chamadas ao provedor,
  - tentativas de criação de agendamento.
- Evitar logar PII sensível (ou mascarar).

### Métricas mínimas
- taxa de 2xx/4xx/5xx por rota (especialmente webhooks)
- p50/p95 de latência
- contagem de mensagens inbound/outbound por tenant
- contagem de conflitos 409 (indicador de UX do bot)

### Alarmes
- vocês já têm alarmes de erro/duração no stack da API (`infra/api/stack.yaml`).
- adicionar (quando houver WhatsApp em produção):
  - alarme de pico de 5xx no webhook,
  - alarme de backlog/DLQ (quando usar SQS).

---

## Custos: como manter baixo desde o dia 1

### Infra (AWS)
- **CloudFront PriceClass_100** (já configurado) para reduzir custo.
- **Retenção curta de logs** (14 dias já está feito).
- Evitar serviços pesados no início (EKS, MSK, etc.).

### Banco (Supabase)
- manter conexões sob controle em Lambda:
  - pool pequeno,
  - preferir queries eficientes,
  - adicionar índices antes de “subir infra”.

### WhatsApp/IA
- custo do provedor WhatsApp cresce por instância/dispositivo → repassar em plano ou add-on.
- custo de IA cresce por mensagem → limites e tiers desde o MVP (mesmo que altos no começo).

---

## Checklist resumido para lançar (MVP vendável)

### Plataforma
- [ ] CORS restrito a domínios do CloudFront
- [ ] Rate limit ativo
- [ ] Alarmes CloudWatch ativos
- [ ] AWS Budget com alertas
- [ ] Backups Supabase conferidos

### Comercial / Onboarding
- [ ] Checkout e webhook de billing funcionando (cria tenant + admin)
- [ ] Email de onboarding (com link do app + instruções)

### WhatsApp (quando entrar no MVP)
- [ ] Tela de Configurações > WhatsApp (conectar, QR, status)
- [ ] `WhatsAppProvider` implementado (Uazapi primeiro)
- [ ] Webhook com idempotência e roteamento por tenant
- [ ] Conversation Engine criando agendamentos via regras do backend

---

## Próximos passos recomendados (ordem sugerida)

1) Consolidar o MVP de vendas com a infra atual (seguir `docs/RUNBOOK.md`).
2) Implementar a camada `WhatsAppProvider` + telas de conexão (mesmo antes do bot estar perfeito).
3) Implementar Conversation Engine mínimo:
   - “agendar”, “cancelar”, “remarcar”, “ver horários”.
4) Quando houver volume real: colocar SQS + DLQ entre webhook e processamento.
