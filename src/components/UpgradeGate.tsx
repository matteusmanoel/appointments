import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { hasPro } from "@/lib/plan";
import { Button } from "@/components/ui/button";
import { CheckoutModal } from "@/components/CheckoutModal";

type Props = {
  children: React.ReactNode;
  /** Short title for the locked feature (e.g. "Agendamentos"). */
  featureName?: string;
};

export function UpgradeGate({ children, featureName = "Esta funcionalidade" }: Props) {
  const { profile } = useAuth();
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  if (hasPro(profile)) {
    return <>{children}</>;
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
            {featureName} é plano Profissional
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            No plano Profissional você tem acesso à assistente de IA para agendamentos,
            lembretes automáticos e follow-ups, além de todas as telas de gestão.
            Faça upgrade para desbloquear.
          </p>
          <Button
            size="lg"
            className="w-full"
            onClick={() => setCheckoutOpen(true)}
          >
            Fazer upgrade para Profissional
          </Button>
        </div>
      </div>
      <CheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        initialPlan="pro"
      />
    </>
  );
}
