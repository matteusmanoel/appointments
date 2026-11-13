olinma# Avaliação humana — versão 2.0

Relógio da bateria: sexta 25/09/2026, por volta de 01:35–01:45 (America/Sao_Paulo).
Cliente de teste `5545988230845` → loja `5545988432998`. Cada cenário aberto limpou o contexto desse telefone antes de rodar.

Este arquivo é a referência da conversa que queremos. A frase pode variar. O que não pode variar é o efeito: o horário certo, a pessoa certa, o tom do lembrete, uma cobrança só. Onde a versão 1 já estava clara, a conversa antiga permanece e não foi reexecutada.

Como ler cada cenário aberto:

- **Conversa** é o que saiu agora no WhatsApp.
- **Agenda** é o que ficou no banco ao fim daquele cenário, só para o telefone 0845.
- **Leitura** é o que a conversa orbitou, ou deixou de orbitar.
- **Seu comentário** fica em branco de propósito.

Lembretes: o worker só envia entre 09h e 20h. Nesta madrugada a bateria mandou o template real pelo número da loja e gravou na conversa, para a resposta seguinte nascer nesse contexto. O cliente fantasma `Undefined` / telefone `undefined` (segunda 28/09 às 10h) foi apagado no início e não voltou.

Legenda: ✅ referência estável · ⚠️ ainda aberto · ⛔️ o efeito no banco não aconteceu

---

<!-- Cenario 1: Saudação ✅ não reexecutado -->
[24/09/26, 13:15:06] Mateus Manoel: Olá, tudo bem?
[24/09/26, 13:15:22] Julia: Oi, tudo bem? Seja bem-vindo à Cavalier Barbearia!
[24/09/26, 13:15:24] Julia: Posso ajudar com algum serviço ou prefere já marcar um horário?

<!-- Cenario 2: Abertos hoje ✅ não reexecutado. Quinta 24/09 até 19h estava certo. -->
[24/09/26, 13:15:35] Mateus Manoel: Olá tudo bem? Estão abertos hoje?
[24/09/26, 13:15:50] Julia: Oi, tudo bem? Seja bem-vindo à Cavalier Barbearia! Estamos abertos hoje até às 19h. Posso ajudar com algum serviço ou prefere já marcar um horário?

<!-- Cenario 3: Aceite pede o nome e só então grava ⚠️ -->
Contexto: sem cliente prévio. O nome do WhatsApp não pode virar a pessoa do horário.

[25/09/26, 01:35] Mateus: Quero agendar um corte e barba com o Lucas na próxima segunda as 10h
[25/09/26, 01:36] Julia: Fica assim, então:
✂️ Corte e Barba
💈 Lucas Lima
📅 Segunda, 28/09 às 10h
💰 R$ 55,00
Posso confirmar?
[25/09/26, 01:36] Mateus: Sim
[25/09/26, 01:36] Julia: Para confirmar, qual seu nome?
[25/09/26, 01:37] Mateus: Mateus
[25/09/26, 01:37] Julia: Infelizmente, o horário solicitado não foi reservado. Aqui estão duas novas opções para agendar seu Corte e Barba com o Lucas Lima na segunda-feira, 28/09: 09h e 10h30. Qual dessas opções você prefere?

Agenda: vazia. Não gravou "Oficina" nem "undefined".

Leitura: o "sim" deixou de ser presença e o nome foi pedido antes de criar. A criação em si falhou. A frase "não foi reservado" é o aviso de que `create_appointment` voltou erro; o 10h da segunda não existe no banco.

Seu comentário:

<!-- Cenario 4: Consultar horário ✅ não reexecutado. Na v1 a consulta herdou o "Oficina" do cenário 3. -->
[24/09/26, 13:17:20] Mateus Manoel: Gostaria de consultar meu agendamento, pra quando ficou mesmo?
[24/09/26, 13:17:33] Julia: Olá, Oficina! Você tem um agendamento para Corte e Barba amanhã, 25/09 às 10h com o Lucas Lima. Está tudo certo com esse horário ou prefere reagendar?

<!-- Cenario 5: Reagendar o horário que já existe ⛔️ -->
Semente: sábado 26/09 às 10h, Corte e Barba, Lucas, cliente Mateus no 0845.

[25/09/26, 01:37] Mateus: Quero reagendar meu corte para terça as 13h, o Lucas teria disponibilidade?
[25/09/26, 01:38] Julia: Você gostaria de reagendar para terça-feira, 29/09 às 13h o Corte e Barba com o Lucas Lima, correto?
[25/09/26, 01:38] Mateus: Sim
[25/09/26, 01:38] Julia: Infelizmente, não consegui reagendar seu corte para terça-feira, 29/09 às 13h. O Lucas Lima não está disponível nesse horário. Posso verificar outros horários ou serviços para você?

Agenda: continuou `pending` em 26/09 às 10:00, Lucas Lima, Mateus, telefone 5545988230845, nome confirmado.

Leitura: achou o horário futuro e perguntou o novo slot (terça 29/09 às 13h). O "sim" chamou `reschedule_appointment` e a agenda não se moveu. Não há outro horário do Lucas na terça que explique a recusa.

Seu comentário:

<!-- Cenario 6: Cancelamento ✅ não reexecutado -->
[24/09/26, 13:20:35] Mateus Manoel: Surgiu um imprevisto, não vou poder ir
[24/09/26, 13:20:49] Julia: Corte e Barba de Sábado, 26/09 às 13h com o Lucas Lima cancelado. Quando quiser remarcar, é só chamar!

<!-- Cenario 7: 18:30 vira 18h ✅ não reexecutado -->
[24/09/26, 13:20:59] Mateus Manoel: Quero agendar corte e barba para hoje 18:30h, o Lucas teria disponibilidade?
[24/09/26, 13:21:17] Julia: Posso te encaixar hoje às 18h com o Lucas
[24/09/26, 13:21:19] Julia: Fica bom pra você?

<!-- Cenario 8: Lucas ocupado às 17h de amanhã ⚠️ -->
Semente: Lucas ocupado sábado 26/09 às 17h. A frase de abertura já traz barbeiro, hora e dia.

[25/09/26, 01:38] Mateus: Corte e barba amanhã às 17h com o Lucas
[25/09/26, 01:39] Julia: Nesse horário o Lucas está atendendo
Se quiser, te aviso se esse horário das 17h com ele abrir
[25/09/26, 01:39] Mateus: Fica sim
[25/09/26, 01:39] Julia: Anotei! Se o horário das 17h com o Lucas abrir, te aviso aqui.
[25/09/26, 01:39] Mateus: Por gentileza
[25/09/26, 01:40] Julia: Claro! Se precisar de mais alguma coisa, é só chamar
[25/09/26, 01:40] Mateus: Mateus
[25/09/26, 01:40] Julia: Parece que preciso do serviço que você gostaria de agendar para adicionar à fila. Você pode me informar qual serviço deseja?

Agenda: nenhum horário do 0845. Fila ativa: 26/09 às 17:00, telefone 0845, sem nome.

Leitura: não ofereceu o Eduardo. Tratou a abertura como preferência fechada e foi para a fila. "Fica sim" entrou na fila. "Por gentileza" e "Mateus" não fecharam horário. Na v1 o esperado aqui era aceitar o outro barbeiro, pedir o nome e gravar o Eduardo às 17h.

Seu comentário:

<!-- Cenario 9: Preferência de barbeiro, hora e dia ⚠️ -->
Semente: Lucas ocupado sexta 25/09 às 18h.

[25/09/26, 01:40] Mateus: O lucas pode me atender hoje as 18? Ou após
[25/09/26, 01:41] Julia: O Lucas está ocupado hoje às 18h. Ele tem horários disponíveis após esse horário.
Em seguida listou o catálogo inteiro (corte, barba, combo, sobrancelha) e perguntou serviço e horário.
[25/09/26, 01:41] Mateus: Corte e barba
[25/09/26, 01:41] Julia: Nesse horário o Lucas está atendendo
Se quiser, te aviso se esse horário das 18h com ele abrir
[25/09/26, 01:41] Mateus: Seria só com o Lucas mesmo, consegue me avisar se surgir um encaixe?
[25/09/26, 01:42] Julia: Anotei seu pedido! Se o horário das 18h com o Lucas abrir, te aviso aqui.

Agenda: nenhum horário do 0845. Fila ativa: 25/09 às 18:00, telefone 0845, sem nome.

Leitura: "ou após" foi lido como flexível, mas a resposta foi o cardápio, não outro barbeiro no mesmo dia nem o Lucas mais tarde com um horário concreto. Depois do serviço, segurou as 18h com o Lucas. A insistência final entrou na fila, que é o desfecho certo quando barbeiro, hora e dia estão pinados.

Seu comentário:

<!-- Cenario 10: PIX da loja uma vez ⚠️ -->
[25/09/26, 01:42] Mateus: Pode me mandar a chave pix para já deixar certo?
[25/09/26, 01:42] Julia: Te mandei a chave PIX aqui

Agenda: sem horário (não era o ponto). Ferramenta: `send_shop_pix`. O texto não repetiu tipo, chave nem recebedor.

Leitura: o eco em texto sumiu. Falta você olhar no aparelho se o nativo chegou uma vez só, no mesmo espírito da localização.

Seu comentário:

<!-- Cenario 11: Lembrete 24h e a resposta dentro dele ⚠️ -->
Semente: sábado 26/09 às 15h, Corte e Barba, Lucas, Mateus.
Template enviado pela bateria (fora da janela 09–20): pede presença para amanhã 26/09 às 15h.

[25/09/26, 01:42] Mateus: Estarei aí
[25/09/26, 01:43] Julia: Presença confirmada! Te esperamos Amanhã, sábado 26/09 às 15h com o Lucas Lima

Agenda: `confirmed`, 26/09 às 15:00, Lucas Lima, Mateus, 5545988230845.

Leitura: "estarei aí" confirmou o horário que o template citou. Não criou outro. No registro da bateria o template aparece colado na resposta; no WhatsApp o que vale é se ele chegou uma vez, antes do "estarei aí".

Seu comentário:

<!-- Cenario 12: Lembrete 2h sem resposta ao de 24h ⚠️ -->
Semente: sexta 25/09 às 18h, ainda `pending`.
Template: "ainda não recebemos sua confirmação" / "Você vem hoje às 18h?" / senão o horário é liberado.

[25/09/26, 01:43] Mateus: Vou sim
[25/09/26, 01:43] Julia: Presença confirmada! Te esperamos Hoje, sexta 25/09 às 18h com o Lucas Lima

Agenda: `confirmed`, 25/09 às 18:00, Lucas Lima, Mateus, 5545988230845.

Leitura: o tom urgente está no template. A resposta confirmou o 18h de hoje e o banco mudou para confirmed.

Seu comentário:

<!-- Cenario 13: Lembrete 2h depois da presença no de 24h ⚠️ -->
Semente: sexta 25/09 às 18h já `confirmed` antes do envio.
Template: "Tudo certo, Mateus! Seu horário está confirmado. Nos vemos hoje, às 18h."

[25/09/26, 01:43] Mateus: Vou sim
[25/09/26, 01:44] Julia: (repetiu o próprio template, sem frase nova)

Agenda: seguiu `confirmed` em 25/09 às 18:00. Não criou outro horário.

Leitura: o template já é só um lembrete, sem pedir presença de novo. A resposta do "vou sim" não acrescentou uma frase própria. As ferramentas chamadas foram `confirm_appointment` e `reschedule_appointment`; o horário não se moveu.

Seu comentário:

<!-- Cenario 14: Remarcar depois de cancelar ⚠️ -->
Semente: sábado 26/09 às 13h, Corte e Barba, Lucas, Mateus. Em seguida a conversa cancela.

[25/09/26, 01:44] Mateus: Surgiu um imprevisto, não vou poder ir
[25/09/26, 01:44] Julia: Corte e Barba de Amanhã, sábado 26/09 às 13h com o Lucas Lima cancelado. Quando quiser remarcar, é só chamar!
[25/09/26, 01:44] Mateus: Quero remarcar
[25/09/26, 01:45] Julia: Vamos remarcar seu horário! Você gostaria de manter o mesmo serviço, Corte e Barba, com o Lucas Lima? Se sim, qual dia e horário fica bom para você?

Agenda: o 13h de sábado saiu (cancelado). Nenhum horário novo.

Leitura: o cancelamento cita serviço, dia e barbeiro. O "quero remarcar" lembra Corte e Barba com o Lucas, mas ainda pergunta se mantém e pede dia e hora do zero. Não usa o nome nem oferece algo perto das 13h.

Seu comentário:

<!-- Cenario 15: Reagendar para as 15h ✅ não reexecutado -->
[24/09/26, 13:41:07] Mateus Manoel: Quero reagendar para as 15h
[24/09/26, 13:41:23] Julia: Mateus, você tem um agendamento hoje às 18h para Corte e Barba com o Eduardo. Você gostaria de reagendar para as 15h?

<!-- Cenario 16: Primeiro horário com o que já se sabe ⚠️ -->
Semente: sexta 25/09 às 15h, Corte e Barba, Eduardo, Mateus. Conversa zerada de propósito, para valer o cadastro e não o histórico.

[25/09/26, 01:45] Mateus: Quero reagendar para amanhã no primeiro horário, é possível?
[25/09/26, 01:45] Julia: Olá! Seja bem-vindo à Cavalier Barbearia!
Gostaria de consultar nossos serviços ou já agendar um horário?

Agenda: o horário seguiu `pending` em 25/09 às 15:00, Eduardo Gustavo, Mateus, 5545988230845. Nada foi para sábado de manhã.

Leitura: saudação de primeiro contato. Não usou o horário das 15h, o combo nem o Eduardo, e não ofereceu o primeiro horário de sábado.

Seu comentário:

<!-- Cenario 17: Fila de encaixe ✅ não reexecutado -->
[24/09/26, 13:43:58] Mateus Manoel: Quero amanhã às 18:30 com o Lucas pra sobrancelha, se tiver vaga
[24/09/26, 13:44:12] Julia: Neste horário o Lucas estará atendendo
[24/09/26, 13:44:14] Julia: Posso te encaixar com o Eduardo às 18h30. Fica bom? Ou seria só com o Lucas mesmo
[24/09/26, 13:44:22] Mateus Manoel: Sim, pode me avisar se o Lucas liberar esse horário amanhã
[24/09/26, 13:44:38] Julia: Anotei! Se o horário das 18h30 com o Lucas abrir, te aviso aqui.

<!-- Cenario 18: Plano vencido no 0845 ⚠️ -->
Semente desta vez: plano "Corte e Barba" R$ 200, assinatura ativa, cobrança `pending` com vencimento 01/08/2026.

[25/09/26, 01:45] Mateus: Quero pagar meu plano mensal de 200,00 que está atrasado
[25/09/26, 01:45] Julia: Parece que não consegui enviar a cobrança do seu plano no momento. Você pode tentar novamente mais tarde ou, se preferir, posso ajudar com outra coisa

Agenda de horário: vazia (o cenário não cria horário). Plano: continua ativo, R$ 200, cobrança ainda `pending` em 01/08. Ferramenta chamada: `send_pix_plan_charge`.

Leitura: o agente achou o plano (não disse mais que a assinatura não existe). O PIX da cobrança não saiu e o status da cobrança não mudou.

Seu comentário:

<!-- Cenario 19: Planos ✅ não reexecutado. Falta, numa bateria futura, fechar com o PIX e o pagamento. -->
[24/09/26, 13:47:42] Mateus Manoel: Vocês tem planos?
[24/09/26, 13:47:56] Julia: Temos dois planos: Corte e Barba R$ 200,00 e Plano mensal corte e barba R$ 219,90 (1x por semana, até 4 visitas).
[24/09/26, 13:48:06] Mateus Manoel: Quero assinar o de corte e barba todo mês
[24/09/26, 13:48:19] Julia: Para confirmar a assinatura, você gostaria de definir o dia do mês para a cobrança? O padrão é o dia de hoje, entre 1 e 28.

<!-- Cenario 20: Preços e continuidade ✅ não reexecutado. Falta, numa bateria futura, "E só a barba, quanto fica". -->
[24/09/26, 13:48:29] Mateus Manoel: Quero agendar meu corte para amanhã às 17h, o Lucas teria disponibilidade?
[24/09/26, 13:48:46] Julia: Para o seu agendamento amanhã às 17h com o Lucas, você gostaria de fazer o Corte masculino (R$ 35,00) ou o Corte e Barba (R$ 55,00)?
[24/09/26, 13:48:55] Mateus Manoel: Qual valor dos dois?
[24/09/26, 13:49:12] Julia: Corte masculino R$ 35,00. Corte e Barba R$ 55,00. Qual deles você gostaria de agendar para amanhã às 17h com o Lucas?

<!-- Cenario 21: "às 6" = 18h ✅ não reexecutado. Falta concluir o horário e cravar 6=18, 5=17, 4=16. -->
[24/09/26, 13:50:08] Mateus Manoel: Quero agendar com o Lucas amanha as 6
[24/09/26, 13:52:11] Mateus Manoel: Corte e barba
[24/09/26, 13:52:25] Julia: Neste horário o Lucas estará atendendo
[24/09/26, 13:52:27] Julia: Posso te encaixar com o Eduardo às 18h. Fica bom? Ou seria só com o Lucas mesmo
[24/09/26, 13:54:38] Mateus Manoel: Por gentileza

---

## O que esta bateria deixa para a próxima

Ainda abertos, nesta ordem de efeito: 3 (nome ok, gravação não), 5 (pergunta ok, agenda não muda), 16 (primeiro contato com horário já existente), 18 (plano achado, PIX da cobrança não), 14 (contexto pela metade), 8 e 9 (fila versus outro barbeiro — precisa da sua leitura), 13 (tom do 2h já confirmado), 10, 11 e 12 (falta o seu ok no aparelho).

Não reexecutados: 1, 2, 4, 6, 7, 15, 17, 19, 20, 21.
