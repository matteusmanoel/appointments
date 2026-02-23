import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  formatCurrencyBR,
  parseCurrencyDigitsToNumber,
  numberToCurrencyDigits,
  formatCurrencyDigits,
} from "@/lib/input-masks";
import type { BillingPlan } from "@/lib/api";

type Props = {
  onCtaClick: () => void;
  defaultPlan?: BillingPlan;
};

const PLAN_LABEL: Record<BillingPlan, string> = {
  essential: "Essencial",
  pro: "Profissional",
  premium: "Premium",
};

function recommendPlan(monthlyLoss: number): BillingPlan {
  if (monthlyLoss >= 2500) return "premium";
  if (monthlyLoss >= 900) return "pro";
  return "essential";
}

export function RoiCalculator({ onCtaClick }: Props) {
  const [ticketDigits, setTicketDigits] = useState(() =>
    numberToCurrencyDigits(60),
  );
  const [lostClientsPerWeek, setLostClientsPerWeek] = useState(4);
  const [noShowsPerWeek, setNoShowsPerWeek] = useState(2);

  const ticket = useMemo(
    () => parseCurrencyDigitsToNumber(ticketDigits),
    [ticketDigits],
  );
  const monthlyLoss = useMemo(() => {
    const weeks = 4.3;
    const lost = (lostClientsPerWeek + noShowsPerWeek) * ticket * weeks;
    return Math.max(0, Math.round(lost * 100) / 100);
  }, [lostClientsPerWeek, noShowsPerWeek, ticket]);

  const cutsToBreakEven = useMemo(() => {
    const price = ticket || 1;
    return Math.max(1, Math.ceil(197 / price));
  }, [ticket]);

  const recommended = useMemo(() => recommendPlan(monthlyLoss), [monthlyLoss]);

  return (
    <Card className="border-primary/30 min-w-0 w-full overflow-hidden">
      <CardHeader className="pb-2 md:pb-3">
        <CardTitle className="text-base md:text-lg leading-snug">
          Quanto custa “demorar no WhatsApp”?{" "}
        </CardTitle>
        <CardDescription className="text-sm leading-relaxed">
          Ajuste os números e veja quanto você pode estar perdendo por mês.
          (Estimativa simples.)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pb-6 pt-0">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-1 min-h-[7rem] flex flex-col">
            <Label htmlFor="ticket" className="text-sm">
              Ticket médio (R$)
            </Label>
            <Input
              id="ticket"
              inputMode="numeric"
              value={formatCurrencyDigits(ticketDigits)}
              onChange={(e) => setTicketDigits(e.target.value)}
              className="mt-1.5 h-10 w-full min-w-0"
              placeholder="60,00"
            />
            <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
              Ex.: corte, barba ou combo.
            </p>
          </div>
          <div className="md:col-span-2 rounded-lg border bg-muted/30 p-4 min-h-[7rem] flex flex-col justify-center">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground shrink-0">
                Perda estimada/mês
              </p>
              <p className="text-xl md:text-2xl font-bold text-foreground tabular-nums min-w-[8rem] text-right">
                R$ {formatCurrencyBR(monthlyLoss)}
              </p>
            </div>
            <p className="text-sm text-muted-foreground mt-2 leading-snug">
              Plano sugerido:{" "}
              <span className="font-medium text-foreground">
                {PLAN_LABEL[recommended]}
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
              Dica: se você recuperar só{" "}
              <span className="font-medium tabular-nums">
                {cutsToBreakEven} cortes/mês
              </span>
              , o plano Profissional já tende a se pagar.
            </p>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2 min-h-[4.5rem]">
            <div className="flex items-center justify-between gap-2 min-h-5">
              <Label className="text-sm leading-tight">
                Clientes perdidos/semana (não respondeu)
              </Label>
              <span className="text-sm font-medium tabular-nums shrink-0 w-6 text-right">
                {lostClientsPerWeek}
              </span>
            </div>
            <Slider
              value={[lostClientsPerWeek]}
              onValueChange={(v) => setLostClientsPerWeek(v[0] ?? 0)}
              min={0}
              max={20}
              step={1}
              className="py-2"
            />
          </div>
          <div className="space-y-2 min-h-[4.5rem]">
            <div className="flex items-center justify-between gap-2 min-h-5">
              <Label className="text-sm leading-tight">No-shows/semana</Label>
              <span className="text-sm font-medium tabular-nums shrink-0 w-6 text-right">
                {noShowsPerWeek}
              </span>
            </div>
            <Slider
              value={[noShowsPerWeek]}
              onValueChange={(v) => setNoShowsPerWeek(v[0] ?? 0)}
              min={0}
              max={20}
              step={1}
              className="py-2"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between pt-1 min-h-[3.5rem]">
          <div className="text-sm text-muted-foreground leading-snug">
            Checkout seguro Stripe • Sem fidelidade
          </div>
          <Button
            onClick={onCtaClick}
            className="sm:min-w-[220px] h-10 shrink-0"
          >
            Quero parar de perder cliente
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
