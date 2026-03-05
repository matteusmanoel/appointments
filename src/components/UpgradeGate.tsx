import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { hasPro, hasPremium } from "@/lib/plan";
import { Button } from "@/components/ui/button";
import { CheckoutModal } from "@/components/CheckoutModal";
import type { BillingPlan } from "@/lib/api";

type Props = {
  children: React.ReactNode;
  /** Short title for the locked feature (e.g. "Agendamentos"). */
  featureName?: string;
  /** Plan required to unlock: 'pro' or 'premium'. Default 'pro'. */
  requiredPlan?: "pro" | "premium";
  /** 'page' = full-height centered block; 'inline' = compact card for inside a section. */
  variant?: "page" | "inline";
};

const PRO_COPY = {
  titleSuffix: "é plano Profissional",
  description:
    "No plano Profissional você tem acesso à assistente de IA para agendamentos, lembretes automáticos e follow-ups, além de todas as telas de gestão. Faça upgrade para desbloquear.",
  cta: "Fazer upgrade para Profissional",
};

const PREMIUM_COPY = {
  titleSuffix: "é plano Premium",
  description:
    "No plano Premium você tem acesso à base de conhecimento do agente (documentos, RAG), múltiplas filiais e recursos avançados. Faça upgrade para desbloquear.",
  cta: "Fazer upgrade para Premium",
};

export function UpgradeGate({
  children,
  featureName = "Esta funcionalidade",
  requiredPlan = "pro",
  variant = "page",
}: Props) {
  const { profile } = useAuth();
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const hasAccess =
    requiredPlan === "premium" ? hasPremium(profile) : hasPro(profile);

  if (hasAccess) {
    return <>{children}</>;
  }

  const copy = requiredPlan === "premium" ? PREMIUM_COPY : PRO_COPY;
  const initialPlan: BillingPlan = requiredPlan;

  if (variant === "inline") {
    return (
      <>
        <div className="rounded-xl border border-border bg-card/50 p-4 sm:p-6 flex flex-col items-center justify-center text-center animate-fade-in">
          <div className="rounded-full bg-primary/10 p-3 mb-3">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground mb-1">
            {featureName} {copy.titleSuffix}
          </h3>
          <p className="text-muted-foreground text-sm mb-4 max-w-md">
            {copy.description}
          </p>
          <Button size="sm" onClick={() => setCheckoutOpen(true)}>
            {copy.cta}
          </Button>
        </div>
        <CheckoutModal
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          initialPlan={initialPlan}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center animate-fade-in">
        <div className="rounded-2xl border border-border bg-card p-8 max-w-md w-full shadow-lg">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-primary/10 p-4">
              <Sparkles className="h-10 w-10 text-primary" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {featureName} {copy.titleSuffix}
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            {copy.description}
          </p>
          <Button
            size="lg"
            className="w-full"
            onClick={() => setCheckoutOpen(true)}
          >
            {copy.cta}
          </Button>
        </div>
      </div>
      <CheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        initialPlan={initialPlan}
      />
    </>
  );
}
