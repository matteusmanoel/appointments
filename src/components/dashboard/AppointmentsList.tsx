import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Clock, User, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  appointmentsApi,
  serviceLabel,
  type AppointmentListItem,
} from "@/lib/api";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";

type RangeValue = { from: Date | null; to: Date | null } | null;

const statusMap: Record<string, { label: string; className: string }> = {
  confirmed: { label: "Confirmado", className: "badge-success" },
  pending: { label: "Pendente", className: "badge-warning" },
  completed: { label: "Concluído", className: "badge-info" },
  cancelled: {
    label: "Cancelado",
    className:
      "bg-destructive/10 text-destructive border border-destructive/20 px-2.5 py-0.5 rounded-full text-xs font-medium",
  },
  no_show: {
    label: "Faltou",
    className:
      "bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full text-xs font-medium",
  },
};

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/** Parse date from API (YYYY-MM-DD or ISO string); return formatted dd/MM/yyyy or — */
function formatAppointmentDate(
  scheduled_date: string | null | undefined,
): string {
  if (!scheduled_date || typeof scheduled_date !== "string") return "—";
  const raw = scheduled_date.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "—";
  try {
    const date = parseISO(raw + "T12:00:00");
    if (Number.isNaN(date.getTime())) return "—";
    return format(date, "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return "—";
  }
}

function formatAppointmentTime(
  scheduled_time: string | null | undefined,
): string {
  if (scheduled_time == null) return "—";
  const s = String(scheduled_time).trim();
  const match = s.match(/^\d{1,2}:\d{2}/) || s.match(/^\d{2}:\d{2}/);
  return match ? s.slice(0, 5) : s.slice(0, 5) || "—";
}

/** Sort by scheduled date+time ascending (soonest first) */
function sortBySoonest(items: AppointmentListItem[]): AppointmentListItem[] {
  return [...items].sort((a, b) => {
    const da = (a.scheduled_date || "").slice(0, 10);
    const ta = String(a.scheduled_time || "").slice(0, 5);
    const db = (b.scheduled_date || "").slice(0, 10);
    const tb = String(b.scheduled_time || "").slice(0, 5);
    const tsA = new Date(da + "T" + (ta || "00:00")).getTime();
    const tsB = new Date(db + "T" + (tb || "00:00")).getTime();
    return tsA - tsB;
  });
}

interface AppointmentsListProps {
  range?: RangeValue;
}

export function AppointmentsList({ range }: AppointmentsListProps) {
  const navigate = useNavigate();
  const today = todayISO();
  const fromStr =
    range?.from && range?.to ? format(range.from, "yyyy-MM-dd") : undefined;
  const toStr =
    range?.from && range?.to ? format(range.to, "yyyy-MM-dd") : undefined;
  const {
    data: appointments = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["appointments", fromStr ?? today, toStr],
    queryFn: () =>
      fromStr && toStr
        ? appointmentsApi.list({ from: fromStr, to: toStr })
        : appointmentsApi.list({ date: today }),
  });

  const pending = appointments.filter(
    (a) => a.status === "pending" || a.status === "confirmed",
  );
  const displayList = sortBySoonest(pending).slice(0, 8);

  const periodSubtitle =
    range?.from && range?.to
      ? `${format(range.from, "dd/MM/yyyy", { locale: ptBR })} - ${format(range.to, "dd/MM/yyyy", { locale: ptBR })}`
      : "Agenda de hoje";

  if (error) {
    return (
      <div className="stat-card animate-fade-in">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground">
            Agendamentos no período
          </h3>
          <p className="text-sm text-muted-foreground">{periodSubtitle}</p>
        </div>
        <p className="text-sm text-destructive">
          Erro ao carregar agendamentos.
        </p>
      </div>
    );
  }

  const agendamentosUrl =
    range?.from && range?.to
      ? `/app/agendamentos?view=lista&from=${format(range.from, "yyyy-MM-dd")}&to=${format(range.to, "yyyy-MM-dd")}`
      : "/app/agendamentos?view=lista";

  return (
    <div className="stat-card animate-fade-in">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Agendamentos no período
          </h3>
          <p className="text-sm text-muted-foreground">{periodSubtitle}</p>
        </div>
        <Link
          to={agendamentosUrl}
          className="text-sm font-medium text-primary hover:underline shrink-0"
        >
          Ver todos
        </Link>
      </div>
      {isLoading ? (
        <LoadingState />
      ) : displayList.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-12 w-12" strokeWidth={1.5} />}
          title={
            fromStr && toStr
              ? "Nenhum agendamento no período"
              : "Nenhum agendamento para hoje"
          }
          description={
            fromStr && toStr
              ? "Não há agendamentos pendentes ou confirmados neste período."
              : "Não há agendamentos para hoje."
          }
        />
      ) : (
        <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
          {displayList.map((appointment) => {
            const status = statusMap[appointment.status] ?? statusMap.pending;
            const dateStr = formatAppointmentDate(appointment.scheduled_date);
            const timeStr = formatAppointmentTime(appointment.scheduled_time);
            return (
              <button
                type="button"
                key={appointment.id}
                onClick={() =>
                  navigate("/app/agendamentos", {
                    state: { editAppointment: appointment },
                  })
                }
                className="w-full flex items-center gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-foreground">
                      {dateStr}
                    </span>
                    <span className="text-muted-foreground">{timeStr}</span>
                    <span className={cn(status.className)}>{status.label}</span>
                  </div>
                  <p className="text-sm text-foreground truncate">
                    {appointment.client_name}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1">
                      <Scissors className="w-3 h-3" />
                      {serviceLabel(
                        appointment.service_names,
                        appointment.service_name,
                      )}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {appointment.barber_name}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">
                    R$ {Number(appointment.price).toFixed(2)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
