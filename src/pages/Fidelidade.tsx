import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StatCard } from "@/components/dashboard/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { Trophy, Gift, Users, TrendingUp, Award, Sparkles } from "lucide-react";
import { loyaltyApi, clientsApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { withToast } from "@/lib/toast-helpers";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Fidelidade() {
  const queryClient = useQueryClient();
  const [redeemService, setRedeemService] = useState<{
    id: string;
    name: string;
    points_to_redeem: number;
  } | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>("");

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["loyalty", "stats"],
    queryFn: () => loyaltyApi.stats(),
  });

  const { data: rewards = [], isLoading: rewardsLoading } = useQuery({
    queryKey: ["loyalty", "rewards"],
    queryFn: () => loyaltyApi.rewards(),
  });

  const { data: ranking = [], isLoading: rankingLoading } = useQuery({
    queryKey: ["loyalty", "ranking"],
    queryFn: () => loyaltyApi.ranking(50),
  });

  const { data: redemptions = [], isLoading: redemptionsLoading } = useQuery({
    queryKey: ["loyalty", "redemptions"],
    queryFn: () => loyaltyApi.redemptions(30),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => clientsApi.list(),
    enabled: !!redeemService,
  });

  const redeemMutation = useMutation({
    mutationFn: (body: { client_id: string; service_id: string }) =>
      loyaltyApi.redeem(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loyalty"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setRedeemService(null);
      setSelectedClientId("");
    },
  });

  const clientsWithEnoughPoints =
    redeemService == null
      ? []
      : clients.filter(
          (c) => (c.loyalty_points ?? 0) >= redeemService.points_to_redeem,
        );

  const handleRedeemConfirm = async () => {
    if (!redeemService || !selectedClientId) return;
    await withToast(
      redeemMutation.mutateAsync({
        client_id: selectedClientId,
        service_id: redeemService.id,
      }),
      {
        successMessage: "Resgate realizado. Pontos debitados do cliente.",
        errorMessage: "Erro ao resgatar.",
      },
    );
  };

  return (
    <>
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Programa de Fidelidade</h1>
          <p className="page-subtitle">
            Pontos por serviço e recompensas para seus clientes
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statsLoading ? (
            <>
              <Skeleton className="h-[120px] rounded-lg" />
              <Skeleton className="h-[120px] rounded-lg" />
              <Skeleton className="h-[120px] rounded-lg" />
              <Skeleton className="h-[120px] rounded-lg" />
            </>
          ) : (
            <>
              <StatCard
                title="Clientes com pontos"
                value={String(stats?.clients_with_points ?? 0)}
                subtitle="Com pontos acumulados"
                icon={<Users className="w-6 h-6" />}
              />
              <StatCard
                title="Pontos distribuídos"
                value={String(stats?.points_distributed_this_month ?? 0)}
                subtitle="Este mês"
                icon={<Trophy className="w-6 h-6" />}
                variant="accent"
              />
              <StatCard
                title="Resgates"
                value={String(stats?.redemptions_this_month ?? 0)}
                subtitle="Este mês"
                icon={<Gift className="w-6 h-6" />}
                variant="success"
              />
              <StatCard
                title="Taxa de retorno"
                value="—"
                subtitle="Em breve"
                icon={<TrendingUp className="w-6 h-6" />}
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="stat-card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Award className="w-5 h-5" />
              Ranking por pontos
            </h2>
            {rankingLoading ? (
              <Skeleton className="h-64 w-full rounded-md" />
            ) : ranking.length === 0 ? (
              <EmptyState
                icon={<Award className="h-12 w-12" strokeWidth={1.5} />}
                title="Nenhum cliente com pontos ainda"
                description="Os pontos aparecerão aqui quando os clientes acumularem através dos atendimentos."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {ranking.map((row, i) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/20"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-muted-foreground font-medium w-6">
                        #{i + 1}
                      </span>
                      <span className="font-medium truncate">{row.name}</span>
                    </div>
                    <span className="font-semibold text-foreground shrink-0">
                      {row.loyalty_points} pts
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="stat-card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Recompensas disponíveis
            </h2>
            {rewardsLoading ? (
              <Skeleton className="h-32 w-full rounded-md" />
            ) : rewards.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="h-12 w-12" strokeWidth={1.5} />}
                title="Nenhuma recompensa configurada"
                description={
                  'Em Serviços, defina "Pontos para resgatar" nos serviços que podem ser trocados por pontos.'
                }
              />
            ) : (
              <div className="space-y-3">
                {rewards.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30"
                  >
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {r.points_to_redeem} pts
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => {
                        setRedeemService(r);
                        setSelectedClientId("");
                      }}
                    >
                      Resgatar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="stat-card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Gift className="w-5 h-5" />
            Resgates recentes
          </h2>
          {redemptionsLoading ? (
            <Skeleton className="h-40 w-full rounded-md" />
          ) : redemptions.length === 0 ? (
            <EmptyState
              icon={<Gift className="h-12 w-12" strokeWidth={1.5} />}
              title="Nenhum resgate registrado ainda"
              description="Os resgates de pontos aparecerão aqui quando forem realizados."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {redemptions.map((row) => (
                <div
                  key={row.id}
                  className="p-3 rounded-lg border border-border bg-muted/20 space-y-1"
                >
                  <p className="font-medium text-foreground">{row.client_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.service_name} · {row.points_spent} pts
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(row.redeemed_at), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={!!redeemService}
        onOpenChange={(open) => !open && setRedeemService(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resgatar recompensa</DialogTitle>
            <DialogDescription>
              {redeemService && (
                <>
                  <strong>{redeemService.name}</strong> —{" "}
                  {redeemService.points_to_redeem} pontos. Selecione o cliente
                  para debitar os pontos.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Cliente</Label>
              <Select
                value={selectedClientId}
                onValueChange={setSelectedClientId}
                disabled={!redeemService}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientsWithEnoughPoints.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Nenhum cliente com pontos suficientes
                    </div>
                  ) : (
                    clientsWithEnoughPoints.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} — {c.loyalty_points} pts
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedeemService(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleRedeemConfirm}
              disabled={!selectedClientId || redeemMutation.isPending}
            >
              {redeemMutation.isPending ? "Resgatando…" : "Confirmar resgate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
