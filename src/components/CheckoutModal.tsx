import { useState, useMemo, useEffect, useRef } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { formatPhoneAsTyped } from "@/lib/input-masks";
import { billingApi, type BillingPlan } from "@/lib/api";
import { BILLING_PLANS } from "@/lib/billing-plans";
import { checkoutErrorMessage } from "@/lib/checkout-validation";
import {
  WHATSAPP_RISK_CHECKBOX_AFTER,
  WHATSAPP_RISK_CHECKBOX_BEFORE,
  WHATSAPP_RISK_CHECKBOX_LINK,
  WHATSAPP_RISK_NOTICE_VERSION,
  WHATSAPP_RISK_REQUIRED_MESSAGE,
  WHATSAPP_RISK_TERMS_URL,
} from "@/lib/whatsapp-risk-notice";
import { cn } from "@/lib/utils";
import { getCheckoutTrackingFields, trackInitiateCheckout } from "@/lib/tracking";

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";

const STEPS = [
  {
    id: "email",
    label: "E-mail",
    question: "Qual é o seu e-mail?",
    incentive: "Quase lá. É neste e-mail que chega o acesso.",
  },
  {
    id: "phone",
    label: "Telefone",
    question: "Qual é o seu telefone?",
    incentive: "Usamos só para o onboarding da sua barbearia.",
  },
  {
    id: "name",
    label: "Barbearia",
    question: "Qual é o nome da barbearia?",
    incentive: "Esse nome aparece no link e no painel.",
  },
  {
    id: "plan",
    label: "Plano",
    question: "Selecione o plano.",
    incentive: "O Profissional é o caminho mais curto para o WhatsApp atender por você.",
  },
] as const;

const PLAN_FEATURES: Record<BillingPlan, string[]> = {
  essential: ["Painel e link de agendamento", "Serviços, barbeiros, horários", "Cliente agenda online 24h"],
  pro: ["Tudo do Essencial", "Secretária no WhatsApp", "Lembrete antes do horário", "1 número incluso"],
  premium: ["Tudo do Profissional", "Tom da sua barbearia", "Várias unidades", "1 número incluso"],
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}


type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When opening for upgrade from Essential, pass "pro" to preselect Profissional. */
  initialPlan?: BillingPlan;
};

export function CheckoutModal({ open, onOpenChange, initialPlan = "pro" }: Props) {
  const stripePromise = useMemo(
    () => (open && STRIPE_PK ? loadStripe(STRIPE_PK) : null),
    [open],
  );
  const [view, setView] = useState<"form" | "embedded">("form");
  const [stepIndex, setStepIndex] = useState(0);
  const [slideDir, setSlideDir] = useState<"next" | "prev">("next");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [plan, setPlan] = useState<BillingPlan>(initialPlan);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [barbershopName, setBarbershopName] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [riskAccepted, setRiskAccepted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const step = STEPS[stepIndex];
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  const validateStep = (index: number): string => {
    if (index === 0) {
      if (!email.trim()) return "E-mail é obrigatório";
      if (!isValidEmail(email)) return "E-mail inválido";
    }
    if (index === 1) {
      const ph = phoneDigits(phone);
      if (!ph) return "Telefone é obrigatório";
      if (ph.length < 10) return "Telefone deve ter pelo menos 10 dígitos";
    }
    if (index === 2 && !barbershopName.trim()) return "Nome é obrigatório";
    return "";
  };

  const goNext = () => {
    const message = validateStep(stepIndex);
    setFieldError(message);
    if (message) {
      inputRef.current?.focus();
      return;
    }
    if (stepIndex >= STEPS.length - 1) return;
    setSlideDir("next");
    setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    if (stepIndex === 0 || loading) return;
    setFieldError("");
    setError(null);
    setSlideDir("prev");
    setStepIndex((i) => i - 1);
  };

  const startCheckout = async () => {
    for (let i = 0; i < STEPS.length - 1; i += 1) {
      const message = validateStep(i);
      if (message) {
        setFieldError(message);
        setSlideDir(i < stepIndex ? "prev" : "next");
        setStepIndex(i);
        return;
      }
    }
    if (!riskAccepted) {
      setFieldError(WHATSAPP_RISK_REQUIRED_MESSAGE);
      document.getElementById("whatsapp_risk")?.focus();
      return;
    }
    setError(null);
    setLoading(true);
    const body = {
      barbershop_name: barbershopName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      plan,
      whatsapp_risk_accepted: true as const,
      whatsapp_risk_notice_version: WHATSAPP_RISK_NOTICE_VERSION,
      ...getCheckoutTrackingFields(),
    };
    trackInitiateCheckout(plan);
    try {
      if (STRIPE_PK && stripePromise) {
        const { client_secret } = await billingApi.createEmbeddedCheckout(body);
        setClientSecret(client_secret);
        setView("embedded");
      } else {
        const { url } = await billingApi.createCheckout(body);
        window.location.href = url;
      }
    } catch (err) {
      setError(checkoutErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (stepIndex < STEPS.length - 1) {
      goNext();
      return;
    }
    void startCheckout();
  };

  const handleFallbackRedirect = async () => {
    setError(null);
    if (!riskAccepted) {
      setError(WHATSAPP_RISK_REQUIRED_MESSAGE);
      return;
    }
    setLoading(true);
    try {
      trackInitiateCheckout(plan);
      const { url } = await billingApi.createCheckout({
        barbershop_name: barbershopName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        plan,
        whatsapp_risk_accepted: true,
        whatsapp_risk_notice_version: WHATSAPP_RISK_NOTICE_VERSION,
        ...getCheckoutTrackingFields(),
      });
      window.location.href = url;
    } catch (err) {
      setError(checkoutErrorMessage(err));
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setView("form");
      setClientSecret(null);
      setError(null);
      setFieldError("");
      setRiskAccepted(false);
      setStepIndex(0);
      setSlideDir("next");
    } else {
      setPlan(initialPlan);
      setStepIndex(0);
      setSlideDir("next");
    }
  }, [open, initialPlan]);

  useEffect(() => {
    if (!open || view !== "form" || step.id === "plan") return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, view, step.id]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (!loading ? onOpenChange(o) : undefined)}
    >
      <DialogContent
        className={
          view === "embedded"
            ? "max-w-md sm:max-w-2xl md:max-w-4xl max-h-[90dvh] overflow-hidden w-[calc(100vw-2rem)] sm:w-full pb-0 flex flex-col"
            : "left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-white/10 bg-[#0e0e0e] p-0 text-white shadow-[0_0_80px_hsl(239_84%_62%/0.22)] md:left-1/2 md:top-1/2 md:h-[min(900px,94dvh)] md:max-h-[94dvh] md:w-full md:max-w-5xl md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-2xl [&>button]:top-6 [&>button]:flex [&>button]:h-8 [&>button]:w-8 [&>button]:items-center [&>button]:justify-center [&>button]:text-white [&>button]:opacity-80 [&>button]:hover:bg-white/10 [&>button]:hover:opacity-100"
        }
        onPointerDownOutside={(e) => loading && e.preventDefault()}
        onEscapeKeyDown={() => !loading && onOpenChange(false)}
      >
        {view === "form" ? (
          <form onSubmit={handleFormSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-3 px-6 pr-14 pt-6">
              <img
                src="/logo-v5.png"
                alt=""
                className="h-8 w-8 shrink-0 object-contain"
                aria-hidden
              />
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/70">
                Assinar NavalhIA
              </p>
            </div>

            <div
              className={cn(
                "min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-4",
                step.id !== "plan" && "flex flex-col justify-center",
              )}
            >
              <div
                key={step.id}
                className={slideDir === "next" ? "checkout-step-next" : "checkout-step-prev"}
              >
                <DialogHeader className="mb-5 space-y-2 text-left">
                  <DialogTitle className="font-display text-2xl font-bold leading-tight text-white sm:text-3xl">
                    {step.question}
                  </DialogTitle>
                  <DialogDescription className="text-sm text-white/55">
                    {step.incentive}
                  </DialogDescription>
                </DialogHeader>
                {step.id === "email" && (
                  <div className="space-y-2">
                    <Label htmlFor="checkout-email" className="sr-only">
                      E-mail
                    </Label>
                    <Input
                      ref={inputRef}
                      id="checkout-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setFieldError("");
                      }}
                      onBlur={(e) => {
                        const next = e.relatedTarget instanceof Element ? e.relatedTarget : null;
                        if (next?.closest("button")) return;
                        requestAnimationFrame(() => inputRef.current?.focus());
                      }}
                      aria-invalid={!!fieldError}
                      className="h-14 rounded-xl border-white/15 bg-white/5 px-4 text-lg text-white placeholder:text-white/30 focus-visible:ring-primary focus-visible:ring-offset-0 md:text-lg"
                    />
                  </div>
                )}

                {step.id === "phone" && (
                  <div className="space-y-2">
                    <Label htmlFor="checkout-phone" className="sr-only">
                      Telefone
                    </Label>
                    <Input
                      ref={inputRef}
                      id="checkout-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="(11) 98765-4321"
                      value={phone}
                      onChange={(e) => {
                        setPhone(formatPhoneAsTyped(e.target.value));
                        setFieldError("");
                      }}
                      onBlur={(e) => {
                        const next = e.relatedTarget instanceof Element ? e.relatedTarget : null;
                        if (next?.closest("button")) return;
                        requestAnimationFrame(() => inputRef.current?.focus());
                      }}
                      aria-invalid={!!fieldError}
                      className="h-14 rounded-xl border-white/15 bg-white/5 px-4 text-lg text-white placeholder:text-white/30 focus-visible:ring-primary focus-visible:ring-offset-0 md:text-lg"
                    />
                  </div>
                )}

                {step.id === "name" && (
                  <div className="space-y-2">
                    <Label htmlFor="checkout-name" className="sr-only">
                      Nome da barbearia
                    </Label>
                    <Input
                      ref={inputRef}
                      id="checkout-name"
                      autoComplete="organization"
                      placeholder="Ex.: Navalha do João"
                      value={barbershopName}
                      onChange={(e) => {
                        setBarbershopName(e.target.value);
                        setFieldError("");
                      }}
                      onBlur={(e) => {
                        const next = e.relatedTarget instanceof Element ? e.relatedTarget : null;
                        if (next?.closest("button")) return;
                        requestAnimationFrame(() => inputRef.current?.focus());
                      }}
                      aria-invalid={!!fieldError}
                      className="h-14 rounded-xl border-white/15 bg-white/5 px-4 text-lg text-white placeholder:text-white/30 focus-visible:ring-primary focus-visible:ring-offset-0 md:text-lg"
                    />
                  </div>
                )}

                {step.id === "plan" && (
                  <>
                  <div role="radiogroup" aria-label="Plano" className="grid grid-cols-1 gap-3 pt-4 md:grid-cols-3 md:items-stretch">
                    {BILLING_PLANS.map((p) => {
                      const selected = plan === p.id;
                      const featured = p.id === "pro";
                      return (
                        <button
                          key={p.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setPlan(p.id)}
                          className={cn(
                            "relative flex h-full w-full rounded-2xl text-left transition-all duration-200",
                            selected
                              ? "bg-gradient-to-b from-primary via-violet-500 to-violet-300 p-1 shadow-[0_0_40px_hsl(262_83%_58%/0.6)]"
                              : "bg-white/10 p-px hover:bg-white/20",
                            featured && !selected && "shadow-[0_0_32px_hsl(239_84%_62%/0.4)]",
                          )}
                        >
                          {featured && (
                            <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-3 py-0.5 text-[10px] font-semibold text-white shadow-[0_0_16px_hsl(239_84%_62%/0.5)]">
                              Mais escolhido
                            </span>
                          )}
                          <span
                            className={cn(
                              "flex h-full flex-col gap-2 rounded-2xl px-4 py-3.5",
                              selected
                                ? "bg-gradient-to-b from-[#2a2158] via-[#1a1630] to-[#12101c]"
                                : featured
                                  ? "bg-gradient-to-b from-[#16162e] to-[#101014]"
                                  : "bg-[#101014]",
                            )}
                          >
                            <span className="flex flex-col items-start gap-1">
                              <span className="font-display text-lg font-bold text-white">{p.label}</span>
                              <span className="font-display text-lg font-bold text-white">{p.price}</span>
                            </span>
                            <span className="text-xs text-white/45">{p.desc}</span>
                            <span className="mt-1 space-y-1">
                              {PLAN_FEATURES[p.id].map((feature) => (
                                <span key={feature} className="flex items-center gap-2 text-xs text-white/70">
                                  <CheckCircle2 className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-primary" : "text-primary/70")} />
                                  {feature}
                                </span>
                              ))}
                            </span>
                            {selected && (
                              <span className="text-[11px] font-medium uppercase tracking-wider text-primary">
                                Selecionado
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div
                    className={cn(
                      "mt-4 flex items-start gap-3 rounded-xl px-1 py-1",
                      fieldError === WHATSAPP_RISK_REQUIRED_MESSAGE && "ring-1 ring-red-400/70",
                    )}
                    data-testid="whatsapp-risk-notice"
                  >
                    <Checkbox
                      id="whatsapp_risk"
                      checked={riskAccepted}
                      onCheckedChange={(v) => {
                        setRiskAccepted(v === true);
                        setFieldError("");
                      }}
                      aria-describedby="whatsapp_risk_text"
                      className="mt-0.5 h-5 w-5 border-white/30 data-[state=checked]:bg-primary data-[state=checked]:text-white"
                    />
                    <p id="whatsapp_risk_text" className="text-sm font-normal leading-snug text-white/80">
                      <label htmlFor="whatsapp_risk" className="cursor-pointer">{WHATSAPP_RISK_CHECKBOX_BEFORE}</label>
                      <a
                        href={WHATSAPP_RISK_TERMS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-primary hover:underline"
                      >
                        {WHATSAPP_RISK_CHECKBOX_LINK}
                      </a>
                      <label htmlFor="whatsapp_risk" className="cursor-pointer">{WHATSAPP_RISK_CHECKBOX_AFTER}</label>
                    </p>
                  </div>
                  </>
                )}

                {fieldError && (
                  <p className="mt-2 text-center text-sm text-red-400" role="alert">
                    {fieldError}
                  </p>
                )}
                {error && (
                  <p className="mt-2 text-sm text-red-400" role="alert">
                    {error}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 px-6 pb-4">
              {stepIndex > 0 && (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={loading}
                  className="rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/70 transition-all hover:border-white/30 hover:bg-white/5 hover:text-white disabled:opacity-50"
                >
                  Voltar
                </button>
              )}
              <button
                type="submit"
                disabled={loading}
                onMouseDown={(e) => {
                  if (step.id !== "plan") e.preventDefault();
                }}
                className={cn(
                  "relative flex-1 overflow-hidden rounded-xl py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60",
                  step.id === "plan"
                    ? "lp-shimmer bg-primary shadow-[0_0_28px_hsl(239_84%_62%/0.55),0_0_0_1px_hsl(270_80%_72%/0.95)]"
                    : "lp-shimmer bg-primary shadow-[0_0_20px_hsl(239_84%_62%/0.4)] transition-all duration-300 hover:shadow-[0_0_48px_hsl(239_84%_62%/0.7)]",
                )}
              >
                {step.id === "plan" && (
                  <span className="absolute inset-0 bg-gradient-to-r from-primary to-violet-500" />
                )}
                <span className="relative z-10">
                  {loading ? "Preparando..." : step.id === "plan" ? "Ir para pagamento" : "Continuar"}
                </span>
              </button>
            </div>

            <footer className="shrink-0 border-t border-white/10 px-6 py-4">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-white/55">
                <span>
                  Etapa {stepIndex + 1} de {STEPS.length} · {step.label}
                </span>
                <span className="tabular-nums">{Math.round(progress)}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={STEPS.length}
                aria-valuenow={stepIndex + 1}
                aria-valuetext={`Etapa ${stepIndex + 1} de ${STEPS.length}: ${step.label}`}
              >
                <div
                  className="checkout-progress-fill h-full rounded-full bg-gradient-to-r from-primary to-violet-400 shadow-[0_0_12px_hsl(239_84%_62%/0.65)]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </footer>
          </form>
        ) : clientSecret && stripePromise ? (
          <div className="flex flex-col md:flex-row -m-6 sm:-m-6 md:max-h-[85vh]">
            <div
              className="hidden md:flex md:w-56 lg:w-64 shrink-0 flex-col items-center justify-center gap-4 px-6 py-8 rounded-l-lg text-center"
              style={{ backgroundColor: "#1a1a1a" }}
            >
              <img
                src="/navalhia-logo-header.png"
                alt="NavalhIA"
                className="w-full max-w-[180px] h-auto object-contain"
              />
              <p className="text-xs text-white/80 font-medium tracking-wide">
                Agende. Automatize. Cresça.
              </p>
            </div>
            <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 space-y-4">
              <div className="md:hidden flex flex-col items-center gap-2 pb-2 border-b border-border">
                <img src="/logo-v5.png" alt="NavalhIA" className="h-9 w-auto object-contain" />
                <p className="text-xs text-muted-foreground">Agende. Automatize. Cresça.</p>
              </div>
              <DialogHeader className="md:text-left">
                <DialogTitle>Finalize sua assinatura</DialogTitle>
                <DialogDescription>
                  Preencha os dados de pagamento abaixo. Após confirmar, você acessa o painel.
                </DialogDescription>
              </DialogHeader>
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={{
                  clientSecret,
                  onComplete: () => {
                    // Stripe redirects to return_url
                  },
                }}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
              <div className="flex flex-col gap-2">
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFallbackRedirect}
                  disabled={loading}
                >
                  Abrir pagamento em nova aba
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
