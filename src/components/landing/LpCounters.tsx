import { useEffect, useRef, useState } from "react";

interface Stat {
  target: number;
  prefix?: string;
  suffix: string;
  label: string;
  sublabel: string;
  /** format number with locale dot-separator */
  formatted?: boolean;
}

const STATS: Stat[] = [
  {
    target: 1200,
    suffix: "+",
    label: "horários agendados",
    sublabel: "todo mês sem o dono intervir",
    formatted: true,
  },
  {
    target: 40,
    suffix: "%",
    label: "menos falta",
    sublabel: "de cliente após o lembrete automático",
  },
  {
    target: 30,
    suffix: "min",
    label: "pra estar pronto",
    sublabel: "do cadastro ao WhatsApp ativo",
  },
  {
    target: 24,
    suffix: "/7",
    label: "secretária disponível",
    sublabel: "sem você parar a tesoura",
  },
];

function useAnimatedCounter(target: number, duration = 1400, active: boolean) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    startRef.current = null;

    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutQuart
      const eased = 1 - Math.pow(1 - progress, 4);
      setValue(Math.round(eased * target));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, target, duration]);

  return value;
}

function Counter({ stat, active, delay }: { stat: Stat; active: boolean; delay: number }) {
  const value = useAnimatedCounter(stat.target, 1400, active);

  const display = stat.formatted
    ? value.toLocaleString("pt-BR")
    : value.toString();

  return (
    <div
      className="flex flex-col items-center text-center px-4 py-6 transition-all duration-500"
      style={{
        opacity: active ? 1 : 0,
        transform: active ? "translateY(0)" : "translateY(16px)",
        transitionDelay: `${delay}ms`,
      }}
    >
      {/* Big number */}
      <div className="font-display font-bold text-5xl md:text-6xl leading-none mb-2 bg-clip-text text-transparent bg-gradient-to-r from-primary to-violet-400 tabular-nums">
        {stat.prefix ?? ""}
        {display}
        <span className="text-3xl md:text-4xl">{stat.suffix}</span>
      </div>

      {/* Label */}
      <p className="text-white font-semibold text-sm mt-2">{stat.label}</p>
      <p className="text-white/35 text-xs mt-0.5 max-w-[140px]">{stat.sublabel}</p>
    </div>
  );
}

export function LpCounters() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          obs.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section ref={ref} className="relative px-4 py-14 md:py-20 overflow-hidden">
      {/* Mesh radial background */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 50%, hsl(239 84% 62% / 0.07) 0%, transparent 70%)",
        }}
      />
      {/* Subtle grid lines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        aria-hidden
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, hsl(239 84% 62%) 0px, transparent 1px, transparent 60px), repeating-linear-gradient(90deg, hsl(239 84% 62%) 0px, transparent 1px, transparent 60px)",
        }}
      />

      <div className="relative max-w-5xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-white/8">
          {STATS.map((stat, i) => (
            <Counter key={i} stat={stat} active={active} delay={i * 100} />
          ))}
        </div>
      </div>
    </section>
  );
}
