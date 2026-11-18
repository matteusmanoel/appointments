/**
 * Base rotulada do entendimento de um turno. Frases "real" vêm de benchmark/real-conversations.md
 * e o número é a linha da conversa. Frases "natural" cobrem jeitos comuns de pedir a mesma coisa.
 */
import type { ConversationState, IntentType } from "../types.js";

export type UnderstandingCase = {
  text: string;
  expected: IntentType;
  source: "real" | "natural";
  line?: number;
  state?: ConversationState;
};

export type CriticalCase = {
  text: string;
  mustNot: IntentType;
  state?: ConversationState;
};

const real = (expected: IntentType, rows: Array<[number, string]>, state?: ConversationState): UnderstandingCase[] =>
  rows.map(([line, text]) => ({ text, expected, source: "real", line, ...(state ? { state } : {}) }));

const natural = (expected: IntentType, rows: string[], state?: ConversationState): UnderstandingCase[] =>
  rows.map((text) => ({ text, expected, source: "natural", ...(state ? { state } : {}) }));

export const UNDERSTANDING_CASES: UnderstandingCase[] = [
  ...real("schedule", [
    [4, "Quero agendar um corte e barba com o Lucas na próxima segunda as 10h"],
    [67, "Quero agendar meu corte para a proxima segunda as 18:30h, o Lucas teria disponibilidade?"],
    [231, "Pode ser corte e barba amanha as 18:30 com Eduardo"],
    [347, "O lucas pode me atender hoje as 18?"],
    [373, "Quero cortar meu cabelo"],
    [380, "Seria só com o Lucas mesmo, tem amanhã?"],
    [440, "Preciso cortar meu cabelo"],
    [518, "Teria apos as 18?"],
    [521, "Amanhã apos as 18 com o Lucas, tem?"],
    [577, "Olá tudo bem? Quero agendar com Lucas amanhã às 10. Ele tem disponibilidade?"],
    [686, "Oi quero agenda esse serviço novamente"],
    [690, "Hoje as 15h pode ser"],
    [732, "Gostaria de agendar com Lucas amanhã às 10. Ele tem disponibilidade?"],
    [797, "Ola! Gostaria de agendar um horario com Lucas amanha as 18. Ele esta disponivel?"],
  ]),
  ...natural("schedule", [
    "Quero marcar um corte",
    "queria marcar uma barba pra sexta",
    "tem vaga pra hoje?",
    "tem horário amanhã de manhã?",
    "dá pra dar um tapa no visual sexta de tarde?",
    "to precisando dar um trato na barba",
    "consegue me encaixar depois do almoço?",
    "queria passar aí sábado cedo",
    "bora marcar pra semana que vem",
    "me vê um horário com o Eduardo",
    "qual o próximo horário livre?",
    "tem como cortar hoje ainda?",
    "preciso aparar a barba amanhã",
    "quero fazer o combo no sábado",
    "marca pra mim às 14h",
    "me agenda amanhã às 9",
    "posso ir aí agora?",
    "ainda dá tempo de cortar hoje?",
    "quero cortar com o Lucas",
    "agendar corte",
    "preciso de um horário urgente",
    "sexta depois das 18 tem?",
    "tem algo pro fim da tarde?",
    "gostaria de um horário para meu filho",
    "vou querer corte e barba amanhã",
    "tem horário pra hoje à noite?",
    "quero dar uma aparada no cabelo",
    "consegue um horário pra mim e pro meu irmão?",
    "depois do trabalho dá pra passar aí?",
  ]),

  ...real("reschedule", [
    [31, "Quero reagendar meu corte para terça as 13h, o Lucas teria disponibilidade?"],
    [100, "Gostaria de reagenda para terça as 10h"],
    [399, "Pode só ajustar o servico de corte e barba as 18h para amanhã, terça-feira"],
    [415, "Pode reagendar para amanhã no mesmo horario, por gentileza"],
    [629, "Quero reagendar para amanha as 15h"],
    [670, "Quero reagendar para as 16h"],
    [707, "Quero reagendar para amanha no primeiro horário, é possível?"],
    [748, "Pode reagendar para as 18h?"],
    [777, "Quero remarcar"],
    [842, "Quero reagendar para as 18:30 com o Lucas"],
    [853, "Quero reagendar para as 15h"],
  ]),
  ...natural("reschedule", [
    "preciso remarcar meu horário",
    "dá pra remarcar?",
    "não vai dar pra ir nesse horário, joga pra quinta",
    "consegue mudar meu horário pra mais tarde?",
    "atrasei, dá pra passar pras 17h?",
    "troca pra sexta",
    "muda meu corte pra amanhã",
    "posso trocar o dia?",
    "adia meu horário pra semana que vem",
    "queria antecipar meu horário",
    "pode passar pra mais cedo?",
    "mudei de ideia, quero ir na quinta em vez de quarta",
    "tem como transferir pra sábado?",
    "preciso alterar a data do meu agendamento",
    "empurra pra depois das 18",
    "reagenda pra mim",
    "vou me atrasar, consegue mudar pra 16h?",
    "melhor deixar pra quinta, pode trocar?",
  ]),

  ...real("cancel", [
    [62, "Surgiu um imprevisto, não vou poder ir"],
    [603, "Quero cancelar"],
    [666, "Não poderei ir"],
  ]),
  ...natural("cancel", [
    "cancela meu horário",
    "preciso cancelar",
    "desmarca pra mim",
    "pode desmarcar amanhã",
    "pode tirar meu nome de amanhã",
    "deixa pra lá, não vou mais",
    "hoje não rola, fica pra próxima",
    "desisti do corte",
    "não vou conseguir comparecer",
    "não vou mais precisar do horário",
    "pode liberar meu horário",
    "fiquei doente, não vou",
    "cancela tudo",
    "quero desmarcar meu corte",
    "não vou conseguir ir amanhã, pode cancelar",
    "tive um problema, cancela pra mim por favor",
  ]),

  ...real("consult", [
    [29, "Gostaria de consultar meu agendamento, pra quando ficou mesmo?"],
    [58, "Pra quando ficou meu agendamento?"],
    [95, "Quero consultar meu agendamento, pra quando ficou mesmo?"],
    [98, "Segunda a que horas ficou agendado?"],
    [157, "Gostaria de consultar as informacoes do meu agendamento, pra quando ficou?"],
    [413, "Gostaria de consultar meu horário, pra quando ficou mesmo?"],
    [625, "Oi, qual é meu horario mesmo?"],
    [668, "Olá, gostaria de consultar meu agendamento"],
    [705, "Pra quando ficou meu horario?"],
    [773, "Quero consultar meu horario"],
    [817, "Maravilha, pra quando ficou meu agendamento mesmo?"],
    [839, "Pra quando ficou mesmo?"],
  ]),
  ...natural("consult", [
    "que horas eu marquei?",
    "tenho algo marcado essa semana?",
    "me lembra o dia do meu corte",
    "qual dia ficou?",
    "com quem ficou meu horário?",
    "esqueci meu horário",
    "meu horário é hoje?",
    "tá marcado pra quando?",
    "ver meus agendamentos",
    "confere pra mim se tenho horário amanhã",
  ]),

  ...real("payment", [
    [248, "Pode me mandar a chave PIX para já deixar acertado?"],
    [296, "Pode me mandar a chave pix?"],
    [425, "Pode me mandar a chave pix para já deixar certo?"],
    [541, "Pode me mandar a chave PIX de vocês?"],
    [621, "Sim, qual a chave pix?"],
    [623, "A chave PIX, por gentileza."],
    [639, "Qual chave PIX, por gentileza?"],
    [650, "Me manda o pix"],
    [700, "Qual a chave PIX?"],
  ]),
  ...natural("payment", [
    "como faço pra pagar?",
    "passa o pix aí",
    "quanto te devo?",
    "quero acertar o que devo",
    "quero pagar agora",
    "manda os dados pra transferência",
    "pix de vocês é qual?",
    "posso pagar adiantado?",
    "vou fazer o pagamento",
    "segue o comprovante do pagamento",
  ]),

  ...real("plan", [[607, "Quero pagar meu plano mensal de 200,00 que está atrasado"]]),
  ...natural("plan", [
    "vocês têm mensalidade?",
    "quero assinar o clube",
    "como funciona o plano mensal?",
    "quero assinar um plano",
    "quanto é a assinatura?",
    "tem pacote mensal?",
    "quais planos vocês têm?",
    "quero aderir ao plano",
    "tem plano com corte ilimitado?",
  ]),

  ...real("location", [
    [64, "Onde fica a loja?"],
    [92, "Onde fica a barbearia?"],
    [430, "Qual endereco de voces?"],
    [663, "Manda a loc"],
  ]),
  ...natural("location", [
    "qual o endereço?",
    "como chego aí?",
    "fica perto de onde?",
    "me manda a localização",
    "manda o mapa",
    "vocês ficam em qual bairro?",
    "qual a rua de vocês?",
    "me passa o endereço completo",
    "onde vocês ficam?",
  ]),

  ...real("hours", [
    [165, "Vocês abrem amanha?"],
    [223, "Olá tudo bem? Estão abertos hoje?"],
  ]),
  ...natural("hours", [
    "até que horas vocês ficam abertos?",
    "funciona domingo?",
    "sábado abre?",
    "qual o horário de funcionamento?",
    "abre feriado?",
    "que horas vocês fecham hoje?",
    "que horas abre amanhã?",
    "tá aberto agora?",
  ]),

  ...real("handoff", [[609, "Falar com a equipe"]]),
  ...natural("handoff", [
    "quero falar com o dono",
    "me passa pra um atendente",
    "tem alguém de verdade aí?",
    "quero falar com uma pessoa",
    "chama o gerente",
    "preciso falar com um humano",
    "posso falar com o Lucas direto?",
    "me transfere pra alguém",
  ]),

  ...real("waitlist", [[848, "Vou precisar que seja neste horario das 18:30, se o Lucas liberar me avise."]]),
  ...natural("waitlist", [
    "se o Lucas liberar me avise",
    "me coloca na fila de espera",
    "se abrir uma vaga às 18h me chama",
    "me avisa se surgir horário amanhã",
    "quero entrar na lista de espera",
    "caso alguém desista, me chama",
    "fico na espera dessa vaga",
  ]),

  ...real(
    "presence",
    [
      [724, "Estarei aí"],
      [768, "Vou sim"],
      [830, "Pode confirmar minha presença"],
      [832, "Sim"],
    ],
    "reminder_24h_pending",
  ),
  ...natural(
    "presence",
    ["confirmo", "pode contar comigo", "tô indo sim", "confirmado", "vou comparecer", "claro, estarei lá", "combinado, vou sim"],
    "reminder_24h_pending",
  ),

  ...natural("unknown", [
    "Olá, tudo bem?",
    "Bom dia",
    "Obrigado",
    "Até",
    "valeu",
    "kkkkk",
    "beleza",
    "ok",
  ]),
];

/** Frases em que entender errado grava algo que o cliente não pediu. */
export const CRITICAL_CASES: CriticalCase[] = [
  { text: "não quero cancelar, só saber o horário", mustNot: "cancel" },
  { text: "não vou cancelar não", mustNot: "cancel" },
  { text: "cancelar? não, deixa marcado", mustNot: "cancel" },
  { text: "meu amigo cancelou, sobrou vaga?", mustNot: "cancel" },
  { text: "se eu precisar cancelar tem multa?", mustNot: "cancel" },
  { text: "até quando posso cancelar?", mustNot: "cancel" },
  { text: "não precisa remarcar, tá ótimo", mustNot: "reschedule" },
  { text: "não quero mudar meu horário", mustNot: "reschedule" },
  { text: "até quando dá pra remarcar?", mustNot: "reschedule" },
  { text: "não sei se confirmo ainda", mustNot: "presence", state: "reminder_24h_pending" },
  { text: "sim, mas preciso mudar o horário", mustNot: "presence", state: "reminder_24h_pending" },
  { text: "confirmo não", mustNot: "presence", state: "reminder_24h_pending" },
  { text: "não vou poder confirmar agora", mustNot: "presence", state: "reminder_24h_pending" },
  { text: "vou ver e te falo", mustNot: "presence", state: "reminder_24h_pending" },
  { text: "acho que sim, te confirmo depois", mustNot: "presence", state: "reminder_24h_pending" },
  { text: "pode ser que eu vá", mustNot: "presence", state: "reminder_24h_pending" },
];
