import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CheckCircle2, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { BillingPlan } from "@/lib/api";
import { LoadingState } from "@/components/LoadingState";
import { CheckoutModal } from "@/components/CheckoutModal";
import { WhatsAppFloatingButton } from "@/components/WhatsAppFloatingButton";
import { RoiCalculator } from "@/components/landing/RoiCalculator";
import { StickyCtaBar } from "@/components/landing/StickyCtaBar";
import { LpDemoSection } from "@/components/landing/LpDemoSection";
import { LpMarquee } from "@/components/landing/LpMarquee";
import { LpCounters } from "@/components/landing/LpCounters";
import { LpPlatformCarousel } from "@/components/landing/LpPlatformCarousel";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useFadeInOnScroll(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function FadeSection({ children }: { children: React.ReactNode }) {
  const { ref, visible } = useFadeInOnScroll();
  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
      )}
    >
      {children}
    </div>
  );
}

function GlassCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-white/8 bg-white/[0.03] backdrop-blur-sm", className)}>
      {children}
    </div>
  );
}

// Floating hero particles
const PARTICLES = [
  { size: 3, top: "18%", left: "12%", anim: "animate-float-slow", delay: "0s", opacity: 0.08 },
  { size: 5, top: "55%", left: "8%", anim: "animate-float-mid", delay: "1.2s", opacity: 0.06 },
  { size: 2, top: "30%", left: "88%", anim: "animate-float-fast", delay: "0.4s", opacity: 0.1 },
  { size: 4, top: "72%", left: "85%", anim: "animate-float-slow", delay: "2s", opacity: 0.07 },
  { size: 3, top: "82%", left: "22%", anim: "animate-float-mid", delay: "0.8s", opacity: 0.06 },
  { size: 5, top: "15%", left: "60%", anim: "animate-float-fast", delay: "1.6s", opacity: 0.05 },
];

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

export default function Landing() {
  const { profile, loading } = useAuth();

  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutInitialPlan, setCheckoutInitialPlan] = useState<BillingPlan>("pro");

  const headerRef = useRef<HTMLElement | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const heroBgRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const mouseRafRef = useRef(0);

  const openCheckout = (plan: BillingPlan = "pro") => {
    setCheckoutInitialPlan(plan);
    setShowCheckout(true);
  };

  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
    const top = window.scrollY + el.getBoundingClientRect().top - headerHeight - 12;
    window.history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const prev = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "smooth";
    return () => { document.documentElement.style.scrollBehavior = prev; };
  }, []);

  useEffect(() => {
    const raw = window.location.hash?.replace("#", "").trim();
    if (!raw) return;
    const t = window.setTimeout(() => scrollToSection(raw), 0);
    return () => window.clearTimeout(t);
  }, [scrollToSection]);

  // Hero parallax
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const bg = heroBgRef.current;
    if (!bg) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = heroRef.current?.getBoundingClientRect();
      if (!rect) return;
      const delta = rect.top / window.innerHeight;
      const translate = Math.max(-60, Math.min(60, delta * -50));
      bg.style.transform = `translate3d(0, ${translate}px, 0) scale(1.1)`;
    };
    const onScroll = () => { if (raf) return; raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener("scroll", onScroll); };
  }, []);

  // Mouse-tracking glow
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const hero = heroRef.current;
    const glow = glowRef.current;
    if (!hero || !glow) return;
    const onMouseMove = (e: MouseEvent) => {
      if (mouseRafRef.current) return;
      mouseRafRef.current = requestAnimationFrame(() => {
        mouseRafRef.current = 0;
        const rect = hero.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        glow.style.background = `radial-gradient(600px circle at ${x}% ${y}%, hsl(239 84% 62% / 0.13), transparent 60%)`;
      });
    };
    hero.addEventListener("mousemove", onMouseMove);
    return () => hero.removeEventListener("mousemove", onMouseMove);
  }, []);

  if (loading) return <LoadingState fullPage />;
  if (profile) return <Navigate to="/app" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-x-hidden">

      {/* ================================================================ NAV */}
      <header
        ref={headerRef}
        className="sticky top-0 z-40 border-b border-white/8 bg-background/80 backdrop-blur-xl"
      >
        <div className="px-4 py-3 max-w-6xl mx-auto w-full flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2">
            <img src="/navalhia-logo-header.png" alt="NavalhIA" className="h-10 w-auto object-contain" />
          </Link>

          <nav className="hidden md:flex items-center gap-0.5">
            {[
              ["Como funciona", "como-funciona"],
              ["Demo", "demo"],
              ["Calculadora", "calculadora"],
              ["Planos", "planos"],
              ["FAQ", "faq"],
            ].map(([label, id]) => (
              <a
                key={id}
                href={`#${id}`}
                className="px-3 py-1.5 text-sm text-white/50 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                onClick={(e) => { e.preventDefault(); scrollToSection(id); }}
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="ghost" size="sm" className="text-white/60 hover:text-white">Entrar</Button>
            </Link>
            <Button
              size="sm"
              onClick={() => openCheckout()}
              className="lp-shimmer bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_hsl(239_84%_62%/0.4)] hover:shadow-[0_0_28px_hsl(239_84%_62%/0.55)] transition-all"
            >
              Assinar agora
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-20 md:pb-0">

        {/* ============================================================== HERO */}
        <section
          ref={heroRef}
          className="relative min-h-[88vh] flex items-center overflow-hidden px-4 py-16 md:py-20"
        >
          {/* Parallax background */}
          <div className="absolute inset-0 overflow-hidden" aria-hidden>
            <div ref={heroBgRef} className="absolute inset-0 w-full h-full will-change-transform" style={{ transform: "translate3d(0,0,0) scale(1.1)" }}>
              <img src="/lp-hero-bg.jpg" alt="" className="w-full h-full object-cover opacity-40" loading="eager" fetchPriority="high" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background" />
            <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-background/30" />
          </div>

          {/* Mouse glow */}
          <div ref={glowRef} className="pointer-events-none absolute inset-0 transition-none" aria-hidden />

          {/* Ambient radial */}
          <div className="pointer-events-none absolute top-1/2 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full" style={{ background: "radial-gradient(circle, hsl(239 84% 62% / 0.08) 0%, transparent 70%)" }} aria-hidden />

          {/* Floating particles */}
          {PARTICLES.map((p, i) => (
            <div
              key={i}
              aria-hidden
              className={cn("absolute rounded-full bg-primary pointer-events-none", p.anim)}
              style={{
                width: p.size,
                height: p.size,
                top: p.top,
                left: p.left,
                opacity: p.opacity,
                animationDelay: p.delay,
              }}
            />
          ))}

          <div className="relative max-w-6xl mx-auto w-full grid lg:grid-cols-[1fr_420px] gap-10 lg:gap-16 items-center">
            {/* Copy */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-[12px] font-mono text-primary mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Secretária virtual · agenda enquanto você corta
              </div>

              <h1 className="font-display text-4xl md:text-5xl lg:text-[60px] font-bold leading-[1.06] text-white mb-5">
                Pare de agendar.{" "}
                <br className="hidden md:block" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400 [filter:drop-shadow(0_0_20px_hsl(239_84%_62%/0.4))]">
                  Comece a atender.
                </span>
              </h1>

              <p className="text-lg md:text-xl text-white/75 mb-8 max-w-xl leading-relaxed">
                Sua barbearia precisa girar. Você só precisa aparecer.
                Nossa secretária virtual cuida do WhatsApp, agenda horários
                e lembra seus clientes — 24 horas por dia, sem você parar a tesoura.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-8">
                <button
                  onClick={() => scrollToSection("demo")}
                  className="lp-shimmer group relative px-8 py-4 rounded-xl bg-primary text-white font-semibold text-base overflow-hidden shadow-[0_0_28px_hsl(239_84%_62%/0.45)] hover:shadow-[0_0_44px_hsl(239_84%_62%/0.6)] transition-all duration-300 hover:scale-[1.03]"
                >
                  <span className="absolute inset-0 rounded-xl ring-2 ring-primary/50 animate-ping opacity-0 group-hover:opacity-60" />
                  <span className="relative z-10 flex items-center gap-2">
                    Ver funcionando →
                  </span>
                  <span className="absolute inset-0 bg-gradient-to-r from-primary to-violet-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl" />
                </button>

                <button
                  onClick={() => openCheckout()}
                  className="lp-shimmer cursor-pointer px-8 py-4 rounded-xl border border-white/15 text-white/80 hover:text-white hover:border-white/30 hover:bg-white/5 font-medium text-base transition-all duration-200"
                >
                  Quero minha secretária
                </button>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/35 font-mono">
                {["Pronto em 30 minutos", "Sem fidelidade", "Cancele quando quiser"].map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary/70" />
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Phone mockup */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative">
                <div className="absolute -inset-10 rounded-full bg-primary/8 blur-3xl pointer-events-none" />
                <img
                  src="/lp-phone-mockup.png"
                  alt="NavalhIA no WhatsApp"
                  className="relative w-full max-w-[320px] lg:max-w-full drop-shadow-[0_32px_64px_rgba(99,102,241,0.28)] animate-float-slow"
                  loading="eager"
                />
              </div>
            </div>
          </div>

          {/* Scroll cue */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 animate-bounce opacity-30" aria-hidden>
            <div className="w-5 h-8 rounded-full border border-white/30 flex items-start justify-center pt-1.5">
              <div className="w-1 h-1.5 bg-white/60 rounded-full" />
            </div>
          </div>
        </section>

        {/* ============================================================ MARQUEE */}
        <LpMarquee />

        {/* ============================================================== DOR */}
        <FadeSection>
          <section className="px-4 py-16 md:py-24">
            <div className="max-w-6xl mx-auto">
              <div className="text-center mb-12">
                <p className="text-xs font-mono text-primary/80 tracking-widest uppercase mb-3">O problema real</p>
                <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
                  Você é barbeiro.{" "}
                  <span className="text-white/40">Não secretário.</span>
                </h2>
                <p className="text-white/55 max-w-md mx-auto">
                  Mas está sendo forçado a ser os dois. E isso tem um custo real, toda semana.
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-5">
                {[
                  {
                    icon: "✂️",
                    title: "Perdendo cliente enquanto tem a tesoura na mão",
                    desc: "Você não pode parar um corte pra responder mensagem. O cliente espera 20 minutos, desiste e vai para a concorrência — sem você nem perceber.",
                    stat: "−3h/dia no celular",
                    gradient: "bg-gradient-to-br from-red-950/50 to-[#0e0e0e]",
                    statColor: "text-red-400/80 bg-red-500/10",
                    hoverBorder: "hover:border-red-500/25",
                  },
                  {
                    icon: "💺",
                    title: "Cadeira vazia. Barbeiro esperando. Você pagando.",
                    desc: "Sem confirmação, ele simplesmente não aparece. A cadeira fica parada, o barbeiro fica ocioso e o prejuízo é seu. Todo dia.",
                    stat: "−R$ 400/mês em média",
                    gradient: "bg-gradient-to-br from-orange-950/40 to-[#0e0e0e]",
                    statColor: "text-orange-400/80 bg-orange-500/10",
                    hoverBorder: "hover:border-orange-500/20",
                  },
                  {
                    icon: "👻",
                    title: "Ele foi embora. E não voltou mais.",
                    desc: "Clientes que somem voltam quando alguém chama. Mas você não tem tempo de mandar mensagem para 50 pessoas. Então eles vão para outro lugar.",
                    stat: "−60% retenção perdida",
                    gradient: "bg-gradient-to-br from-zinc-900/80 to-[#0e0e0e]",
                    statColor: "text-zinc-400/70 bg-zinc-500/10",
                    hoverBorder: "hover:border-zinc-500/20",
                  },
                ].map((card, i) => (
                  <div
                    key={i}
                    className={cn(
                      "p-6 rounded-2xl border border-white/8 transition-all duration-300 group",
                      card.gradient,
                      card.hoverBorder,
                      "hover:shadow-[0_0_30px_rgba(0,0,0,0.4)] hover:scale-[1.02]",
                    )}
                  >
                    <div className="text-3xl mb-4">{card.icon}</div>
                    <h3 className="font-display font-semibold text-white mb-2">{card.title}</h3>
                    <p className="text-sm text-white/50 leading-relaxed mb-4">{card.desc}</p>
                    <span className={cn("text-xs font-mono px-2 py-1 rounded-md", card.statColor)}>
                      {card.stat}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-10 text-center">
                <p className="text-white/40 text-sm mb-5">
                  Se isso acontece toda semana, você está pagando caro por não ter sistema — só que paga em cadeira vazia.
                </p>
                <button
                  onClick={() => openCheckout()}
                  className="lp-shimmer cursor-pointer px-6 py-3 rounded-xl bg-white/8 border border-white/15 text-white hover:bg-white/12 hover:border-white/25 text-sm font-medium transition-all"
                >
                  Quero cadeiras cheias →
                </button>
              </div>
            </div>
          </section>
        </FadeSection>

        {/* ========================================================= ANTÍDOTO */}
        <FadeSection>
          <section className="relative px-4 py-16 md:py-24 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_50%,hsl(239_84%_62%/0.05),transparent)]" />
            <div className="max-w-6xl mx-auto">
              <div className="text-center mb-12">
                <p className="text-xs font-mono text-primary/80 tracking-widest uppercase mb-3">A solução</p>
                <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
                Tecnologia não é estética.{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400">
                  É ferramenta que gera resultado.
                  </span>
                </h2>
                <p className="text-white/50 max-w-lg mx-auto mt-3">
                  Não oferecemos logo bonita num app — entregamos uma barbearia que funciona enquanto você trabalha.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">
                <div className="p-6 rounded-2xl border border-red-500/15 bg-gradient-to-br from-red-950/30 to-[#0e0e0e]">
                  <div className="flex items-center gap-2 mb-5">
                    <XCircle className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-mono text-red-400/70 uppercase tracking-widest">Antes</span>
                  </div>
                  <ul className="space-y-3 text-sm text-white/55">
                    {[
                      "Respondendo WhatsApp enquanto corta",
                      "Cadeira vazia por cliente que não avisou",
                      "Ligação no meio do serviço, sem poder atender",
                      "Cliente sumiu — sem tempo pra chamar de volta",
                      "Agenda no papel ou só na cabeça",
                      "Esquece de lembrar quem tem horário amanhã",
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="w-1 h-1 rounded-full bg-red-400/40 mt-2 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-6 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-[#0e0e0e] shadow-[0_0_40px_hsl(239_84%_62%/0.08)]">
                  <div className="flex items-center gap-2 mb-5">
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                    <span className="text-sm font-mono text-primary/70 uppercase tracking-widest">Com a NavalhIA</span>
                  </div>
                  <ul className="space-y-3 text-sm text-white/75">
                    {[
                      "Secretária virtual atende no WhatsApp 24h",
                      "Lembrete automático antes do horário → cliente não falta",
                      "Cliente agenda sozinho, a qualquer hora",
                      "Quem sumiu recebe uma mensagem de volta",
                      "Painel mostra tudo: agenda, clientes, movimento",
                      "Você foca só no corte. O sistema cuida do resto.",
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        </FadeSection>

        {/* =========================================================== COUNTERS */}
        <LpCounters />

        {/* ============================================================= DEMO */}
        <LpDemoSection onAssinarClick={() => openCheckout()} />

        {/* =========================================================== PAINEL (carousel) */}
        <FadeSection>
          <LpPlatformCarousel />
        </FadeSection>

        {/* =========================================================== MÉTODO */}
        <FadeSection>
          <section id="como-funciona" className="px-4 py-16 md:py-24 scroll-mt-20">
            <div className="max-w-5xl mx-auto">
              <div className="text-center mb-14">
                <p className="text-xs font-mono text-primary/80 tracking-widest uppercase mb-3">Como funciona</p>
                <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
                  Pronto em 15 minutos.{" "}
                  <span className="text-white/40">Funciona 24/7 no seu whatsapp</span>
                </h2>
              </div>

              <div className="grid md:grid-cols-4 gap-4 relative">
                {/* Connector line */}
                <div
                  className="hidden md:block absolute top-[44px] left-[calc(12.5%+24px)] right-[calc(12.5%+24px)] h-px"
                  style={{ background: "linear-gradient(90deg, transparent 0%, hsl(239 84% 62% / 0.5) 20%, hsl(239 84% 62% / 0.5) 80%, transparent 100%)" }}
                  aria-hidden
                />

                {[
                  { n: "01", title: "Configure", sub: "Serviços & horários", desc: "Adicione seus serviços, barbeiros e horários disponíveis. Tudo guiado, passo a passo." },
                  { n: "02", title: "Conecte", sub: "QR no WhatsApp", desc: "Leia o QR code no seu WhatsApp. Em minutos sua secretária virtual está ativa no número." },
                  { n: "03", title: "Compartilhe", sub: "Seu link de agendamento", desc: "Manda o link pro seu cliente. Ele agenda sozinho. Você nem precisa olhar o celular." },
                  { n: "04", title: "Apareça", sub: "Só para dar o corte", desc: "A agenda fica cheia. Os clientes são lembrados. Você só aparece para trabalhar." },
                ].map((step, i) => (
                  <GlassCard key={i} className="p-5 relative z-10 group hover:border-primary/30 hover:shadow-[0_0_24px_hsl(239_84%_62%/0.1)] hover:scale-[1.02] transition-all duration-300 bg-gradient-to-b from-white/[0.04] to-[#0e0e0e]">
                    <div className="w-12 h-12 rounded-full border border-primary/40 bg-primary/10 flex items-center justify-center mb-5 group-hover:bg-primary/20 group-hover:border-primary/60 transition-all">
                      <span className="font-mono text-sm font-bold text-primary">{step.n}</span>
                    </div>
                    <p className="font-display font-semibold text-white mb-0.5">{step.title}</p>
                    <p className="text-xs font-mono text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400 mb-3">{step.sub}</p>
                    <p className="text-sm text-white/45 leading-relaxed">{step.desc}</p>
                  </GlassCard>
                ))}
              </div>
            </div>
          </section>
        </FadeSection>

        {/* =========================================================== FILTRO */}
        <FadeSection>
          <section className="px-4 py-16 md:py-20">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-10">
                <p className="text-xs font-mono text-primary/80 tracking-widest uppercase mb-3">Para quem é</p>
                <h2 className="font-display text-2xl md:text-3xl font-bold text-white">
                  Você adiciona inteligência.{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400">Foca em manter a qualidade.</span>
                </h2>
                <p className="text-white/45 mt-3 max-w-md mx-auto">
                  A praticidade do sistema garante que seus clientes voltem.
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-5">
                <div className="p-6 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/8 to-[#0e0e0e]">
                  <p className="text-sm font-mono text-primary/70 uppercase tracking-widest mb-4">✅ É para você se…</p>
                  <ul className="space-y-2.5 text-sm text-white/70">
                    {[
                      "Seus clientes já usam WhatsApp para marcar horário",
                      "Você perde tempo respondendo mensagem enquanto trabalha",
                      "Quer que a agenda se organize sozinha, sem depender de você",
                      "Sente que perde cliente por demora na resposta",
                      "Quer saber o que acontece na barbearia sem precisar estar lá",
                    ].map((t, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-6 rounded-2xl border border-white/8 bg-gradient-to-br from-zinc-900/40 to-[#0e0e0e]">
                  <p className="text-sm font-mono text-white/30 uppercase tracking-widest mb-4">❌ Não é para você se…</p>
                  <ul className="space-y-2.5 text-sm text-white/35">
                    {[
                      "Seus clientes só marcam por ligação",
                      "Você não usa WhatsApp com a clientela",
                      "Procura um software de gestão completo tipo ERP",
                      "Quer disparar promoções para desconhecidos em massa",
                    ].map((t, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-white/25 shrink-0 mt-0.5" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        </FadeSection>

        {/* ===================================================== CALCULADORA */}
        <FadeSection>
          <section id="calculadora" className="px-4 py-16 md:py-24 scroll-mt-20">
            <div className="max-w-6xl mx-auto">
              <div className="text-center mb-10">
                <p className="text-xs font-mono text-primary/80 tracking-widest uppercase mb-3">Calculadora de ROI</p>
                <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
                  Quanto você está perdendo{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400">por mês?</span>
                </h2>
                <p className="text-white/50 max-w-md mx-auto">Arraste os sliders e descubra qual plano se paga mais rápido.</p>
              </div>
              <div className="max-w-2xl mx-auto">
                <RoiCalculator onCtaClick={() => openCheckout()} />
              </div>
            </div>
          </section>
        </FadeSection>

        {/* ============================================================ PLANOS */}
        <FadeSection>
          <section id="planos" className="px-4 py-16 md:py-24 scroll-mt-20">
            <div className="max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <p className="text-xs font-mono text-primary/80 tracking-widest uppercase mb-3">Planos</p>
                <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">Escolha e comece em 2 minutos</h2>
                <p className="text-white/50 max-w-md mx-auto">Comece pequeno. Suba quando precisar. Sem fidelidade.</p>
              </div>

              <div className="grid items-stretch gap-5 md:grid-cols-3">
                <div className="flex h-full flex-col rounded-2xl border border-white/8 bg-gradient-to-b from-white/[0.03] to-[#0e0e0e] p-6 transition-all duration-300 hover:scale-[1.02] hover:border-white/15">
                  <p className="mb-1 font-display text-lg font-bold text-white">Essencial</p>
                  <p className="mb-5 text-sm text-white/40">Setup + link + agenda online</p>
                  <div className="mb-5">
                    <span className="font-display text-4xl font-bold text-white">R$ 147</span>
                    <span className="text-sm text-white/40">/mês</span>
                  </div>
                  <ul className="flex-1 space-y-2 text-sm text-white/55">
                    {["Painel e link de agendamento", "Serviços, barbeiros, horários", "Cliente agenda online 24h"].map((f) => (
                      <li key={f} className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary/70" />{f}
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => openCheckout("essential")} className="lp-shimmer mt-6 w-full rounded-xl border border-white/15 py-2.5 text-sm font-medium text-white/70 transition-all hover:border-white/30 hover:bg-white/5 hover:text-white">
                    <span className="relative z-10">Assinar</span>
                  </button>
                </div>

                <div className="relative flex h-full rounded-2xl bg-gradient-to-b from-primary/60 to-violet-500/30 p-px shadow-[0_0_56px_hsl(239_84%_62%/0.22)] transition-all duration-300 hover:scale-[1.02]">
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-[11px] font-semibold text-white shadow-[0_0_16px_hsl(239_84%_62%/0.5)]">
                    Mais escolhido
                  </div>
                  <div className="flex h-full w-full flex-col rounded-2xl bg-gradient-to-b from-[#12122a] to-[#0e0e0e] p-6">
                    <p className="mb-1 font-display text-lg font-bold text-white">Profissional</p>
                    <p className="mb-5 text-sm text-white/40">WhatsApp + lembretes + recuperação</p>
                    <div className="mb-5">
                      <span className="font-display text-4xl font-bold text-white">R$ 297</span>
                      <span className="text-sm text-white/40">/mês</span>
                    </div>
                    <ul className="flex-1 space-y-2 text-sm text-white/75">
                      {["Tudo do Essencial", "Secretária no WhatsApp", "Lembrete antes do horário", "Reagendar e cancelar pelo WhatsApp", "1 número incluso"].map((f) => (
                        <li key={f} className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />{f}
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={() => openCheckout("pro")} className="lp-shimmer mt-6 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_hsl(239_84%_62%/0.4)] transition-all hover:bg-primary/90 hover:shadow-[0_0_32px_hsl(239_84%_62%/0.55)]">
                      <span className="relative z-10">Assinar o Profissional</span>
                    </button>
                  </div>
                </div>

                <div className="flex h-full flex-col rounded-2xl border border-white/8 bg-gradient-to-b from-violet-950/20 to-[#0e0e0e] p-6 transition-all duration-300 hover:scale-[1.02] hover:border-violet-500/20 hover:shadow-[0_0_24px_hsl(250_84%_62%/0.1)]">
                  <p className="mb-1 font-display text-lg font-bold text-white">Premium</p>
                  <p className="mb-5 text-sm text-white/40">Escala + marca + multi-filial</p>
                  <div className="mb-5">
                    <span className="font-display text-4xl font-bold text-white">R$ 449</span>
                    <span className="text-sm text-white/40">/mês</span>
                  </div>
                  <ul className="flex-1 space-y-2 text-sm text-white/55">
                    {["Tudo do Profissional", "Tom da sua barbearia", "Várias unidades", "Prioridade no suporte", "1 número incluso"].map((f) => (
                      <li key={f} className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-violet-400/70" />{f}
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => openCheckout("premium")} className="lp-shimmer mt-6 w-full rounded-xl border border-white/15 py-2.5 text-sm font-medium text-white/70 transition-all hover:border-violet-500/30 hover:bg-violet-500/5 hover:text-white">
                    <span className="relative z-10">Assinar</span>
                  </button>
                </div>
              </div>

              <div className="mt-8 grid md:grid-cols-3 gap-3 max-w-3xl mx-auto text-center">
                {[["Sem fidelidade", "Cancele quando quiser, sem multa."], ["Pronto em 30 minutos", "Configuração guiada, sem complicação."], ["Pagamento seguro", "Assinatura mensal, simples assim."]].map(([title, desc], i) => (
                  <div key={i} className="p-4 rounded-xl border border-white/6 bg-white/[0.02]">
                    <p className="text-sm font-medium text-white/70">{title}</p>
                    <p className="text-xs text-white/30 mt-1">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </FadeSection>

        {/* ============================================================== FAQ */}
        <FadeSection>
          <section id="faq" className="px-4 py-16 md:py-24 scroll-mt-20">
            <div className="max-w-3xl mx-auto">
              <div className="grid md:grid-cols-[280px_1fr] gap-12 items-start">
                {/* Left label */}
                <div className="md:sticky md:top-28">
                  <p className="text-xs font-mono text-primary/80 tracking-widest uppercase mb-3">Perguntas diretas</p>
                  <h2 className="font-display text-3xl md:text-4xl font-bold text-white leading-tight mb-4">
                    O que você{" "}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400">
                      ainda quer saber.
                    </span>
                  </h2>
                  <p className="text-white/40 text-sm">
                    As cinco respostas que costumam decidir.
                  </p>
                </div>

                {/* Accordion */}
                <Accordion type="single" collapsible className="space-y-2.5">
                  {[
                    ["whatsapp", "Funciona com meu WhatsApp atual?", "Sim. Você conecta escaneando um QR code — funciona igual ao WhatsApp Web. A secretária virtual passa a atender no seu número. Quando quiser, você assume a conversa manualmente. Recomendamos usar um número exclusivo para a barbearia."],
                    ["setup", "Quanto tempo para ficar pronto?", "A maioria dos barbeiros configura em 15 a 30 minutos: adiciona os serviços, os horários e os barbeiros, gera o link e conecta o WhatsApp. Se travar em alguma etapa, o suporte te ajuda."],
                    ["contract", "Tem contrato ou fidelidade?", "Nenhum. É assinatura mensal. Se um dia não fizer sentido, você cancela sem multa, sem burocracia."],
                    ["extra-number", "Posso ter mais de um número de WhatsApp?", "Sim. Cada plano inclui 1 número por unidade. Se precisar de um segundo número, é R$ 39/mês — basta entrar em contato com o suporte."],
                    ["multi-unit", "E se eu tiver mais de uma barbearia?", "Funciona. Cada unidade tem sua própria configuração e seu próprio WhatsApp. Tudo gerenciado numa conta só."],
                  ].map(([value, question, answer], idx) => (
                    <AccordionItem key={value} value={value} className="rounded-xl border border-white/8 bg-white/[0.02] data-[state=open]:bg-white/[0.04] data-[state=open]:border-primary/20 transition-all">
                      <AccordionTrigger className="px-5 py-4 text-left hover:no-underline">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[11px] text-primary/50 shrink-0 w-5">
                            0{idx + 1}
                          </span>
                          <span className="font-medium text-white/85 hover:text-white text-sm">{question}</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-5 pb-5 text-sm leading-relaxed text-white/50 pl-14">
                        {answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            </div>
          </section>
        </FadeSection>

        {/* ============================================================ FECHO */}
        <FadeSection>
          <section className="relative px-4 py-24 md:py-32 overflow-hidden">
            {/* Mesh radial glow */}
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden
              style={{
                background:
                  "radial-gradient(ellipse 100% 80% at 50% 100%, hsl(239 84% 62% / 0.14), transparent 70%)",
              }}
            />
            {/* Subtle grid */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.025]"
              aria-hidden
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, hsl(239 84% 62%) 0px, transparent 1px, transparent 60px), repeating-linear-gradient(90deg, hsl(239 84% 62%) 0px, transparent 1px, transparent 60px)",
              }}
            />
            {/* Floating particles in fecho */}
            {[
              { size: 3, top: "20%", left: "10%", anim: "animate-float-slow", delay: "0s", opacity: 0.07 },
              { size: 4, top: "70%", left: "88%", anim: "animate-float-mid", delay: "1s", opacity: 0.06 },
              { size: 2, top: "55%", left: "5%", anim: "animate-float-fast", delay: "0.5s", opacity: 0.08 },
            ].map((p, i) => (
              <div key={i} aria-hidden className={cn("absolute rounded-full bg-primary pointer-events-none", p.anim)} style={{ width: p.size, height: p.size, top: p.top, left: p.left, opacity: p.opacity, animationDelay: p.delay }} />
            ))}

            <div className="max-w-3xl mx-auto text-center relative">
              {/* Urgency badge */}
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-green-500/30 bg-green-500/10 text-[12px] font-mono text-green-400 mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Vagas abertas esta semana
              </div>

              <h2 className="font-display text-4xl md:text-6xl font-bold text-white mb-6 leading-[1.04]">
                Sua barbearia precisa girar.{" "}
                <br className="hidden md:block" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400 [filter:drop-shadow(0_0_24px_hsl(239_84%_62%/0.4))]">
                  Você só precisa atender.
                </span>
              </h2>

              <p className="text-white/60 text-lg md:text-xl mb-12 max-w-lg mx-auto leading-relaxed">
                Terceirize a gestão da agenda. Tenha suas cadeiras sempre cheias.
                Concentre-se no que você faz de melhor.
              </p>

              {/* BIG CTA */}
              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={() => openCheckout()}
                  className="lp-shimmer group relative w-full max-w-lg py-5 px-14 rounded-2xl bg-primary text-white font-bold text-xl overflow-hidden shadow-[0_0_60px_hsl(239_84%_62%/0.55)] hover:shadow-[0_0_80px_hsl(239_84%_62%/0.7)] transition-all duration-300 hover:scale-[1.03]"
                >
                  <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary to-violet-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <span className="relative z-10 flex items-center justify-center gap-3">
                    Quero minhas cadeiras cheias
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="group-hover:translate-x-1.5 transition-transform duration-300">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </span>
                </button>

                <p className="text-white/30 text-sm font-mono">
                  Pronto em 30 minutos · Sem fidelidade · Cancele quando quiser
                </p>

                <button
                  onClick={() => scrollToSection("demo")}
                  className="cursor-pointer text-white/35 hover:text-white/60 text-sm underline underline-offset-4 transition-colors"
                >
                  Ver funcionando primeiro
                </button>
              </div>

              <p className="text-sm text-white/25 mt-10">
                Já tem conta?{" "}
                <Link to="/login" className="text-primary hover:underline">Fazer login</Link>
              </p>
            </div>
          </section>
        </FadeSection>
      </main>

      <CheckoutModal open={showCheckout} onOpenChange={setShowCheckout} initialPlan={checkoutInitialPlan} />
      <WhatsAppFloatingButton />
      <StickyCtaBar className="md:hidden" onCtaClick={() => openCheckout()} />
    </div>
  );
}
