# Plano: Módulo Fidelidade (pontos por serviço)

## Objetivo
- Na **criação/edição de serviço**: o usuário define **pontos a ganhar** (ao realizar o serviço) e **pontos para resgatar** (para trocar o serviço no programa de fidelidade).
- Ao **concluir um atendimento**: o cliente ganha a soma dos pontos de cada serviço do agendamento.
- O cliente pode **resgatar pontos** por um serviço que tenha "pontos para resgatar" definidos.

## Estado atual
- **Clients**: já têm `loyalty_points`.
- **Services**: não têm campos de fidelidade.
- **Trigger**: ao marcar agendamento como `completed`, soma `FLOOR(price)` aos pontos (1 ponto por R$1).
- **loyalty_rewards** / **reward_redemptions**: existem no schema; hoje não são usados na UI. Podemos manter para recompensas genéricas ou usar só “resgate por serviço”.

## Escopo escolhido (resgate por serviço)
- Pontos **ganhos** e **resgatados** ficam atrelados ao **serviço** (campos no `services`).
- Recompensas “disponíveis” = lista de **serviços** com `points_to_redeem > 0` e ativos.
- Resgates = registrar que o cliente trocou X pontos por um serviço (nova tabela ou uso de `reward_redemptions` com vínculo a serviço).

---

## 1. Banco de dados

### 1.1 Tabela `services`
- `points_to_earn` INTEGER NOT NULL DEFAULT 0 — pontos que o cliente ganha ao realizar o serviço.
- `points_to_redeem` INTEGER — pontos necessários para resgatar o serviço; NULL = serviço não participa como recompensa.

### 1.2 Cálculo de pontos ao concluir atendimento
- Ajustar a função/trigger `update_client_stats_on_appointment` para, em vez de `FLOOR(NEW.price)`, somar os pontos dos serviços do agendamento:
  - Para o `appointment_id` do agendamento que virou `completed`, somar `s.points_to_earn` de cada linha em `appointment_services` (join com `services`).
  - Se um serviço foi desativado ou alterado depois, usar o valor atual de `services.points_to_earn` (comportamento por serviço atual).

### 1.3 Resgates por serviço
- **Opção A** – Nova tabela `service_redemptions`:
  - `id`, `client_id`, `service_id`, `points_spent`, `redeemed_at`
  - Simples e alinhado ao conceito “trocar pontos por este serviço”.
- **Opção B** – Reaproveitar `reward_redemptions`:
  - Adicionar `service_id` (nullable) em `loyalty_rewards` e criar um “reward” por serviço resgatável (espelhando `points_to_redeem`), ou adicionar `service_id` em `reward_redemptions` e tratar resgate por serviço como caso especial.

**Recomendação:** Opção A (`service_redemptions`) para manter o modelo claro: “pontos a trocar por serviço” definidos no próprio serviço, sem duplicar regras em `loyalty_rewards`.

---

## 2. Backend

### 2.1 Serviços (CRUD)
- Incluir `points_to_earn` e `points_to_redeem` no create/update e nas respostas (GET list, GET :id, PATCH).

### 2.2 Fidelidade
- **GET /api/loyalty/stats** (ou similar):  
  - Clientes com pontos > 0; pontos distribuídos no mês (a partir de agendamentos concluídos); resgates no mês (por `service_redemptions`).
- **GET /api/loyalty/rewards** (ou “recompensas disponíveis”):  
  - Serviços do estabelecimento com `points_to_redeem IS NOT NULL AND points_to_redeem > 0` e `is_active = true` (id, name, points_to_redeem).
- **GET /api/loyalty/ranking**:  
  - Clientes ordenados por `loyalty_points` (desc), com limite (ex.: top 50).
- **POST /api/loyalty/redeem**:  
  - Body: `{ client_id, service_id }`. Validar: cliente do estabelecimento; serviço do estabelecimento; ativo; `points_to_redeem` definido; `client.loyalty_points >= points_to_redeem`. Debitar pontos do cliente; inserir em `service_redemptions` com `points_spent = service.points_to_redeem`.
- **GET /api/loyalty/redemptions** (opcional):  
  - Listar resgates recentes (por estabelecimento), com cliente e serviço, para exibir na página Fidelidade.

### 2.3 Snapshot em agendamento
- Ao criar/atualizar agendamento, `appointment_services` já guarda `service_id`. O trigger usa o `service_id` para buscar `points_to_earn` na tabela `services` atual; não é obrigatório guardar snapshot de pontos em `appointment_services` (evita duplicar lógica).

---

## 3. Frontend

### 3.1 Página Serviços
- No formulário de criar/editar serviço:
  - **Pontos ao ganhar** (número, opcional, default 0).
  - **Pontos para resgatar** (número opcional ou “Não participa”); se vazio/null = não resgatável.
- Exibir na listagem/card do serviço (opcional): “X pts ao ganhar / Y pts para resgatar” ou “Não resgatável”.

### 3.2 Página Fidelidade
- **Cards de estatísticas** (dados reais):
  - Clientes ativos (com pontos acumulados).
  - Pontos distribuídos (este mês).
  - Recompensas resgatadas (este mês).
  - Taxa de retorno (pode ficar “Em breve” ou um indicador simples).
- **Ranking**: top clientes por pontos (tabela ou lista).
- **Recompensas disponíveis**: lista de serviços resgatáveis (nome do serviço, pontos necessários), com botão “Resgatar” que abre modal: selecionar cliente (ou buscar por nome/telefone), confirmar resgate.
- **Resgates recentes**: tabela com cliente, serviço, pontos gastos, data.

### 3.3 Clientes
- Manter exibição de `loyalty_points` (já existe). Opcional: link “Resgatar” que leva à página Fidelidade com cliente pré-selecionado.

---

## 4. Ordem sugerida de implementação
1. Migration: adicionar `points_to_earn` e `points_to_redeem` em `services`; criar `service_redemptions`; ajustar trigger de pontos.
2. Backend: services (CRUD com novos campos); rotas de fidelidade (stats, rewards, ranking, redeem, redemptions).
3. Frontend: formulário de serviços (pontos ganhar/resgatar); página Fidelidade com dados reais, ranking, recompensas e resgates.

---

## 5. Regras de negócio resumidas
- Pontos ao ganhar: aplicados por serviço ao concluir o agendamento; soma de todos os serviços do agendamento.
- Pontos para resgatar: só serviços com valor definido e ativos aparecem como recompensa.
- Resgate: debita `points_to_redeem` do cliente; não cria agendamento automático (apenas registra o resgate); o uso do “serviço grátis” pode ser combinado depois (ex.: criar agendamento com preço 0 ou flag “resgate fidelidade”).
