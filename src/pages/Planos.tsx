import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, CreditCard, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { plansApi, type BarbershopPlan } from "@/lib/api";
import { PlanCard } from "@/components/plans/PlanCard";
import { PlanFormModal } from "@/components/plans/PlanFormModal";
import { SubscriptionTable } from "@/components/plans/SubscriptionTable";
import { ConfirmDialog } from "@/components/shared";
import { toastError, toastSuccess } from "@/lib/toast-helpers";
import { LoadingState } from "@/components/LoadingState";

export default function Planos() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<BarbershopPlan | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<BarbershopPlan | null>(null);

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: () => plansApi.list(),
  });

  const { data: subscriptions = [], isLoading: subsLoading } = useQuery({
    queryKey: ["plan-subscriptions"],
    queryFn: () => plansApi.subscriptions.list(),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => plansApi.deactivate(id),
    onSuccess: () => {
      toastSuccess("Plano desativado.");
      void queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
    onError: (e) => toastError("Erro ao desativar", undefined, e instanceof Error ? e.message : String(e)),
  });

  const activePlans = plans.filter((p) => p.is_active);
  const inactivePlans = plans.filter((p) => !p.is_active);
  const activeSubscriptions = subscriptions.filter((s) => s.status === "active");

  const handleEdit = (plan: BarbershopPlan) => {
    setEditingPlan(plan);
    setFormOpen(true);
  };

  const handleNewPlan = () => {
    setEditingPlan(null);
    setFormOpen(true);
  };

  const handleFormSave = () => {
    void queryClient.invalidateQueries({ queryKey: ["plans"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Planos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gerencie planos de assinatura e cobranças recorrentes via WhatsApp
          </p>
        </div>
        <Button onClick={handleNewPlan} className="gap-2">
          <Plus className="h-4 w-4" />
          Novo plano
        </Button>
      </div>

      <Tabs defaultValue="planos">
        <TabsList>
          <TabsTrigger value="planos" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Planos ({activePlans.length})
          </TabsTrigger>
          <TabsTrigger value="assinaturas" className="gap-2">
            <Users className="h-4 w-4" />
            Assinaturas ({activeSubscriptions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="planos" className="mt-4">
          {plansLoading ? (
            <LoadingState />
          ) : activePlans.length === 0 && inactivePlans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground/40" />
              <div>
                <p className="font-medium">Nenhum plano cadastrado</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Crie planos de assinatura recorrentes para seus clientes
                </p>
              </div>
              <Button onClick={handleNewPlan} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                Criar primeiro plano
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {activePlans.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {activePlans.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      onEdit={handleEdit}
                      onDeactivate={setDeactivateTarget}
                    />
                  ))}
                </div>
              )}
              {inactivePlans.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Planos inativos</p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {inactivePlans.map((plan) => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        onEdit={handleEdit}
                        onDeactivate={setDeactivateTarget}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="assinaturas" className="mt-4">
          <SubscriptionTable subscriptions={subscriptions} isLoading={subsLoading} />
        </TabsContent>
      </Tabs>

      <PlanFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        plan={editingPlan}
        onSave={handleFormSave}
      />

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
        title="Desativar plano"
        description={`Desativar o plano "${deactivateTarget?.name}"? Assinantes existentes não serão afetados imediatamente.`}
        confirmLabel="Desativar"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (deactivateTarget) deactivateMutation.mutate(deactivateTarget.id);
          setDeactivateTarget(null);
        }}
      />
    </div>
  );
}
