import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Loader2,
  Clock,
  Cpu,
  MessageCircle,
  Bell,
  CalendarClock,
  Mic,
  Sliders,
  Send,
  TrendingUp,
  Inbox,
  AlertCircle,
  RefreshCw,
  Calendar,
  MapPin,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  whatsappApi,
  integrationsApi,
  reportsApi,
  barbershopsApi,
  billingApi,
  type AgentProfile,
  type AiSettings,
  type BusinessHours,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { AgentToneStep } from "./AgentToneStep";
import { AgentBehaviorStep } from "./AgentBehaviorStep";
import { AgentPreviewChatStep } from "./AgentPreviewChatStep";
import { LoadingState } from "@/components/LoadingState";
import { toastSuccess, toastError } from "@/lib/toast-helpers";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function getWeekdayKeyInTimezone(tz: string): (typeof DAY_KEYS)[number] {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" });
    const name = formatter.format(new Date()).toLowerCase();
    const key = DAY_KEYS.find((k) => k === name || name.startsWith(k.slice(0, 2)));
    return key ?? "monday";
  } catch {
    return "monday";
  }
}

function formatClosureDate(closureDate: string): string {
  try {
    return new Date(closureDate + "T12:00:00").toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return closureDate;
  }
}

const TAB_CONFIG = [
  { id: "connect" as const, label: "Conectar", shortLabel: "Conexão", icon: MessageCircle },
  { id: "hours" as const, label: "Horários", shortLabel: "Horários", icon: Clock },
  { id: "tone" as const, label: "Tom de voz", shortLabel: "Tom", icon: Mic },
  { id: "behaviors" as const, label: "Comportamentos", shortLabel: "Comport.", icon: Sliders },
  { id: "preview" as const, label: "Testar e publicar", shortLabel: "Publicar", icon: Send },
  { id: "notifications" as const, label: "Notificações", shortLabel: "Notif.", icon: Bell },
];

function ResponsibleUseBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
        <div className="space-y-1 text-muted-foreground">
          <p className="font-medium text-foreground">Uso responsável</p>
          <p>
            Conexão por QR, sujeita às políticas do WhatsApp. Recomendamos número dedicado para automação. Uso para atendimento a quem te procurar e reativação de clientes existentes — não para disparos promocionais em massa.
          </p>
        </div>
      </div>
    </div>
  );
}

function NotificationsTabContent({
  whatsappConnected,
  canUseWhatsApp,
  isActive,
}: {
  whatsappConnected: boolean;
  canUseWhatsApp: boolean;
  isActive: boolean;
}) {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [eligibleDays, setEligibleDays] = useState(30);
  const [searchEligible, setSearchEligible] = useState("");
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [confirmedExistingClients, setConfirmedExistingClients] = useState(false);
  const {
    data: mvpMetrics,
    isError: mvpMetricsError,
    refetch: refetchMvpMetrics,
  } = useQuery({
    queryKey: ["reports", "mvp-metrics"],
    queryFn: () => reportsApi.mvpMetrics(),
    enabled: isActive,
    retry: 1,
  });
  const {
    data: list = [],
    isLoading: listLoading,
    isError: listError,
    refetch: refetchList,
  } = useQuery({
    queryKey: [
      "integrations",
      "scheduled-messages",
      "list",
      typeFilter,
      statusFilter,
    ],
    queryFn: () =>
      integrationsApi.listScheduledMessages({
        type: typeFilter !== "__all__" ? typeFilter : undefined,
        status: statusFilter !== "__all__" ? statusFilter : undefined,
        limit: 50,
      }),
    enabled: isActive,
    retry: 1,
  });

  const { data: creditsData } = useQuery({
    queryKey: ["integrations", "followup", "credits"],
    queryFn: () => integrationsApi.followup.getCredits(),
    enabled: isActive && canUseWhatsApp,
  });
  const creditsBalance = creditsData?.balance ?? 0;

  const { data: eligibleList = [], isLoading: eligibleLoading } = useQuery({
    queryKey: ["integrations", "followup", "eligible", eligibleDays, searchEligible],
    queryFn: () =>
      integrationsApi.followup.getEligible({
        days: eligibleDays,
        limit: 100,
        search: searchEligible.trim() || undefined,
      }),
    enabled: isActive && canUseWhatsApp,
  });

  const dispatchMutation = useMutation({
    mutationFn: (client_ids: string[]) =>
      integrationsApi.followup.dispatch({ client_ids, days: eligibleDays }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "followup", "credits"] });
      queryClient.invalidateQueries({ queryKey: ["integrations", "followup", "eligible", eligibleDays, searchEligible] });
      queryClient.invalidateQueries({ queryKey: ["integrations", "scheduled-messages", "list"] });
      queryClient.invalidateQueries({ queryKey: ["reports", "mvp-metrics"] });
      setSelectedClientIds(new Set());
      toastSuccess(`${data.enqueued} follow-up(s) enfileirado(s). Créditos restantes: ${data.credits_remaining}.`);
    },
    onError: (e) => toastError(e instanceof Error ? e.message : "Falha ao disparar"),
  });

  const creditsCheckoutMutation = useMutation({
    mutationFn: (quantity: number) => billingApi.creditsCheckout(quantity),
    onSuccess: (data) => {
      if (data?.url) window.open(data.url, "_blank", "noopener,noreferrer");
    },
    onError: (e) => toastError(e instanceof Error ? e.message : "Erro ao abrir checkout"),
  });

  const hasError = mvpMetricsError || listError;
  const isLoading = listLoading;
  const refetchAll = () => {
    refetchMvpMetrics();
    refetchList();
  };

  const statusConfig = {
    whatsapp: {
      ok: whatsappConnected,
      label: "WhatsApp",
      value: whatsappConnected ? "Conectado" : "Desconectado",
    },
    plan: {
      ok: canUseWhatsApp,
      label: "Plano",
      value: canUseWhatsApp ? "Pro/Premium" : "Upgrade necessário",
    },
  };

  if (hasError) {
    return (
      <div className="space-y-4 py-1">
        <div
          className={cn(
            "rounded-xl border border-destructive/50 bg-destructive/5 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4"
          )}
        >
          <div className="flex items-center gap-3 flex-1">
            <AlertCircle className="h-8 w-8 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="font-medium text-foreground">Falha ao carregar</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                A requisição demorou demais ou o servidor não respondeu. Verifique a conexão e o worker de mensagens.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetchAll()}
            className="shrink-0 gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-1">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Lembretes e follow-ups automáticos por WhatsApp. Requer número conectado e worker em execução.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { ...statusConfig.whatsapp, icon: MessageCircle },
          { ...statusConfig.plan, icon: TrendingUp },
          {
            label: "Lembretes (mês)",
            value: mvpMetrics ? `${mvpMetrics.reminders.sent} enviados` : "—",
            ok: true,
            icon: Bell,
          },
          {
            label: "Follow-ups (mês)",
            value: mvpMetrics ? `${mvpMetrics.followUps.sent} enviados` : "—",
            ok: true,
            icon: Send,
          },
        ].map((item) => (
          <div
            key={item.label}
            className={cn(
              "rounded-xl border p-4 transition-colors",
              "bg-card/50 border-border/60",
              "hover:border-border hover:bg-card/80"
            )}
          >
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <item.icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="text-xs font-medium uppercase tracking-wider">
                {item.label}
              </span>
            </div>
            <p
              className={cn(
                "font-semibold text-foreground",
                "ok" in item && !item.ok && "text-warning"
              )}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground">
          Últimas mensagens agendadas
        </Label>
        <div className="flex flex-wrap gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[160px] h-9 rounded-lg border-border/80 bg-background">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os tipos</SelectItem>
              <SelectItem value="reminder_24h">Lembrete 24h</SelectItem>
              <SelectItem value="reminder_2h">Lembrete 2h</SelectItem>
              <SelectItem value="followup_30d">Follow-up 30d</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9 rounded-lg border-border/80 bg-background">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="queued">Na fila</SelectItem>
              <SelectItem value="sent">Enviado</SelectItem>
              <SelectItem value="failed">Falhou</SelectItem>
              <SelectItem value="skipped">Ignorado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="rounded-xl border border-border/60 bg-card/30 flex items-center justify-center min-h-[200px]">
            <LoadingState />
          </div>
        ) : list.length === 0 ? (
          <div
            className={cn(
              "rounded-xl border border-dashed border-border/60",
              "flex flex-col items-center justify-center min-h-[200px] gap-3 py-8 px-4",
              "bg-muted/20"
            )}
          >
            <div className="rounded-full bg-muted/50 p-3">
              <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm text-muted-foreground text-center max-w-[240px]">
              Nenhuma mensagem agendada no período.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 overflow-hidden bg-card/30">
            <div className="max-h-[260px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/50 backdrop-blur-sm">
                  <tr className="border-b border-border/60">
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Tipo
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Destino
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Erro
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium">{row.type}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {row.to_phone}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            row.status === "sent" &&
                              "bg-success/15 text-success",
                            row.status === "failed" &&
                              "bg-destructive/15 text-destructive",
                            row.status === "queued" &&
                              "bg-info/15 text-info",
                            row.status === "skipped" &&
                              "bg-muted text-muted-foreground"
                          )}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td
                        className="px-4 py-2.5 text-muted-foreground text-xs max-w-[180px] truncate"
                        title={row.last_error}
                      >
                        {row.last_error ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {canUseWhatsApp && (
        <div className="space-y-4 rounded-xl border border-border/60 bg-card/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Reengajamento (Follow-up manual)</h3>
          <p className="text-xs text-muted-foreground">
            Clientes inativos (última atividade: agendamento ou WhatsApp). Cada disparo consome 1 crédito. Mensagens são enviadas apenas entre 9h e 20h (horário comercial).
          </p>
          <div className="flex items-start gap-3">
            <Checkbox
              id="confirm-existing-clients"
              checked={confirmedExistingClients}
              onCheckedChange={(c) => setConfirmedExistingClients(!!c)}
            />
            <Label htmlFor="confirm-existing-clients" className="text-sm font-normal cursor-pointer leading-tight">
              Confirmo que a lista é de clientes que já passaram pelo meu estabelecimento e que posso contatá-los para reengajamento.
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Créditos: {creditsBalance}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => creditsCheckoutMutation.mutate(10)}
              disabled={creditsCheckoutMutation.isPending}
            >
              {creditsCheckoutMutation.isPending ? "Abrindo..." : "Comprar créditos"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              value={String(eligibleDays)}
              onValueChange={(v) => setEligibleDays(parseInt(v, 10))}
            >
              <SelectTrigger className="w-[120px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Inativos 30+ dias</SelectItem>
                <SelectItem value="45">45+ dias</SelectItem>
                <SelectItem value="60">60+ dias</SelectItem>
                <SelectItem value="90">90+ dias</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Buscar por nome ou telefone"
              value={searchEligible}
              onChange={(e) => setSearchEligible(e.target.value)}
              className="h-9 w-[200px]"
            />
          </div>
          {eligibleLoading ? (
            <div className="min-h-[120px] flex items-center justify-center">
              <LoadingState />
            </div>
          ) : eligibleList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum cliente elegível para o período.</p>
          ) : (
            <>
              <div className="max-h-[220px] overflow-auto rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/50">
                    <tr className="border-b border-border/60">
                      <th className="w-10 px-2 py-2 text-left">
                        <Checkbox
                          checked={selectedClientIds.size === eligibleList.length && eligibleList.length > 0}
                          onCheckedChange={(checked) =>
                            setSelectedClientIds(checked ? new Set(eligibleList.map((c) => c.id)) : new Set())
                          }
                          aria-label="Selecionar todos"
                        />
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Cliente</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Última atividade</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Fonte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibleList.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-border/40 last:border-0 hover:bg-muted/30"
                      >
                        <td className="w-10 px-2 py-2">
                          <Checkbox
                            checked={selectedClientIds.has(c.id)}
                            onCheckedChange={(checked) =>
                              setSelectedClientIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(c.id);
                                else next.delete(c.id);
                                return next;
                              })
                            }
                            aria-label={`Selecionar ${c.name ?? c.phone}`}
                          />
                        </td>
                        <td className="px-3 py-2 font-medium">{c.name || c.phone || c.id.slice(0, 8)}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.last_activity
                            ? new Date(c.last_activity + "T12:00:00").toLocaleDateString("pt-BR", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{c.source === "appointment" ? "Agendamento" : "WhatsApp"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => dispatchMutation.mutate(Array.from(selectedClientIds))}
                  disabled={
                    !confirmedExistingClients ||
                    selectedClientIds.size === 0 ||
                    creditsBalance < selectedClientIds.size ||
                    dispatchMutation.isPending
                  }
                >
                  {dispatchMutation.isPending ? "Enfileirando…" : "Disparar follow-up"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {selectedClientIds.size > 0
                    ? `Custo: ${selectedClientIds.size} crédito(s). Restante após: ${creditsBalance - selectedClientIds.size}.`
                    : "Selecione os clientes acima."}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function WhatsAppSetupStepperModal({
  open,
  onOpenChange,
  connectStepContent,
  onOpenHours,
  whatsappConnected = false,
  canUseWhatsApp = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectStepContent: React.ReactNode;
  onOpenHours?: () => void;
  whatsappConnected?: boolean;
  canUseWhatsApp?: boolean;
}) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("connect");
  const [draftProfile, setDraftProfile] = useState<
    AgentProfile | Record<string, unknown>
  >({});
  const [draftAdditionalInstructions, setDraftAdditionalInstructions] =
    useState<string | null>(null);
  const [applyFeedback, setApplyFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const diagnosticApplyRef = useRef(false);
  const { profile } = useAuth();
  const isPremium = profile?.billing_plan === "premium";

  const { data: aiSettings, isLoading: loadingSettings } = useQuery({
    queryKey: ["integrations", "whatsapp", "ai-settings"],
    queryFn: () => whatsappApi.getAiSettings(),
    enabled: open,
  });

  const { data: versionsData } = useQuery({
    queryKey: ["integrations", "whatsapp", "ai-versions"],
    queryFn: () => whatsappApi.listAiVersions(),
    enabled: open && activeTab === "preview",
  });

  const { data: barbershop, isLoading: hoursLoading } = useQuery({
    queryKey: ["barbershop"],
    queryFn: () => barbershopsApi.get(),
    enabled: open && activeTab === "hours",
  });

  const { data: closures = [] } = useQuery({
    queryKey: ["barbershops", "closures"],
    queryFn: () => barbershopsApi.closures.list(),
    enabled: open && activeTab === "hours",
  });

  useEffect(() => {
    if (
      aiSettings?.agent_profile &&
      typeof aiSettings.agent_profile === "object"
    ) {
      setDraftProfile(aiSettings.agent_profile as AgentProfile);
    }
    if (aiSettings?.additional_instructions !== undefined) {
      setDraftAdditionalInstructions(
        aiSettings.additional_instructions ?? null,
      );
    }
  }, [aiSettings?.agent_profile, aiSettings?.additional_instructions]);

  const updateSettingsMutation = useMutation({
    mutationFn: (body: Partial<AiSettings>) =>
      whatsappApi.updateAiSettings(body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "ai-settings"],
      });
      if (diagnosticApplyRef.current) {
        diagnosticApplyRef.current = false;
        setApplyFeedback({
          type: "success",
          message: "Rascunho aplicado com sucesso.",
        });
        setTimeout(() => setApplyFeedback(null), 4000);
      }
    },
    onError: (e) => {
      if (diagnosticApplyRef.current) {
        diagnosticApplyRef.current = false;
        setApplyFeedback({
          type: "error",
          message: e instanceof Error ? e.message : "Falha ao aplicar.",
        });
        setTimeout(() => setApplyFeedback(null), 5000);
      }
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => whatsappApi.publishAiSettings(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "ai-settings"],
      });
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "ai-versions"],
      });
      toastSuccess("Ajustes publicados.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Falha ao publicar"),
  });

  const rollbackMutation = useMutation({
    mutationFn: (versionId: string) =>
      whatsappApi.rollbackAiSettings(versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "ai-settings"],
      });
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "ai-versions"],
      });
      toastSuccess("Versão anterior reativada.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Falha ao reverter"),
  });

  const persistDraft = () => {
    updateSettingsMutation.mutate({
      agent_profile: draftProfile as AgentProfile,
      additional_instructions: draftAdditionalInstructions,
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setActiveTab("connect");
    onOpenChange(next);
  };

  const versions = versionsData?.versions ?? [];

  const isBusy =
    updateSettingsMutation.isPending ||
    publishMutation.isPending ||
    rollbackMutation.isPending;

  const showDraftPublishFooter =
    activeTab === "tone" ||
    activeTab === "behaviors" ||
    activeTab === "preview";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "grid grid-rows-[auto_1fr_auto] gap-0 p-0 overflow-hidden",
          "max-w-[calc(100vw-1.5rem)] sm:max-w-[min(94vw,1000px)]",
          "w-full sm:w-[min(94vw,1000px)]",
          "h-[min(92vh,860px)] sm:h-[min(94vh,880px)]",
          "rounded-2xl border border-border/80 shadow-elevated",
          "bg-background"
        )}
        aria-describedby={undefined}
      >
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            if (isBusy) return;
            if ((activeTab === "tone" || activeTab === "behaviors") && (v !== activeTab)) {
              persistDraft();
            }
            setActiveTab(v);
          }}
          className="contents"
        >
          {/* ─── Header: título + tabs ─── */}
          <header className="shrink-0 flex flex-col border-b border-border/70 bg-card/40">
            <DialogHeader className="px-6 sm:px-8 pt-6 sm:pt-7 pb-0">
              <DialogTitle className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                WhatsApp (IA)
              </DialogTitle>
              <p id="whatsapp-modal-desc" className="text-sm text-muted-foreground mt-1">
                Conexão, assistente com IA e notificações em um só lugar.
              </p>
            </DialogHeader>

            <div className="px-6 sm:px-8 pt-4 pb-0 mt-1">
              <TabsList
                className={cn(
                  "w-full inline-flex h-auto p-0 gap-0 rounded-none bg-transparent",
                  "border-b border-border/70 min-h-[2.75rem]"
                )}
                role="tablist"
                aria-label="Abas de configuração WhatsApp"
              >
                <div className="flex overflow-x-auto scrollbar-thin scroll-smooth pb-px -mb-px">
                  {TAB_CONFIG.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <TabsTrigger
                        key={tab.id}
                        value={tab.id}
                        disabled={isBusy}
                        className={cn(
                          "flex items-center gap-2 shrink-0 rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium transition-all duration-200",
                          "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                          "data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          "disabled:opacity-60 disabled:pointer-events-none"
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0 transition-colors",
                            isActive && "text-primary"
                          )}
                          aria-hidden
                        />
                        <span className="hidden sm:inline">{tab.label}</span>
                        <span className="sm:hidden">{tab.shortLabel}</span>
                      </TabsTrigger>
                    );
                  })}
                </div>
              </TabsList>
            </div>
          </header>

          {/* ─── Conteúdo rolável ─── */}
          <ScrollArea className="min-h-0 flex-1">
            <div
              className="px-6 sm:px-8 py-6 sm:py-7 min-h-[320px]"
              role="region"
              aria-labelledby="whatsapp-modal-desc"
            >
              {(activeTab === "connect" || activeTab === "notifications") && (
                <ResponsibleUseBanner className="mb-6" />
              )}
              <TabsContent
                value="connect"
                className="mt-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200"
              >
                {loadingSettings && activeTab !== "connect" ? null : (
                  <div className="min-h-[280px] flex flex-col justify-center">
                    {connectStepContent}
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="hours"
                className="mt-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200"
              >
                {hoursLoading ? (
                  <div className="min-h-[260px] flex items-center justify-center">
                    <LoadingState />
                  </div>
                ) : (
                  <div className="space-y-5">
                    <Card className="border-border/60 bg-card/50 overflow-hidden">
                      <CardContent className="p-6 sm:p-8">
                        <div className="flex flex-col sm:flex-row sm:items-start gap-6">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                            <CalendarClock className="h-6 w-6 text-primary" aria-hidden />
                          </div>
                          <div className="min-w-0 flex-1 space-y-4">
                            <div>
                              <h3 className="font-semibold text-foreground">
                                Horário de funcionamento
                              </h3>
                              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                                Configure dias, horários e exceções (feriados, fechamentos). O assistente usa essas informações para não sugerir horários fora do expediente.
                              </p>
                            </div>
                            {onOpenHours && (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={onOpenHours}
                                  className="rounded-lg font-medium"
                                >
                                  Editar horários
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={onOpenHours}
                                  className="rounded-lg font-medium"
                                >
                                  Gerenciar exceções
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    {barbershop && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border border-border/60 bg-card/50 p-4">
                          <div className="flex items-center gap-2 text-muted-foreground mb-1">
                            <Calendar className="h-4 w-4 shrink-0" />
                            <span className="text-xs font-medium uppercase tracking-wider">Hoje</span>
                          </div>
                          {(() => {
                            const tz = aiSettings?.timezone ?? "America/Sao_Paulo";
                            const dayKey = getWeekdayKeyInTimezone(tz);
                            const dayHours = (barbershop.business_hours as BusinessHours | undefined)?.[dayKey];
                            const isOpen = dayHours && typeof dayHours === "object" && dayHours.start != null && dayHours.end != null;
                            return (
                              <p className="font-semibold text-foreground">
                                {isOpen
                                  ? `Aberto ${dayHours!.start}–${dayHours!.end}`
                                  : "Fechado"}
                              </p>
                            );
                          })()}
                        </div>
                        <div className="rounded-xl border border-border/60 bg-card/50 p-4">
                          <div className="flex items-center gap-2 text-muted-foreground mb-1">
                            <MapPin className="h-4 w-4 shrink-0" />
                            <span className="text-xs font-medium uppercase tracking-wider">Fuso</span>
                          </div>
                          <p className="font-semibold text-foreground">
                            {aiSettings?.timezone ?? "America/Sao_Paulo"}
                          </p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-card/50 p-4">
                          <div className="flex items-center gap-2 text-muted-foreground mb-1">
                            <CalendarClock className="h-4 w-4 shrink-0" />
                            <span className="text-xs font-medium uppercase tracking-wider">Próxima exceção</span>
                          </div>
                          {(() => {
                            const today = new Date().toISOString().slice(0, 10);
                            const next = closures
                              .filter((c) => c.closure_date >= today)
                              .sort((a, b) => a.closure_date.localeCompare(b.closure_date))[0];
                            return (
                              <p className="font-semibold text-foreground">
                                {next
                                  ? `${formatClosureDate(next.closure_date)}${next.reason ? ` — ${next.reason}` : ""}`
                                  : "Nenhuma"}
                              </p>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="tone"
                className="mt-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200"
              >
                {loadingSettings ? (
                  <div className="min-h-[280px] flex items-center justify-center">
                    <LoadingState />
                  </div>
                ) : (
                  <AgentToneStep
                    profile={draftProfile}
                    onChange={(u) => setDraftProfile((p) => ({ ...p, ...u }))}
                  />
                )}
              </TabsContent>

              <TabsContent
                value="behaviors"
                className="mt-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200"
              >
                <div className="space-y-5">
                  <AgentBehaviorStep
                    profile={draftProfile}
                    onChange={(u) => setDraftProfile((p) => ({ ...p, ...u }))}
                  />
                  {isPremium && aiSettings && (
                    <Card className="border-border/60 bg-card/50">
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                            <Cpu className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <Label className="text-sm font-semibold">Modelo de IA (Premium)</Label>
                            <p className="text-xs text-muted-foreground font-normal mt-0.5">
                              Modelo padrão para conversas; premium para escalonamento em conversas longas.
                            </p>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4 pt-0">
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground">Modelo padrão</Label>
                          <Select
                            value={aiSettings.model ?? "gpt-4o-mini"}
                            onValueChange={(v) =>
                              updateSettingsMutation.mutate({ model: v })
                            }
                            disabled={updateSettingsMutation.isPending}
                          >
                            <SelectTrigger className="w-full rounded-lg h-10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="gpt-4o-mini">GPT-4o mini</SelectItem>
                              <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                              <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground">Modelo premium (escalonamento)</Label>
                          <Select
                            value={aiSettings.model_premium ?? "none"}
                            onValueChange={(v) =>
                              updateSettingsMutation.mutate({
                                model_premium: v === "none" ? null : v,
                              })
                            }
                            disabled={updateSettingsMutation.isPending}
                          >
                            <SelectTrigger className="w-full rounded-lg h-10">
                              <SelectValue placeholder="Nenhum (usar sempre o padrão)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Nenhum</SelectItem>
                              <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                              <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                              <SelectItem value="gpt-4o-mini">GPT-4o mini</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              <TabsContent
                value="preview"
                className="mt-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200"
              >
                <AgentPreviewChatStep
                  draftProfile={draftProfile}
                  draftAdditionalInstructions={draftAdditionalInstructions}
                  onPublish={() => publishMutation.mutate()}
                  onRollback={(id) => rollbackMutation.mutate(id)}
                  onApplyAnalyzerResult={(patch, publish) => {
                    const mergedProfile = {
                      ...draftProfile,
                      ...(patch.profile && Object.keys(patch.profile).length > 0
                        ? patch.profile
                        : {}),
                    } as AgentProfile;
                    const mergedInstructions =
                      patch.instructions !== undefined
                        ? patch.instructions
                        : draftAdditionalInstructions;
                    setDraftProfile(mergedProfile);
                    setDraftAdditionalInstructions(mergedInstructions);
                    if (publish) {
                      updateSettingsMutation.mutate(
                        {
                          agent_profile: mergedProfile,
                          additional_instructions: mergedInstructions,
                        },
                        { onSuccess: () => publishMutation.mutate() },
                      );
                    } else if (
                      patch.profile ||
                      patch.instructions !== undefined
                    ) {
                      diagnosticApplyRef.current = true;
                      updateSettingsMutation.mutate({
                        agent_profile: mergedProfile,
                        additional_instructions: mergedInstructions,
                      });
                    }
                  }}
                  versions={versions}
                  isPublishing={publishMutation.isPending}
                  isRollingBack={rollbackMutation.isPending}
                  applyFeedback={applyFeedback}
                />
              </TabsContent>

              <TabsContent
                value="notifications"
                className="mt-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200"
              >
                <NotificationsTabContent
                  whatsappConnected={whatsappConnected}
                  canUseWhatsApp={canUseWhatsApp}
                  isActive={activeTab === "notifications"}
                />
              </TabsContent>
            </div>
          </ScrollArea>

          {/* ─── Footer fixo ─── */}
          <footer
            className={cn(
              "relative shrink-0 flex flex-wrap items-center justify-end gap-3 px-6 sm:px-8 py-4 min-h-[72px]",
              "border-t border-border/70 bg-card/60",
              "before:content-[''] before:absolute before:left-0 before:right-0 before:bottom-full before:h-6 before:pointer-events-none before:bg-gradient-to-t before:from-background before:to-transparent"
            )}
          >
            <div className="flex items-center gap-3 flex-1 justify-end min-w-0">
              {updateSettingsMutation.isPending && (
                <span className="text-xs text-muted-foreground flex items-center gap-2 shrink-0">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Salvando…
                </span>
              )}
              {showDraftPublishFooter && (
                <>
                  {(activeTab === "tone" || activeTab === "behaviors") && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={persistDraft}
                      disabled={isBusy}
                      aria-label="Salvar rascunho"
                      className="rounded-lg font-medium"
                    >
                      Salvar rascunho
                    </Button>
                  )}
                  {activeTab === "preview" && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={persistDraft}
                        disabled={isBusy}
                        aria-label="Salvar rascunho"
                        className="rounded-lg font-medium"
                      >
                        Salvar rascunho
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => publishMutation.mutate()}
                        disabled={isBusy}
                        aria-label={publishMutation.isPending ? "Publicando…" : "Publicar alterações"}
                        className="rounded-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        {publishMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                        ) : null}
                        Publicar
                      </Button>
                    </>
                  )}
                </>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                aria-label="Fechar"
                className="rounded-lg font-medium"
              >
                Fechar
              </Button>
            </div>
          </footer>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
