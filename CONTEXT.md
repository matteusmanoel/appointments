# NavalhIA (agenda da barbearia)

Contexto da conversa WhatsApp e da agenda: o cliente marca, altera e responde lembretes; o horário ocupado e a presença são fatos distintos.

## Agenda

**Agendamento**:
Horário ocupado na grade (`pending` no create). Já impede outro cliente no mesmo barbeiro/serviço/duração.
_Avoid_: reserva, booking confirmado, presença

**Aceite**:
Sim do cliente ao rascunho oferecido (serviço, barbeiro, dia, hora). Fecha o create. Não é presença.
_Avoid_: confirmar, confirmação, RSVP

**Confirmação de presença**:
Resposta ao lembrete 24h ou 2h (`pending` → `confirmed`). Inclui “sim”, “confirmo” e presença (“estarei aí”, “compareço”). Só isso gera a atividade “confirmou presença”.
_Avoid_: confirmar agendamento, ok pode confirmar (aceite), tratar “estarei aí” como pedido de serviço novo

**Lembrete 24h**:
Mensagem determinística (template) pedindo presença, cancelamento ou remarca. Ausência de resposta não muda o status.
_Avoid_: follow-up, cobrança, texto do modelo

**Lembrete 2h**:
Template na janela de 2h. Sem confirmação de presença: intima (“ainda não tivemos sua confirmação”). Com presença das 24h: só lembra (“só lembrando do seu horário com fulano daqui 2h”).
_Avoid_: RSVP 2h (quando a presença já existe), texto livre do modelo

**Fila de espera**:
Pedido de um relógio específico (dia + hora + serviço). Barbeiro opcional; o primeiro da fila é avisado quando aquela vaga abre. Com preferência de barbeiro, só inscreve se não houver outro horário dele ou se o cliente insistir naquele relógio.
_Avoid_: waitlist só por data, encaixe genérico, inscrição automática por recusa do substituto

**Disparo da fila**:
Aviso ao primeiro da fila para aceite. Só envia se faltam pelo menos 20 minutos para o horário. Dentro dessa janela, não dispara (ruído). Create só no aceite da resposta.
_Avoid_: create automático, avisar todo mundo, disparo em cima da hora

**Disparo manual**:
O operador escolhe um barbeiro e avisa quem está na fila para vir agora. O prazo é o próximo horário desse barbeiro menos a duração do serviço. Se esse próximo horário é o próprio cliente, a mensagem não traz prazo. Sem próximo horário, o prazo é o fechamento do dia. Não cria o agendamento. A entrada continua visível, marcada como avisada.
_Avoid_: create automático, prazo no horário do próprio cliente, sumir da fila ao avisar

**Recusa de horário**:
Três fatos internos: dia fechado; não cabe no expediente; barbeiro ocupado. Fechado e ocupado podem ser ditos. Não cabe: o cliente ouve só o convite para a janela que cabe, sem parecer que a loja recusou o atendimento.
_Avoid_: já está preenchido para tudo, explicar duração vs fechamento, roteiro fixo de “encerrando por hoje”

**Janela que cabe**:
Último relógio do dia pedido em que o serviço ainda entra no expediente, se esse horário ainda estiver no futuro. Só muda de dia quando esse último já passou.
_Avoid_: próximo slot qualquer, pular o dia pedido enquanto ainda cabe

**Oferta alternativa**:
Horário ou barbeiro diferente do pedido. O nome do profissional só aparece se for outra pessoa; o mesmo barbeiro entra só como horário.
_Avoid_: repetir o nome em todo slot, omitir a troca de barbeiro

## Atendimento

**Rascunho**:
Acordo em construção na conversa (serviço, barbeiro, data, hora). Omissão do turno não apaga. Close só com aceite ou nome pedido. Check de horário só com serviço já no acordo (dito agora ou já no rascunho).
_Avoid_: estado da IA, memória, contexto, serviço inferido no check

**Serviço**:
O que o cliente quer neste atendimento. Nomeado no turno já vale — não perguntar de novo. Histórico pode sugerir (“o de sempre?”); o check espera o sim.
_Avoid_: assumir combo da memória, confirmar o que já foi dito

**Pergunta de funcionamento**:
Se a loja abre naquele dia. Não grava data no rascunho.
_Avoid_: hoje = data do agendamento

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
Escolha explícita de que aquele profissional vale mais que o relógio. Fica no cliente (não só no rascunho) até ele aceitar outro ou dizer qualquer um. Enquanto vale, as ofertas são outros horários desse barbeiro.
_Avoid_: inferência de histórico como se fosse esta escolha, pin só do turno, store paralelo

## Pagamento

**PIX da loja**:
Envio da chave da barbearia no chat, independente de agendamento, serviço ou valor. Nativo se o provedor tiver; senão texto. Cobre débito, plano ou acerto avulso.
_Avoid_: PIX do horário, send_pix_plan_charge como único caminho, acoplar ao slot

**Pagamento reconhecido**:
Só vira fato no sistema se destinatário e data do comprovante estão completos e consistentes. Valor lido é informativo no feed, não critério de aceite. Sem consistência: agradecimento genérico, sem escrita.
_Avoid_: confirmed, pago no status, RSVP, exigir valor do serviço, retry

**Comprovante válido**:
Imagem ou PDF com destinatário (nome da loja ou `pix_key`) e data da transferência (hoje; ontem se madrugada). Qualquer buraco ou divergência = não atualiza o sistema.
_Avoid_: data do agendamento, valor como critério

**Comprovante recusado**:
Leitura falhou ou destinatário/data não batem. O agente não pede outro arquivo: diz que a equipe confere. Não marca pagamento reconhecido.
_Avoid_: retry de comprovante, presença confirmada
