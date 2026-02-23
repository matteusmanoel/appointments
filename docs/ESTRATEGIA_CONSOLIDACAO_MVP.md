# Estratégia de Consolidação do MVP — NavalhIA (Barber Harmony)

Data: 2026-02-21  
Escopo: consolidar MVP vendável (pequenas e médias), preparar multi-filial sem complexidade, otimizar custos/escala de IA (multi-modelo), e elevar conversão da landing (sem promessa de pagamento antecipado).

---

## Sumário executivo

**O que vender agora (promessa honesta):**  
**“Recepcionista 24h no WhatsApp que agenda e reduz no-show — com lembretes e recuperação automática de clientes.”**  
(Sem “cobrar/pagamento antecipado” por enquanto.)

**O que já está forte no produto (base para ganhar mercado):**
- **WhatsApp-first** (Brasil): integração via Uazapi + IA configurável (perfil/versões/simulação/health) + trilha de conversas.
- **Painel completo**: serviços, barbeiros, clientes, agendamentos, horário de funcionamento, exceções/closures, link público.
- **Modelo de automação pronto**: eventos outbound / n8n e filas (jobs) — ideal para lembretes, follow-ups e campanhas.
- **Checkout SaaS funcionando**: assinatura via Stripe com planos (`essential`, `pro`, `premium`).

**Principais ajustes para o MVP “pronto para venda”:**
- **Alinhar o Plano Essencial** (hoje bloqueia telas necessárias para configurar link público) — tornar “mínimo utilizável”.
- Implementar **lembretes e follow-ups reais** (automação) — é a maior “âncora” de valor recorrente no nicho.
- Implementar **multi-filial “light”** (conta → várias unidades), **cobrando por unidade**, com seletor no painel e isolamento por `barbershop_id`.
- Ajustar landing para **prova visual + prova social + comparativo** e copys de alta conversão coerentes com entrega.

---

## Padrão de mercado (benchmarks de SaaS para barbearias/salões)

### O que aparece de forma recorrente nas landings e páginas de pricing/features
- **Agendamento 24/7** (link, widget, “book now”), integrações (Google/Instagram), regras de agenda e gestão de equipe.
- **No-show protection**: lembretes, política de cancelamento, (frequentemente) depósito/cartão no arquivo.
- **Retenção e receita**: fidelidade, gift cards, memberships/pacotes, campanhas.
- **Operação**: relatórios, comissões, multi-unidade, (em plataformas maiores) POS/estoque.

### Referências usadas como base (leitura das páginas públicas)
- Squire — matriz de planos com: online booking, reminders, no-show protection, waitlist, kiosk, multi-location, marketing, loyalty/gift cards. Fonte: `https://www.getsquire.com/pricing`
- Booksy — “tudo incluso” com foco em: reminders, deposits/cancellation fees, waitlist, marketing, memberships, gift cards, integrações. Fontes: `https://biz.booksy.com/en-us/pricing` e `https://biz.booksy.com/en-us/features`
- Fresha — posicionamento “all-in-one” com: booking, CRM, marketing, POS, no-show protection (depósitos/políticas), equipe e relatórios. Fonte: `https://www.fresha.com/pt/for-business/barber`
- SimplyBook — pricing por limites (providers/bookings/mês) + custom features (depósitos/pagamentos, apps, etc.). Fonte: `https://simplybook.me/en/pricing`

**Leitura estratégica:** vocês não precisam competir em POS/estoque no MVP. O “atalho” para ganhar mercado no Brasil é **WhatsApp-first + automação anti no-show + recuperação**, que é exatamente onde vocês já estão tecnicamente mais avançados.

---

## Definição do MVP “pronto para vender” (o que precisa estar verdadeiramente entregue)

### MVP vendável (objetivo)
O cliente compra e, em até 60 minutos, consegue:
- Configurar a unidade (dados, horários, serviços, barbeiros).
- Publicar um link de agendamento funcional.
- Conectar o WhatsApp e ativar a IA.
- Ter **lembretes automáticos** e pelo menos **1 fluxo de follow-up** (recuperação).
- Acompanhar resultados mínimos (ocupação/agenda, no-show, retorno).

### Critérios de qualidade (Definition of Done)
- Automação não pode “quebrar silêncio”: falhas de envio devem registrar erro e permitir reprocesso.
- Mensagens automáticas devem respeitar janela de horário (ex.: não enviar 02:00) e opt-out simples (“parar”).
- IA não pode vazar IDs/UUIDs nem pedir telefone (guardrails já existem; manter e estender).
- Setup “self-serve” completo, com mensagens de estado e checklist.

---

## Backlog recomendado (prioridades do MVP)

### Prioridade 0 — Ajustes para coerência de plano e ativação (bloqueadores de venda)

#### P0.1 — Tornar o “Essencial” utilizável (mínimo de setup)
Hoje, o Plano Essencial está descrito como “Painel + Link Público”, mas várias telas essenciais estão bloqueadas no app para não-Pro.

**Recomendação (produto + conversão):**
- **Essencial deve permitir Setup mínimo** (sem IA):
  - **Serviços**: criar/editar (ao menos os básicos).
  - **Barbeiros**: criar/editar (ao menos 1).
  - **Horário de funcionamento + closures**.
  - **Slug/link público**.
- O restante (IA, integrações avançadas, follow-ups automáticos, etc.) fica no Pro/Premium.

**Motivo:** sem isso, o Essencial vira “plano que não dá para usar”, elevando churn, suporte e cancelamentos.

#### P0.2 — Landing e mensagens do produto: remover “cobrança/pagamento antecipado”
**Ajuste de copy obrigatório**: tirar qualquer promessa de “cobrar / pagamento antecipado / pagamento antecipado reduz no-show”.  
Trocar por: “lembretes + confirmação + reagendamento fácil” (anti no-show sem pagamentos).

**Efeito:** reduz objeção, reduz expectativa errada, aumenta retenção.

---

### Prioridade 1 — Motor de valor recorrente (anti no-show + recuperação)

#### P1.1 — Lembretes automáticos (WhatsApp)
**MVP**: 1 lembrete por agendamento (ex.: 24h antes), com opção de 2º lembrete (ex.: 2h antes) no Premium.

**Requisitos funcionais:**
- Regra de envio por janela: não enviar fora do horário configurado (ou usar fallback 09:00–20:00).
- Idempotência: não duplicar envio.
- Opt-out simples (“parar”, “não receber”) e registro no cliente.
- Registro de eventos: enviado, falhou, reprocessado.

**Arquitetura recomendada (simples e escalável):**
- Gerar um “job de lembrete” quando o agendamento é criado/confirmado.
- Executar via worker + Uazapi sendText **ou** via n8n (usando outbound events).

> Nota: lembretes podem ser **determinísticos** (sem LLM), reduzindo custo e risco.

#### P1.2 — Follow-up automático de recuperação
**MVP**: 1 fluxo:
- “Cliente sumido”: sem visita há 30 dias → mensagem curta com CTA para agendar (link).

**Upgrade Pro/Premium:**
- Segmentação simples (ex.: “VIP”, “barba”, “corte”) via tags.
- 2 fluxos adicionais (ex.: 7 dias pós-visita pedindo feedback / 60 dias com oferta).

> Follow-up também pode ser **determinístico** ou com “variação de tom” via LLM barato.

#### P1.3 — Reagendar/cancelar self-serve
Sem pagamento antecipado, o maior anti no-show é “reduzir fricção para remarcar”.

**MVP:**
- Link em mensagens de lembrete: “Reagendar” / “Cancelar”.
- Regra de janela (ex.: até 2h antes).
- Atualizar status do agendamento, e opcionalmente reabrir slots.

---

## Multi-filial sem complexidade (MVP-ready)

### Objetivo
Permitir que uma mesma “conta” (dono/operador) tenha **várias unidades (barbershops)**, mantendo isolamento por `barbershop_id`, com pouca mudança estrutural.

### Decisão do modelo (alinhado com a estratégia)
- **Cobrança por unidade** (cada filial é uma assinatura).
- **Padrão 1 número** de WhatsApp por unidade; **número extra é add-on**.
- Público alvo inicial: pequenas e médias; arquitetura já pronta para absorver maiores depois.

### Proposta técnica “light”
- Introduzir entidade **Conta/Grupo** (ex.: `accounts`) e relação:
  - `accounts` 1—N `barbershops`
  - usuário pode ter acesso a mais de uma barbershop via membership.
- No frontend:
  - seletor de unidade no header/sidebar (persistir última seleção).
  - rotas e queries sempre escopadas ao `barbershop_id` ativo.
- No backend:
  - auth retorna lista de unidades acessíveis.
  - endpoints passam a validar `barbershop_id` por contexto de sessão.

### Por que isso não adiciona “complexidade desnecessária”
- O banco e a API já são orientados a `barbershop_id` (multi-tenant no schema).
- O ganho de negócio é grande: permite fechar contrato com “2–3 unidades” já no MVP, sem refazer tudo depois.

---

## IA e automações: estratégia multi-modelo (custos x eficiência)

### Objetivo
Manter alta taxa de conversão e qualidade no WhatsApp, reduzindo custo variável (tokens) e risco operacional.

### Princípio 1 — Nem tudo precisa de LLM
- **Lembretes** e **follow-ups**: mensagens determinísticas (templates) + personalização por variáveis (nome, data, hora, serviço, barbeiro).
- **Regras** (opt-out, janela de horário, política de cancelamento): determinístico.

### Princípio 2 — Roteamento por complexidade (multi-modelo)
Fluxo recomendado:
- **Classificação barata** (ou heurística): identificar intenção (agendar, ver serviços, reagendar, cancelamento, humano, fora do escopo).
- **Modelo padrão** (custo baixo) para 90% das conversas.
- **Modelo “premium”** apenas quando:
  - o cliente está confuso (muitas voltas),
  - há conflito complexo de agenda,
  - precisa negociar/explicar política,
  - linguagem difícil (ex.: áudio transcrito ruim, muito ruído).

### Princípio 3 — Guardrails e qualidade como produto
Vocês já têm:
- regras para não pedir telefone, não vazar UUID, controlar emoji,
- simulação e métricas de qualidade.

Recomendação:
- Vincular “quality health” ao Premium (ou ao menos visível no Pro, avançado no Premium).
- Criar “safe mode”: se violar regras, responder curto e puxar para link público/atendimento humano.

---

## Planos, limites, add-ons e suporte (estratégia de conversão + controle de custos)

### Diretriz geral
Planos precisam:
- incentivar o upgrade pelo **valor** (automação e IA),
- e proteger margem por **limites** (conversas, números, unidades).

### Oferta (mantendo âncoras atuais)

#### Essencial — R$ 97/mês (setup e link)
**Promessa:** “organize agenda e pare de perder horário por bagunça”.
- Inclui:
  - painel com setup mínimo (serviços, barbeiros, horários, link público)
  - agendamentos manuais
  - 1 unidade
- Não inclui:
  - IA no WhatsApp
  - lembretes/follow-ups automáticos
  - integrações avançadas
- Suporte:
  - self-serve (base/FAQ)

#### Profissional — R$ 197/mês (core de valor)
**Promessa:** “WhatsApp 24h + menos no-show + recuperação automática”.
- Inclui:
  - tudo do Essencial
  - 1 número de WhatsApp por unidade
  - IA para agendamentos
  - lembrete automático (1x) + follow-up “cliente sumido”
  - integrações (API key/n8n)
- Suporte:
  - prioritário

#### Premium — R$ 349/mês (escala e padronização)
**Promessa:** “escalar atendimento e padronizar a marca”.
- Inclui:
  - tudo do Profissional
  - qualidade/health e controle avançado do agente (versões, publicar/rollback, simulação)
  - 2º lembrete (opcional) e mais fluxos de follow-up
  - relatórios mais completos (retorno, no-show, conversão WhatsApp→agendamento)
- Suporte:
  - prioritário + SLA (mesmo que simples)

### Add-ons (alavancas de receita + proteção de custo)
- **Número extra de WhatsApp**: **R$ 39 / número / mês** (por unidade).
- (Opcional futuro) **Pacote de conversas**: quando houver escala grande, introduzir limite de conversas/mês com excedente.

### Política de “sem trial” (decisão atual)
Sem trial exige:
- Onboarding extremamente guiado.
- Prova visual e prova social fortes na landing.
- Garantia simples (ex.: “cancele quando quiser” + “setup em X minutos”).

---

## Estratégia de vendas (go-to-market) para o MVP

### ICP (perfil de cliente ideal) inicial
- Barbearia pequena/média com:
  - alto volume de WhatsApp,
  - 1–8 barbeiros,
  - dono/gerente operando atendimento (dor forte de tempo),
  - perdas por demora e no-show.

### Canais de aquisição mais eficientes (Brasil, early-stage)
- **Outbound local** (WhatsApp/Instagram DM) com oferta de “setup self-serve + ajuda rápida”.
- Parcerias com:
  - fornecedores (cosméticos, máquinas),
  - influenciadores locais (barbeiros com audiência),
  - consultores de barbearias.
- Conteúdo “dor real”:
  - “quanto você perde por demora”, “roteiro anti no-show”, “mensagens prontas”.

### Pitch (curto, replicável)
- “A NavalhIA responde na hora no WhatsApp e fecha horários automaticamente.  
  Você para de perder cliente por demora e reduz falta com lembretes e reagendamento fácil.”

### Política comercial
- Sem trial: oferecer **setup 100% self-serve** + suporte prioritário nos planos Pro/Premium.
- Upsell natural:
  - mais unidade (assinatura por unidade),
  - número extra (add-on),
  - Premium para padronizar e acompanhar qualidade.

---

## Landing page — diagnóstico e proposta de alta conversão (sem “pagamento antecipado”)

### O que já está muito bom
- Hero com dor + CTA forte.
- Calculadora ROI (excelente para justificar Pro).
- Demo interativa (reduz desconfiança).
- Checkout embutido (menos fricção).

### O que hoje gera risco de churn/objeção
- Promessa de “cobra/pagamento antecipado” precisa sair (coerência).

### Estrutura recomendada (versão “alta conversão”)
1) **Hero** (WhatsApp-first, benefício quantificável, CTA)  
2) **Prova visual** (prints/gif do fluxo WhatsApp + painel)  
3) **Dor + perda** (cadeira vazia, dono preso no WhatsApp)  
4) **Como funciona** (3 passos)  
5) **Demo** (interativa)  
6) **ROI calculator** (mantenha)  
7) **Prova social** (3 depoimentos + 1 mini case)  
8) **Comparativo** (“agenda comum” vs “WhatsApp 24h + automação”)  
9) **Planos + add-ons claros** (incluindo “1 número incluso; extra R$39”)  
10) **FAQ de objeções** (IA, erro, humano, setup, WhatsApp business, LGPD)  
11) CTA final

### Copys sugeridas (exemplos prontos)

#### Hero (headline)
- Opção A: **“Sua recepcionista 24h no WhatsApp — agenda e reduz no-show automaticamente”**
- Opção B: **“Pare de perder cliente por demora no WhatsApp. A NavalhIA agenda por você.”**

#### Subheadline
- “Respostas imediatas, link de agendamento e lembretes automáticos para manter as cadeiras cheias — sem contratar recepcionista.”

#### Bullets (benefícios)
- “Cliente agenda sem esperar você responder”
- “Menos faltas com lembretes e reagendamento fácil”
- “Recuperação automática de clientes que sumiram”

#### Microcopy (confiança)
- “Setup 100% self-serve” • “Cancele quando quiser” • “Checkout seguro”

### FAQ (objeções que aumentam conversão)
- “Funciona com meu WhatsApp Business atual?” (sim)
- “Se a IA errar, eu consigo assumir?” (sim, handoff)
- “Quanto tempo para configurar?” (meta: 15–30 min)
- “Posso ter mais de um número?” (sim, add-on R$39/número/mês)
- “E se eu tiver 2 unidades?” (assinatura por unidade + painel com seletor)

---

## Checklist prático de execução (ordem que maximiza velocidade de lançamento)

### Semana 1 — Coerência + Essencial utilizável
- Remover “pagamento antecipado” da landing e do material.
- Ajustar Essencial para permitir setup mínimo (serviços/barbeiros/horários/slug).
- Revisar onboarding self-serve (checklist e estados).

### Semana 2 — Automação mínima vendável
- Lembrete automático 24h (determinístico).
- Follow-up “cliente sumido 30 dias”.
- Opt-out + registros de envio/erro.

### Semana 3 — Multi-filial light
- Entidade conta/grupo + membership.
- Seletor de unidade no painel.
- Cobrança por unidade (processo comercial + docs).

### Semana 4 — Landing “prova social + prova visual + comparativo”
- Prints/gifs reais (pelo menos 2).
- 3 depoimentos (mesmo que dos primeiros pilotos).
- Tabela comparativa e FAQ expandido.

---

## Riscos e mitigação

- **Risco: custo variável da IA crescer rápido**
  - Mitigação: roteamento multi-modelo + lembretes/follow-ups determinísticos + limites/add-ons.

- **Risco: Plano Essencial gerar churn por bloqueios**
  - Mitigação: liberar setup mínimo e posicionar Essencial como “link + organização”.

- **Risco: WhatsApp instável / bloqueios do provedor**
  - Mitigação: status/health, reprocesso, fallback (link público), e documentação de operação.

- **Risco: promessas grandes sem prova**
  - Mitigação: prova visual + prova social + casos antes/depois; demo realista.

---

## Próximos passos sugeridos (decisões que valem “1 hora” e evitam retrabalho)

1) **Definir o que é “handoff humano” no MVP** (um botão “assumir” e pausa da IA por X horas).
2) **Definir templates oficiais** de lembretes/follow-up (tom NavalhIA) e regras de horário.
3) **Escolher limites iniciais** do Pro/Premium (conversas/mês, ou “fair use”) para proteger margem.
4) **Planejar 3 provas sociais** (quem serão os primeiros pilotos e qual métrica vamos capturar).

