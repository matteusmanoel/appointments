import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Clock, User, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { appointmentsApi, serviceLabel } from "@/lib/api";

type RangeValue = { from: Date | null; to: Date | null } | null;

const statusMap: Record<string, { label: string; className: string }> = {
  confirmed: { label: "Confirmado", className: "badge-success" },
  pending: { label: "Pendente", className: "badge-warning" },
  completed: { label: "Concluído", className: "badge-info" },
  cancelled: { label: "Cancelado", className: "bg-destructive/10 text-destructive border border-destructive/20 px-2.5 py-0.5 rounded-full text-xs font-medium" },
  no_show: { label: "Faltou", className: "bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full text-xs font-medium" },
};

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

interface AppointmentsListProps {
  range?: RangeValue;
}

export function AppointmentsList({ range }: AppointmentsListProps) {
  const navigate = useNavigate();
  const today = todayISO();
  const fromStr = range?.from && range?.to ? format(range.from, "yyyy-MM-dd") : undefined;
  const toStr = range?.from && range?.to ? format(range.to, "yyyy-MM-dd") : undefined;
  const { data: appointments = [], isLoading, error } = useQuery({
    queryKey: ["appointments", fromStr ?? today, toStr],
    queryFn: () =>
      fromStr && toStr
        ? appointmentsApi.list({ from: fromStr, to: toStr })
        : appointmentsApi.list({ date: today }),
  });

  const pending = appointments.filter((a) => a.status === "pending" || a.status === "confirmed");
  const displayList = pending.slice(0, 8);

  const periodSubtitle =
    range?.from && range?.to
      ? `${format(range.from, "dd/MM/yyyy", { locale: ptBR })} - ${format(range.to, "dd/MM/yyyy", { locale: ptBR })}`
      : "Agenda de hoje";

  if (error) {
    return (
      <div className="stat-card animate-fade-in">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground">Agendamentos no período</h3>
          <p className="text-sm text-muted-foreground">{periodSubtitle}</p>
        </div>
        <p className="text-sm text-destructive">Erro ao carregar agendamentos.</p>
      </div>
    );
  }

  return (
    <div className="stat-card animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Agendamentos no período</h3>
          <p className="text-sm text-muted-foreground">{periodSubtitle}</p>
        </div>
        <Link to="/agendamentos" className="text-sm font-medium text-accent hover:text-accent/80 transition-colors">
          Ver todos
        </Link>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : displayList.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {fromStr && toStr ? "Nenhum agendamento no período." : "Nenhum agendamento para hoje."}
        </p>
      ) : (
        <div className="space-y-3">
          {displayList.map((appointment) => {
            const status = statusMap[appointment.status] ?? statusMap.pending;
            const time = String(appointment.scheduled_time).slice(0, 5);
            return (
              <button
                type="button"
                key={appointment.id}
                onClick={() => navigate("/app/agendamentos", { state: { editAppointment: appointment } })}
                className="w-full flex items-center gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-foreground">{time}</span>
                    <span className={cn(status.className)}>{status.label}</span>
                  </div>
                  <p className="text-sm text-foreground truncate">{appointment.client_name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1">
                      <Scissors className="w-3 h-3" />
                      {serviceLabel(appointment.service_names, appointment.service_name)}
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
