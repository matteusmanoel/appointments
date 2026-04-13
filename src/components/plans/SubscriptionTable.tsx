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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Ban, History, Link2, Loader2 } from "lucide-react";
import { plansApi, clientsApi, type PlanSubscription, type PlanCharge } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
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
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkClientId, setLinkClientId] = useState("");
  const [linkPlanId, setLinkPlanId] = useState("");

  const { data: clientsList = [] } = useQuery({
    queryKey: ["clients", "subscription-link"],
    queryFn: () => clientsApi.list(),
    enabled: linkOpen,
  });

  const { data: plansList = [] } = useQuery({
    queryKey: ["plans", "subscription-link"],
    queryFn: () => plansApi.list(),
    enabled: linkOpen,
  });

  const activePlans = plansList.filter((p) => p.is_active);

  const createSubscriptionMutation = useMutation({
    mutationFn: () =>
      plansApi.subscriptions.create({
        client_id: linkClientId,
        plan_id: linkPlanId,
      }),
    onSuccess: () => {
      toastSuccess("Assinatura vinculada ao cliente.");
      setLinkOpen(false);
      setLinkClientId("");
      setLinkPlanId("");
      void queryClient.invalidateQueries({ queryKey: ["plan-subscriptions"] });
    },
    onError: (e) =>
      toastError("Não foi possível vincular", e instanceof Error ? e : undefined),
  });

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

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <p className="text-sm text-muted-foreground">
          Vincule um plano ativo a um cliente para gerar cobranças recorrentes (base para automações e WhatsApp).
        </p>
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-2" onClick={() => setLinkOpen(true)}>
          <Link2 className="h-4 w-4" />
          Vincular assinatura
        </Button>
      </div>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular plano ao cliente</DialogTitle>
            <DialogDescription>
              Escolha um cliente e um plano ativo. A primeira cobrança PIX será agendada conforme a regra do backend.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="sub-client">Cliente</Label>
              <Select value={linkClientId || undefined} onValueChange={setLinkClientId}>
                <SelectTrigger id="sub-client">
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientsList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} · {c.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-plan">Plano ativo</Label>
              <Select value={linkPlanId || undefined} onValueChange={setLinkPlanId}>
                <SelectTrigger id="sub-plan">
                  <SelectValue placeholder="Selecione o plano" />
                </SelectTrigger>
                <SelectContent>
                  {activePlans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — R$ {Number(p.price).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={!linkClientId || !linkPlanId || createSubscriptionMutation.isPending}
              onClick={() => createSubscriptionMutation.mutate()}
            >
              {createSubscriptionMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Salvando…
                </>
              ) : (
                "Confirmar vínculo"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {subscriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center border rounded-md border-dashed">
          Nenhuma assinatura registrada ainda. Use &quot;Vincular assinatura&quot; acima.
        </p>
      ) : (
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
      )}

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
