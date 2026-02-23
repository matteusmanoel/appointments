import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  MessageCircle,
  Calendar,
  CreditCard,
  Timer,
  Users,
  CheckCircle2,
  Shield,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { BillingPlan } from "@/lib/api";
import { LoadingState } from "@/components/LoadingState";
import { CheckoutModal } from "@/components/CheckoutModal";
import { AiSchedulingDemoChat } from "@/components/ai-demo/AiSchedulingDemoChat";
import { WhatsAppFloatingButton } from "@/components/WhatsAppFloatingButton";
import { RoiCalculator } from "@/components/landing/RoiCalculator";
import { StickyCtaBar } from "@/components/landing/StickyCtaBar";

export default function Landing() {
  const { profile, loading } = useAuth();
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutInitialPlan, setCheckoutInitialPlan] = useState<BillingPlan>("pro");
  const [chatOpen, setChatOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const provaSectionRef = useRef<HTMLElement | null>(null);
  const provaBgImgRef = useRef<HTMLImageElement | null>(null);

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
    return () => {
      document.documentElement.style.scrollBehavior = prev;
    };
  }, []);

  useEffect(() => {
    const raw = window.location.hash?.replace("#", "").trim();
    if (!raw) return;
    const t = window.setTimeout(() => scrollToSection(raw), 0);
    return () => window.clearTimeout(t);
  }, [scrollToSection]);

  useEffect(() => {
    const section = provaSectionRef.current;
    const img = provaBgImgRef.current;
    if (!section || !img) return;

    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (media?.matches) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      const viewportH = window.innerHeight || 0;
      if (!viewportH) return;

      const sectionCenter = rect.top + rect.height / 2;
      const viewportCenter = viewportH / 2;
      const delta = (sectionCenter - viewportCenter) / viewportH; // ~[-1..1]
      const translate = Math.max(-80, Math.min(80, delta * -70));
      img.style.transform = `translate3d(0, ${translate}px, 0) scale(1.12)`;
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  if (loading) return <LoadingState fullPage />;
  if (profile) return <Navigate to="/app" replace />;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
      <header ref={headerRef} className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur">
        <div className="px-4 py-4 max-w-6xl mx-auto w-full flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2">
            <img
              src="/logo-named-white.svg"
              alt="NavalhIA"
              className="h-16 w-auto dark:block hidden object-contain"
            />
            <img
              src="/logo-named-transparent.svg"
              alt="NavalhIA"
              className="h-8 w-auto block dark:hidden object-contain"
            />
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <a
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              href="#como-funciona"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection("como-funciona");
              }}
            >
              Como funciona
            </a>
            <a
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              href="#calculadora"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection("calculadora");
              }}
            >
              Calculadora
            </a>
            <a
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              href="#comparativo"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection("comparativo");
              }}
            >
              Comparativo
            </a>
            <a
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              href="#planos"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection("planos");
              }}
            >
              Planos
            </a>
            <a
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              href="#faq"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection("faq");
              }}
            >
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="ghost">Entrar</Button>
            </Link>
            <Button onClick={() => openCheckout()}>
              Assinar agora
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-24 md:pb-0">
        {/* Above-the-fold: value + proof + interactive */}
        <section className="px-4 py-10 md:py-16">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-8 items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <img
                  src="/logo-app.svg"
                  alt=""
                  className="h-10 w-10 shrink-0 object-contain"
                  aria-hidden
                />
                <Badge variant="secondary">
                  Feito para donos de estabelecimentos
                </Badge>
                <Badge variant="outline">Checkout seguro Stripe</Badge>
                <Badge variant="outline">Sem fidelidade</Badge>
              </div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Agende. Automatize. Cresça.
              </p>
              <h1 className="text-4xl md:text-5xl font-bold text-foreground leading-tight">
                Sua recepcionista 24h no WhatsApp —{" "}
                <span className="text-primary">agenda e reduz no-show</span>{" "}
                automaticamente
              </h1>
              <p className="text-lg text-muted-foreground mt-4">
                Pare de perder cliente por demora, acabe com cadeira vazia:
                agendamento automático, lembretes e reagendamento fácil, sem
                contratar recepcionista.
              </p>

              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <Button
                  size="lg"
                  className="text-base"
                  onClick={() => openCheckout()}
                >
                  Assinar e começar hoje
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="text-base"
                  onClick={() => setChatOpen(true)}
                >
                  Testar demo agora
                </Button>
              </div>

              <div className="mt-5 grid sm:grid-cols-3 gap-3">
                <div className="rounded-lg border bg-background p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Timer className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">Resposta imediata</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Cliente agenda sem “esperar você ver”.
                  </p>
                </div>
                <div className="rounded-lg border bg-background p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">Menos no-show</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Confirmação e lembretes para reduzir faltas.
                  </p>
                </div>
                <div className="rounded-lg border bg-background p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">Cliente volta</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Follow-up automático de quem sumiu.
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mt-4">
                Setup 100% self-serve • Cancele quando quiser • Checkout seguro
              </p>
            </div>

            <div id="calculadora" className="scroll-mt-28">
              <RoiCalculator onCtaClick={() => openCheckout()} />
            </div>
          </div>
        </section>

        {/* Dor / Aversão à perda */}
        <section className="px-4 py-10 md:py-14 bg-muted/30 border-y border-border/50">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-3xl font-bold">
                Os problemas reais do dia a dia
              </h2>
              <p className="text-muted-foreground mt-3">
                Você não precisa de “mais um sistema”. Você precisa parar de
                perder dinheiro no automático.
              </p>
            </div>
            <ul className="space-y-4">
              <li className="flex items-start gap-3 p-4 rounded-lg bg-background border">
                <MessageCircle className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
                <div>
                  <strong>Você responde WhatsApp o dia inteiro</strong> — e
                  ainda assim perde cliente por demora
                </div>
              </li>
              <li className="flex items-start gap-3 p-4 rounded-lg bg-background border">
                <Timer className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
                <div>
                  <strong>Horário vazio por falha de agenda</strong> = barbeiro
                  ocioso = prejuízo
                </div>
              </li>
              <li className="flex items-start gap-3 p-4 rounded-lg bg-background border">
                <Calendar className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
                <div>
                  <strong>No-show sem confirmação</strong> = cadeira parada =
                  caixa menor
                </div>
              </li>
              <li className="flex items-start gap-3 p-4 rounded-lg bg-background border">
                <Users className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
                <div>
                  <strong>Sem follow-up</strong> = cliente some e não volta
                </div>
              </li>
            </ul>
            <p className="mt-6 text-muted-foreground">
              Se isso acontece toda semana, você já paga um sistema — só que
              paga em perda.
            </p>
            <div className="mt-6">
              <Button onClick={() => openCheckout()}>
                Quero resolver isso agora
              </Button>
            </div>
          </div>
        </section>

        {/* Prova de produto: copy + visual (background + notebook-phone) */}
        <section
          ref={provaSectionRef}
          id="prova-visual"
          className="relative px-4 py-10 md:py-14 overflow-hidden"
        >
          <div className="absolute inset-0 overflow-hidden" aria-hidden>
            <img
              ref={provaBgImgRef}
              src="/background.png"
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-35 dark:opacity-25 will-change-transform"
              style={{ transform: "translate3d(0, 0, 0) scale(1.12)" }}
              aria-hidden
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/55 to-background/90" />
            <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_20%_20%,hsl(var(--primary))_0%,transparent_60%)] opacity-10" />
          </div>
          <div className="relative max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
              <div className="order-2 lg:order-1 text-center lg:text-left">
                <div className="inline-flex items-center justify-center lg:justify-start rounded-full border border-border/60 bg-background/50 backdrop-blur px-3 py-1 text-xs text-muted-foreground mb-4">
                  Produto em ação
                </div>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-3">
                  Sua barbearia automatizada. Sem WhatsApp manual.
                </h2>
                <p className="text-base md:text-lg text-muted-foreground mb-6 max-w-xl mx-auto lg:mx-0">
                  Agenda lotada e controle total com IA: mobile e desktop trabalhando juntos para sua barbearia bombar.
                </p>
                <ul className="space-y-4 text-sm text-muted-foreground list-none mb-7">
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground/90">Agendamento automático 24h</p>
                      <p className="text-xs md:text-sm text-muted-foreground">Quem agenda é o cliente — sem ficar preso no celular.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground/90">Lembretes e confirmações automáticas</p>
                      <p className="text-xs md:text-sm text-muted-foreground">Reduz faltas e evita buracos na agenda.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground/90">Recupere clientes inativos</p>
                      <p className="text-xs md:text-sm text-muted-foreground">Follow-up sem esforço (com créditos) pra trazer quem sumiu.</p>
                    </div>
                  </li>
                </ul>
                <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                  <Button onClick={() => setChatOpen(true)} size="lg" className="font-medium">
                    Simular minha barbearia
                  </Button>
                  <Button onClick={() => openCheckout()} variant="outline" size="lg">
                    Assinar agora
                  </Button>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  + 1.200 agendamentos automáticos toda semana
                </p>
              </div>
              <div className="order-1 lg:order-2 relative rounded-3xl overflow-hidden border border-border/70 shadow-2xl bg-background/35 backdrop-blur min-h-[320px] md:min-h-[380px] flex items-center justify-center p-4 md:p-8">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" aria-hidden />
                <div className="pointer-events-none absolute -inset-24 bg-[radial-gradient(closest-side,hsl(var(--primary))_0%,transparent_65%)] opacity-10" aria-hidden />
                <div className="relative z-10 w-full max-w-xl">
                  <div className="relative rounded-2xl border border-border/70 bg-background/55 backdrop-blur overflow-hidden shadow-2xl">
                    <div className="relative aspect-[4/3] bg-muted/30">
                      <img
                        src="/note+phone.png"
                        alt="NavalhIA: painel no notebook e simulação no WhatsApp no celular"
                        loading="eager"
                        fetchPriority="high"
                        decoding="async"
                        className="absolute inset-0 w-full h-full object-contain object-center data-[loaded]:opacity-100 opacity-0 transition-opacity duration-300 p-2 md:p-3"
                        onLoad={(e) => e.currentTarget.setAttribute("data-loaded", "true")}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          e.currentTarget.parentElement?.querySelector("[data-mock-fallback]")?.classList.remove("hidden");
                        }}
                      />
                      <div
                        data-mock-fallback
                        className="hidden absolute inset-0 flex flex-col items-center justify-center gap-4 text-center text-muted-foreground p-6"
                      >
                        <div className="flex flex-wrap justify-center gap-6">
                          <div className="flex flex-col items-center gap-2">
                            <Calendar className="h-12 w-12 opacity-60" />
                            <p className="text-sm font-medium">Painel NavalhIA</p>
                            <p className="text-xs">Agenda, barbeiros, relatórios</p>
                          </div>
                          <div className="flex flex-col items-center gap-2">
                            <MessageCircle className="h-12 w-12 opacity-60" />
                            <p className="text-sm font-medium">Simulação IA</p>
                            <p className="text-xs">Fluxo de atendimento e agendamento</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-border/70 bg-background/55 backdrop-blur p-4">
                      <div className="flex items-start gap-3">
                        <MessageCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">Experiência do cliente</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Resposta na hora, lembrete antes do horário e link para reagendar ou cancelar.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/55 backdrop-blur p-4">
                      <div className="flex items-start gap-3">
                        <Calendar className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">Seu controle</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Agenda, clientes, link público e WhatsApp em um só lugar.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Comparativo */}
        <section id="comparativo" className="px-4 py-10 md:py-14 scroll-mt-28">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">
              NavalhIA x Manual x Outros
            </h2>
            <p className="text-muted-foreground text-center max-w-xl mx-auto mb-8">
              Veja o que muda quando você automatiza agenda e recuperação.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium">Recurso</th>
                    <th className="p-3 font-medium text-primary">NavalhIA</th>
                    <th className="p-3 font-medium text-muted-foreground">Só WhatsApp manual</th>
                    <th className="p-3 font-medium text-muted-foreground">Outros sistemas</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/50">
                    <td className="p-3">Resposta 24h</td>
                    <td className="p-3"><CheckCircle2 className="h-4 w-4 text-primary inline" /></td>
                    <td className="p-3 text-muted-foreground">—</td>
                    <td className="p-3 text-muted-foreground">Depende</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="p-3">Lembrete antes do horário</td>
                    <td className="p-3"><CheckCircle2 className="h-4 w-4 text-primary inline" /></td>
                    <td className="p-3 text-muted-foreground">Manual</td>
                    <td className="p-3 text-muted-foreground">Depende</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="p-3">Reagendar/cancelar por link</td>
                    <td className="p-3"><CheckCircle2 className="h-4 w-4 text-primary inline" /></td>
                    <td className="p-3 text-muted-foreground">—</td>
                    <td className="p-3 text-muted-foreground">Depende</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="p-3">Follow-up de quem sumiu</td>
                    <td className="p-3"><CheckCircle2 className="h-4 w-4 text-primary inline" /></td>
                    <td className="p-3 text-muted-foreground">—</td>
                    <td className="p-3 text-muted-foreground">Depende</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="p-3">Setup self-serve</td>
                    <td className="p-3"><CheckCircle2 className="h-4 w-4 text-primary inline" /></td>
                    <td className="p-3 text-muted-foreground">—</td>
                    <td className="p-3 text-muted-foreground">Depende</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="px-4 py-10 md:py-14 scroll-mt-28">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-3xl font-bold">
                Como funciona (sem blá-blá-blá)
              </h2>
              <p className="text-muted-foreground mt-3">
                Você configura serviços e horários uma vez. Depois, a NavalhIA
                faz o repetitivo por você.
              </p>
            </div>
            <div className="mt-8 grid md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">1) Cliente chama</CardTitle>
                  <CardDescription>WhatsApp</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  A conversa anda sozinha: pergunta, sugere e conduz ao
                  agendamento.
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">2) Escolhe</CardTitle>
                  <CardDescription>Serviço e horário</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  O cliente escolhe sem precisar “falar com ninguém”.
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">3) Confirma</CardTitle>
                  <CardDescription>Lembretes</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Confirma e lembra automaticamente para reduzir faltas.
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">4) Você só vê</CardTitle>
                  <CardDescription>Painel</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Agenda organizada e visão do que mais dá dinheiro.
                </CardContent>
              </Card>
            </div>
            <div className="mt-6">
              <Button onClick={() => setChatOpen(true)} variant="outline">
                Ver demo do WhatsApp
              </Button>
            </div>
          </div>
        </section>

        {/* Demo */}
        <section id="demo" className="px-4 py-10 md:py-14 bg-muted/40">
          <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-8 items-center">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold">
                Teste a experiência que seu cliente vai ter
              </h2>
              <p className="text-muted-foreground mt-3">
                Demonstração interativa (simulada) do agendamento: serviço →
                barbeiro → horário → confirmação.
              </p>
              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <Button size="lg" onClick={() => setChatOpen(true)}>
                  Abrir demo
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => openCheckout()}
                >
                  Assinar agora
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                Se você perder só 2 cortes/mês por demora no WhatsApp, o sistema
                já tende a se pagar.
              </p>
            </div>
            <div className="rounded-xl border bg-background p-6">
              <h3 className="font-semibold">
                O que a NavalhIA faz no automático
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5" />
                  Atendimento 24h e resposta imediata
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5" />
                  Confirmação e lembretes para reduzir faltas
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5" />
                  Reagendamento fácil (link e WhatsApp)
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5" />
                  Recuperação de clientes (follow-up automático)
                </li>
              </ul>
            </div>
          </div>

          <AiSchedulingDemoChat
            open={chatOpen}
            onOpenChange={setChatOpen}
            onAssinarClick={() => openCheckout()}
          />
        </section>

        {/* Confiança e risco controlado */}
        <section className="px-4 py-10 md:py-14 bg-muted/30 border-y border-border/50">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-2 mb-6">
              <Shield className="h-6 w-6 text-primary" aria-hidden />
              <h2 className="text-xl md:text-2xl font-bold text-center">
                Confiança e risco controlado
              </h2>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span><strong className="text-foreground">Checkout Stripe</strong> — pagamento seguro, sem fidelidade; cancele quando quiser.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span><strong className="text-foreground">WhatsApp</strong> — conexão por QR; sujeito às políticas do WhatsApp. Recomendamos número dedicado para automação. Foco em conversas iniciadas pelo cliente e reativação de clientes que já passaram pela sua barbearia.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span>Se o WhatsApp ficar indisponível, você continua operando pelo <strong className="text-foreground">link público de agendamento</strong> e atendimento humano.</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Planos */}
        <section id="planos" className="px-4 py-10 md:py-14 scroll-mt-28">
          <div className="max-w-4xl mx-auto">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold">
                Escolha o plano e finalize em 2 minutos
              </h2>
              <p className="text-muted-foreground mt-3">
                Comece pequeno e suba quando precisar. O objetivo é simples: não
                deixar cliente sem resposta.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-6 mt-8">
              <Card>
                <CardHeader>
                  <CardTitle>Essencial</CardTitle>
                  <CardDescription>Setup + link + agenda</CardDescription>
                  <p className="text-2xl font-bold mt-2">
                    R$ 97
                    <span className="text-sm font-normal text-muted-foreground">
                      /mês
                    </span>
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>• Painel e link público de agendamento</p>
                  <p>• Serviços, barbeiros, horários</p>
                  <p>• Cliente agenda online 24h</p>
                </CardContent>
                <div className="p-6 pt-0">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => openCheckout("essential")}
                  >
                    Assinar
                  </Button>
                </div>
              </Card>
              <Card className="border-primary ring-2 ring-primary/20 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                  Mais escolhido
                </div>
                <CardHeader>
                  <CardTitle>Profissional</CardTitle>
                  <CardDescription>WhatsApp IA + lembretes + recuperação</CardDescription>
                  <p className="text-2xl font-bold mt-2">
                    R$ 197
                    <span className="text-sm font-normal text-muted-foreground">
                      /mês
                    </span>
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>• Tudo do Essencial</p>
                  <p>• WhatsApp com IA (agenda na conversa)</p>
                  <p>• Lembrete 24h e follow-up automático</p>
                  <p>• Reagendar/cancelar por link e WhatsApp</p>
                  <p>• 1 número incluso (extra: R$ 39/número/mês)</p>
                </CardContent>
                <div className="p-6 pt-0">
                  <Button
                    className="w-full"
                    onClick={() => openCheckout("pro")}
                  >
                    Assinar
                  </Button>
                </div>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Premium</CardTitle>
                  <CardDescription>Padronização + qualidade + escala</CardDescription>
                  <p className="text-2xl font-bold mt-2">
                    R$ 349
                    <span className="text-sm font-normal text-muted-foreground">
                      /mês
                    </span>
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>• Tudo do Profissional</p>
                  <p>• IA com tom da marca e modelo escalonável</p>
                  <p>• Multi-filial (várias unidades)</p>
                  <p>• Prioridade no suporte</p>
                  <p>• 1 número incluso (extra: R$ 39/número/mês)</p>
                </CardContent>
                <div className="p-6 pt-0">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => openCheckout("premium")}
                  >
                    Assinar
                  </Button>
                </div>
              </Card>
            </div>
            <div className="mt-8 max-w-3xl mx-auto grid md:grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium">Sem fidelidade</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Cancele quando quiser.
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium">Setup 100% self-serve</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Configuração guiada no painel.
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium">1 número incluso</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Número extra: R$ 39/mês (via suporte).
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="px-4 py-10 md:py-14 bg-muted/40 scroll-mt-28">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold text-center mb-8">
              Perguntas frequentes
            </h2>
            <Accordion type="single" collapsible className="w-full space-y-3">
              <AccordionItem value="whatsapp" className="rounded-xl border bg-background/60 backdrop-blur data-[state=open]:bg-background/80">
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline">
                  Funciona com meu WhatsApp atual?
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                  Sim. A conexão é feita por QR (pareamento com o seu número). O uso está sujeito às políticas do WhatsApp; recomendamos número dedicado para automação. A NavalhIA cuida do repetitivo (agenda, confirmar, lembrar, reativação de clientes existentes). Quando quiser, você assume como humano.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="whatsapp-policy" className="rounded-xl border bg-background/60 backdrop-blur data-[state=open]:bg-background/80">
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline">
                  A conexão WhatsApp é oficial?
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                  A conexão é por QR (como WhatsApp Web), sujeita às políticas do WhatsApp. Focamos em atendimento a quem já te procurou e reativação de clientes que já passaram pelo seu estabelecimento — não em disparos promocionais em massa.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="setup" className="rounded-xl border bg-background/60 backdrop-blur data-[state=open]:bg-background/80">
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline">
                  Quanto tempo para ficar pronto?
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                  Em geral 15 a 30 minutos: checklist guiado com serviços, horários,
                  barbeiros e link de agendamento. Se precisar, o suporte te acompanha.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="contract" className="rounded-xl border bg-background/60 backdrop-blur data-[state=open]:bg-background/80">
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline">Tem contrato ou fidelidade?</AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                  Não. Assinatura mensal, cancele quando quiser. Sem multas.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="security" className="rounded-xl border bg-background/60 backdrop-blur data-[state=open]:bg-background/80">
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline">O pagamento é seguro?</AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                  Sim. O checkout da assinatura é processado pela Stripe.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="human" className="rounded-xl border bg-background/60 backdrop-blur data-[state=open]:bg-background/80">
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline">
                  E se o cliente quiser falar com humano?
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                  Você pode assumir manualmente no painel ou a IA pausa sozinha quando
                  você envia uma mensagem do seu número. Depois retoma quando quiser.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="extra-number" className="rounded-xl border bg-background/60 backdrop-blur data-[state=open]:bg-background/80">
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline">Posso ter mais de um número de WhatsApp?</AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                  Sim. O plano inclui 1 número por unidade. Número extra: R$ 39/mês
                  (contrate via suporte).
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="multi-unit" className="rounded-xl border bg-background/60 backdrop-blur data-[state=open]:bg-background/80">
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline">E se eu tiver mais de uma unidade?</AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                  Cada unidade tem sua própria assinatura (e seu número de WhatsApp, se for Pro/Premium).
                  Multi-unidade é suportado: uma conta, várias barbearias.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="change-plan" className="rounded-xl border bg-background/60 backdrop-blur data-[state=open]:bg-background/80">
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline">Posso mudar de plano depois?</AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                  Sim. Você pode assinar o Essencial e depois subir para Profissional ou Premium
                  quando quiser; ou começar no Pro e ajustar conforme a necessidade.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="support" className="rounded-xl border bg-background/60 backdrop-blur data-[state=open]:bg-background/80">
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline">Como é o suporte?</AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                  Por e-mail e WhatsApp. O setup é self-serve com checklist guiado; se travar em algo,
                  a gente te ajuda. Plano Premium tem prioridade nas respostas.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>

        {/* CTA final */}
        <section className="px-4 py-14 md:py-20">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              Pronto para tirar o WhatsApp das suas costas?
            </h2>
            <p className="text-muted-foreground mb-6">
              Assine e comece a agendar automaticamente. Se não fizer sentido,
              cancele.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" onClick={() => openCheckout()}>
                Assinar agora
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setChatOpen(true)}
              >
                Testar demo
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-6">
              Já tem conta?{" "}
              <Link
                to="/login"
                className="text-primary font-medium hover:underline"
              >
                Fazer login
              </Link>
            </p>
          </div>
        </section>
      </main>

      <CheckoutModal open={showCheckout} onOpenChange={setShowCheckout} initialPlan={checkoutInitialPlan} />
      <WhatsAppFloatingButton />
      <StickyCtaBar
        className="md:hidden"
        onCtaClick={() => openCheckout()}
      />
    </div>
  );
}
