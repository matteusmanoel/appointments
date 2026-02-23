import { useState, useMemo, useEffect } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  formatPhoneBR,
  parsePhoneBR,
  formatCNPJ,
  parseCNPJ,
} from "@/lib/input-masks";
import { billingApi, type BillingPlan } from "@/lib/api";

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";

const EXTRA_NUMBER_PRICE = 39;
const MAX_EXTRA_NUMBERS = 10;

const PLANS: { id: BillingPlan; label: string; price: string; priceValue: number; desc: string }[] =
  [
    {
      id: "essential",
      label: "Essencial",
      price: "R$ 97/mês",
      priceValue: 97,
      desc: "Painel de Gestão + Link Público",
    },
    {
      id: "pro",
      label: "Profissional",
      price: "R$ 197/mês",
      priceValue: 197,
      desc: "Assistente de IA, lembretes e follow-ups",
    },
    {
      id: "premium",
      label: "Premium",
      price: "R$ 349/mês",
      priceValue: 349,
      desc: "NavalhIA escalável",
    },
  ];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function cnpjDigits(value: string): string {
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
  const [step, setStep] = useState<"form" | "embedded">("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [plan, setPlan] = useState<BillingPlan>(initialPlan);
  const [extraNumbers, setExtraNumbers] = useState(0);
  const [form, setForm] = useState({
    barbershop_name: "",
    cnpj: "",
    phone: "",
    email: "",
    contact_name: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parsePhoneBR(e.target.value);
    setForm((f) => ({ ...f, phone: raw }));
    setFieldErrors((e) => ({ ...e, phone: "" }));
  };

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseCNPJ(e.target.value);
    setForm((f) => ({ ...f, cnpj: raw }));
    setFieldErrors((e) => ({ ...e, cnpj: "" }));
  };

  const showExtraNumbers = plan === "pro" || plan === "premium";
  const effectiveExtraNumbers = showExtraNumbers ? extraNumbers : 0;
  const planInfo = PLANS.find((p) => p.id === plan);
  const monthlyTotal = planInfo
    ? planInfo.priceValue + effectiveExtraNumbers * EXTRA_NUMBER_PRICE
    : 0;

  const isFormValid = useMemo(() => {
    const name = form.barbershop_name.trim();
    const emailVal = form.email.trim();
    const phoneVal = form.phone.trim();
    const cnpjVal = form.cnpj.trim();
    if (!name.length) return false;
    if (!isValidEmail(emailVal)) return false;
    if (phoneDigits(phoneVal).length < 10 || phoneDigits(phoneVal).length > 11) return false;
    if (cnpjVal.length > 0 && cnpjDigits(cnpjVal).length !== 14) return false;
    return true;
  }, [form.barbershop_name, form.email, form.phone, form.cnpj]);

  const validateAndSetErrors = (): boolean => {
    const errors: Record<string, string> = {};
    if (!form.barbershop_name.trim()) errors.barbershop_name = "Nome é obrigatório";
    if (!form.email.trim()) errors.email = "E-mail é obrigatório";
    else if (!isValidEmail(form.email.trim())) errors.email = "E-mail inválido";
    const ph = phoneDigits(form.phone);
    if (ph.length < 10 || ph.length > 11) errors.phone = "Telefone deve ter 10 ou 11 dígitos";
    const cn = cnpjDigits(form.cnpj);
    if (cn.length > 0 && cn.length !== 14) errors.cnpj = "CNPJ deve ter 14 dígitos";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateAndSetErrors() || !isFormValid) return;
    setLoading(true);
    try {
      const extra = plan === "essential" ? 0 : extraNumbers;
      if (STRIPE_PK && stripePromise) {
        const { client_secret } = await billingApi.createEmbeddedCheckout({
          barbershop_name: form.barbershop_name.trim(),
          cnpj: form.cnpj.trim() || undefined,
          phone: form.phone.trim(),
          email: form.email.trim(),
          contact_name: form.contact_name.trim() || undefined,
          plan,
          extra_numbers: extra > 0 ? extra : undefined,
        });
        setClientSecret(client_secret);
        setStep("embedded");
      } else {
        const { url } = await billingApi.createCheckout({
          barbershop_name: form.barbershop_name.trim(),
          cnpj: form.cnpj.trim() || undefined,
          phone: form.phone.trim(),
          email: form.email.trim(),
          contact_name: form.contact_name.trim() || undefined,
          plan,
          extra_numbers: extra > 0 ? extra : undefined,
        });
        window.location.href = url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar checkout");
    } finally {
      setLoading(false);
    }
  };

  const handleFallbackRedirect = async () => {
    setError(null);
    setLoading(true);
    try {
      const extra = plan === "essential" ? 0 : extraNumbers;
      const { url } = await billingApi.createCheckout({
        barbershop_name: form.barbershop_name.trim(),
        cnpj: form.cnpj.trim() || undefined,
        phone: form.phone.trim(),
        email: form.email.trim(),
        contact_name: form.contact_name.trim() || undefined,
        plan,
        extra_numbers: extra > 0 ? extra : undefined,
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar checkout");
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setStep("form");
      setClientSecret(null);
      setError(null);
      setFieldErrors({});
    } else {
      setPlan(initialPlan);
    }
  }, [open, initialPlan]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (!loading ? onOpenChange(o) : undefined)}
    >
      <DialogContent
        className="max-w-md sm:max-w-lg max-h-[90dvh] overflow-y-auto w-[calc(100vw-2rem)] sm:w-full pb-[max(1rem,env(safe-area-inset-bottom))]"
        onPointerDownOutside={(e) => loading && e.preventDefault()}
        onEscapeKeyDown={() => !loading && onOpenChange(false)}
      >
        {step === "form" ? (
          <>
            <DialogHeader className="space-y-2">
              <div className="flex items-center gap-3">
                <img
                  src="/logo-app.svg"
                  alt=""
                  className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 object-contain"
                  aria-hidden
                />
                <div className="min-w-0">
                  <DialogTitle className="text-lg sm:text-xl">Assinar NavalhIA</DialogTitle>
                  <DialogDescription className="flex items-center gap-1.5 mt-0.5 text-xs sm:text-sm">
                    Pagamento seguro via Stripe
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <form onSubmit={handleSubmitForm} className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Plano</Label>
                <RadioGroup
                  value={plan}
                  onValueChange={(v) => setPlan(v as BillingPlan)}
                  className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1.5"
                >
                  {PLANS.map((p) => (
                    <label
                      key={p.id}
                      className={`flex flex-col items-center justify-center rounded-lg border p-3 min-h-[72px] sm:min-h-0 cursor-pointer transition-colors touch-manipulation ${
                        plan === p.id
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <RadioGroupItem
                        value={p.id}
                        id={p.id}
                        className="sr-only"
                      />
                      <span className="font-medium text-sm">{p.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.price}
                      </span>
                      <span className="text-xs text-muted-foreground text-center">
                        {p.desc}
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              {showExtraNumbers && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 sm:p-4 space-y-3">
                  <Label className="text-sm font-medium">Números de WhatsApp</Label>
                  <p className="text-xs text-muted-foreground">
                    1 número incluso no plano. Adicione quantos precisar (R$ {EXTRA_NUMBER_PRICE}/número/mês).
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 min-h-[44px] min-w-[44px] sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0 shrink-0"
                        onClick={() => setExtraNumbers((n) => Math.max(0, n - 1))}
                        disabled={extraNumbers === 0}
                        aria-label="Menos números extras"
                      >
                        −
                      </Button>
                      <span className="w-8 text-center font-medium tabular-nums text-sm">
                        {extraNumbers}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 min-h-[44px] min-w-[44px] sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0 shrink-0"
                        onClick={() => setExtraNumbers((n) => Math.min(MAX_EXTRA_NUMBERS, n + 1))}
                        disabled={extraNumbers >= MAX_EXTRA_NUMBERS}
                        aria-label="Mais números extras"
                      >
                        +
                      </Button>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {extraNumbers === 0
                        ? "Nenhum extra"
                        : `+ R$ ${(extraNumbers * EXTRA_NUMBER_PRICE).toLocaleString("pt-BR")}/mês`}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Você pode adicionar mais números depois no painel.
                  </p>
                </div>
              )}

              {plan === "essential" && (
                <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                  WhatsApp com IA está nos planos Profissional e Premium.
                </p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="barbershop_name">Nome da Barbearia *</Label>
                <Input
                  id="barbershop_name"
                  placeholder="Ex.: NavalhIA do João"
                  value={form.barbershop_name}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, barbershop_name: e.target.value }));
                    setFieldErrors((err) => ({ ...err, barbershop_name: "" }));
                  }}
                  className="mt-1 min-h-[44px] text-base sm:text-sm"
                  aria-invalid={!!fieldErrors.barbershop_name}
                />
                {fieldErrors.barbershop_name && (
                  <p className="text-xs text-destructive mt-1">{fieldErrors.barbershop_name}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cnpj">CNPJ (opcional)</Label>
                <Input
                  id="cnpj"
                  placeholder="00.000.000/0001-00"
                  value={formatCNPJ(form.cnpj)}
                  onChange={handleCnpjChange}
                  className="mt-1 min-h-[44px] text-base sm:text-sm"
                  aria-invalid={!!fieldErrors.cnpj}
                />
                {fieldErrors.cnpj && (
                  <p className="text-xs text-destructive mt-1">{fieldErrors.cnpj}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Telefone *</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(11) 98765-4321"
                  value={formatPhoneBR(form.phone)}
                  onChange={handlePhoneChange}
                  className="mt-1 min-h-[44px] text-base sm:text-sm"
                  aria-invalid={!!fieldErrors.phone}
                />
                {fieldErrors.phone && (
                  <p className="text-xs text-destructive mt-1">{fieldErrors.phone}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail *</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  placeholder="seu@email.com"
                  value={form.email}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, email: e.target.value }));
                    setFieldErrors((err) => ({ ...err, email: "" }));
                  }}
                  className="mt-1 min-h-[44px] text-base sm:text-sm"
                  aria-invalid={!!fieldErrors.email}
                />
                {fieldErrors.email && (
                  <p className="text-xs text-destructive mt-1">{fieldErrors.email}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact_name">
                  Nome do responsável (opcional)
                </Label>
                <Input
                  id="contact_name"
                  placeholder="Seu nome"
                  value={form.contact_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contact_name: e.target.value }))
                  }
                  className="mt-1 min-h-[44px] text-base sm:text-sm"
                />
              </div>

              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-sm">
                <p className="font-medium text-foreground">
                  Resumo: {planInfo?.label} {effectiveExtraNumbers > 0 && `+ ${effectiveExtraNumbers} número(s) extra(s)`}
                </p>
                <p className="text-muted-foreground">
                  Total estimado: R$ {monthlyTotal.toLocaleString("pt-BR")}/mês
                </p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="w-full min-h-[44px] text-base sm:text-sm"
                disabled={loading || !isFormValid}
              >
                {loading ? "Preparando..." : "Ir para pagamento"}
              </Button>
              <p className="text-[10px] sm:text-xs text-muted-foreground text-center pt-1">
                Checkout Stripe • Sem fidelidade
              </p>
            </form>
          </>
        ) : clientSecret && stripePromise ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Finalize sua assinatura</DialogTitle>
              <DialogDescription>
                Preencha os dados de pagamento abaixo. Após confirmar, você
                acessa o painel.
              </DialogDescription>
            </DialogHeader>
            <EmbeddedCheckoutProvider
              stripe={stripePromise}
              options={{
                clientSecret,
                onComplete: () => {
                  // Stripe redirects to return_url, so we don't need to do anything here
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
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
