# Tutorial: Configurar o WhatsApp no NavalhIA

Este guia explica, passo a passo, as configurações que você precisa fazer manualmente no painel para o atendimento por WhatsApp funcionar. A ordem segue as abas da tela **Integrações**.

---

## Qual é o meu plano?

- **Essencial** — Você tem painel, link de agendamento, serviços e horários. **Não há WhatsApp com IA.** Use o guia [Primeiros passos (Essencial)](PRIMEIROS_PASSOS.md) para deixar o link e a agenda prontos.
- **Profissional** — WhatsApp com IA, lembretes e follow-up. Siga este tutorial da primeira à última aba.
- **Premium** — Tudo do Profissional + base de conhecimento (documentos que a IA usa para responder) e multi-unidade.

Se você está na página **Integrações** e vê as abas (Conectar, Horários, Cérebro, etc.), seu plano já é Profissional ou Premium.

---

## Aba 1 — Conectar

Aqui você vincula o número de WhatsApp ao NavalhIA. A conexão é por **QR Code** (como o WhatsApp Web).

### Antes de começar

- Use, se possível, um **número dedicado** ao atendimento (evita misturar com uso pessoal).
- Celular com **internet estável** e WhatsApp instalado.
- O uso é para **atendimento a quem te procurar** e **reativação de clientes** — não para disparos promocionais em massa (políticas do WhatsApp).

### Passo a passo

1. Leia o aviso de **uso responsável** e marque os dois checkboxes se estiver de acordo.
2. (Opcional) Informe o número com DDD se quiser usar **código de pareamento** em vez de só QR.
3. Clique em **Conectar WhatsApp**.
4. Na tela aparece um **QR Code** (e às vezes um código de 8 dígitos).
5. No celular: abra **WhatsApp** → **Aparelhos conectados** → **Conectar um aparelho**.
6. Escaneie o QR ou digite o código.
7. Quando aparecer **Conectado** na tela, você pode enviar uma **Mensagem de teste** para outro número para confirmar que está tudo certo.

### Diagnóstico

Se algo falhar, use o botão **Testar conectividade**:

- **API: OK** e **Uazapi: OK** — a comunicação entre o servidor e o serviço de WhatsApp está ok.
- Se aparecer erro na **Uazapi**, o serviço de WhatsApp pode estar fora do ar ou o número/instância pode precisar de verificação.

### Aviso de webhook

Se o sistema mostrar um aviso sobre **webhook**: significa que o endereço que recebe as mensagens do WhatsApp pode não estar configurado corretamente no servidor. **Sem isso, o NavalhIA não recebe as mensagens.** Em caso de dúvida, entre em contato com o suporte.

### Checklist — Conectar

- [ ] Aceitei o uso responsável.
- [ ] Conectei o número via QR ou código.
- [ ] Status mostra "Conectado".
- [ ] Enviei uma mensagem de teste e recebi no outro celular.

---

## Aba 2 — Horários

O agente usa esses horários para **não sugerir** agendamento fora do expediente.

### O que configurar

1. **Horário semanal** — Para cada dia (Segunda a Domingo), defina se abre ou fecha e, se abrir, o horário de **início** e **fim**. Use **Salvar horários** ao terminar.
2. **Exceções de funcionamento** — Feriados ou dias que você fecha. Clique em **Adicionar exceção**, escolha a data, marque "Fechado" ou "Aberto parcial" (com horário reduzido) e um motivo. O agente não oferecerá horários nesses dias (ou só no intervalo parcial).
3. **Intervalos de indisponibilidade** — Por exemplo, horário de almoço em um dia da semana: adicione um bloco "das 12h às 14h" para que o agente não sugira esse período.

### Checklist — Horários

- [ ] Horário semanal preenchido e salvo.
- [ ] Exceções (feriados/fechamentos) cadastradas, se houver.
- [ ] Intervalos de almoço ou outros blocos indisponíveis configurados, se precisar.

---

## Aba 3 — Cérebro

Aqui você define **como** o agente se apresenta e responde.

### Identidade e comportamento

- **Nome, apelido e papel** — Como o agente se identifica para o cliente.
- **Assinar mensagens** — Se as respostas devem levar uma assinatura (ex.: nome da barbearia).
- **Tom de voz e comportamentos** — Presets para deixar o atendimento mais formal ou informal.

### Ajustes técnicos (em uma frase)

- **Máx. tokens por resposta** — Limite o tamanho da resposta (ex.: 350 deixa as mensagens mais curtas, ideal para WhatsApp).
- **Simular digitação** — Um pequeno atraso antes de enviar cada mensagem, para parecer mais natural.

### Rascunho x Publicar

Todas as alterações nesta aba ficam em **rascunho**. O agente **só passa a usar** depois que você for na aba **Testar e publicar** e clicar em **Publicar**. Use **Salvar rascunho** para não perder as mudanças.

### Base de conhecimento (só Premium)

Se você tem plano **Premium**, aparece a seção **Base de conhecimento**. Você pode enviar documentos (PDF, Word, texto) para a IA usar nas respostas. Eles são processados em alguns minutos e passam a aparecer como **Pronto**. Se aparecer a mensagem de que "o armazenamento ainda não está configurado", a infraestrutura de documentos ainda não foi ativada no seu ambiente — consulte a documentação técnica ou o suporte.

### Checklist — Cérebro

- [ ] Identidade e tom configurados.
- [ ] Cliquei em **Salvar rascunho**.
- [ ] (Premium) Enviei documentos na base de conhecimento, se quiser usar.

---

## Aba 4 — Testar e publicar

Aqui você **testa** o agente e **coloca em produção** as alterações.

### Testar

Use a simulação de conversa para enviar algumas mensagens (ex.: "Quero agendar", "Que horários têm amanhã?") e ver se as respostas fazem sentido.

### Publicar

Quando estiver satisfeito, clique em **Publicar**. A partir daí, o agente passa a usar essa versão nas conversas reais.

### Reverter

Se depois de publicar algo der errado, você pode **reverter** para uma versão anterior: na lista de versões, escolha a desejada e use o botão de reverter. As configurações daquela versão voltam a valer.

### Checklist — Testar e publicar

- [ ] Simulei pelo menos 2–3 trocas de mensagem.
- [ ] Cliquei em **Publicar**.
- [ ] Sei onde reverter, se precisar.

---

## Aba 5 — Notificações

Lembretes e follow-ups automáticos por WhatsApp. **Requisitos:** número conectado e serviço de mensagens em execução (no servidor).

### O que você vê

- **Lembretes (mês)** — Quantos lembretes (24h ou 2h antes do horário) foram enviados.
- **Follow-ups (mês)** — Mensagens para clientes que ficaram muito tempo sem agendar (ex.: 30 dias).
- **Últimas mensagens agendadas** — Lista com tipo (Lembrete 24h, Lembrete 2h, Follow-up 30d) e status (Na fila, Enviado, Falhou, Ignorado).

### Créditos de follow-up

O follow-up (reativar cliente inativo) usa **créditos**. Você vê o saldo na tela. Se acabar, use o botão para comprar mais créditos.

### Disparar follow-up manualmente

Você pode escolher clientes elegíveis (por exemplo, sem agendamento há 30 dias), marcar os que quer reativar e clicar em **Disparar follow-up**. As mensagens entram na fila e são enviadas pelo sistema.

### Checklist — Notificações

- [ ] Entendi que preciso de número conectado e worker ativo.
- [ ] Vi os tipos de mensagem (24h, 2h, 30d) e a lista de agendadas.
- [ ] Se uso follow-up, conferi os créditos.

---

## Aba 6 — Chaves de API

Para quem usa **n8n** ou outra integração que chama a API do NavalhIA.

### O que fazer

1. Clique em **Nova chave**.
2. Dê um nome (ex.: "n8n").
3. **Copie e guarde** a chave — ela **só aparece uma vez**. Nas requisições à API, use o cabeçalho **X-API-Key** com essa chave.
4. Se precisar invalidar uma chave, use **Revogar**; a partir daí ela deixa de funcionar (erro 401).

### Checklist — Chaves de API

- [ ] Criei uma chave se vou usar n8n ou outra integração.
- [ ] Guardei a chave em local seguro.

---

## Se der errado (resumo)

| Situação | O que fazer |
|----------|-------------|
| Fica em "Conectando…" e não conecta | Verifique internet no celular; feche outras sessões do WhatsApp Web no número; use **Testar conectividade** e, se Uazapi falhar, aguarde ou contate suporte. |
| Aviso de webhook | O endereço que recebe as mensagens pode estar incorreto no servidor. Suporte/infra precisa conferir a URL configurada na Uazapi. |
| IA não responde no WhatsApp | Confirme que está **Conectado** na aba Conectar; que você **Publicou** na aba Testar e publicar; e que não há limite de mensagens atingido (veja uso na aba Conectar). |
| "Falha ao carregar" na aba Notificações | Pode ser timeout ou worker de mensagens parado. Tente **Tentar novamente**; se persistir, verifique com suporte se o worker está rodando. |
| Base de conhecimento "não configurada" | Ambiente sem armazenamento de documentos ativado. Consulte documentação técnica ou suporte para configurar o bucket/S3. |

Para detalhes técnicos e lista de endpoints da API, use **Documentação** no topo das Integrações (ou acesse `/docs` no app).
