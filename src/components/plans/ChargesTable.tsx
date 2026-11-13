import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Banknote, Loader2, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { plansApi, type PlanChargeRow, type PlanPaidMethod } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/toast-helpers";

const SITUATION_LABELS: Record<PlanChargeRow["situation"], string> = {
  upcoming: "A vencer",
  due_today: "Vence hoje",
  overdue: "Atrasada",
  paid: "Paga",
};

const SITUATION_VARIANTS: Record<PlanChargeRow["situation"], "default" | "secondary" | "destructive" | "outline"> = {
  upcoming: "outline",
  due_today: "secondary",
  overdue: "destructive",
  paid: "default",
};

const QUEUED_KIND_LABELS: Record<string, string> = {
  due: "Vencimento",
  day10: "10º dia",
  manual: "Manual",
};

const PAID_METHOD_LABELS: Record<PlanPaidMethod, string> = {
  cash: "Dinheiro",
  pix: "PIX conferido",
};

function formatDay(iso: string) {
  try {
    return format(new Date(iso.slice(0, 10) + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return iso;
  }
}

function formatRunAfter(iso: string) {
  try {
    return format(new Date(iso), "dd/MM 'às' HH:mm", { locale: ptBR });
  } catch {
    return iso;
  }
}

function formatMoney(v: number) {
  return `R$ ${Number(v).toFixed(2).replace(".", ",")}`;
}

function todayIso() {
  return format(new Date(), "yyyy-MM-dd");
}

interface ReceiveDialogProps {
  charge: PlanChargeRow | null;
  onOpenChange: (open: boolean) => void;
}

function ReceiveDialog({ charge, onOpenChange }: ReceiveDialogProps) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<PlanPaidMethod>("cash");
  const [paidOn, setPaidOn] = useState(todayIso());

  const receiveMutation = useMutation({
    mutationFn: () => plansApi.charges.receive(charge!.id, { method, paid_on: paidOn || undefined }),
    onSuccess: () => {
      toastSuccess("Recebimento lançado.", "Os envios dessa cobrança que estavam na fila foram cancelados.");
      void queryClient.invalidateQueries({ queryKey: ["plan-charges-board"] });
      void queryClient.invalidateQueries({ queryKey: ["plan-charges"] });
      onOpenChange(false);
    },
    onError: (e) => toastError("Não foi possível lançar o recebimento", e),
  });

  return (
    <Dialog open={Boolean(charge)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lançar recebimento</DialogTitle>
          <DialogDescription>
            {charge
              ? `${charge.client_name} · ${charge.plan_name} · vencimento ${formatDay(charge.due_date)} · ${formatMoney(charge.amount)}`
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Forma de pagamento</Label>
            <RadioGroup value={method} onValueChange={(v) => setMethod(v as PlanPaidMethod)} className="gap-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem id="receive-cash" value="cash" />
                <Label htmlFor="receive-cash" className="font-normal">Dinheiro</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="receive-pix" value="pix" />
                <Label htmlFor="receive-pix" className="font-normal">PIX conferido no extrato</Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-date">Data do recebimento</Label>
            <Input
              id="receive-date"
              type="date"
              value={paidOn}
              max={todayIso()}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!charge || receiveMutation.isPending}
            onClick={() => receiveMutation.mutate()}
          >
            {receiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirmar recebimento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChargesTable() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"open" | "paid">("open");
  const [receiveTarget, setReceiveTarget] = useState<PlanChargeRow | null>(null);

  const { data: charges = [], isLoading } = useQuery({
    queryKey: ["plan-charges-board", filter],
    queryFn: () => plansApi.charges.list(filter),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["plan-charges-board"] });

  const sendMutation = useMutation({
    mutationFn: (id: string) => plansApi.charges.send(id),
    onSuccess: (r) => {
      toastSuccess("Cobrança na fila de envio.", r.message);
      invalidate();
    },
    onError: (e) => toastError("Cobrança não enviada", e),
  });

  const cancelQueuedMutation = useMutation({
    mutationFn: (scheduledId: string) => plansApi.charges.cancelQueued(scheduledId),
    onSuccess: () => {
      toastSuccess("Envio cancelado.");
      invalidate();
    },
    onError: (e) => toastError("Não foi possível cancelar o envio", e),
  });

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <p className="text-sm text-muted-foreground">
          A cobrança sai só quando você envia ou quando o automático está ligado na assinatura. O mês fica pago
          quando você lança o recebimento.
        </p>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as "open" | "paid")}>
          <TabsList>
            <TabsTrigger value="open">Em aberto</TabsTrigger>
            <TabsTrigger value="paid">Pagas</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : charges.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center border rounded-md border-dashed">
          {filter === "open" ? "Nenhuma cobrança em aberto." : "Nenhum recebimento lançado ainda."}
        </p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>{filter === "open" ? "Envios na fila" : "Recebimento"}</TableHead>
                {filter === "open" ? <TableHead className="text-right">Ações</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {charges.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <p className="font-medium text-sm">{c.client_name}</p>
                    <p className="text-xs text-muted-foreground">{c.client_phone}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{c.plan_name}</p>
                    <p className="text-xs text-muted-foreground">{formatMoney(c.amount)}</p>
                  </TableCell>
                  <TableCell className="text-sm">{formatDay(c.due_date)}</TableCell>
                  <TableCell>
                    <Badge variant={SITUATION_VARIANTS[c.situation]}>{SITUATION_LABELS[c.situation]}</Badge>
                  </TableCell>
                  <TableCell>
                    {filter === "paid" ? (
                      <span className="text-sm">
                        {c.paid_method ? PAID_METHOD_LABELS[c.paid_method] : "—"}
                        {c.paid_at ? ` · ${formatDay(c.paid_at)}` : ""}
                      </span>
                    ) : c.queued.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {c.auto_billing ? "Nada na fila" : "Manual"}
                      </span>
                    ) : (
                      <ul className="space-y-1">
                        {c.queued.map((q) => (
                          <li key={q.id} className="flex items-center gap-1 text-xs">
                            <span>
                              {QUEUED_KIND_LABELS[q.kind] ?? q.kind} · {formatRunAfter(q.run_after)}
                            </span>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              aria-label="Cancelar envio"
                              title="Cancelar envio"
                              disabled={cancelQueuedMutation.isPending}
                              onClick={() => cancelQueuedMutation.mutate(q.id)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  {filter === "open" ? (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={sendMutation.isPending || c.queued.some((q) => q.kind === "manual")}
                          onClick={() => sendMutation.mutate(c.id)}
                        >
                          <Send className="h-3.5 w-3.5" />
                          Enviar cobrança
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => setReceiveTarget(c)}
                        >
                          <Banknote className="h-3.5 w-3.5" />
                          Lançar recebimento
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ReceiveDialog charge={receiveTarget} onOpenChange={(o) => !o && setReceiveTarget(null)} />
    </>
  );
}
