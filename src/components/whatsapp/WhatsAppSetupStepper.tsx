import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { Link } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Brain,
  Key,
  User,
  Plus,
  Pencil,
  Trash2,
  CalendarX,
  FileText,
  Upload,
  BookOpen,
  Copy,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import {
  whatsappApi,
  integrationsApi,
  reportsApi,
  barbershopsApi,
  billingApi,
  getDefaultBusinessHours,
  type AgentProfile,
  type AiSettings,
  type BusinessHours,
  type BarbershopClosure,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { UpgradeGate } from "@/components/UpgradeGate";
import { hasPremium } from "@/lib/plan";
import { AgentToneStep } from "./AgentToneStep";
import { AgentBehaviorStep } from "./AgentBehaviorStep";
import { AgentCustomRulesStep } from "./AgentCustomRulesStep";
import { AgentPreviewChatStep } from "./AgentPreviewChatStep";
import { LoadingState } from "@/components/LoadingState";
import { toastSuccess, toastError } from "@/lib/toast-helpers";
import { EntityFormDialog } from "@/components/shared";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { DatePicker } from "@/components/ui/date-picker";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

const DAY_LABELS: { key: keyof BusinessHours; label: string }[] = [
  { key: "monday", label: "Segunda" },
  { key: "tuesday", label: "Terça" },
  { key: "wednesday", label: "Quarta" },
  { key: "thursday", label: "Quinta" },
  { key: "friday", label: "Sexta" },
  { key: "saturday", label: "Sábado" },
  { key: "sunday", label: "Domingo" },
];

const DEFAULT_SUITE_SCENARIOS = [
  { id: "scenario-0-saudação", label: "Saudação", messages: [{ role: "user" as const, content: "Oi" }], expected: { violationsMax: 0 } as const },
  { id: "scenario-1-serviço-inexistente", label: "Serviço inexistente", messages: [{ role: "user" as const, content: "Vocês fazem pizza?" }], expected: { violationsMax: 0 } as const },
  { id: "scenario-2-hoje-1745", label: "Hoje 17:45", messages: [{ role: "user" as const, content: "Quero cortar o cabelo hoje às 17:45" }], expected: { violationsMax: 0 } as const },
  { id: "scenario-3-ver-serviços", label: "Ver serviços", messages: [{ role: "user" as const, content: "Quais serviços vocês têm?" }], expected: { violationsMax: 0 } as const },
];

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

function formatClosureDateDisplay(closureDate: string): string {
  try {
    const dateOnly = closureDate.includes("T") ? closureDate.slice(0, 10) : closureDate;
    const d = new Date(dateOnly + "T12:00:00");
    if (Number.isNaN(d.getTime())) return dateOnly;
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return closureDate;
  }
}

/** Safe format for closure_date in lists; avoids "Invalid time value" when date is invalid. */
function formatClosureDateSafe(closureDate: string | null | undefined): string {
  if (closureDate == null || closureDate === "") return "—";
  try {
    const dateOnly = closureDate.includes("T") ? closureDate.slice(0, 10) : closureDate;
    const d = new Date(dateOnly + "T12:00:00");
    if (Number.isNaN(d.getTime())) return dateOnly;
    return format(d, "d MMM yyyy", { locale: ptBR });
  } catch {
    return closureDate;
  }
}

/** Format time for display; accepts "HH:mm" or full ISO string. */
function formatClosureTime(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const s = String(value).trim();
  if (s.includes("T")) {
    try {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return format(d, "HH:mm");
    } catch {
      // fall through
    }
  }
  return s.length >= 5 ? s.slice(0, 5) : s;
}

export const TAB_CONFIG = [
  { id: "connect" as const, label: "Conectar", shortLabel: "Conexão", icon: MessageCircle },
  { id: "hours" as const, label: "Horários", shortLabel: "Horários", icon: Clock },
  { id: "brain" as const, label: "Cérebro", shortLabel: "Cérebro", icon: Brain },
  { id: "preview" as const, label: "Testar e publicar", shortLabel: "Publicar", icon: Send },
  { id: "notifications" as const, label: "Notificações", shortLabel: "Notif.", icon: Bell },
  { id: "api-keys" as const, label: "Chaves de API", shortLabel: "API", icon: Key },
];

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

export type WhatsAppSetupStepperProps = {
  connectStepContent: React.ReactNode;
  /** Content for the "Chaves de API" tab. When provided, the tab is shown. */
  apiKeysContent?: React.ReactNode;
  onOpenHours?: () => void;
  whatsappConnected?: boolean;
  canUseWhatsApp?: boolean;
  /** When true, footer shows a "Fechar" button that calls onClose. Used in modal. */
  showCloseButton?: boolean;
  onClose?: () => void;
  /** Controlled tab (e.g. from URL). If not provided, uses internal state. */
  value?: string;
  onValueChange?: (v: string) => void;
  /** When true, open diagnostic modal with transcript from sessionStorage (from WhatsApp interno). */
  openDiagnosticFromInbox?: boolean;
  /** When false, internal queries are disabled. Default true for page use. */
  enabled?: boolean;
};

export function WhatsAppSetupStepper({
  connectStepContent,
  apiKeysContent,
  onOpenHours,
  whatsappConnected = false,
  canUseWhatsApp = true,
  showCloseButton = false,
  onClose,
  value: controlledValue,
  onValueChange,
  openDiagnosticFromInbox = false,
  enabled = true,
}: WhatsAppSetupStepperProps) {
  const queryClient = useQueryClient();
  const [internalTab, setInternalTab] = useState<string>("connect");
  const activeTab = controlledValue ?? internalTab;
  const setActiveTab = onValueChange ?? setInternalTab;

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
    enabled,
  });

  const { data: versionsData } = useQuery({
    queryKey: ["integrations", "whatsapp", "ai-versions"],
    queryFn: () => whatsappApi.listAiVersions(),
    enabled: enabled && activeTab === "preview",
  });

  const { data: numberModeData } = useQuery({
    queryKey: ["integrations", "whatsapp", "number-mode"],
    queryFn: () => whatsappApi.getNumberMode(),
    enabled: enabled && (activeTab === "brain" || activeTab === "preview"),
  });

  const { data: knowledgeConfig } = useQuery({
    queryKey: ["integrations", "whatsapp", "knowledge", "config"],
    queryFn: () => whatsappApi.knowledge.getConfig(),
    enabled: enabled && activeTab === "brain",
  });
  const { data: knowledgeDocuments } = useQuery({
    queryKey: ["integrations", "whatsapp", "knowledge", "documents"],
    queryFn: () => whatsappApi.knowledge.listDocuments(),
    enabled: enabled && activeTab === "brain",
  });
  const { data: compiledPromptData } = useQuery({
    queryKey: ["integrations", "whatsapp", "ai-prompt", "compiled"],
    queryFn: () => whatsappApi.getCompiledPrompt(),
    enabled: enabled && activeTab === "brain",
  });
  const knowledgeFileInputRef = useRef<HTMLInputElement>(null);

  const { data: barbershop, isLoading: hoursLoading } = useQuery({
    queryKey: ["barbershop"],
    queryFn: () => barbershopsApi.get(),
    enabled: enabled && activeTab === "hours",
  });

  const { data: closures = [], isLoading: closuresLoading } = useQuery({
    queryKey: ["barbershops", "closures"],
    queryFn: () => barbershopsApi.closures.list(),
    enabled: enabled && activeTab === "hours",
  });

  const [hoursState, setHoursState] = useState<BusinessHours>(() => getDefaultBusinessHours());
  const [closureFormOpen, setClosureFormOpen] = useState(false);
  const [editingClosure, setEditingClosure] = useState<BarbershopClosure | null>(null);
  const [requireSuiteBeforePublish, setRequireSuiteBeforePublish] = useState(false);
  const [publishGateChecking, setPublishGateChecking] = useState(false);

  useEffect(() => {
    if (barbershop?.business_hours && activeTab === "hours") {
      setHoursState({ ...getDefaultBusinessHours(), ...(barbershop.business_hours as BusinessHours) });
    }
  }, [barbershop?.business_hours, activeTab]);

  const setDayHours = (key: keyof BusinessHours, value: { start: string; end: string } | null) => {
    setHoursState((prev) => ({ ...prev, [key]: value }));
  };

  const patchHoursMutation = useMutation({
    mutationFn: (payload: { business_hours: BusinessHours }) => barbershopsApi.patch(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["barbershop"] });
      toastSuccess("Horários salvos.");
    },
    onError: (e) => toastError(e instanceof Error ? e.message : "Erro ao salvar horários"),
  });

  const unavailabilityIntervalSchema = z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/, "HH:mm"),
    end: z.string().regex(/^\d{2}:\d{2}$/, "HH:mm"),
    reason: z.string().max(200).optional(),
  });
  const closureFormSchema = z.object({
    closure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data yyyy-MM-dd"),
    status: z.enum(["closed", "open_partial"]),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    reason: z.string().max(500).optional(),
    unavailability_intervals: z.array(unavailabilityIntervalSchema).optional(),
  });
  type ClosureFormValues = z.infer<typeof closureFormSchema>;
  const closureFormDefault: ClosureFormValues = {
    closure_date: new Date().toISOString().slice(0, 10),
    status: "closed",
    start_time: "",
    end_time: "",
    reason: "",
    unavailability_intervals: [],
  };
  const closureForm = useForm<ClosureFormValues>({
    resolver: zodResolver(closureFormSchema),
    defaultValues: closureFormDefault,
  });
  const closureIntervals = useFieldArray({
    control: closureForm.control,
    name: "unavailability_intervals",
  });

  useEffect(() => {
    if (closureFormOpen && editingClosure) {
      closureForm.reset({
        closure_date: editingClosure.closure_date,
        status: editingClosure.status,
        start_time: editingClosure.start_time?.slice(0, 5) ?? "",
        end_time: editingClosure.end_time?.slice(0, 5) ?? "",
        reason: editingClosure.reason ?? "",
        unavailability_intervals:
          (editingClosure.unavailability_intervals?.length ?? 0) > 0
            ? editingClosure.unavailability_intervals!.map((i) => ({
                start: i.start?.slice(0, 5) ?? "12:00",
                end: i.end?.slice(0, 5) ?? "13:00",
                reason: i.reason ?? "",
              }))
            : [],
      });
    } else if (closureFormOpen && !editingClosure) {
      closureForm.reset(closureFormDefault);
    }
  }, [closureFormOpen, editingClosure]);

  const openClosureForm = (closure?: BarbershopClosure) => {
    setEditingClosure(closure ?? null);
    setClosureFormOpen(true);
  };

  const createClosureMutation = useMutation({
    mutationFn: (body: Parameters<typeof barbershopsApi.closures.create>[0]) =>
      barbershopsApi.closures.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["barbershops", "closures"] });
      setClosureFormOpen(false);
      setEditingClosure(null);
      toastSuccess("Exceção adicionada.");
    },
    onError: (e) => toastError(e instanceof Error ? e.message : "Erro ao adicionar"),
  });
  const updateClosureMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof barbershopsApi.closures.update>[1] }) =>
      barbershopsApi.closures.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["barbershops", "closures"] });
      setClosureFormOpen(false);
      setEditingClosure(null);
      toastSuccess("Exceção atualizada.");
    },
    onError: (e) => toastError(e instanceof Error ? e.message : "Erro ao atualizar"),
  });
  const deleteClosureMutation = useMutation({
    mutationFn: (id: string) => barbershopsApi.closures.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["barbershops", "closures"] });
      toastSuccess("Exceção removida.");
    },
    onError: (e) => toastError(e instanceof Error ? e.message : "Erro ao remover"),
  });

  const onSubmitClosureForm = (values: ClosureFormValues) => {
    const intervals =
      values.unavailability_intervals?.filter(
        (i) => i.start && i.end && /^\d{2}:\d{2}$/.test(i.start) && /^\d{2}:\d{2}$/.test(i.end),
      ).map((i) => ({ start: i.start, end: i.end, reason: i.reason || undefined })) ?? [];
    if (editingClosure) {
      updateClosureMutation.mutate({
        id: editingClosure.id,
        body: {
          status: values.status,
          start_time: values.start_time || null,
          end_time: values.end_time || null,
          reason: values.reason || null,
          unavailability_intervals: intervals,
        },
      });
    } else {
      createClosureMutation.mutate({
        closure_date: values.closure_date,
        status: values.status,
        start_time: values.start_time || undefined,
        end_time: values.end_time || undefined,
        reason: values.reason || undefined,
        unavailability_intervals: intervals.length > 0 ? intervals : undefined,
      });
    }
  };

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
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "ai-prompt", "compiled"],
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
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "ai-prompt", "compiled"],
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
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "ai-prompt", "compiled"],
      });
      toastSuccess("Versão anterior reativada.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Falha ao reverter"),
  });

  const uploadKnowledgeDocumentMutation = useMutation({
    mutationFn: async (file: File) => {
      const title = file.name;
      const mime = file.type || "application/octet-stream";
      const createRes = await whatsappApi.knowledge.createDocument({
        title,
        original_filename: file.name,
        mime_type: mime,
      });
      if (!createRes.upload_url) throw new Error("URL de upload não retornada");
      await fetch(createRes.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": mime },
      });
      await whatsappApi.knowledge.completeDocument(createRes.id, {
        size_bytes: file.size,
      });
      return createRes.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "knowledge", "documents"],
      });
      toastSuccess("Documento enviado. O processamento pode levar alguns minutos.");
      knowledgeFileInputRef.current?.setAttribute("value", "");
      if (knowledgeFileInputRef.current) knowledgeFileInputRef.current.value = "";
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Falha ao enviar documento"),
  });

  const deleteKnowledgeDocumentMutation = useMutation({
    mutationFn: (id: string) => whatsappApi.knowledge.deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "knowledge", "documents"],
      });
      toastSuccess("Documento removido.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Falha ao remover documento"),
  });

  const persistDraft = () => {
    updateSettingsMutation.mutate({
      agent_profile: draftProfile as AgentProfile,
      additional_instructions: draftAdditionalInstructions,
    });
  };

  const handleTabChange = (v: string) => {
    if (isBusy) return;
    if (activeTab === "brain" && v !== activeTab) {
      persistDraft();
    }
    setActiveTab(v);
  };

  const versions = versionsData?.versions ?? [];

  const isBusy =
    updateSettingsMutation.isPending ||
    publishMutation.isPending ||
    rollbackMutation.isPending;

  const showDraftPublishFooter =
    activeTab === "brain" || activeTab === "preview";

  const tabInner = "px-4 sm:px-6 py-6";

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="flex flex-col min-h-[calc(100vh-8rem)]"
    >
          <div className="flex items-center gap-2 border-b border-border/70 min-h-[2.75rem]">
          <TabsList
            className={cn(
              "flex-1 min-w-0 inline-flex h-auto p-0 gap-0 rounded-none bg-transparent",
              "border-0"
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
        <TabsContent
          value="connect"
          className={cn("mt-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200", tabInner)}
        >
          {loadingSettings && activeTab !== "connect" ? null : (
            <div className="min-h-[280px] flex flex-col justify-center">
              {connectStepContent}
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="hours"
          className={cn("mt-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200 min-h-[calc(100vh-12rem)]", tabInner)}
        >
          {hoursLoading ? (
            <div className="min-h-[260px] flex items-center justify-center">
              <LoadingState />
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-foreground">
                  Horário de funcionamento
                </h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  Configure dias, horários e exceções (feriados, fechamentos). O assistente usa essas informações para não sugerir horários fora do expediente.
                </p>
              </div>

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
                      const dayHours = (hoursState as BusinessHours)?.[dayKey];
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
                            ? `${formatClosureDateDisplay(next.closure_date)}${next.reason ? ` — ${next.reason}` : ""}`
                            : "Nenhuma"}
                        </p>
                      );
                    })()}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border-border/60 bg-card/50 overflow-hidden h-fit">
                  <CardContent className="p-6 sm:p-8">
                    <h4 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                      <CalendarClock className="h-4 w-4 text-primary" />
                      Horário semanal
                    </h4>
                    <div className="space-y-0 min-w-0">
                      {DAY_LABELS.map(({ key, label }) => {
                        const day = hoursState[key];
                        const isOpen =
                          day &&
                          typeof day === "object" &&
                          day.start != null &&
                          day.end != null;
                        return (
                          <div
                            key={key}
                            className="flex min-h-[52px] flex-wrap items-center gap-3 border-b border-border py-3 last:border-0"
                          >
                            <div className="w-24 shrink-0 font-medium text-foreground">
                              {label}
                            </div>
                            <Checkbox
                              id={`hours-${key}`}
                              checked={!!isOpen}
                              onCheckedChange={(checked) => {
                                if (checked)
                                  setDayHours(key, { start: "09:00", end: "18:00" });
                                else setDayHours(key, null);
                              }}
                              className="border-green-600 data-[state=checked]:bg-green-600 data-[state=checked]:text-white shrink-0"
                            />
                            <Label
                              htmlFor={`hours-${key}`}
                              className="shrink-0 cursor-pointer text-sm"
                            >
                              Aberto
                            </Label>
                            {isOpen && day && (
                              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-0 sm:flex-nowrap">
                                <Input
                                  type="time"
                                  value={day.start}
                                  onChange={(e) =>
                                    setDayHours(key, { ...day, start: e.target.value })
                                  }
                                  className="h-8 min-w-0 flex-1 sm:w-28 sm:flex-none sm:min-w-[7rem]"
                                />
                                <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                                  até
                                </span>
                                <Input
                                  type="time"
                                  value={day.end}
                                  onChange={(e) =>
                                    setDayHours(key, { ...day, end: e.target.value })
                                  }
                                  className="h-8 min-w-0 flex-1 sm:w-28 sm:flex-none sm:min-w-[7rem]"
                                />
                              </div>
                            )}
                            {!isOpen && (
                              <span className="text-sm text-muted-foreground">Fechado</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button
                        type="button"
                        onClick={() => patchHoursMutation.mutate({ business_hours: hoursState })}
                        disabled={patchHoursMutation.isPending}
                      >
                        Salvar horários
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-card/50 overflow-hidden flex flex-col min-h-0">
                  <CardHeader className="p-6 pb-2 sm:p-8 sm:pb-4 flex flex-row items-start justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <CalendarX className="h-4 w-4 text-primary" />
                        Exceções de funcionamento
                      </h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Feriados e fechamentos inesperados. O atendente usa essas datas para não sugerir horários.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openClosureForm()}
                      className="gap-2 shrink-0"
                    >
                      <Plus className="h-4 w-4" />
                      Adicionar exceção
                    </Button>
                  </CardHeader>
                  <CardContent className="p-6 pt-0 sm:p-8 sm:pt-0 flex-1 min-h-0 flex flex-col">
                    {closuresLoading ? (
                      <LoadingState />
                    ) : closures.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center flex-1">
                        <p className="text-sm text-muted-foreground">
                          Nenhuma exceção. Use o botão acima para feriados ou dias de fechamento.
                        </p>
                      </div>
                    ) : (
                      <ul className="space-y-2 max-h-64 overflow-y-auto flex-1 min-h-0">
                        {closures.map((c) => (
                          <li
                            key={c.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/30 px-4 py-3 text-sm"
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="font-semibold text-foreground">
                                  {formatClosureDateSafe(c.closure_date)}
                                </span>
                                <span
                                  className={cn(
                                    "text-xs font-medium rounded-full px-2 py-0.5",
                                    c.status === "closed"
                                      ? "bg-muted text-muted-foreground"
                                      : "bg-primary/10 text-primary"
                                  )}
                                >
                                  {c.status === "closed" ? "Fechado" : "Aberto parcial"}
                                </span>
                              </div>
                              {c.reason && (
                                <p className="text-muted-foreground text-xs mt-0.5">{c.reason}</p>
                              )}
                              {c.status === "open_partial" &&
                                (c.start_time != null || c.end_time != null) && (
                                  <p className="text-muted-foreground text-xs mt-0.5">
                                    {formatClosureTime(c.start_time)} – {formatClosureTime(c.end_time)}
                                  </p>
                                )}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openClosureForm(c)}
                                aria-label="Editar"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => {
                                  if (window.confirm("Remover esta exceção?"))
                                    deleteClosureMutation.mutate(c.id);
                                }}
                                aria-label="Excluir"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          <EntityFormDialog
            open={closureFormOpen}
            onOpenChange={(open) => {
              setClosureFormOpen(open);
              if (!open) setEditingClosure(null);
            }}
            title={editingClosure ? "Editar exceção" : "Adicionar exceção"}
            description={
              editingClosure
                ? "Altere status, horário ou motivo."
                : "Informe a data e se estará fechado ou com horário reduzido."
            }
            footer={
              <>
                <Button variant="outline" onClick={() => setClosureFormOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={closureForm.handleSubmit(onSubmitClosureForm)}
                  disabled={
                    createClosureMutation.isPending ||
                    updateClosureMutation.isPending
                  }
                >
                  {editingClosure ? "Salvar" : "Adicionar"}
                </Button>
              </>
            }
          >
            <Form {...closureForm}>
              <form
                onSubmit={closureForm.handleSubmit(onSubmitClosureForm)}
                className="space-y-4"
              >
                {!editingClosure && (
                  <FormField
                    control={closureForm.control}
                    name="closure_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data</FormLabel>
                        <FormControl>
                          <DatePicker
                            value={
                              field.value && /^\d{4}-\d{2}-\d{2}$/.test(field.value)
                                ? new Date(field.value + "T12:00:00")
                                : null
                            }
                            onChange={(d) =>
                              d && field.onChange(format(d, "yyyy-MM-dd"))
                            }
                            placeholder="Selecione a data"
                            triggerVariant="compact"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {editingClosure && (
                  <div className="text-sm text-muted-foreground">
                    Data:{" "}
                    <strong title={editingClosure.closure_date}>
                      {formatClosureDateSafe(editingClosure.closure_date)}
                    </strong>{" "}
                    (não editável)
                  </div>
                )}
                <FormField
                  control={closureForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(v) =>
                          field.onChange(v as "closed" | "open_partial")
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="closed">
                            Fechado (dia todo)
                          </SelectItem>
                          <SelectItem value="open_partial">
                            Aberto parcial (informe horário abaixo)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {closureForm.watch("status") === "open_partial" && (
                  <>
                    <FormField
                      control={closureForm.control}
                      name="start_time"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Das (horário)</FormLabel>
                          <FormControl>
                            <Input
                              type="time"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={closureForm.control}
                      name="end_time"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Até (horário)</FormLabel>
                          <FormControl>
                            <Input
                              type="time"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
                <FormField
                  control={closureForm.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Motivo (opcional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ex: Feriado, reforma"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {closureForm.watch("status") === "open_partial" && (
                  <div className="space-y-2">
                    <Label>Intervalos de indisponibilidade (ex.: almoço)</Label>
                    <p className="text-xs text-muted-foreground">
                      Bloqueie horários dentro do expediente em que não há atendimento.
                    </p>
                    {closureIntervals.fields.map((field, index) => (
                      <div key={field.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                        <Input type="time" className="w-[100px]" {...closureForm.register(`unavailability_intervals.${index}.start`)} />
                        <span className="text-muted-foreground">até</span>
                        <Input type="time" className="w-[100px]" {...closureForm.register(`unavailability_intervals.${index}.end`)} />
                        <Input placeholder="Motivo (opcional)" className="flex-1 min-w-[120px]" {...closureForm.register(`unavailability_intervals.${index}.reason`)} />
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => closureIntervals.remove(index)} aria-label="Remover">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={() => closureIntervals.append({ start: "12:00", end: "13:00", reason: "" })}>
                      <Plus className="h-4 w-4 mr-1" />
                      Adicionar intervalo
                    </Button>
                  </div>
                )}
              </form>
            </Form>
          </EntityFormDialog>
        </TabsContent>

        <TabsContent
          value="brain"
          className={cn("mt-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200", tabInner)}
        >
          {loadingSettings ? (
            <div className="min-h-[280px] flex items-center justify-center">
              <LoadingState />
            </div>
          ) : (
            <div className="space-y-8">
              {numberModeData?.mode === "account_wide" && numberModeData?.barbershops && numberModeData.barbershops.length > 1 && (
                <Alert className="border-primary/50 bg-primary/5">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Modo conta única</AlertTitle>
                  <AlertDescription>
                    As regras e o perfil do agente serão aplicados a todas as unidades da conta ao publicar.
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <Brain className="h-5 w-5 text-primary" aria-hidden />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Cérebro</h3>
                  <p className="text-sm text-muted-foreground">
                    Tom de voz e comportamentos do assistente de IA.
                  </p>
                </div>
              </div>
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Identidade do agente
                  </h4>
                  <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Nome exibido</Label>
                        <input
                          type="text"
                          placeholder="Ex.: NavalhIA"
                          maxLength={100}
                          value={String(draftProfile?.displayName ?? "")}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraftProfile((p) => {
                              const next = { ...p, displayName: v || undefined };
                              updateSettingsMutation.mutate({ agent_profile: next });
                              return next;
                            });
                          }}
                          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Apelido</Label>
                        <input
                          type="text"
                          placeholder="Ex.: Navalha"
                          maxLength={50}
                          value={String(draftProfile?.nickname ?? "")}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraftProfile((p) => {
                              const next = { ...p, nickname: v || undefined };
                              updateSettingsMutation.mutate({ agent_profile: next });
                              return next;
                            });
                          }}
                          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Papel / função</Label>
                      <input
                        type="text"
                        placeholder="Ex.: Assistente de agendamento"
                        maxLength={200}
                        value={String(draftProfile?.role ?? "")}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftProfile((p) => {
                            const next = { ...p, role: v || undefined };
                            updateSettingsMutation.mutate({ agent_profile: next });
                            return next;
                          });
                        }}
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="sign-messages"
                        checked={Boolean(draftProfile?.signMessages ?? false)}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setDraftProfile((p) => {
                            const next = { ...p, signMessages: v };
                            updateSettingsMutation.mutate({ agent_profile: next });
                            return next;
                          });
                        }}
                      />
                      <Label htmlFor="sign-messages" className="text-xs text-muted-foreground">
                        Assinar mensagens com nome do agente
                      </Label>
                    </div>
                    {(draftProfile?.signMessages ?? false) && (
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Estilo da assinatura</Label>
                        <Select
                          value={String(draftProfile?.signatureStyle ?? "short")}
                          onValueChange={(v: "short" | "full") => {
                            setDraftProfile((p) => {
                              const next = { ...p, signatureStyle: v };
                              updateSettingsMutation.mutate({ agent_profile: next });
                              return next;
                            });
                          }}
                        >
                          <SelectTrigger className="h-10 rounded-lg w-full max-w-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="short">Só o nome</SelectItem>
                            <SelectItem value="full">Nome + papel</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                      <Mic className="h-4 w-4" />
                      Tom de voz
                    </h4>
                    <AgentToneStep
                      profile={draftProfile}
                      onChange={(u) => setDraftProfile((p) => ({ ...p, ...u }))}
                    />
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                      <Sliders className="h-4 w-4" />
                      Comportamentos
                    </h4>
                    <AgentBehaviorStep
                      profile={draftProfile}
                      onChange={(u) => setDraftProfile((p) => ({ ...p, ...u }))}
                    />
                    <div className="mt-4">
                      <AgentCustomRulesStep
                        profile={draftProfile}
                        onChange={(u) => setDraftProfile((p) => ({ ...p, ...u }))}
                      />
                    </div>
                    {isPremium && aiSettings && (
                    <Card className="border-border/60 bg-card/50 mt-4">
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
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground">Máx. tokens por resposta</Label>
                          <input
                            type="number"
                            min={50}
                            max={4096}
                            value={aiSettings.max_output_tokens ?? 350}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (!Number.isNaN(v)) updateSettingsMutation.mutate({ max_output_tokens: v });
                            }}
                            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                          />
                          <p className="text-xs text-muted-foreground">
                            Respostas mais curtas (ex.: 350) para WhatsApp.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id="typing-sim"
                              checked={aiSettings.typing_simulation?.enabled ?? false}
                              onChange={(e) =>
                                updateSettingsMutation.mutate({
                                  typing_simulation: {
                                    ...(aiSettings.typing_simulation ?? {}),
                                    enabled: e.target.checked,
                                    baseDelayMs: aiSettings.typing_simulation?.baseDelayMs ?? 300,
                                    msPerChar: aiSettings.typing_simulation?.msPerChar ?? 20,
                                    jitterMs: aiSettings.typing_simulation?.jitterMs ?? 100,
                                  },
                                })
                              }
                            />
                            <Label htmlFor="typing-sim" className="text-xs font-medium text-muted-foreground">
                              Simular digitação antes de enviar
                            </Label>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  </div>
                </div>

                {/* Base de conhecimento (memória do agente) */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Base de conhecimento
                  </h4>
                  {!hasPremium(profile) ? (
                    <UpgradeGate
                      featureName="Base de conhecimento"
                      requiredPlan="premium"
                      variant="inline"
                    >
                      <span />
                    </UpgradeGate>
                  ) : (
                  <Card className="border-border/60 bg-card/50">
                    <CardContent className="p-4 sm:p-6 space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Anexe documentos (PDF, Word, texto) para o agente usar nas respostas. Eles são processados e indexados em alguns minutos.
                      </p>
                      {knowledgeConfig?.storage_configured !== true && (
                        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200">
                          O armazenamento de documentos ainda não está configurado neste ambiente. Você pode ativar a base de conhecimento seguindo a documentação.
                          <div className="flex flex-wrap gap-2 mt-2">
                            <Button variant="outline" size="sm" asChild>
                              <Link to="/app/ajuda/whatsapp" className="flex items-center gap-1.5">
                                <BookOpen className="h-4 w-4" />
                                Ver tutorial
                              </Link>
                            </Button>
                            <Button variant="ghost" size="sm" asChild>
                              <Link to="/docs" className="flex items-center gap-1.5">
                                Documentação (API)
                              </Link>
                            </Button>
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          ref={knowledgeFileInputRef}
                          type="file"
                          accept=".pdf,.docx,.doc,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              uploadKnowledgeDocumentMutation.mutate(file);
                              e.target.value = "";
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => knowledgeFileInputRef.current?.click()}
                          disabled={
                            uploadKnowledgeDocumentMutation.isPending ||
                            knowledgeConfig?.storage_configured !== true
                          }
                        >
                          {uploadKnowledgeDocumentMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Upload className="h-4 w-4 mr-2" />
                          )}
                          Adicionar documento
                        </Button>
                      </div>
                      {(knowledgeDocuments?.length ?? 0) > 0 && (
                        <ul className="space-y-2 border border-border/60 rounded-lg divide-y divide-border/60 overflow-hidden">
                          {knowledgeDocuments?.map((doc) => (
                            <li
                              key={doc.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/30"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="font-medium text-foreground truncate block">
                                  {doc.title || doc.original_filename}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {doc.status === "ready"
                                    ? "Pronto"
                                    : doc.status === "processing"
                                      ? "Processando…"
                                      : doc.status === "failed"
                                        ? "Falha"
                                        : doc.status === "uploaded"
                                          ? "Enviado"
                                          : doc.status}
                                  {doc.last_error ? ` — ${doc.last_error}` : ""}
                                </span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  if (window.confirm("Remover este documento da base de conhecimento?")) {
                                    deleteKnowledgeDocumentMutation.mutate(doc.id);
                                  }
                                }}
                                disabled={deleteKnowledgeDocumentMutation.isPending}
                                aria-label="Excluir documento"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                  )}
                </div>

                {/* Prompt compilado (read-only) */}
                {compiledPromptData && (
                  <Card className="border-border/60 bg-card/50">
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <h4 className="text-sm font-semibold">Prompt compilado (em execução)</h4>
                            <p className="text-xs text-muted-foreground font-normal mt-0.5">
                              Versão ativa em uso pelo agente. Somente leitura.
                              {compiledPromptData.active_prompt_version_id && (
                                <span className="ml-1">ID: {compiledPromptData.active_prompt_version_id.slice(0, 8)}…</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(compiledPromptData.compiled_prompt).then(
                              () => toastSuccess("Prompt copiado para a área de transferência."),
                              () => toastError("Falha ao copiar.")
                            );
                          }}
                        >
                          <Copy className="h-4 w-4 mr-1.5" />
                          Copiar
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Accordion type="single" collapsible className="w-full space-y-1" defaultValue={["base"]}>
                        <AccordionItem value="base" className="rounded-lg border border-border/60 px-3">
                          <AccordionTrigger className="hover:no-underline py-3 text-sm">
                            Base ({compiledPromptData.section_lengths?.base ?? 0} caracteres)
                          </AccordionTrigger>
                          <AccordionContent>
                            <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono bg-muted/30 p-3 rounded-md max-h-48 overflow-y-auto">
                              {compiledPromptData.sections.base}
                            </pre>
                          </AccordionContent>
                        </AccordionItem>
                        {compiledPromptData.sections.style != null && compiledPromptData.sections.style.trim() !== "" && (
                          <AccordionItem value="style" className="rounded-lg border border-border/60 px-3">
                            <AccordionTrigger className="hover:no-underline py-3 text-sm">
                              Estilo ({compiledPromptData.section_lengths?.style ?? 0} caracteres)
                            </AccordionTrigger>
                            <AccordionContent>
                              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono bg-muted/30 p-3 rounded-md max-h-48 overflow-y-auto">
                                {compiledPromptData.sections.style}
                              </pre>
                            </AccordionContent>
                          </AccordionItem>
                        )}
                        {compiledPromptData.sections.customRules != null && compiledPromptData.sections.customRules.trim() !== "" && (
                          <AccordionItem value="customRules" className="rounded-lg border border-border/60 px-3">
                            <AccordionTrigger className="hover:no-underline py-3 text-sm">
                              Regras customizadas ({compiledPromptData.section_lengths?.customRules ?? 0} caracteres)
                            </AccordionTrigger>
                            <AccordionContent>
                              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono bg-muted/30 p-3 rounded-md max-h-48 overflow-y-auto">
                                {compiledPromptData.sections.customRules}
                              </pre>
                            </AccordionContent>
                          </AccordionItem>
                        )}
                        {compiledPromptData.sections.additionalInstructions != null && compiledPromptData.sections.additionalInstructions.trim() !== "" && (
                          <AccordionItem value="additionalInstructions" className="rounded-lg border border-border/60 px-3">
                            <AccordionTrigger className="hover:no-underline py-3 text-sm">
                              Instruções adicionais ({compiledPromptData.section_lengths?.additionalInstructions ?? 0} caracteres)
                            </AccordionTrigger>
                            <AccordionContent>
                              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono bg-muted/30 p-3 rounded-md max-h-48 overflow-y-auto">
                                {compiledPromptData.sections.additionalInstructions}
                              </pre>
                            </AccordionContent>
                          </AccordionItem>
                        )}
                        <AccordionItem value="guardrails" className="rounded-lg border border-border/60 px-3">
                          <AccordionTrigger className="hover:no-underline py-3 text-sm">
                            Guardrails ({compiledPromptData.section_lengths?.guardrails ?? 0} caracteres)
                          </AccordionTrigger>
                          <AccordionContent>
                            <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono bg-muted/30 p-3 rounded-md max-h-48 overflow-y-auto">
                              {compiledPromptData.sections.guardrails}
                            </pre>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="preview"
          className={cn("mt-0 flex flex-col flex-1 min-h-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200", tabInner)}
        >
          <AgentPreviewChatStep
            draftProfile={draftProfile}
            draftAdditionalInstructions={draftAdditionalInstructions}
            onPublish={() => publishMutation.mutate()}
            onRollback={(id) => rollbackMutation.mutate(id)}
            onApplyAnalyzerResult={(patch, publish) => {
              const baseProfile = {
                ...draftProfile,
                ...(patch.profile && Object.keys(patch.profile).length > 0
                  ? patch.profile
                  : {}),
              } as AgentProfile;
              let nextCustomRules = Array.isArray(baseProfile.customRules) ? [...baseProfile.customRules] : [];
              const crp = patch.custom_rules_patch;
              if (crp) {
                const disableSet = new Set(crp.disable ?? []);
                if (disableSet.size > 0) {
                  nextCustomRules = nextCustomRules.map((r) =>
                    disableSet.has((r as { id?: string }).id ?? "") ? { ...r, enabled: false } : r
                  );
                }
                for (const u of crp.update ?? []) {
                  const i = nextCustomRules.findIndex((r) => (r as { id?: string }).id === u.id);
                  if (i >= 0) {
                    nextCustomRules[i] = { ...nextCustomRules[i], ...u.patch } as AgentProfile["customRules"] extends (infer R)[] ? R : never;
                  }
                }
                for (const a of crp.add ?? []) {
                  const rule = a as { id?: string; title?: string; enabled?: boolean; priority?: number; do?: string[]; dont?: string[] };
                  nextCustomRules.push({
                    id: rule.id ?? crypto.randomUUID(),
                    title: rule.title ?? "Nova regra",
                    enabled: rule.enabled !== false,
                    priority: typeof rule.priority === "number" ? rule.priority : 3,
                    do: Array.isArray(rule.do) ? rule.do : [String(rule.do ?? "")],
                    dont: rule.dont,
                  } as AgentProfile["customRules"] extends (infer R)[] ? R : never);
                }
              }
              const mergedProfile = { ...baseProfile, customRules: nextCustomRules };
              const mergedInstructions =
                patch.instructions !== undefined
                  ? patch.instructions
                  : draftAdditionalInstructions;
              setDraftProfile(mergedProfile);
              setDraftAdditionalInstructions(mergedInstructions);
              const hasChanges =
                patch.profile ||
                patch.instructions !== undefined ||
                (crp && (crp.add?.length || crp.update?.length || crp.disable?.length));
              if (publish) {
                updateSettingsMutation.mutate(
                  {
                    agent_profile: mergedProfile,
                    additional_instructions: mergedInstructions,
                  },
                  { onSuccess: () => publishMutation.mutate() },
                );
              } else if (hasChanges) {
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
            openDiagnosticFromInbox={openDiagnosticFromInbox}
          />
        </TabsContent>

        <TabsContent
          value="notifications"
          className={cn("mt-0 focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200", tabInner)}
        >
          <NotificationsTabContent
            whatsappConnected={whatsappConnected}
            canUseWhatsApp={canUseWhatsApp}
            isActive={activeTab === "notifications"}
          />
        </TabsContent>

        {apiKeysContent && (
          <TabsContent
            value="api-keys"
            className={cn("mt-0 flex flex-col flex-1 min-h-0 overflow-hidden focus-visible:outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200", tabInner)}
          >
            {apiKeysContent}
          </TabsContent>
        )}

      {/* Footer (only when showCloseButton or showDraftPublishFooter) */}
      {(showDraftPublishFooter || showCloseButton) && (
        <footer
          className={cn(
            "relative shrink-0 flex flex-wrap items-center justify-end gap-3 px-6 sm:px-8 py-4 min-h-[72px]",
            "border-t border-border/70 bg-card/60 rounded-b-xl",
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
                {(activeTab === "brain") && (
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
                    <div className="flex items-center gap-2 shrink-0">
                      <Checkbox
                        id="require-suite-publish"
                        checked={requireSuiteBeforePublish}
                        onCheckedChange={(v) => setRequireSuiteBeforePublish(v === true)}
                        aria-describedby="require-suite-desc"
                      />
                      <Label id="require-suite-desc" htmlFor="require-suite-publish" className="text-sm font-normal cursor-pointer whitespace-nowrap">
                        Exigir suíte antes de publicar
                      </Label>
                    </div>
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
                      onClick={async () => {
                        if (requireSuiteBeforePublish) {
                          setPublishGateChecking(true);
                          try {
                            const res = await whatsappApi.simulateAiSuite({
                              scenarios: DEFAULT_SUITE_SCENARIOS,
                              draft_profile: draftProfile ?? undefined,
                              draft_additional_instructions: draftAdditionalInstructions ?? undefined,
                            });
                            if (!res.all_passed) {
                              toastError("Suíte de cenários falhou. Corrija o agente e tente novamente ou desmarque 'Exigir suíte antes de publicar'.");
                              setPublishGateChecking(false);
                              return;
                            }
                          } catch (e) {
                            toastError(e instanceof Error ? e.message : "Erro ao rodar suíte.");
                            setPublishGateChecking(false);
                            return;
                          }
                          setPublishGateChecking(false);
                        }
                        publishMutation.mutate();
                      }}
                      disabled={isBusy || publishGateChecking}
                      aria-label={publishMutation.isPending || publishGateChecking ? "Publicando…" : "Publicar alterações"}
                      className="rounded-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {(publishMutation.isPending || publishGateChecking) ? (
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                      ) : null}
                      Publicar
                    </Button>
                  </>
                )}
              </>
            )}
            {showCloseButton && onClose && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                aria-label="Fechar"
                className="rounded-lg font-medium"
              >
                Fechar
              </Button>
            )}
          </div>
        </footer>
      )}
    </Tabs>
  );
}
