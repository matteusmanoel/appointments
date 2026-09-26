import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Slide data
// ---------------------------------------------------------------------------

interface Slide {
  img: string;
  label: string;
  sub: string;
  tag: string;
}

const SLIDES: Slide[] = [
  {
    img: "/lp-painel-feed.png",
    label: "Feed de Atividade",
    sub: "Cada agendamento, lembrete e reativação aparece em tempo real.",
    tag: "live",
  },
  {
    img: "/lp-painel-agenda.png",
    label: "Próximos Atendimentos",
    sub: "Agenda do dia organizada. Saiba quem vem e a que horas.",
    tag: "hoje",
  },
  {
    img: "/lp-painel-lembretes.png",
    label: "Lembretes Pendentes",
    sub: "Fila de lembretes automáticos. A IA envia; você acompanha.",
    tag: "automático",
  },
];

const INTERVAL_MS = 3500;

// ---------------------------------------------------------------------------
// Live events feed (right column)
// ---------------------------------------------------------------------------

interface LiveEvent {
  icon: string;
  text: string;
  time: string;
}

const LIVE_EVENTS: LiveEvent[] = [
  { icon: "✅", text: "Rafael · Corte agendado · hoje 14h", time: "agora" },
  { icon: "🔔", text: "Lembrete enviado · Carlos · amanhã 10h", time: "1min" },
  { icon: "🔄", text: "Bruno reagendou · sexta 16h", time: "3min" },
  { icon: "💬", text: "Follow-up · Maria · 42 dias sem visita", time: "5min" },
  { icon: "✅", text: "Thiago confirmou presença · hoje 18h", time: "7min" },
  { icon: "🔔", text: "Lembrete enviado · João · amanhã 15h", time: "9min" },
];

function LiveFeed({ activeSlide }: { activeSlide: number }) {
  const [visibleCount, setVisibleCount] = useState(2);

  // Reveal one more event per slide advance
  useEffect(() => {
    setVisibleCount((prev) => Math.min(prev + 1, LIVE_EVENTS.length));
  }, [activeSlide]);

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
          Feed ao vivo
        </p>
      </div>
      {LIVE_EVENTS.slice(0, visibleCount).map((ev, i) => (
        <div
          key={i}
          className="flex items-start gap-2 p-2.5 rounded-lg border border-white/6 bg-white/[0.03] transition-all duration-400"
          style={{
            opacity: i === visibleCount - 1 ? 1 : 0.7,
            animation: i === visibleCount - 1 ? "count-in 0.4s ease-out both" : "none",
          }}
        >
          <span className="text-base leading-none mt-0.5 shrink-0">{ev.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-white/75 leading-tight truncate">{ev.text}</p>
          </div>
          <span className="text-[9px] font-mono text-white/25 shrink-0 mt-0.5">{ev.time}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ active, duration }: { active: boolean; duration: number }) {
  return (
    <div className="h-px bg-white/10 overflow-hidden rounded-full">
      <div
        key={active ? "running" : "reset"}
        className="h-full bg-primary origin-left"
        style={
          active
            ? {
                animation: `progress-fill ${duration}ms linear forwards`,
              }
            : { transform: "scaleX(0)" }
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LpPlatformCarousel() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const advance = () => setActive((p) => (p + 1) % SLIDES.length);

  // Auto-advance
  useEffect(() => {
    if (paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(advance, INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paused]);

  // Pause when tab hidden
  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const goTo = (i: number) => {
    setActive(i);
    // Reset timer
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!paused) {
      intervalRef.current = setInterval(advance, INTERVAL_MS);
    }
  };

  return (
    <section className="px-4 py-16 md:py-24">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-xs font-mono text-primary/80 tracking-widest uppercase mb-3">
            Painel Inteligência
          </p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
            Você afia.{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400">
              A NavalhIA corta.
            </span>
          </h2>
          <p className="text-white/50 max-w-md mx-auto">
            Um painel em tempo real para saber exatamente o que acontece
            na sua barbearia — de qualquer lugar.
          </p>
        </div>

        {/* Desktop layout: browser frame left + live feed right */}
        <div className="grid lg:grid-cols-[1fr_280px] gap-5 items-start">
          {/* Browser frame */}
          <div className="rounded-2xl border border-white/10 overflow-hidden bg-[#0e0e18] shadow-[0_32px_80px_rgba(0,0,0,0.5)]">
            {/* Browser chrome bar */}
            <div className="flex items-center gap-2 px-4 py-3 bg-[#16161f] border-b border-white/8">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
              </div>
              <div className="flex-1 mx-3">
                <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-md max-w-[280px] mx-auto">
                  <svg className="w-3 h-3 text-white/25 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  <span className="text-[11px] text-white/30 font-mono truncate">
                    navalhia.com.br/app/inteligencia
                  </span>
                </div>
              </div>
            </div>

            {/* Slide image with crossfade */}
            <div className="relative overflow-hidden bg-[#0a0a12]" style={{ aspectRatio: "16/9" }}>
              {SLIDES.map((slide, i) => (
                <img
                  key={slide.img}
                  src={slide.img}
                  alt={slide.label}
                  loading="lazy"
                  className={cn(
                    "absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-500",
                    i === active ? "opacity-100" : "opacity-0",
                  )}
                />
              ))}
              {/* Vignette bottom */}
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0e0e18] to-transparent pointer-events-none" />
            </div>

            {/* Tab controls + progress */}
            <div className="px-5 pt-4 pb-5">
              {/* Progress bar */}
              <ProgressBar active={!paused} duration={INTERVAL_MS} key={`${active}-${paused}`} />

              {/* Tabs */}
              <div className="flex gap-2 mt-4 flex-wrap">
                {SLIDES.map((slide, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className={cn(
                      "flex-1 min-w-[80px] text-left px-3 py-2.5 rounded-xl border transition-all duration-200 text-[12px]",
                      i === active
                        ? "border-primary/40 bg-primary/10 text-white"
                        : "border-white/8 bg-white/[0.02] text-white/40 hover:text-white/65 hover:border-white/15",
                    )}
                  >
                    <p className="font-medium truncate">{slide.label}</p>
                    <p className="text-[10px] text-white/30 mt-0.5 truncate">{slide.sub}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live feed column (desktop only) */}
          <div className="hidden lg:block rounded-2xl border border-white/8 bg-white/[0.02] p-4 backdrop-blur-sm">
            <LiveFeed activeSlide={active} />
          </div>
        </div>

        {/* Mobile: live feed below as collapsible card */}
        <div className="lg:hidden mt-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
          <LiveFeed activeSlide={active} />
        </div>
      </div>
    </section>
  );
}
