import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Settings, Scissors, Users, MessageCircle, Lock } from "lucide-react";
import { hasPro } from "@/lib/plan";
import type { Profile } from "@/contexts/AuthContext";
import { CheckoutModal } from "@/components/CheckoutModal";

type SetupChecklistProps = {
  profile: Profile | null;
  barbershop: { name?: string; business_hours?: unknown; slug?: string | null } | null | undefined;
  servicesCount: number;
  barbersCount: number;
  whatsappConnected: boolean;
  loading?: boolean;
  error?: boolean;
};

function hasBusinessHours(bh: unknown): boolean {
  if (!bh || typeof bh !== "object") return false;
  const o = bh as Record<string, unknown>;
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days.some((d) => {
    const day = o[d];
    return day && typeof day === "object" && "start" in (day as object) && "end" in (day as object);
  });
}

export function SetupChecklist({
  profile,
  barbershop,
  servicesCount,
  barbersCount,
  whatsappConnected,
  loading,
  error,
}: SetupChecklistProps) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  if (loading) {
    return (
      <div className="mb-6 rounded-lg border border-border/50 bg-muted/30 p-4 animate-pulse">
        <div className="h-5 w-48 bg-muted rounded mb-3" />
        <div className="space-y-2">
          <div className="h-4 w-full bg-muted rounded" />
          <div className="h-4 w-full bg-muted rounded" />
          <div className="h-4 w-3/4 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-6 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
        <p className="text-sm text-amber-700 dark:text-amber-400 mb-2">
          Não foi possível carregar o status do setup.
        </p>
        <Link to="/app/configuracoes" className="text-sm font-medium text-primary hover:underline">
          Configurar manualmente →
        </Link>
      </div>
    );
  }

  const configDone =
    !!barbershop?.name?.trim() &&
    hasBusinessHours(barbershop.business_hours) &&
    !!barbershop?.slug?.trim();
  const servicesDone = servicesCount >= 1;
  const barbersDone = barbersCount >= 1;
  const isPro = hasPro(profile);
  /** Essential: WhatsApp IA é upgrade — nunca conta como "concluído" no checklist. */
  const whatsappDone = isPro && whatsappConnected;
  const allDone = configDone && servicesDone && barbersDone && whatsappDone;

  if (allDone) return null;

  const steps = [
    {
      done: configDone,
      label: "Definir horário de funcionamento, nome e link de agendamento",
      to: "/app/configuracoes?open=hours",
      icon: Settings,
    },
    {
      done: servicesDone,
      label: "Pelo menos 1 serviço cadastrado",
      to: "/app/servicos",
      icon: Scissors,
    },
    {
      done: barbersDone,
      label: "Pelo menos 1 barbeiro cadastrado",
      to: "/app/barbeiros",
      icon: Users,
    },
    {
      done: whatsappDone,
      label: "Conectar WhatsApp (recepcionista 24h)",
      to: "/app/integracoes?step=connect",
      icon: MessageCircle,
      proOnly: true,
      isPro,
    },
  ];

  return (
    <div className="mb-6 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <h2 className="text-sm font-medium mb-3">Complete seu setup para começar a receber agendamentos</h2>
      <ul className="space-y-2">
        {steps.map((step) => {
          const Icon = step.icon;
          const isProOnly = "proOnly" in step && step.proOnly && !step.isPro;
          return (
            <li key={step.label} className="flex items-center gap-2 text-sm">
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
              ) : isProOnly ? (
                <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              {step.done ? (
                <span className="text-muted-foreground line-through">{step.label}</span>
              ) : isProOnly ? (
                <button
                  type="button"
                  onClick={() => setCheckoutOpen(true)}
                  className="flex items-center gap-1.5 text-primary hover:underline font-medium"
                >
                  <Icon className="h-4 w-4" />
                  {step.label} (Plano Profissional) →
                </button>
              ) : (
                <Link
                  to={step.to}
                  className="flex items-center gap-1.5 text-primary hover:underline font-medium"
                >
                  <Icon className="h-4 w-4" />
                  {step.label} →
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <CheckoutModal open={checkoutOpen} onOpenChange={setCheckoutOpen} initialPlan="pro" />
    </div>
  );
}
