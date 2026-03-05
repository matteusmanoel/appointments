# Análise: WhatsApp Setup Stepper vs Backend e Melhorias

## 1. Interface para anexar documentos à memória do agente

**Sim.** O backend já expõe toda a API necessária para base de conhecimento (RAG):

- **GET/POST/PATCH** `/api/integrations/whatsapp/knowledge/sources` — categorias/fontes
- **GET** `/api/integrations/whatsapp/knowledge/documents` — listar documentos
- **POST** `/api/integrations/whatsapp/knowledge/documents` — criar documento e obter URL de upload (presigned S3)
- **POST** `/api/integrations/whatsapp/knowledge/documents/:id/complete` — após upload, dispara processamento (worker extrai texto, gera embeddings)
- **DELETE** `/api/integrations/whatsapp/knowledge/documents/:id` — remover documento
- **GET** `/api/integrations/whatsapp/knowledge/config` — indica se o S3 está configurado

O frontend em `src/lib/api.ts` já tinha os métodos `whatsappApi.knowledge.*` implementados; **faltava apenas a UI** na aba Cérebro do `WhatsAppSetupStepper`.

**Implementado:** Seção **"Base de conhecimento"** na aba Cérebro, com:

- Verificação de `storage_configured` (aviso se S3 não configurado)
- Botão "Adicionar documento" (PDF, DOCX, TXT, MD)
- Fluxo: criar documento → upload via presigned URL → complete → listar com status (enviado, processando, pronto, falha)
- Lista de documentos com status e botão excluir

Assim, o usuário passa a ter interface para anexar documentos à memória do agente, alinhada ao que o backend já entrega.

---

## 2. Compatibilidade do front com o que temos para entregar

Antes das alterações, **não estava totalmente compatível**:

| Recurso no backend | Exposto no Stepper? (antes) | Situação |
|--------------------|-----------------------------|----------|
| AI settings (modelo, temperatura, perfil, instruções) | Sim | OK |
| Identidade do agente (displayName, nickname, role, signMessages, signatureStyle) | Sim | OK |
| max_output_tokens, typing_simulation | Sim | OK |
| Handoff (pausar/retomar por conversa) | Via API; sem UI dedicada no stepper | Aceitável (pode ser em lista de conversas) |
| **Base de conhecimento (sources + documents)** | **Não** | **Corrigido** — seção "Base de conhecimento" na aba Cérebro |
| Versões do prompt / publicar / rollback | Sim (aba "Testar e publicar") | OK |
| Horários e exceções | Sim (aba Horários) | OK |
| Notificações (lembretes, follow-up) | Sim | OK |

Com a nova seção de Base de conhecimento, o front fica **compatível** com as funcionalidades que o backend oferece para o usuário final no fluxo do assistente WhatsApp.

---

## 3. Melhorias possíveis para agregar ao software

### 3.1 Base de conhecimento (curto prazo)

- **Fontes/categorias:** Usar a API de sources na UI: dropdown "Pasta" ou "Categoria" ao enviar documento; listar fontes e permitir criar/editar (nome, ativar/desativar). O backend já suporta `source_id` opcional em documentos.
- **Feedback de processamento:** Polling ou refetch periódico enquanto houver documentos com status `processing`, para atualizar "Processando…" → "Pronto" sem recarregar a página.
- **Limite de tamanho/arquivo:** Exibir aviso (ex.: máx. 10 MB) e validar no front antes do upload.
- **Tipos de arquivo:** Deixar explícito na UI: "PDF, Word (.docx), texto (.txt, .md)".

### 3.2 Cérebro / agente

- **Handoff na lista de conversas:** Botões "Assumir" / "Retomar IA" por conversa, chamando `POST .../conversations/:id/assume` e `.../resume`, para o usuário controlar quando a IA responde.
- **Configuração de handoff por keywords:** Tela ou seção para ativar/desativar "passar para humano quando o cliente disser X" e editar lista de palavras-chave (já existente em `barbershop_ai_handoff_settings`).
- **Pré-visualização de instruções:** Mostrar trecho do prompt compilado (já existe em versões) na aba Cérebro, opcional e colapsável.

### 3.3 Publicar e versões

- **Diff entre versões:** Na lista de versões, exibir diff (texto ou campos) entre a versão ativa e uma anterior antes de clicar em "Reverter".
- **Etiqueta "publicado agora":** Destacar a versão atualmente ativa (ex.: badge "Ativa") na lista de versões.

### 3.4 UX geral do stepper

- **Indicador de rascunho não salvo:** Na aba Cérebro, aviso discreto quando há alterações não persistidas (comparar estado local com `aiSettings`).
- **Acessibilidade:** Garantir labels e roles em botões/inputs da Base de conhecimento e das abas (já parcialmente feito com `aria-label` no excluir).
- **Mobile:** Revisar abas e listas (documentos, horários, exceções) em telas pequenas para evitar scroll horizontal e toques pequenos.

### 3.5 Operacional / observabilidade

- **Health da base de conhecimento:** Se houver documentos em `failed`, exibir resumo (ex.: "1 documento com falha") e, se o backend passar, mensagem de erro amigável (já mostramos `last_error` na lista).
- **Métricas de uso:** Eventos de analytics (ex.: documento adicionado, publicação, rollback) para entender uso do stepper.

---

## 4. Resumo

- **Sim,** faz sentido ter interface para anexar documentos à memória do agente; o backend já suporta e o front tinha apenas a camada de API — **a seção "Base de conhecimento" na aba Cérebro foi implementada.**
- O front no `WhatsAppSetupStepper` **agora está compatível** com o que o backend oferece para o usuário (incluindo base de conhecimento).
- As melhorias listadas acima podem ser implementadas em etapas (fontes/categorias, handoff na UI, feedback de processamento, etc.) para refinar a experiência e o controle do agente.
