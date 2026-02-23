import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, User, Scissors } from "lucide-react";
import { appointmentsApi } from "@/lib/api";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";

const TOP_N = 5;

type RangeValue = { from: Date | null; to: Date | null } | null;

interface RankingCardProps {
  range?: RangeValue;
}

export function RankingCard({ range }: RankingCardProps) {
  const [mode, setMode] = useState<"barbeiros" | "clientes">("barbeiros");
  const fromStr =
    range?.from && range?.to ? format(range.from, "yyyy-MM-dd") : undefined;
  const toStr =
    range?.from && range?.to ? format(range.to, "yyyy-MM-dd") : undefined;

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["appointments", "ranking", fromStr ?? "", toStr ?? ""],
    queryFn: () =>
      fromStr && toStr
        ? appointmentsApi.list({ from: fromStr, to: toStr })
        : Promise.resolve([]),
    enabled: !!fromStr && !!toStr,
  });

  const completed = useMemo(
    () => appointments.filter((a) => a.status === "completed"),
    [appointments],
  );

  const byBarber = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>();
    for (const a of completed) {
      const id = a.barber_id ?? "__unknown__";
      const name = a.barber_name ?? "Barbeiro";
      const prev = map.get(id) ?? { name, total: 0 };
      prev.total += Number(a.price ?? 0);
      map.set(id, prev);
    }
    return Array.from(map.entries())
      .map(([id, { name, total }]) => ({ id, name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP_N);
  }, [completed]);

  const byClient = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>();
    for (const a of completed) {
      const id = a.client_id ?? "__unknown__";
      const name = a.client_name ?? "Cliente";
      const prev = map.get(id) ?? { name, total: 0 };
      prev.total += Number(a.price ?? 0);
      map.set(id, prev);
    }
    return Array.from(map.entries())
      .map(([id, { name, total }]) => ({ id, name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP_N);
  }, [completed]);

  const periodSubtitle =
    range?.from && range?.to
      ? `${format(range.from, "dd/MM/yyyy", { locale: ptBR })} - ${format(range.to, "dd/MM/yyyy", { locale: ptBR })}`
      : "Selecione um período";

  const list = mode === "barbeiros" ? byBarber : byClient;
  const isEmpty = list.length === 0;

  return (
    <div className="stat-card animate-fade-in">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Ranking (faturamento)
          </h3>
          <p className="text-sm text-muted-foreground">{periodSubtitle}</p>
        </div>
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "barbeiros"}
            onClick={() => setMode("barbeiros")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              mode === "barbeiros"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Scissors className="h-4 w-4" />
            Barbeiros
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "clientes"}
            onClick={() => setMode("clientes")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              mode === "clientes"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <User className="h-4 w-4" />
            Clientes
          </button>
        </div>
      </div>
      {isLoading ? (
        <LoadingState />
      ) : !fromStr || !toStr ? (
        <EmptyState
          icon={<TrendingUp className="h-12 w-12" strokeWidth={1.5} />}
          title="Selecione um período"
          description="Escolha as datas no seletor acima para ver o ranking."
        />
      ) : isEmpty ? (
        <EmptyState
          icon={<TrendingUp className="h-12 w-12" strokeWidth={1.5} />}
          title={
            mode === "barbeiros"
              ? "Nenhum faturamento por barbeiro"
              : "Nenhum consumo por cliente"
          }
          description="Só entram agendamentos concluídos no período."
        />
      ) : (
        <div className="space-y-2">
          {list.map((item, i) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium text-muted-foreground w-5">
                  {i + 1}º
                </span>
                <span className="font-medium text-foreground truncate">
                  {item.name}
                </span>
              </div>
              <span className="text-sm font-semibold text-foreground shrink-0 ml-2">
                R$ {item.total.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
