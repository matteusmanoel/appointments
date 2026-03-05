# Mapeamento: WhatsApp Setup Stepper × Planos

Referência para o tutorial de usuário. Ordem e nomenclatura seguem a UI em `WhatsAppSetupStepper.tsx` e `ConnectTab.tsx`.

## Planos e acesso ao stepper

| Plano        | Acesso à página Integrações | Abas do stepper disponíveis |
|-------------|-----------------------------|-----------------------------|
| **Essencial** | Não (gate "Integrações é plano Profissional") | Nenhuma. Foco: Serviços, Barbeiros, Horários, Configurações (link público). |
| **Profissional** | Sim | Conectar, Horários, Cérebro, Testar e publicar, Notificações, Chaves de API. Base de conhecimento: bloqueada (gate Premium). |
| **Premium**   | Sim | Todas as abas + Base de conhecimento (RAG) na aba Cérebro. |

---

## Aba 1 — Conectar

**Onde:** `ConnectTab.tsx` (conteúdo injetado como `connectStepContent`).

**Configuração manual / ações:**
- Aceitar uso responsável (dois checkboxes) antes de habilitar "Conectar WhatsApp".
- Opcional: informar número para código de pareamento (em vez de só QR).
- Clicar em **Conectar WhatsApp** → aparece QR e/ou código.
- No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → escanear QR ou inserir código.
- Após conectado: **Assumir atendimento** (pausa IA), **Retomar IA**, **Desconectar**, **Adicionar novo número** (portal de cobrança), **Mensagem de teste** (número + texto opcional).
- **Diagnóstico:** botão "Testar conectividade" → exibe API (ok/erro) e Uazapi (ok ou mensagem de erro).

**Pré-requisitos práticos:** número dedicado recomendado; celular com internet; não usar para disparos em massa. `webhook_warning` (retornado por `whatsappApi.start`): se o backend exibir aviso, o webhook da Uazapi pode não estar apontando para a URL pública — sem isso o sistema não recebe mensagens.

---

## Aba 2 — Horários

**Configuração manual:**
- **Horário semanal:** por dia (Seg–Dom), abrir/fechar e horário início–fim. Botão **Salvar horários**.
- **Exceções de funcionamento:** feriados e fechamentos. Botão **Adicionar exceção** → data, status (Fechado / Aberto parcial), motivo, horário parcial (se aplicável). Editar/remover por exceção.
- **Intervalos de indisponibilidade:** por dia, blocos "das X até Y" (ex.: almoço). Salvos junto com o horário semanal.

O agente usa essas informações para não sugerir horários fora do expediente.

---

## Aba 3 — Cérebro

**Configuração manual:**
- **Identidade do agente:** nome, apelido, papel/função, assinar mensagens (sim/não e estilo).
- **Tom de voz e comportamentos:** presets e opções na mesma aba.
- **Modelo de IA** (Premium): modelo padrão e modelo premium para escalonamento.
- **Máx. tokens por resposta:** campo numérico (ex.: 350 para respostas curtas).
- **Simular digitação:** checkbox.
- **Salvar rascunho** (footer): persiste alterações; o agente **só usa** após **Publicar** na aba "Testar e publicar".
- **Base de conhecimento** (Premium): upload de PDF, Word, TXT, MD. Status: Enviado → Processando → Pronto (ou Falha). Se `storage_configured` for falso, a tela exibe aviso e link para documentação.

---

## Aba 4 — Testar e publicar

**Configuração manual:**
- Simular conversa (mensagens de exemplo) para validar respostas.
- **Salvar rascunho** e **Publicar**: publicar cria nova versão e ativa; o agente passa a usar essa versão.
- **Reverter:** escolher versão anterior na lista e reverter — restaura configurações e prompt daquela versão.

---

## Aba 5 — Notificações

**Requisitos:** número conectado e worker de mensagens em execução.

**Configuração / uso:**
- Tipos de mensagem: Lembrete 24h, Lembrete 2h, Follow-up 30d.
- Lista "Últimas mensagens agendadas" com filtros por tipo e status (Na fila, Enviado, Falhou, Ignorado).
- **Créditos de follow-up:** exibição do saldo; botão para comprar mais (checkout).
- **Disparar follow-up:** seleção de clientes elegíveis (por dias sem agendamento), confirmação e "Disparar follow-up".

---

## Aba 6 — Chaves de API

**Configuração manual:**
- **Nova chave:** nome (ex.: n8n) → chave exibida uma vez; copiar e guardar.
- Uso: integrações externas (ex.: n8n) com header `X-API-Key`.
- Revogar: chave deixa de funcionar (401).

---

## Resumo por plano (para o tutorial)

- **Essencial:** não acessa o stepper; guiar em Serviços, Barbeiros, Horários, Configurações e link público.
- **Profissional:** todas as abas exceto Base de conhecimento; conectar → horários → cérebro → publicar → notificações → chaves.
- **Premium:** igual ao Pro + Base de conhecimento na aba Cérebro.
