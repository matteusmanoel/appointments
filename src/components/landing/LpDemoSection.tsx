import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  Fragment,
} from "react";
import { cn } from "@/lib/utils";
import { RotateCcw, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MsgFrom = "user" | "agent" | "note";

interface Msg {
  from: MsgFrom;
  text: string;
  tag?: string;
  time?: string;
}

interface BackstageTag {
  icon: string;
  text: string;
}

interface PainelEvent {
  type: "agendamento" | "lembrete" | "inativo" | "pausa";
  label: string;
  sub: string;
  time: string;
}

interface Cenario {
  label: string;
  messages: Msg[];
  backstage: Record<string, BackstageTag>;
  painel: Record<string, PainelEvent>;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const CENARIOS: Record<string, Cenario> = {
  horario: {
    label: "Horário hoje",
    messages: [
      { from: "user", text: "Oi! Quero agendar um corte pra hoje.", time: "09:12" },
      { from: "agent", text: "Oi! Que bom falar com você 😊", time: "09:12" },
      { from: "agent", text: "Hoje tenho horários às *10h*, *14h* e *17h30*. Qual fica melhor?", time: "09:12", tag: "slots" },
      { from: "user", text: "14h tá ótimo.", time: "09:13" },
      { from: "agent", text: "Reservado! ✅\nHoje às *14h* — seu nome?", time: "09:13" },
      { from: "user", text: "Rafael.", time: "09:13" },
      { from: "agent", text: "Perfeito, Rafael! Te esperamos às 14h.\nVou te mandar um lembrete uma hora antes 🔔", time: "09:14", tag: "agendamento" },
    ],
    backstage: {
      slots: { icon: "📅", text: "Horários disponíveis listados para hoje" },
      agendamento: { icon: "✅", text: "Rafael · hoje 14h · lembrete agendado" },
    },
    painel: {
      agendamento: { type: "agendamento", label: "Rafael · Corte", sub: "Hoje 14h00", time: "agora" },
    },
  },
  reagendar: {
    label: "Reagendar",
    messages: [
      { from: "user", text: "Preciso mudar meu horário de amanhã às 10h.", time: "16:05" },
      { from: "agent", text: "Achei o agendamento, pode deixar!", time: "16:05", tag: "encontrado" },
      { from: "agent", text: "Prefere outro dia ou só outro horário amanhã?", time: "16:05" },
      { from: "user", text: "Amanhã mesmo, mas às 15h se tiver.", time: "16:06" },
      { from: "agent", text: "15h está livre! O horário das 10h foi liberado ✅", time: "16:06", tag: "reagendado" },
      { from: "agent", text: "Amanhã às *15h* confirmado. Qualquer coisa é só chamar!", time: "16:06" },
    ],
    backstage: {
      encontrado: { icon: "🔍", text: "Agendamento localizado: amanhã 10h" },
      reagendado: { icon: "✅", text: "10h liberado · amanhã 15h confirmado" },
    },
    painel: {
      reagendado: { type: "agendamento", label: "Reagendamento", sub: "Amanhã 15h00", time: "agora" },
    },
  },
  cancelar: {
    label: "Cancelar",
    messages: [
      { from: "user", text: "Preciso cancelar meu horário de sábado.", time: "11:20" },
      { from: "agent", text: "Sábado às 10h com o Marcos, correto?", time: "11:20", tag: "confirma" },
      { from: "user", text: "Isso mesmo.", time: "11:21" },
      { from: "agent", text: "Cancelado! Sábado 10h voltou para a agenda livre 🗓️", time: "11:21", tag: "cancelado" },
      { from: "agent", text: "Quando quiser remarcar é só chamar aqui 😊", time: "11:21" },
    ],
    backstage: {
      confirma: { icon: "🗓️", text: "Sábado 10h identificado antes de cancelar" },
      cancelado: { icon: "✅", text: "Horário liberado · cliente não pressionado" },
    },
    painel: {
      cancelado: { type: "lembrete", label: "Cancelamento", sub: "Sábado 10h liberado", time: "agora" },
    },
  },
  lembrete: {
    label: "Lembrete",
    messages: [
      { from: "agent", text: "Oi, Carlos! 👋 Seu horário é amanhã às *14h* com o João.", time: "13:00" },
      { from: "agent", text: "Só confirmando: você vem? Responda *SIM* para confirmar ou *NÃO* para cancelar.", time: "13:00", tag: "lembrete_enviado" },
      { from: "user", text: "Sim!", time: "13:04" },
      { from: "agent", text: "Ótimo! Te esperamos amanhã às 14h 😊\nSe precisar mudar algo, é só chamar.", time: "13:04", tag: "confirmado" },
    ],
    backstage: {
      lembrete_enviado: { icon: "🔔", text: "Lembrete 24h enviado automaticamente" },
      confirmado: { icon: "✅", text: "Carlos confirmou presença · no-show evitado" },
    },
    painel: {
      lembrete_enviado: { type: "lembrete", label: "Lembrete enviado", sub: "Carlos · amanhã 14h", time: "13:00" },
      confirmado: { type: "agendamento", label: "Presença confirmada", sub: "Carlos · amanhã 14h", time: "agora" },
    },
  },
  sumiu: {
    label: "Cliente sumiu",
    messages: [
      { from: "agent", text: "Oi, Bruno! Tudo bem? 👋", time: "10:00" },
      { from: "agent", text: "Faz um tempo que não aparece por aqui — sentimos sua falta!", time: "10:00", tag: "followup" },
      { from: "agent", text: "Quando quiser marcar um horário, é só falar. Tenho horários disponíveis esta semana 😊", time: "10:00" },
      { from: "user", text: "Oi! Verdade, faz tempo. Tem horário na sexta?", time: "10:17" },
      { from: "agent", text: "Sexta tenho 10h, 14h e 16h. Qual você prefere?", time: "10:17", tag: "retorno" },
      { from: "user", text: "14h.", time: "10:18" },
      { from: "agent", text: "Sexta às *14h* reservado! 🎉 Até lá, Bruno!", time: "10:18", tag: "agendou" },
    ],
    backstage: {
      followup: { icon: "💬", text: "Follow-up automático: +45 dias sem visita" },
      retorno: { icon: "🔄", text: "Cliente inativo retornou ao funil" },
      agendou: { icon: "✅", text: "Bruno · sexta 14h · cliente reativado" },
    },
    painel: {
      followup: { type: "inativo", label: "Follow-up enviado", sub: "Bruno · 45 dias sem visita", time: "10:00" },
      agendou: { type: "agendamento", label: "Cliente reativado", sub: "Bruno · sexta 14h", time: "agora" },
    },
  },
  humano: {
    label: "Quero o barbeiro",
    messages: [
      { from: "user", text: "Quero falar com o dono.", time: "15:30" },
      { from: "agent", text: "Claro! Vou avisá-lo agora mesmo.", time: "15:30", tag: "pausa" },
      { from: "agent", text: "Ele vai te chamar em instantes. Enquanto isso, posso ajudar com mais alguma coisa? 😊", time: "15:30" },
      { from: "note", text: "A IA pausa. O painel mostra a conversa em espera para o dono assumir." },
    ],
    backstage: {
      pausa: { icon: "⏸️", text: "IA pausada · conversa em espera para o humano" },
    },
    painel: {
      pausa: { type: "pausa", label: "Aguardando humano", sub: "IA pausada · conversa em espera", time: "agora" },
    },
  },
};

const SCENARIO_KEYS = Object.keys(CENARIOS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THINK_MS = 700;
const BETWEEN_MSG_MS = 900;
const REDUCED_MOTION_MS = 0;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function renderText(text: string) {
  const lines = text.split(/\n/);
  return lines.map((line, li) => {
    const parts = line.split(/(\*[^*]+\*)/g);
    return (
      <Fragment key={li}>
        {parts.map((part, pi) =>
          part.startsWith("*") && part.endsWith("*") ? (
            <strong key={pi}>{part.slice(1, -1)}</strong>
          ) : (
            <span key={pi}>{part}</span>
          ),
        )}
        {li < lines.length - 1 && <br />}
      </Fragment>
    );
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <div className="flex items-end gap-1 px-3 py-2.5 bg-white/8 rounded-2xl rounded-bl-sm w-fit max-w-[80px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
        />
      ))}
    </div>
  );
}

interface WaMessageProps {
  msg: Msg;
  visible: boolean;
  roomy?: boolean;
}

function WaMessage({ msg, visible, roomy }: WaMessageProps) {
  if (msg.from === "note") {
    return (
      <div
        className={cn(
          "mx-auto text-center text-[11px] text-white/30 italic px-4 py-1.5 bg-white/[0.03] rounded-full border border-white/5 transition-all duration-300",
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
        )}
      >
        {msg.text}
      </div>
    );
  }

  const isUser = msg.from === "user";
  return (
    <div
      className={cn(
        "flex transition-all duration-300",
        isUser ? "justify-end" : "justify-start",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3",
      )}
    >
      <div
        className={cn(
          "max-w-[82%] rounded-2xl leading-relaxed",
          roomy ? "px-3.5 py-2.5 text-[15px]" : "px-3 py-2 text-[13.5px]",
          isUser
            ? "bg-[#005c4b] text-white rounded-br-sm"
            : "bg-white/10 text-white rounded-bl-sm",
        )}
      >
        {renderText(msg.text)}
        {msg.time && (
          <span className="block text-[10px] text-white/35 text-right mt-0.5">
            {msg.time}
          </span>
        )}
      </div>
    </div>
  );
}

interface PainelEventCardProps {
  event: PainelEvent;
  visible: boolean;
  delay?: number;
}

function PainelEventCard({ event, visible, delay = 0 }: PainelEventCardProps) {
  const colorMap: Record<PainelEvent["type"], string> = {
    agendamento: "bg-primary/20 text-primary",
    lembrete: "bg-warning/20 text-warning",
    inativo: "bg-info/20 text-info",
    pausa: "bg-muted-foreground/20 text-muted-foreground",
  };
  const dotMap: Record<PainelEvent["type"], string> = {
    agendamento: "bg-primary",
    lembrete: "bg-warning",
    inativo: "bg-info",
    pausa: "bg-muted-foreground",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-xl border border-white/8 bg-white/[0.03] transition-all",
        visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4",
      )}
      style={{ transitionDuration: "350ms", transitionDelay: `${delay}ms` }}
    >
      <span className={cn("mt-1 w-2 h-2 rounded-full shrink-0", dotMap[event.type])} />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-white/90 truncate">{event.label}</p>
        <p className="text-[11px] text-white/45 truncate">{event.sub}</p>
      </div>
      <span className={cn("shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-md", colorMap[event.type])}>
        {event.time}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LpDemoSection({ onAssinarClick }: { onAssinarClick?: () => void }) {
  const [activeScenario, setActiveScenario] = useState<string>("horario");
  const [visibleCount, setVisibleCount] = useState(0);
  const [showTyping, setShowTyping] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [painelEvents, setPainelEvents] = useState<PainelEvent[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const genRef = useRef(0);
  const runningRef = useRef(false);

  const cenario = CENARIOS[activeScenario];
  const msgs = cenario.messages;

  const resetDemo = useCallback(() => {
    genRef.current += 1;
    runningRef.current = false;
    setVisibleCount(0);
    setShowTyping(false);
    setIsDone(false);
    setPainelEvents([]);
  }, []);

  const runPlayback = useCallback(
    async (gen: number) => {
      if (runningRef.current) return;
      runningRef.current = true;
      const reduced = prefersReducedMotion();

      const cenarioSnap = CENARIOS[activeScenario];
      const msgsSnap = cenarioSnap.messages;

      if (reduced) {
        setVisibleCount(msgsSnap.length);
        const allEvents: PainelEvent[] = [];
        msgsSnap.forEach((m) => {
          if (m.tag && cenarioSnap.painel[m.tag]) allEvents.push(cenarioSnap.painel[m.tag]);
        });
        setPainelEvents(allEvents);
        setIsDone(true);
        runningRef.current = false;
        return;
      }

      for (let i = 0; i < msgsSnap.length; i++) {
        if (gen !== genRef.current) return;

        const msg = msgsSnap[i];
        const isAgent = msg.from === "agent";

        if (isAgent && i > 0) {
          setShowTyping(true);
          await new Promise<void>((res) => setTimeout(res, THINK_MS));
          if (gen !== genRef.current) return;
          setShowTyping(false);
        } else if (i > 0) {
          await new Promise<void>((res) => setTimeout(res, BETWEEN_MSG_MS));
          if (gen !== genRef.current) return;
        }

        setVisibleCount(i + 1);
        if (msg.tag && cenarioSnap.painel[msg.tag]) {
          setPainelEvents((prev) => [...prev, cenarioSnap.painel[msg.tag!]]);
        }

        await new Promise<void>((res) => setTimeout(res, BETWEEN_MSG_MS));
      }

      if (gen !== genRef.current) return;
      setIsDone(true);
      runningRef.current = false;
    },
    [activeScenario],
  );

  // Auto-play when in viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          resetDemo();
          setTimeout(() => {
            const gen = genRef.current;
            runPlayback(gen);
          }, 400);
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [activeScenario, resetDemo, runPlayback]);

  // Pause when tab hidden
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        genRef.current += 1;
        runningRef.current = false;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Pin the chat to the latest bubble after layout (and after the enter transition).
  useLayoutEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    pin();
    const frame = requestAnimationFrame(pin);
    const timer = window.setTimeout(pin, 340);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [visibleCount, showTyping, isDone]);

  const handleScenarioChange = (key: string) => {
    if (key === activeScenario) return;
    genRef.current += 1;
    runningRef.current = false;
    setActiveScenario(key);
    setVisibleCount(0);
    setShowTyping(false);
    setIsDone(false);
    setPainelEvents([]);
    setTimeout(() => {
      const gen = genRef.current;
      runPlayback(gen);
    }, 200);
  };

  const handleRestart = () => {
    resetDemo();
    setTimeout(() => {
      const gen = genRef.current;
      runPlayback(gen);
    }, 100);
  };

  // Plain render (not a component) so the chat node survives each new message.
  const renderPhone = (chatAreaRef: React.RefObject<HTMLDivElement>) => (
    <div className="relative mx-auto h-full w-[min(380px,100%)]">
      <div className="pointer-events-none absolute -inset-4 rounded-[44px] bg-primary/10 blur-2xl" />
      <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[40px] border border-white/15 bg-[#1a1a1a] shadow-[0_32px_64px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="flex shrink-0 items-center justify-between bg-[#111] px-6 pb-1.5 pt-4">
          <span className="font-mono text-[11px] text-white/60">09:41</span>
          <div className="flex items-center gap-1">
            <div className="relative h-2 w-5 rounded-sm border border-white/40">
              <div className="absolute inset-0.5 right-1.5 bg-white/60 rounded-sm" />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-b border-white/5 bg-[#1f2c34] px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary">
            <span className="text-xs font-bold text-white">N</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-none text-white">NavalhIA</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-green-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
              online
            </p>
          </div>
        </div>
        <div
          ref={chatAreaRef}
          className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-[#0d1117] px-4 pb-5 pt-4"
        >
          <div className="text-center">
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/30">HOJE</span>
          </div>
          {msgs.slice(0, visibleCount).map((msg, i) => (
            <WaMessage key={`${activeScenario}-${i}`} msg={msg} visible roomy />
          ))}
          {showTyping && <TypingIndicator />}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-white/5 bg-[#1f2c34] px-4 py-3">
          <div className="flex h-9 flex-1 items-center rounded-full bg-white/8 px-3">
            <span className="text-xs text-white/25">Mensagem</span>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-white">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <section
      id="demo"
      ref={containerRef}
      className="relative scroll-mt-[4.75rem] px-4 py-10 md:flex md:h-[calc(100dvh-4.75rem)] md:flex-col md:overflow-hidden md:py-4"
    >
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_60%,hsl(239_84%_62%/0.06),transparent)]" />

      <div className="mx-auto flex w-full max-w-6xl flex-col md:min-h-0 md:flex-1">
        {/* Header */}
        <div className="mb-4 text-center md:mb-5">
          <p className="mb-2 text-xs font-mono uppercase tracking-widest text-primary">
            Demo interativa
          </p>
          <h2 className="mb-2 font-display text-3xl font-bold text-white md:text-4xl">
            Veja funcionar{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400">
              na prática
            </span>
          </h2>
          <p className="text-white/55 max-w-lg mx-auto text-base">
            Escolha um cenário e assista a NavalhIA atendendo.
            Tudo que acontece no whats, aparece em {" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400">
            tempo real no painel.
            </span>
          </p>
        </div>

        {/* === DESKTOP LAYOUT === */}
        <div className="hidden min-h-0 flex-1 md:grid md:grid-cols-[200px_minmax(0,1fr)_260px] md:items-stretch md:gap-5">
          {/* Scenarios column */}
          <div className="flex flex-col gap-1.5 self-center">
            <p className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-2 px-1">
              Cenários
            </p>
            {SCENARIO_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => handleScenarioChange(key)}
                className={cn(
                  "text-left px-3 py-2.5 rounded-xl text-[13px] transition-all duration-200 border",
                  activeScenario === key
                    ? "bg-primary/15 border-primary/40 text-white font-medium shadow-[0_0_16px_hsl(239_84%_62%/0.15)]"
                    : "border-transparent text-white/45 hover:text-white/75 hover:bg-white/5",
                )}
              >
                {CENARIOS[key].label}
              </button>
            ))}
            <button
              onClick={handleRestart}
              className="mt-3 flex items-center gap-2 px-3 py-2 text-[12px] text-white/30 hover:text-white/60 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reiniciar
            </button>
          </div>

          {/* Phone */}
          <div className="flex min-h-0 min-w-0 flex-col items-center">
            <div className="flex min-h-0 w-full flex-1 justify-center">
              {renderPhone(chatRef)}
            </div>
            <div className="relative mt-3 h-[76px] w-full overflow-hidden">
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 flex flex-col items-center gap-2.5 pb-1 transition-all duration-700 ease-out motion-reduce:transition-none",
                  isDone
                    ? "translate-y-0 opacity-100"
                    : "pointer-events-none translate-y-full opacity-0",
                )}
                aria-hidden={!isDone}
              >
                <p className="text-[12px] text-white/40">
                  Conversa concluída · {painelEvents.length} evento{painelEvents.length !== 1 ? "s" : ""} no painel
                </p>
                <button
                  onClick={onAssinarClick}
                  tabIndex={isDone ? 0 : -1}
                  className="lp-shimmer group relative rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-white shadow-[0_0_24px_hsl(239_84%_62%/0.4)] transition-shadow duration-300 hover:shadow-[0_0_36px_hsl(239_84%_62%/0.55)]"
                >
                  <span className="relative z-10">Assinar o Profissional →</span>
                  <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary to-violet-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                </button>
              </div>
            </div>
          </div>

          {/* Intelligence panel */}
          <div className="h-fit self-start rounded-2xl border border-white/8 bg-white/[0.02] p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <p className="text-[11px] font-mono text-white/40 uppercase tracking-widest">
                Painel Inteligência
              </p>
            </div>
            {painelEvents.length === 0 ? (
              <p className="text-[12px] text-white/20">Aguardando eventos…</p>
            ) : (
              <div className="flex flex-col gap-2">
                {painelEvents.map((ev, i) => (
                  <PainelEventCard key={i} event={ev} visible={true} delay={i * 80} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* === MOBILE LAYOUT === */}
        <div className="md:hidden flex flex-col items-center gap-6">
          <button
            onClick={() => setDialogOpen(true)}
            className="lp-shimmer relative cursor-pointer px-8 py-4 rounded-2xl bg-primary text-white font-semibold text-base shadow-[0_0_32px_hsl(239_84%_62%/0.35)] hover:shadow-[0_0_48px_hsl(239_84%_62%/0.5)] transition-all active:scale-95"
          >
            Ver a simulação →
          </button>
          <p className="text-[12px] text-white/30">
            Funciona sem instalar nada · não usa seu WhatsApp
          </p>
        </div>

        {/* MOBILE DIALOG */}
        {dialogOpen && (
          <dialog
            open
            className="fixed inset-0 z-50 w-full h-full m-0 p-0 bg-[#0d1117] flex flex-col"
          >
            {/* WA-style header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-[#1f2c34] border-b border-white/8 shrink-0">
              <button
                onClick={() => setDialogOpen(false)}
                className="text-white/60 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-xs font-bold text-white">N</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">NavalhIA</p>
                <p className="text-[11px] text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  online
                </p>
              </div>
            </div>

            {/* Chat scroll */}
            <div
              ref={chatRef}
              className="flex-1 overflow-y-auto flex flex-col gap-2.5 px-4 py-4 scrollbar-thin"
            >
              <div className="text-center">
                <span className="text-[11px] text-white/30 bg-white/5 px-2 py-0.5 rounded-full">HOJE</span>
              </div>
              {msgs.slice(0, visibleCount).map((msg, i) => (
                <WaMessage key={`${activeScenario}-m-${i}`} msg={msg} visible={true} />
              ))}
              {showTyping && <TypingIndicator />}
              {isDone && onAssinarClick && (
                <div className="text-center pt-4 animate-fade-in">
                  <button
                    onClick={() => { setDialogOpen(false); onAssinarClick(); }}
                    className="lp-shimmer cursor-pointer px-6 py-3 rounded-xl bg-primary text-white font-semibold text-sm shadow-[0_0_24px_hsl(239_84%_62%/0.4)]"
                  >
                    Assinar o Profissional →
                  </button>
                </div>
              )}
            </div>

            {/* Input bar decorative */}
            <div className="flex items-center gap-2 px-4 py-3 bg-[#1f2c34] border-t border-white/5 shrink-0">
              <div className="flex-1 h-8 rounded-full bg-white/8 px-3 flex items-center">
                <span className="text-[12px] text-white/25">Mensagem</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                </svg>
              </div>
            </div>

            {/* Bottom bar: restart + scenario */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#111] border-t border-white/5 shrink-0">
              <button
                onClick={() => { handleRestart(); }}
                className="text-white/40 hover:text-white/70 flex items-center gap-1.5 text-[12px]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reiniciar
              </button>
              <select
                value={activeScenario}
                onChange={(e) => { handleScenarioChange(e.target.value); }}
                className="bg-white/5 border border-white/10 rounded-lg text-[12px] text-white/70 px-2 py-1"
              >
                {SCENARIO_KEYS.map((key) => (
                  <option key={key} value={key} className="bg-[#1a1a1a]">
                    {CENARIOS[key].label}
                  </option>
                ))}
              </select>
            </div>
          </dialog>
        )}
      </div>
    </section>
  );
}
