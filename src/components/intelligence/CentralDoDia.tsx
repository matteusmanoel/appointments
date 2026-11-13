import { useQuery } from "@tanstack/react-query";
import { Bell, AlertTriangle, WifiOff } from "lucide-react";
import { intelligenceApi, type DaySummary } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PURPOSES: { key: keyof DaySummary["by_purpose"]; label: string }[] = [
  { key: "lembrete", label: "Lembrete" },
  { key: "fila_espera", label: "Fila de espera" },
  { key: "reativacao", label: "Reativação" },
  { key: "cobranca", label: "Cobrança de plano" },
  { key: "atendimento", label: "Atendimento" },
  { key: "avulsa", label: "Mensagem avulsa" },
  { key: "campanha", label: "Campanha" },
];

export function CentralDoDia() {
  const { data, isLoading } = useQuery({
    queryKey: ["intel-day-summary"],
    queryFn: () => intelligenceApi.daySummary(),
    refetchInterval: 60_000,
  });

  const byPurpose = data?.by_purpose ?? { lembrete: 0, fila_espera: 0, reativacao: 0, cobranca: 0, atendimento: 0, avulsa: 0, campanha: 0 };
  const unique = data?.unique_clients_today ?? 0;
  const insistence = data?.insistence_phones ?? 0;
  const failures = data?.send_failures_today ?? 0;
  const connected = data?.session_connected ?? true;

  const showFailureAlert = !isLoading && data != null && (failures > 0 || !connected);

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="shrink-0 border-b pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Bell className="h-4 w-4 text-amber-500" />
          Central do Dia
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* Finalidade de envio */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Finalidade de envio
          </p>
          {isLoading ? (
            <div className="space-y-1.5">
              {PURPOSES.map((p) => (
                <div key={p.key} className="h-5 w-3/4 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <ul className="space-y-1">
              {PURPOSES.map(({ key, label }) => {
                const n = byPurpose[key];
                return (
                  <li key={key} className="flex items-center justify-between">
                    <span className={`text-sm ${n === 0 ? "text-muted-foreground" : ""}`}>{label}</span>
                    <span className={`text-sm font-semibold tabular-nums ${n === 0 ? "text-muted-foreground" : ""}`}>
                      {n}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Clientes únicos */}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Clientes únicos hoje
          </p>
          {isLoading ? (
            <div className="h-8 w-16 animate-pulse rounded bg-muted" />
          ) : (
            <p
              className="text-3xl font-bold tabular-nums"
              title="Telefones distintos que receberam pelo menos uma mensagem hoje"
            >
              {unique}
            </p>
          )}
        </div>

        {/* Alerta de insistência */}
        {!isLoading && insistence > 0 && (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-sm">
              <span className="font-semibold">{insistence}</span> telefone{insistence !== 1 ? "s" : ""} com 3 ou mais
              mensagens hoje
            </p>
          </div>
        )}

        {/* Alerta de falha */}
        {showFailureAlert && (
          <div className="space-y-1.5">
            {!connected && (
              <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                <WifiOff className="h-4 w-4 shrink-0" />
                <p className="text-sm font-medium">Sessão WhatsApp desconectada</p>
              </div>
            )}
            {failures > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <p className="text-sm">
                  <span className="font-semibold">{failures}</span> falha{failures !== 1 ? "s" : ""} de envio hoje
                </p>
              </div>
            )}
          </div>
        )}

      </CardContent>
    </Card>
  );
}
