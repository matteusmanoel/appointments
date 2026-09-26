import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Activity } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { nativeAiUiEnabled } from "@/lib/native-ai-ui";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  appointment_created: "agendou",
  rescheduled: "reagendou",
  cancelled: "cancelou",
  confirmed: "confirmou presença",
  reminder_sent: "recebeu lembrete",
  no_show: "faltou",
  payment_recognized: "PIX recebido",
  conversation_started: "iniciou conversa",
};

function formatWhen(date: string | null, time: string | null): string {
  const d = date?.slice(0, 10);
  const t = time ? String(time).slice(0, 5) : "";
  if (!d) return t;
  try {
    const pretty = format(parseISO(`${d}T12:00:00`), "dd/MM", { locale: ptBR });
    return [pretty, t].filter(Boolean).join(" ");
  } catch {
    return [d, t].filter(Boolean).join(" ");
  }
}

export function AgendaActivityFeed() {
  const { data } = useQuery({
    queryKey: ["reports", "agenda-activity"],
    queryFn: () => reportsApi.agendaActivity(15),
    refetchInterval: 6000,
    retry: false,
  });
  const events = data?.events ?? [];

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Atividade da agenda</h3>
      </div>
      {events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Ainda não há ações recentes. Quando a IA ou o cliente mudar a agenda, aparece aqui.
        </p>
      ) : (
        <ul className="divide-y">
          {events.map((ev) => {
            const who = ev.client_name?.trim() || "Cliente";
            const verb = TYPE_LABEL[ev.type] ?? ev.type;
            const when = formatWhen(ev.scheduled_date, ev.scheduled_time);
            const inner = (
              <span className="block px-4 py-3 text-sm hover:bg-muted/40">
                <span className="font-medium">{who}</span> {verb}
                {when ? <span className="text-muted-foreground"> · {when}</span> : null}
              </span>
            );
            return (
              <li key={ev.id}>
                {nativeAiUiEnabled ? (
                  <Link
                    to="/app/whatsapp-interno"
                    className={cn("block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
