import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Pencil, Trash2, RotateCcw } from "lucide-react";
import type { BarbershopPlan } from "@/lib/api";

const CYCLE_LABELS: Record<string, string> = {
  monthly: "Mensal",
  quarterly: "Trimestral",
  yearly: "Anual",
};

interface PlanCardProps {
  plan: BarbershopPlan;
  onEdit: (plan: BarbershopPlan) => void;
  onDeactivate: (plan: BarbershopPlan) => void;
  onReactivate?: (plan: BarbershopPlan) => void;
  reactivatePending?: boolean;
}

export function PlanCard({ plan, onEdit, onDeactivate, onReactivate, reactivatePending }: PlanCardProps) {
  const price = Number(plan.price).toFixed(2).replace(".", ",");
  const cycle = CYCLE_LABELS[plan.billing_cycle] ?? plan.billing_cycle;

  return (
    <Card className={plan.is_active ? "" : "opacity-60"}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-base leading-tight">{plan.name}</h3>
            {plan.description && (
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{plan.description}</p>
            )}
          </div>
          <Badge variant={plan.is_active ? "default" : "secondary"} className="shrink-0 text-xs">
            {plan.is_active ? "Ativo" : "Inativo"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-3 space-y-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold">R$ {price}</span>
          <span className="text-sm text-muted-foreground">/ {cycle.toLowerCase()}</span>
        </div>
        {plan.max_visits && (
          <p className="text-xs text-muted-foreground">Até {plan.max_visits} visita{plan.max_visits !== 1 ? "s" : ""} por ciclo</p>
        )}
        {plan.services_detail.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {plan.services_detail.map((s) => (
              <Badge key={s.id} variant="outline" className="text-xs font-normal">
                {s.name}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="gap-2 pt-0">
        <Button size="sm" variant="outline" onClick={() => onEdit(plan)} className="gap-1.5">
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </Button>
        {plan.is_active && (
          <Button size="sm" variant="ghost" onClick={() => onDeactivate(plan)} className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5" />
            Desativar
          </Button>
        )}
        {!plan.is_active && onReactivate && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onReactivate(plan)}
            disabled={reactivatePending}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reativar
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
