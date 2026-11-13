# NavalhIA (agenda da barbearia)

Contexto da conversa WhatsApp e da agenda: o cliente marca, altera e responde lembretes; o horário ocupado e a presença são fatos distintos.

## Agenda

**Agendamento**:
Horário ocupado na grade (`pending` no create). Já impede outro cliente no mesmo barbeiro/serviço/duração.
_Avoid_: reserva, booking confirmado, presença

**Aceite de slot**:
Sim do cliente ao rascunho oferecido (serviço, barbeiro, dia, hora). Fecha o create de um único slot. Não é presença.
_Avoid_: confirmar, confirmação, RSVP, confundir com aceite de plano

**Aceite de plano**:
Sim do cliente ao Plano oferecido (conjunto de ações de um Turno — ex: cancelar + remarcar + cobrar). Executa todas as ações do Plano em sequência. Não é aceite de slot único. Se o cliente mudar de assunto sem confirmar, o Plano é descartado sem bloquear o fluxo.
_Avoid_: exigir confirmação quando cliente apenas se informou, tratar silêncio como aceite, bloquear conversa aguardando resposta

**Confirmação de presença**:
Resposta ao lembrete 24h ou 2h (`pending` → `confirmed`). Inclui “sim”, “confirmo” e presença (“estarei aí”, “compareço”). Só isso gera a atividade “confirmou presença”.
_Avoid_: confirmar agendamento, ok pode confirmar (aceite), tratar “estarei aí” como pedido de serviço novo

**Texto de ação**:
Frase fixa que acompanha um fato já decidido (oferta de horário, PIX, localização, lembrete). Não é geração do modelo. Se a frase afirmasse algo que o turno não estabeleceu, ela não sai.
_Avoid_: roteiro por fala do cliente, pedir ao modelo para reescrever o pin ou o lembrete

**Lembrete 24h**:
Mensagem determinística (template) pedindo presença, cancelamento ou remarca. Ausência de resposta não muda o status.
_Avoid_: follow-up, cobrança, texto do modelo

**Lembrete 2h**:
Template na janela de 2h. Sem confirmação de presença: intima (“ainda não tivemos sua confirmação”). Com presença das 24h: só lembra (“só lembrando do seu horário com fulano daqui 2h”). Se o horário natural cai antes da janela de envio, sai na abertura dessa janela, desde que faltem pelo menos 20 minutos para o horário. Com menos de 20 minutos, não sai.
_Avoid_: RSVP 2h (quando a presença já existe), texto livre do modelo

**Lembrete vigente**:
O lembrete pendente do relógio atual daquele agendamento. Sem o agendamento, ou com outro relógio, não é lembrete: não aparece e não sai, nem no disparo manual. Cada agendamento tem no máximo um de 24h e um de 2h.
_Avoid_: lembrete órfão, reenviar o texto de um horário antigo

**Fila de espera**:
Pedido de um relógio específico (dia + hora + serviço). Barbeiro opcional; o primeiro da fila é avisado quando aquela vaga abre. Com preferência de barbeiro, só inscreve se não houver outro horário dele ou se o cliente insistir naquele relógio. Relógio anterior a agora deixa de ser fila. O mesmo cliente, no mesmo dia, hora, serviço e barbeiro (quando há preferência), entra uma vez. Segundo pedido não cria outra linha; a resposta diz que ele já está na fila. Na conversa, se a fila é a intenção do turno e o relógio já está no acordo, grava neste turno. O relógio é dia, hora e serviço ditos agora ou já no acordo. Falta algum desses três: pergunta só o que falta. Não grava e não vira pendente. Se acompanha outra transação, fica pendente e é oferecida uma vez quando essa transação fecha.
_Avoid_: waitlist só por data, encaixe genérico, fila de encaixe, inscrição automática por recusa do substituto, toda fila pendente, fila só pelo painel, pendente por falta de dado, segunda linha do mesmo relógio

**Reativação**:
Sugestão única no painel de inteligência: quem pediu um relógio já passado e não tem agendamento nas últimas 48 horas, quem está sem visita há 15, 30, 45, 60 dias ou no intervalo escolhido, quem faz aniversário naquele dia, ou quem conversou no WhatsApp e não marcou há 30 dias. A mesma pessoa aparece uma vez. O operador enfileira, inclusive várias de uma vez. Nenhum envio nasce sozinho. Follow-up automático não é fila nem produto: quem estava nela é sugestão, e não há crédito de follow-up.
_Avoid_: remarketing, follow-up automático, crédito de follow-up, parabéns automático, disparo manual, duas listas

**Aniversário**:
Motivo de reativação no dia do aniversário do cliente. Não sai sozinho. Na hora de enfileirar, o operador pode trocar o texto de todo o lote; em branco, sai o texto comum de aniversário.
_Avoid_: finalidade própria, parabéns automático, desconto automático, modelo único da barbearia

**Fila de reativação**:
Reativações já escolhidas pelo operador que ainda não saíram. Saem no dia seguinte às 9h, no horário da barbearia, igual para todos. O operador vê quem está nela e quando sai, e pode tirar alguém antes do envio. Não há envio imediato. Sair não tem custo extra.
_Avoid_: fila de espera, lembretes pendentes, enviar agora, escolher a hora, crédito de follow-up

**Recusa de marketing**:
O cliente não quer reativação, inclusive aniversário. Lembrete, fila de espera e cobrança de plano continuam.
_Avoid_: opt-out geral, silenciar lembrete, silenciar cobrança, silenciar fila de espera

**Teto diário**:
No máximo 50 disparos por dia, somando cobrança de plano, reativação, lembrete, fila de espera, mensagem avulsa e campanha. Acima disso o sistema não envia e pede que o operador fale pelo WhatsApp e registre o fato no sistema depois. O aviso automático da fila, quando a vaga abre, sai mesmo depois dos 50 e entra na soma. A chave pedida no chat é atendimento e não entra nas 50.
_Avoid_: teto de 20, teto só da reativação, deixar o excedente para o dia seguinte, contar o atendimento do agente, contar o PIX do chat no teto, avulsa e campanha fora da conta

**Mensagem avulsa**:
Texto que o operador escreve para um cliente e deixa na fila de envio. Entra no teto diário, para nos 50 e espera os 3 minutos entre disparos.
_Avoid_: disparo manual da fila, atendimento do agente, follow-up automático, sair colada na mensagem anterior

**Campanha**:
O mesmo texto para vários clientes, escolhido pelo operador. Cada envio entra no teto diário, para nos 50 e espera os 3 minutos entre disparos.
_Avoid_: reativação, follow-up automático, furar o teto, sair colada na mensagem anterior

**Prioridade de disparo**:
Quem ocupa o próximo intervalo de 3 minutos quando há mais de um disparo esperando: lembrete, fila de espera, cobrança de plano, reativação, mensagem avulsa, campanha. A prioridade não encolhe o intervalo. O aviso automático da fila, quando a vaga abre, sai na hora e não espera esses 3 minutos. Não se guarda vaga para um lembrete que ainda não existe.
_Avoid_: encaixe, ordem de chegada, reativação na frente do lembrete, furar os 3 minutos fora do aviso da vaga, campanha na frente da avulsa

**Finalidade de envio**:
O motivo de uma mensagem que saiu. No centro do dia: lembrete, fila de espera, reativação, atendimento, mensagem avulsa, campanha e cobrança de plano. Aniversário conta como reativação. A chave pedida no chat conta como atendimento. Cobrança de plano no centro é o envio agendado ou o que o operador deixou na fila.
_Avoid_: encaixe, ação do agente, tratar aviso de assinatura como cobrança de plano do cliente, tratar avulsa ou campanha como reativação, tratar o PIX do chat como cobrança de plano, resumo de abertura, aviso de assinatura

**Resumo de abertura**:
Mensagem da manhã para o operador com a agenda do dia. Fora do produto.
_Avoid_: resumo para o cliente, confirmação de horário, voltar como mensagem no WhatsApp

**Aviso de assinatura**:
Mensagem para o operador quando o pagamento da assinatura da NavalhIA falha. Fora do produto.
_Avoid_: cobrança de plano do cliente, PIX do atendimento, voltar como mensagem no WhatsApp

**Cobrança de plano**:
Pedido de pagamento do plano que o cliente tem na barbearia. Manual, salvo quando o operador liga o automático naquele cliente. No automático, sai no vencimento e, se seguir em aberto, no décimo dia. Cada envio entra na central e o operador pode cancelar antes de sair. O envio, nativo ou em texto, marca como enviada a cobrança em aberto mais antiga que ainda não foi enviada. Um envio, um mês. O próximo ciclo não é marcado. Se o mês já está marcado como enviado, outro pedido ou o décimo dia reenvia a chave e não marca o mês seguinte. O mês fica pago quando o operador lança o recebimento, em dinheiro ou PIX conferido por ele.
_Avoid_: aviso de assinatura, reativação, aviso no quinto dia, automático para todos, leitura automática do banco, marcar o próximo ciclo, marcar todos os meses num envio, pedido repetido avançando o mês, pedido de plano de quem ainda não tem

**Pedido de plano**:
A pessoa ainda não tem plano e pede para assinar. Sem o nome que ela disse, o turno só pergunta o nome. Com esse nome, nasce a assinatura, sai a chave da primeira cobrança e o painel avisa com som próprio, diferente de agendar, reagendar e cancelar.
_Avoid_: aviso de assinatura, nome do contato, criar antes do nome, tratar como agendamento, cobrança de quem já tem plano

**Cliente único do dia**:
Telefone de cliente que recebeu pelo menos uma mensagem de lembrete, fila de espera, reativação, atendimento, mensagem avulsa ou campanha naquele dia. Aniversário entra por ser reativação. Cobrança de plano não entra.
_Avoid_: contar o telefone do operador, contar bolhas como se fossem pessoas, deixar avulsa e campanha de fora

**Alerta de insistência**:
Três ou mais mensagens no mesmo dia, no mesmo telefone, entre reativação, lembrete, fila de espera, mensagem avulsa e campanha. Aniversário entra por ser reativação. Atendimento não entra. Cobrança de plano não entra.
_Avoid_: contar atendimento, contar resumo de abertura, contar aviso de assinatura, contar cobrança de plano, deixar avulsa e campanha de fora

**Alerta de falha**:
Aviso no centro só quando algo deu errado: um envio que falhou hoje, com a finalidade e o destinatário, ou a sessão do WhatsApp desconectada. Dia sem falha e sessão aberta não mostra aviso.
_Avoid_: selo de tudo certo, sem alertas no momento, nota de saúde do número

**Disparo da fila**:
Aviso ao primeiro da fila para aceite. Só envia se faltam pelo menos 20 minutos para o horário. Dentro dessa janela, não dispara (ruído). Quando a vaga abre, não espera o intervalo de 3 minutos e sai mesmo com o teto diário cheio. Create só no aceite da resposta. No registro do dia, a frase diz que avisou a fila. Não usa a palavra encaixe.
_Avoid_: create automático, avisar todo mundo, disparo em cima da hora, ofereceu encaixe

**Disparo manual**:
O operador escolhe um barbeiro e avisa quem está na fila para vir agora. O prazo é o próximo horário desse barbeiro menos a duração do serviço. Se esse próximo horário é o próprio cliente, a mensagem não traz prazo. Sem próximo horário, o prazo é o fechamento do dia. Não cria o agendamento. A entrada continua visível, marcada como avisada.
_Avoid_: create automático, prazo no horário do próprio cliente, sumir da fila ao avisar

**Recusa de horário**:
Três fatos internos: dia fechado; não cabe no expediente; barbeiro ocupado. Fechado e ocupado podem ser ditos. Não cabe: o cliente ouve só o convite para a janela que cabe, sem parecer que a loja recusou o atendimento.
_Avoid_: já está preenchido para tudo, explicar duração vs fechamento, roteiro fixo de “encerrando por hoje”

**Janela que cabe**:
Último relógio do dia pedido em que o serviço ainda entra no expediente, se esse horário ainda estiver no futuro. Só muda de dia quando esse último já passou.
_Avoid_: próximo slot qualquer, pular o dia pedido enquanto ainda cabe

**Primeiro horário**:
Abertura do dia pedido, com o mesmo serviço e o mesmo barbeiro, depois de conferir se está livre. Se a abertura já passou, é o próximo relógio desse dia em que o serviço ainda cabe. O horário que o cliente já tem não é o primeiro horário. Abertura ocupada oferece outro horário desse barbeiro.
_Avoid_: recitar o agendamento existente, trocar de profissional, oferecer a janela que cabe no lugar da abertura

**Hora antes da abertura**:
Hora dita antes de a loja abrir, quando a mesma hora à tarde ainda cabe no expediente. Vale a hora da tarde. Não vira a abertura e não pergunta manhã ou noite. Se a tarde também cair fora, pergunta. Não grava enquanto o relógio estiver fora do expediente.
_Avoid_: tratar 6h como 9h, perguntar manhã ou noite quando a manhã é impossível

**Oferta alternativa**:
Horário ou barbeiro diferente do pedido. O nome do profissional só aparece se for outra pessoa; o mesmo barbeiro entra só como horário.
_Avoid_: repetir o nome em todo slot, omitir a troca de barbeiro

## Atendimento

**Rascunho**:
Acordo em construção na conversa (serviço, barbeiro, data, hora). Cobre um único slot. Omissão do turno não apaga campos já preenchidos. Close só com aceite de slot ou nome pedido. Check de horário só com serviço já no acordo (dito agora ou já no rascunho).
_Avoid_: estado da IA, memória, contexto, serviço inferido no check, confundir com Plano

**Remarcar**:
Pedido de outro relógio para o horário que a pessoa já tem, ou para o que acabou de ser cancelado nesta conversa. Leva o serviço e o barbeiro desse horário. Esse serviço fica até a pessoa nomear outro do catálogo. “Meu corte”, com o horário já sendo o combo, mantém o combo. O sim a esse combo pergunta o dia e a hora. Não cria enquanto o dia não for dito. Pode dizer que o relógio antigo foi cancelado.
_Avoid_: recomeçar perguntando o serviço, tratar como cliente novo, criar sem dia, partir o combo, perguntar combo ou só o corte

**Nome da pessoa**:
Nome que a pessoa disse na conversa. Só esse aparece na resposta. O nome do contato no WhatsApp não é nome da pessoa. Se o cadastro só tem o contato, a frase sai sem nome.
_Avoid_: chamar pelo push name, nome empresarial do WhatsApp, nome do contato

**Saudação com horário**:
Saudação quando há horário futuro. Cita só o próximo. O texto é fixo e começa pela pergunta: se está tudo certo com esse horário, com o serviço, o barbeiro e a hora. Em seguida, diz que para cancelar ou reagendar basta dizer o novo dia e horário. O nome só entra se for nome da pessoa. Um sim a essa pergunta deixa o horário como está: não confirma presença, não cria e não reagenda. Os outros horários entram só se ela pedir para consultar. Sem horário futuro, oferece ver os serviços ou marcar.
_Avoid_: primeiro contato, pedir o serviço de novo, confirmar presença, criar horário, listar todos os horários na saudação

**Plano**:
Conjunto de ações propostas pelo agente em um único Turno. Pode incluir múltiplos slots, cancelamento + reagendamento, ou cobrança + agendamento. Complementa o Rascunho (que cobre um slot em construção). Efetivado com Aceite de plano. Se o cliente mudar de assunto, o Plano é descartado sem bloquear o fluxo.
_Avoid_: substituir o Rascunho, tratar como estado persistente, bloquear o fluxo aguardando resposta, tratar silêncio como aceite

**Serviço**:
O que o cliente quer neste atendimento. Nomeado no turno já vale — não perguntar de novo. Histórico pode sugerir (“o de sempre?”); o check espera o sim.
_Avoid_: assumir combo da memória, confirmar o que já foi dito

**Pergunta de funcionamento**:
Se a loja abre naquele dia. Antes da abertura, o dia continua aberto: a resposta é o horário em que abre. "Já encerramos" só depois do fechamento. O dia seguinte entra quando o expediente desse dia já acabou. Não grava data no rascunho.
_Avoid_: hoje = data do agendamento, tratar antes da abertura como dia encerrado

**Data do rascunho**:
Dia do possível agendamento. Só entra com intenção de marcar ou com aceite da oferta de dia (“pode ser” depois de “amanhã, que tal?”).
_Avoid_: hoje da pergunta de expediente

**Bolhas**:
Um turno vira mais de uma mensagem só quando há dois movimentos (fato + pergunta, resumo + aceite). Teto de 3. Sem ponto final terminando a bolha.
_Avoid_: sempre 2–3, muro de um parágrafo, ponto no fim da frase

**Resumo de aceite**:
Antes do create, o cliente vê dia da semana + data + hora. **Hoje** e **amanhã** entram na frente (`Hoje, domingo 20/09 às 17h` / `Amanhã, segunda 21/09 às 17h`). Do terceiro dia em diante, só `Terça, 22/09 às 17h`.
_Avoid_: só “amanhã às 17h”, omitir a data no fechamento, relativo além de amanhã

**Preferência de barbeiro**:
Escolha explícita de que aquele profissional vale mais que o relógio. Fica no cliente (não só no rascunho) até ele aceitar outro ou dizer qualquer um. Enquanto vale, as ofertas são outros horários desse barbeiro. Horário dele ocupado oferece outro horário dele. A fila desse relógio só entra se não houver outro, ou se ele recusar a alternativa e ficar nesse.
_Avoid_: inferência de histórico como se fosse esta escolha, pin só do turno, store paralelo, trocar de profissional no mesmo relógio sem o cliente nomear outro

## Pagamento

**PIX da loja**:
Envio da chave da barbearia no chat, independente de agendamento, serviço ou valor. Nativo se o provedor tiver; senão texto. Cobre débito, plano ou acerto avulso. Sem envio nativo, a chave sai em texto e a resposta não diz que o PIX falhou. Sem cobrança de plano em aberto, a chave sai e nada é marcado. A resposta não diz que um mês foi cobrado. O mês do plano só fecha quando o operador lança o recebimento.
_Avoid_: PIX do horário, send_pix_plan_charge como único caminho, acoplar ao slot, dizer que não conseguiu mandar, inventar cobrança, dizer que um mês foi cobrado sem cobrança em aberto

**Pagamento reconhecido**:
Só vira fato no sistema se destinatário e data do comprovante estão completos e consistentes. Valor lido é informativo no feed, não critério de aceite. Sem consistência: agradecimento genérico, sem escrita.
_Avoid_: confirmed, pago no status, RSVP, exigir valor do serviço, retry

**Comprovante válido**:
Imagem ou PDF com destinatário (nome da loja ou `pix_key`) e data da transferência (hoje; ontem se madrugada). Qualquer buraco ou divergência = não atualiza o sistema.
_Avoid_: data do agendamento, valor como critério

**Comprovante recusado**:
Leitura falhou ou destinatário/data não batem. O agente não pede outro arquivo: diz que a equipe confere. Não marca pagamento reconhecido.
_Avoid_: retry de comprovante, presença confirmada

## Agente

**Evento**:
Mensagem individual entregue pelo WhatsApp (um webhook). Unidade de protocolo; pode chegar em rajada. Não tem semântica de negócio. O agente nunca responde Evento a Evento — acumula na janela de debounce.
_Avoid_: tratar como Turno, responder a cada mensagem isolada, atualizar estado por Evento

**Turno**:
Conjunto de Eventos do cliente acumulados desde a última resposta do agente (janela de debounce), processados como unidade pelo Orchestrator, mais a resposta gerada. O Orchestrator decide o fato e a ação. O modelo só redige. Estado de conversa só muda na fronteira de Turno. Unidade dos cenários golden do benchmark.
_Avoid_: processar Evento por Evento, atualizar estado no meio do pulso, escrever contratos de benchmark por Evento, modelo decidindo o fato, loop de ferramentas como dono do turno

**Fato do turno**:
O que o turno gravou ou verificou. A resposta só afirma isso. Gravação feita não pode ser dita como falha. Se o texto do modelo fosse dizer o contrário, ou se denunciar a máquina, ele não sai: no lugar sai o fato que o turno já estabeleceu. Repetir esse fato pode. Sem fato nenhum, o turno fica em silêncio.
_Avoid_: reinterpretar sucesso como falta de dado, explicar erro técnico ao cliente, fato que o turno não estabeleceu, “não entendi”, handoff para tapar o buraco

**Intenção**:
Interpretação semântica estruturada do Turno. O Understanding Engine extrai; o Orchestrator resolve com o estado atual. Conjunto fechado de 12 tipos:

`schedule` · `reschedule` · `cancel` · `presence` · `waitlist` · `payment` · `plan` · `consult` · `location` · `hours` · `handoff` · `unknown`

Regras de resolução (determinísticas, não no prompt):
- `schedule` com memória (confiança ≥ 0.5 em `client_ai_memory`): pula coleta, propõe horários com serviço e barbeiro recordados.
- `reschedule` + `cancel` simultâneos: `reschedule` prevalece. `cancel` implícito só quando não houver pedido de nova data.
- Múltiplas intenções no mesmo Turno: uma transacional por Turno (`reschedule` › `cancel` › `schedule` › `presence`) é tratada primeiro. `payment`, `location`, `hours` e `consult` são companheiras e rodam no mesmo Turno. `plan` vira **intenção pendente** e é oferecida uma única vez quando a transação fecha. `waitlist` como intenção do turno, com o relógio já no acordo, grava neste turno. `waitlist` que acompanha outra transação vira **intenção pendente** e é oferecida uma única vez quando essa transação fecha. Um sim curto grava só o que já está aberto, nesta ordem: aceite de slot, confirmação de presença, aceite de plano, fila. Slot oferecido ganha dos outros. Sem slot, lembrete vigente e intenção `presence` confirmam presença; `unknown` pergunta e não confirma. Sem slot e sem lembrete, aceite de plano fecha o Plano oferecido. Sem esses, a fila grava se o turno anterior a ofereceu e o relógio já está no acordo. Sem nada disso aberto, não grava. Qualquer outro pedido descarta a pendente.
- `unknown` com > 8 tokens e não saudação: registrar em `backend/benchmark/suggestions/new-intents.jsonl`; resposta objetiva, sem gravação, nunca ação destrutiva nem handoff automático. Handoff só em dois Turnos consecutivos abaixo de 0.35.
- Novos tipos exigem atualização deste glossário antes de implementar.

_Avoid_: detectores booleanos exclusivos, heurísticas de palavras-chave para intenção comercial, fallback para saudação em falha de entendimento, `unknown` como catch-all silencioso, `unknown` gravando fila, horário ou cobrança

**Estado de conversa**:
O que o Orchestrator lê ao início do Turno. Persiste no banco. Muda apenas ao fim do Turno, nunca no meio.

| Estado | Significado |
|---|---|
| `idle` | nenhuma ação pendente |
| `collecting` | rascunho em construção, campos faltando |
| `awaiting_name` | rascunho completo, aguardando confirmação de nome (push name da API pode ser nome empresarial) |
| `slot_offered` | slot apresentado, aguardando aceite de slot |
| `plan_offered` | Plano apresentado — **não bloqueante** |
| `reminder_24h_pending` | lembrete 24h enviado, aguardando confirmação de presença |
| `reminder_2h_pending` | lembrete 2h enviado, aguardando confirmação |
| `handoff` | humano ativo, agente silencioso |
| `closed` | conversa encerrada |

Regras determinísticas:
- `plan_offered` + novo intent ≠ `{aceite_plano, recusa_plano}` → processar novo intent normalmente, limpar estado `plan_offered`.
- `intent.confidence < HANDOFF_LOW_CONFIDENCE_THRESHOLD` (0.35) em dois Turnos consecutivos → acionar handoff. Threshold é constante nomeada no código, nunca inline.

_Avoid_: estado implícito no prompt, múltiplas fontes de verdade, transição de estado fora da fronteira de Turno, `awaiting_name` como campo de `collecting` (é estado separado por garantia de identidade)

**Resultado de Turno**:
O que o Orchestrator produz ao fim do Turno. Logado no trace estruturado; não persiste como Estado de conversa. Base dos contratos dos cenários golden.

| Resultado | Transição de estado |
|---|---|
| `appointment_created` | → `idle` |
| `appointment_updated` | → `idle` |
| `appointment_cancelled` | → `idle` |
| `reminder_sent` (24h \| 2h \| cobrança) | → estado correspondente ou `idle` |
| `reminder_confirmed` | → `idle` |
| `plan_offered` | → `plan_offered` |
| `handoff_triggered` | → `handoff` |
| `name_confirmed` | → próximo passo do rascunho |

_Avoid_: tratar Resultado como Estado persistente, usar Resultado anterior como pré-condição sem verificar Estado atual
