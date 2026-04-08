import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Phone,
  Calendar,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  Pencil,
  Brain,
  Scissors,
} from "lucide-react";
import { clientsApi, type Client, type ClientMemory } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toastSuccess, toastError } from "@/lib/toast-helpers";

const STATUS_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  completed: { label: "Concluído", icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "text-success" },
  confirmed: { label: "Confirmado", icon: <Calendar className="w-3.5 h-3.5" />, color: "text-primary" },
  pending: { label: "Pendente", icon: <Clock className="w-3.5 h-3.5" />, color: "text-amber-500" },
  cancelled: { label: "Cancelado", icon: <XCircle className="w-3.5 h-3.5" />, color: "text-muted-foreground" },
  no_show: { label: "No-show", icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "text-destructive" },
};

const REACTIVATION_LABELS: Record<string, string> = {
  active: "Ativo",
  at_risk: "Em risco",
  churned: "Perdido",
  returning: "Retornando",
  unknown: "Desconhecido",
};

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const STYLE_LABELS: Record<string, string> = {
  formal: "Formal",
  informal: "Informal",
  direct: "Direto",
  chatty: "Conversador",
  unknown: "Desconhecido",
};

function parseIsoDateOnly(value: string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const datePart = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const d = new Date(`${datePart}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeFormat(d: Date | null, pattern: string): string {
  if (!d || Number.isNaN(d.getTime())) return "—";
  try {
    return format(d, pattern, { locale: ptBR });
  } catch {
    return "—";
  }
}

/** ISO timestamp ou data YYYY-MM-DD — evita Invalid time value no date-fns */
function safeFormatDateish(value: string | null | undefined, pattern: string): string {
  if (value == null || value === "") return "—";
  const s = String(value).trim();
  const asDate = new Date(s);
  if (!Number.isNaN(asDate.getTime())) {
    try {
      return format(asDate, pattern, { locale: ptBR });
    } catch {
      return "—";
    }
  }
  const only = parseIsoDateOnly(s);
  return only ? safeFormat(only, pattern) : "—";
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 70 ? "bg-success/20 text-success" :
    pct >= 50 ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" :
    "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 font-medium", color)}>
      {pct}% conf.
    </span>
  );
}

function MemoryTab({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const { data: memory, isLoading } = useQuery({
    queryKey: ["client-memory", clientId],
    queryFn: () => clientsApi.getMemory(clientId),
    staleTime: 60 * 1000,
  });

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState<string>("");

  const updateMemoryMutation = useMutation({
    mutationFn: (notes: string | null) => clientsApi.updateMemory(clientId, { notes_safe: notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-memory", clientId] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toastSuccess("Observações salvas.");
      setEditingNotes(false);
    },
    onError: () => toastError("Erro ao salvar observações."),
  });

  if (isLoading) {
    return (
      <div className="space-y-3 pt-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 rounded" />)}
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
        <Brain className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">Nenhuma memória de IA ainda.</p>
        <p className="text-xs mt-1">O agente irá construir o perfil conforme atendimentos ocorrerem.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      <p className="text-xs text-muted-foreground">
        Dados inferidos pelo agente com base nos atendimentos. Confiança indica a certeza da inferência.
      </p>

      {/* Preferred services */}
      {memory.preferred_services && (memory.preferred_services as string[]).length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Scissors className="w-3.5 h-3.5" /> Serviços preferidos
            </span>
            <ConfidenceBadge value={memory.preferred_services_conf} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(memory.preferred_services as string[]).map((s) => (
              <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Preferred barber */}
      {memory.preferred_barber_name && (
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <User className="w-3.5 h-3.5" /> Barbeiro preferido
            </span>
            <p className="text-sm mt-0.5">{memory.preferred_barber_name}</p>
          </div>
          <ConfidenceBadge value={memory.preferred_barber_conf} />
        </div>
      )}

      {/* Preferred days */}
      {memory.preferred_days && (memory.preferred_days as number[]).length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> Dias preferidos
            </span>
            <ConfidenceBadge value={memory.preferred_days_conf} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(memory.preferred_days as number[]).map((d) => (
              <Badge key={d} variant="outline" className="text-xs">{DAY_LABELS[d]}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Preferred time */}
      {memory.preferred_time_start && (
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Horário preferido
            </span>
            <p className="text-sm mt-0.5">
              {memory.preferred_time_start.slice(0, 5)}
              {memory.preferred_time_end ? ` – ${memory.preferred_time_end.slice(0, 5)}` : ""}
            </p>
          </div>
          <ConfidenceBadge value={memory.preferred_time_conf} />
        </div>
      )}

      {/* Communication style */}
      {memory.communication_style && memory.communication_style !== "unknown" && (
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-muted-foreground">Estilo de comunicação</span>
            <p className="text-sm mt-0.5">{STYLE_LABELS[memory.communication_style] ?? memory.communication_style}</p>
          </div>
          <ConfidenceBadge value={memory.communication_style_conf} />
        </div>
      )}

      {/* No-show info */}
      {memory.no_show_count > 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 rounded-lg bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {memory.no_show_count} no-show{memory.no_show_count > 1 ? "s" : ""} registrado{memory.no_show_count > 1 ? "s" : ""}
          {memory.last_no_show_at && (
            <span className="text-muted-foreground text-xs ml-auto">
              último: {safeFormatDateish(memory.last_no_show_at, "dd/MM/yy")}
            </span>
          )}
        </div>
      )}

      {/* Notes safe (editable) */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-muted-foreground">Observação para o agente</span>
          {!editingNotes && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => {
                setNotesValue(memory.notes_safe ?? "");
                setEditingNotes(true);
              }}
            >
              <Pencil className="w-3 h-3 mr-1" /> Editar
            </Button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-2">
            <Textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              maxLength={200}
              className="text-sm resize-none min-h-[60px]"
              placeholder="Ex: prefere manhã, traz o filho às vezes..."
              autoFocus
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{notesValue.length}/200</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditingNotes(false)}>Cancelar</Button>
                <Button
                  size="sm"
                  onClick={() => updateMemoryMutation.mutate(notesValue || null)}
                  disabled={updateMemoryMutation.isPending}
                >
                  Salvar
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {memory.notes_safe || "Nenhuma observação adicionada."}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Confiança geral: <ConfidenceBadge value={memory.overall_confidence} />
        {memory.last_completed_at && (
          <> · Último atendimento: {safeFormatDateish(memory.last_completed_at, "dd/MM/yy")}</>
        )}
      </p>
    </div>
  );
}

interface ClientDrawerProps {
  client: Client | null;
  onClose: () => void;
  onEdit: (client: Client) => void;
}

export function ClientDrawer({ client, onClose, onEdit }: ClientDrawerProps) {
  const { data: appointments = [], isLoading: loadingAppointments } = useQuery({
    queryKey: ["client-appointments", client?.id],
    queryFn: () => clientsApi.getAppointments(client!.id),
    enabled: !!client,
    staleTime: 60 * 1000,
  });

  const recentAppointment = appointments[0] ?? null;
  const upcomingAppointment = appointments.find(
    (a) => (a.status === "confirmed" || a.status === "pending") && a.scheduled_date >= new Date().toISOString().slice(0, 10)
  ) ?? null;

  return (
    <Sheet open={!!client} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        {client && (
          <>
            <SheetHeader className="pb-4 border-b border-border">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <SheetTitle className="text-base">{client.name}</SheetTitle>
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" />
                      {client.phone}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => onEdit(client)}>
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar
                </Button>
              </div>
              {/* Quick stats */}
              <div className="flex gap-4 mt-3 pt-3 border-t border-border/50">
                <div className="text-center">
                  <p className="text-base font-semibold">{client.total_visits}</p>
                  <p className="text-xs text-muted-foreground">Visitas</p>
                </div>
                <div className="text-center">
                  <p className="text-base font-semibold">
                    R$ {Number(client.total_spent).toLocaleString("pt-BR")}
                  </p>
                  <p className="text-xs text-muted-foreground">Total gasto</p>
                </div>
                <div className="text-center">
                  <p className="text-base font-semibold">{client.loyalty_points}</p>
                  <p className="text-xs text-muted-foreground">Pontos</p>
                </div>
                {(client.no_show_count ?? 0) > 0 && (
                  <div className="text-center">
                    <p className="text-base font-semibold text-destructive">{client.no_show_count}</p>
                    <p className="text-xs text-muted-foreground">No-shows</p>
                  </div>
                )}
              </div>
            </SheetHeader>

            <Tabs defaultValue="summary" className="mt-4">
              <TabsList className="w-full">
                <TabsTrigger value="summary" className="flex-1">Resumo</TabsTrigger>
                <TabsTrigger value="appointments" className="flex-1">Agendamentos</TabsTrigger>
                <TabsTrigger value="memory" className="flex-1">
                  <Brain className="w-3.5 h-3.5 mr-1" /> IA
                </TabsTrigger>
              </TabsList>

              {/* Summary tab */}
              <TabsContent value="summary" className="mt-4 space-y-4">
                {/* Reactivation status */}
                {client.reactivation_status && client.reactivation_status !== "unknown" && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant="secondary">{REACTIVATION_LABELS[client.reactivation_status] ?? client.reactivation_status}</Badge>
                  </div>
                )}

                {/* Upcoming appointment */}
                {upcomingAppointment && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                    <p className="text-xs font-medium text-primary mb-1">Próximo agendamento</p>
                    <p className="text-sm font-medium">
                      {(() => {
                        const d = parseIsoDateOnly(upcomingAppointment.scheduled_date);
                        return d
                          ? `${safeFormat(d, "EEEE, dd/MM")} às ${upcomingAppointment.scheduled_time?.slice(0, 5) ?? "—"}`
                          : "—";
                      })()}
                    </p>
                    {upcomingAppointment.barber_name && (
                      <p className="text-xs text-muted-foreground mt-0.5">com {upcomingAppointment.barber_name}</p>
                    )}
                    {Array.isArray(upcomingAppointment.service_names) && upcomingAppointment.service_names.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {upcomingAppointment.service_names.map((s) => (
                          <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Last appointment */}
                {recentAppointment && recentAppointment.id !== upcomingAppointment?.id && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Último atendimento</p>
                    <div className="rounded-lg border border-border px-3 py-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">
                          {safeFormat(parseIsoDateOnly(recentAppointment.scheduled_date), "dd/MM/yyyy")}
                        </p>
                        <span className={cn("flex items-center gap-1 text-xs", STATUS_LABELS[recentAppointment.status]?.color ?? "text-muted-foreground")}>
                          {STATUS_LABELS[recentAppointment.status]?.icon}
                          {STATUS_LABELS[recentAppointment.status]?.label ?? recentAppointment.status}
                        </span>
                      </div>
                      {recentAppointment.barber_name && (
                        <p className="text-xs text-muted-foreground mt-0.5">com {recentAppointment.barber_name}</p>
                      )}
                      {Array.isArray(recentAppointment.service_names) && recentAppointment.service_names.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {recentAppointment.service_names.map((s) => (
                            <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Preferred services from memory */}
                {Array.isArray(client.preferred_services) && (client.preferred_services as string[]).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Serviços frequentes</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(client.preferred_services as string[]).map((s) => (
                        <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* No content state */}
                {!recentAppointment && !upcomingAppointment && (
                  <div className="flex flex-col items-center py-6 text-center text-muted-foreground">
                    <Calendar className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">Nenhum agendamento registrado.</p>
                  </div>
                )}

                {/* Client notes */}
                {client.notes && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Observações</p>
                    <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">{client.notes}</p>
                  </div>
                )}
              </TabsContent>

              {/* Appointments tab */}
              <TabsContent value="appointments" className="mt-4">
                {loadingAppointments && (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
                  </div>
                )}
                {!loadingAppointments && appointments.length === 0 && (
                  <div className="flex flex-col items-center py-8 text-center text-muted-foreground">
                    <Calendar className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">Nenhum agendamento encontrado.</p>
                  </div>
                )}
                {!loadingAppointments && appointments.length > 0 && (
                  <div className="space-y-2">
                    {appointments.map((a) => (
                      <div key={a.id} className="rounded-lg border border-border px-3 py-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium">
                            {safeFormat(parseIsoDateOnly(a.scheduled_date), "dd/MM/yyyy")}
                            {a.scheduled_time && ` às ${a.scheduled_time.slice(0, 5)}`}
                          </p>
                          <span className={cn("flex items-center gap-1 text-xs", STATUS_LABELS[a.status]?.color ?? "text-muted-foreground")}>
                            {STATUS_LABELS[a.status]?.icon}
                            {STATUS_LABELS[a.status]?.label ?? a.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{a.barber_name ?? "—"}</span>
                          {a.price != null && a.price > 0 && (
                            <span className="flex items-center gap-0.5">
                              <DollarSign className="w-3 h-3" />
                              {Number(a.price).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                        {Array.isArray(a.service_names) && a.service_names.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {a.service_names.map((s) => (
                              <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Memory (AI) tab */}
              <TabsContent value="memory" className="mt-4">
                <MemoryTab clientId={client.id} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
