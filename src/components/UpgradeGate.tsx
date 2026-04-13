import { useState } from "react";
import {
  Sparkles,
  Link,
  Calendar,
  MessageCircle,
  FileText,
  Building2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { hasPro, hasPremium } from "@/lib/plan";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckoutModal } from "@/components/CheckoutModal";
import type { BillingPlan } from "@/lib/api";
import { BILLING_PLANS } from "@/lib/billing-plans";
import { cn } from "@/lib/utils";

type Props = {
  children: React.ReactNode;
  /** Short title for the locked feature (e.g. "Agendamentos"). */
  featureName?: string;
  /** Plan required to unlock: 'pro' or 'premium'. Default 'pro'. */
  requiredPlan?: "pro" | "premium";
  /** 'page' = full-height centered block; 'inline' = compact card for inside a section. */
  variant?: "page" | "inline";
};

const PLAN_FEATURES: Record<
  BillingPlan,
  { icon: LucideIcon; text: string }[]
> = {
  essential: [
    { icon: Calendar, text: "Agendamentos e painel de gestão" },
    { icon: Link, text: "Link público para clientes agendarem" },
    { icon: FileText, text: "Barbeiros, serviços e clientes" },
    { icon: Zap, text: "Gestão básica sem IA" },
  ],
  pro: [
    { icon: Sparkles, text: "Assistente de IA para agendamentos" },
    { icon: MessageCircle, text: "WhatsApp com IA e lembretes automáticos" },
    { icon: Calendar, text: "Follow-ups e notificações" },
    { icon: Zap, text: "Integrações e API" },
    { icon: FileText, text: "Todas as telas de gestão" },
  ],
  premium: [
    { icon: Sparkles, text: "Tudo do Profissional e mais" },
    { icon: FileText, text: "Base de conhecimento do agente (RAG)" },
    { icon: Building2, text: "Múltiplas filiais" },
    { icon: Zap, text: "Recursos avançados e prioridade" },
  ],
};

function getRequiredPlanLabel(requiredPlan: "pro" | "premium"): string {
  return requiredPlan === "premium" ? "Premium" : "Profissional";
}

export function UpgradeGate({
  children,
  featureName = "Esta funcionalidade",
  requiredPlan = "pro",
  variant = "page",
}: Props) {
  const { profile } = useAuth();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>(requiredPlan);

  const hasAccess =
    requiredPlan === "premium" ? hasPremium(profile) : hasPro(profile);

  if (hasAccess) {
    return <>{children}</>;
  }

  const currentPlan: BillingPlan =
    (profile?.billing_plan as BillingPlan) ?? "essential";
  const requiredPlanLabel = getRequiredPlanLabel(requiredPlan);

  const openCheckout = (plan: BillingPlan) => {
    setSelectedPlan(plan);
    setCheckoutOpen(true);
  };

  const isCompact = variant === "inline";

  const headerTitle = isCompact
    ? `${featureName} requer plano ${requiredPlanLabel}`
    : `Desbloqueie ${featureName}`;
  const headerSubtitle = isCompact
    ? `Faça upgrade para o plano ${requiredPlanLabel} e desbloqueie este recurso.`
    : `Esta funcionalidade está disponível no plano ${requiredPlanLabel}. Escolha seu plano abaixo.`;

  const cardGrid = (
    <div
      className={cn(
        "grid gap-4 sm:gap-5 w-full",
        isCompact
          ? "grid-cols-1 sm:grid-cols-3"
          : "grid-cols-1 md:grid-cols-3 max-w-5xl mx-auto"
      )}
    >
      {BILLING_PLANS.map((plan) => {
        const isCurrent = plan.id === currentPlan;
        const isHighlight = plan.id === requiredPlan;
        const features = PLAN_FEATURES[plan.id];

        return (
          <Card
            key={plan.id}
            className={cn(
              "flex flex-col transition-colors",
              isHighlight &&
                "ring-2 ring-primary bg-primary/5 dark:bg-primary/10 border-primary/50",
              isCompact ? "p-3 sm:p-4" : "p-5 sm:p-6 min-h-[320px]"
            )}
          >
            <CardHeader className="p-0 pb-2 sm:pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle
                    className={cn(
                      "font-semibold text-foreground leading-tight",
                      isCompact ? "text-base" : "text-lg"
                    )}
                  >
                    {plan.label}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {plan.desc}
                  </p>
                </div>
                {isHighlight && (
                  <span className="shrink-0 rounded-md bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                    Necessário
                  </span>
                )}
              </div>
              <p
                className={cn(
                  "font-semibold text-foreground mt-1",
                  isCompact ? "text-sm" : "text-base"
                )}
              >
                {plan.price}
              </p>
            </CardHeader>
            <CardContent className="p-0 flex-1 space-y-2">
              <ul className="space-y-2 text-left">
                {features.slice(0, isCompact ? 3 : 6).map((f, i) => {
                  const Icon = f.icon;
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 text-sm text-muted-foreground text-left"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-primary/70" />
                      <span>{f.text}</span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
            <CardFooter className="p-0 pt-3 sm:pt-4 mt-auto">
              {isCurrent ? (
                <Button
                  variant="secondary"
                  size={isCompact ? "sm" : "default"}
                  className="w-full"
                  disabled
                >
                  Seu plano atual
                </Button>
              ) : (
                <Button
                  size={isCompact ? "sm" : "default"}
                  variant={isHighlight ? "default" : "outline"}
                  className="w-full"
                  onClick={() => openCheckout(plan.id)}
                >
                  Fazer upgrade para {plan.label}
                </Button>
              )}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );

  return (
    <>
      <div
        className={cn(
          "animate-fade-in",
          isCompact
            ? "rounded-xl border border-border bg-card/50 p-4 sm:p-5"
            : "flex flex-col items-center justify-center min-h-[60vh] px-4 text-center"
        )}
      >
        <div className={isCompact ? "space-y-4" : "space-y-6 w-full"}>
          <div>
            <h2
              className={cn(
                "font-semibold text-foreground",
                isCompact ? "text-base" : "text-xl sm:text-2xl"
              )}
            >
              {headerTitle}
            </h2>
            <p
              className={cn(
                "text-muted-foreground mt-1",
                isCompact ? "text-sm" : "text-sm sm:text-base"
              )}
            >
              {headerSubtitle}
            </p>
          </div>
          {cardGrid}
        </div>
      </div>
      <CheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        initialPlan={selectedPlan}
      />
    </>
  );
}
