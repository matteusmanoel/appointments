# Configuração do WhatsApp e Agente de IA — Referência das abas

Guia das opções disponíveis na tela **Integrações** (stepper WhatsApp) do NavalhIA, para que você consiga configurar o agente e a base de conhecimento de forma autônoma.

---

## Abas do stepper

1. **Conectar** — Parear o número WhatsApp (QR ou código), status da conexão, pausar/retomar a IA, enviar mensagem de teste.
2. **Horários** — Funcionamento semanal, exceções (feriados, fechamentos), intervalos de indisponibilidade.
3. **Cérebro** — Identidade do agente, tom de voz, comportamentos, modelo de IA, tokens por resposta, simulação de digitação, **base de conhecimento**.
4. **Testar e publicar** — Simular conversa, publicar alterações, reverter para versão anterior.
5. **Notificações** — Lembretes e follow-ups automáticos.
6. **Chaves de API** — Gerar chaves para n8n ou outras integrações.

No topo das abas há **Tutorial** (passo a passo para usuário) e **Documentação** (API para desenvolvedores).

---

## Cérebro: identidade e configurações do agente

- **Identidade do agente**: nome exibido, apelido, papel/função, assinar mensagens (sim/não e estilo).
- **Tom de voz e comportamentos**: configurados na mesma aba (presets e opções).
- **Modelo de IA** (planos Premium): modelo padrão (ex.: GPT-4o mini) e modelo premium para escalonamento em conversas longas.
- **Máx. tokens por resposta**: limite de tamanho da resposta (ex.: 350 para respostas mais curtas no WhatsApp).
- **Simular digitação**: atraso antes de enviar cada mensagem, para parecer mais natural.

As alterações na aba Cérebro são salvas como **rascunho**. Para o agente passar a usar a nova configuração, é preciso **publicar** na aba **Testar e publicar**.

---

## Base de conhecimento (plano Premium)

A **base de conhecimento** permite anexar documentos (PDF, Word, texto) que o agente usa para responder (RAG). Disponível para plano **Premium**.

- Se o armazenamento de documentos **não estiver configurado** neste ambiente, a própria tela exibe uma mensagem de auto-serviço e links para o **Tutorial** e a **Documentação** (API).
- Com armazenamento configurado: use o botão **Adicionar documento**, escolha o arquivo (PDF, .docx, .txt, .md). O sistema gera uma URL de upload, você envia o arquivo e em seguida o processamento (extração de texto, divisão em blocos e indexação) é enfileirado. Em alguns minutos o documento aparece como **Pronto** e passa a ser usado nas respostas do agente.

**Fluxo técnico** (para integrações ou suporte):

1. `POST /api/integrations/whatsapp/knowledge/documents` — retorna `upload_url` e `id`.
2. `PUT` do arquivo na `upload_url` (presigned S3).
3. `POST /api/integrations/whatsapp/knowledge/documents/:id/complete` — dispara o job de processamento.

Na documentação in-app (**Documentação** → grupo **WhatsApp e Agente de IA**) estão listados todos os endpoints: configurações do agente, publicar/reverter, versões, config da base de conhecimento, fontes e documentos.

---

## Publicar e reverter

- **Publicar**: cria uma nova **versão** do agente (com snapshot das configurações e da base de conhecimento) e a ativa. O agente passa a usar essa versão nas próximas conversas.
- **Reverter**: escolha uma versão anterior na lista e clique em reverter. As configurações e o prompt daquela versão são restaurados e ativados.

Assim você pode testar mudanças e, se necessário, voltar a uma versão estável sem "contato com suporte".

---

## Documentação da API

Use o botão **Documentação** no stepper (ou acesse `/docs` no app) para:

- Ver todos os endpoints da API (Autenticação, NavalhIA, Barbeiros, Serviços, Clientes, Integrações, **WhatsApp e Agente de IA**, Ferramentas).
- Abrir um endpoint diretamente pela URL: `/docs?id=whatsapp-ai-settings-get` (exemplo).
- Testar chamadas (Try it) com token e body.

Isso permite que você mesmo consiga conferir payloads, códigos de status e integrar o agente ou a base de conhecimento com outros sistemas.
