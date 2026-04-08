import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Ban, History, Loader2 } from "lucide-react";
import { plansApi, type PlanSubscription, type PlanCharge } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/toast-helpers";
import { ConfirmDialog } from "@/components/shared";

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  suspended: "Suspenso",
  cancelled: "Cancelado",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive"> = {
  active: "default",
  suspended: "secondary",
  cancelled: "destructive",
};

const CHARGE_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  sent: "Enviado",
  paid: "Pago",
  failed: "Falhou",
  skipped: "Ignorado",
};

const CYCLE_LABELS: Record<string, string> = {
  monthly: "Mensal",
  quarterly: "Trimestral",
  yearly: "Anual",
};

function formatDate(iso: string) {
  try {
    return format(new Date(iso + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return iso;
  }
}

interface ChargesModalProps {
  subscriptionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ChargesModal({ subscriptionId, open, onOpenChange }: ChargesModalProps) {
  const { data: charges = [], isLoading } = useQuery({
    queryKey: ["plan-charges", subscriptionId],
    queryFn: () => plansApi.subscriptions.charges(subscriptionId!),
    enabled: open && Boolean(subscriptionId),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Histórico de cobranças</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : charges.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma cobrança registrada.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {charges.map((c: PlanCharge) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border p-2.5 text-sm">
                <div>
                  <p className="font-medium">R$ {Number(c.amount).toFixed(2).replace(".", ",")}</p>
                  <p className="text-xs text-muted-foreground">Venc: {formatDate(c.due_date)}</p>
                </div>
                <Badge variant={c.status === "paid" ? "default" : c.status === "failed" ? "destructive" : "secondary"}>
                  {CHARGE_STATUS_LABELS[c.status] ?? c.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SubscriptionTableProps {
  subscriptions: PlanSubscription[];
  isLoading: boolean;
}

export function SubscriptionTable({ subscriptions, isLoading }: SubscriptionTableProps) {
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<PlanSubscription | null>(null);
  const [chargesTarget, setChargesTarget] = useState<string | null>(null);
  const [chargesOpen, setChargesOpen] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: (id: string) => plansApi.subscriptions.cancel(id),
    onSuccess: () => {
      toastSuccess("Assinatura cancelada.");
      void queryClient.invalidateQueries({ queryKey: ["plan-subscriptions"] });
    },
    onError: (e) => toastError("Erro ao cancelar", undefined, e instanceof Error ? e.message : String(e)),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        Nenhuma assinatura registrada ainda.
      </p>
    );
  }

  return (
    <>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Ciclo</TableHead>
              <TableHead>Próx. cobrança</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell>
                  <div>
                    <p className="font-medium text-sm">{sub.client_name}</p>
                    <p className="text-xs text-muted-foreground">{sub.client_phone}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="text-sm">{sub.plan_name}</p>
                    <p className="text-xs text-muted-foreground">
                      R$ {Number(sub.price).toFixed(2).replace(".", ",")}
                    </p>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{CYCLE_LABELS[sub.billing_cycle] ?? sub.billing_cycle}</TableCell>
                <TableCell className="text-sm">{formatDate(sub.next_billing_date)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANTS[sub.status] ?? "secondary"}>
                    {STATUS_LABELS[sub.status] ?? sub.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Histórico de cobranças"
                      onClick={() => { setChargesTarget(sub.id); setChargesOpen(true); }}
                    >
                      <History className="h-4 w-4" />
                    </Button>
                    {sub.status === "active" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Cancelar assinatura"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setCancelTarget(sub)}
                      >
                        <Ban className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Cancelar assinatura"
        description={`Cancelar a assinatura de ${cancelTarget?.client_name} no plano "${cancelTarget?.plan_name}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Cancelar assinatura"
        cancelLabel="Manter"
        variant="destructive"
        onConfirm={() => {
          if (cancelTarget) cancelMutation.mutate(cancelTarget.id);
          setCancelTarget(null);
        }}
      />

      <ChargesModal
        subscriptionId={chargesTarget}
        open={chargesOpen}
        onOpenChange={setChargesOpen}
      />
    </>
  );
}
