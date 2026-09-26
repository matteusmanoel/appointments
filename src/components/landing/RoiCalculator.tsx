import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

const PRO_PRICE = 297;

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

function FluidSlider({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const fill = `${(value / max) * 100}%`;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-widest text-white/40">
          {label}
        </span>
        <span className="font-mono text-sm tabular-nums text-white">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="lp-range"
        style={{ ["--fill" as string]: fill }}
      />
    </div>
  );
}

export function RoiCalculator({ onCtaClick }: Props) {
  const [ticketDigits, setTicketDigits] = useState(() => numberToCurrencyDigits(60));
  const [lostClientsPerWeek, setLostClientsPerWeek] = useState(4);
  const [noShowsPerWeek, setNoShowsPerWeek] = useState(2);

  const ticket = useMemo(() => parseCurrencyDigitsToNumber(ticketDigits), [ticketDigits]);

  const monthlyLoss = useMemo(() => {
    const weeks = 4.3;
    const lost = (lostClientsPerWeek + noShowsPerWeek) * ticket * weeks;
    return Math.max(0, Math.round(lost * 100) / 100);
  }, [lostClientsPerWeek, noShowsPerWeek, ticket]);

  const cutsToBreakEven = useMemo(() => {
    const price = ticket || 1;
    return Math.max(1, Math.ceil(PRO_PRICE / price));
  }, [ticket]);

  const recommended = useMemo(() => recommendPlan(monthlyLoss), [monthlyLoss]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="relative rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-[#0c0c12] p-6 md:p-8">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Como o cálculo é feito"
              className="absolute right-4 top-4 cursor-pointer rounded-full p-1.5 text-white/35 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Info className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="left"
            className="max-w-[260px] border-white/10 bg-[#12121a] font-mono text-[11px] leading-relaxed text-white/75"
          >
            Perda do mês = (clientes que desistem + faltas na semana) × ticket × 4,3 semanas.
            O plano sugerido é o que cabe nessa perda. Cortes para o Profissional se pagar = R$ 297 ÷ ticket.
          </TooltipContent>
        </Tooltip>

        <p className="font-mono text-[11px] uppercase tracking-widest text-white/35">
          Perda estimada / mês
        </p>
        <p className="mt-2 font-display text-4xl font-bold tabular-nums text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400 md:text-5xl">
          R$ {formatCurrencyBR(monthlyLoss)}
        </p>
        <p className="mt-2 font-display text-sm text-white/55">
          Plano sugerido{" "}
          <span className="text-white">{PLAN_LABEL[recommended]}</span>
        </p>

        <div className="mt-8 space-y-6">
          <div>
            <label htmlFor="ticket" className="font-mono text-[11px] uppercase tracking-widest text-white/40">
              Ticket médio
            </label>
            <Input
              id="ticket"
              inputMode="numeric"
              value={formatCurrencyDigits(ticketDigits)}
              onChange={(e) => setTicketDigits(e.target.value)}
              className="mt-2 h-11 border-white/10 bg-white/[0.03] font-mono text-white placeholder:text-white/25"
              placeholder="60,00"
            />
          </div>

          <FluidSlider
            label="Clientes que desistem / semana"
            value={lostClientsPerWeek}
            max={20}
            onChange={setLostClientsPerWeek}
          />
          <FluidSlider
            label="Faltas / semana"
            value={noShowsPerWeek}
            max={20}
            onChange={setNoShowsPerWeek}
          />
        </div>

        <p className="mt-6 flex items-start gap-2 font-display text-sm leading-snug text-white/50">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" aria-hidden />
          <span>
            Recupere só{" "}
            <span className="font-mono tabular-nums text-white">{cutsToBreakEven}</span>{" "}
            cortes no mês e o Profissional já se paga.
          </span>
        </p>

        <button
          type="button"
          onClick={onCtaClick}
          className="lp-shimmer mt-6 w-full rounded-xl bg-primary py-3.5 font-display text-sm font-semibold text-white shadow-[0_0_24px_hsl(239_84%_62%/0.4)] transition-all hover:shadow-[0_0_36px_hsl(239_84%_62%/0.55)]"
        >
          <span className="relative z-10">Quero parar de perder cliente</span>
        </button>
      </div>
    </TooltipProvider>
  );
}
