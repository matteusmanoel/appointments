import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { BarChart2 } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import * as React from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

function getMonthRange() {
  const now = new Date();
  return {
    from: format(startOfMonth(now), "yyyy-MM-dd"),
    to: format(endOfMonth(now), "yyyy-MM-dd"),
  };
}

type RangeValue = { from: Date | null; to: Date | null } | null;

interface TopServicesProps {
  range?: RangeValue;
}

export function TopServices({ range }: TopServicesProps) {
  const fallback = getMonthRange();
  const fromStr =
    range?.from && range?.to
      ? format(range.from, "yyyy-MM-dd")
      : fallback.from;
  const toStr =
    range?.from && range?.to
      ? format(range.to, "yyyy-MM-dd")
      : fallback.to;
  const periodSubtitle = React.useMemo(() => {
    if (range?.from && range?.to) {
      return `${format(range.from, "dd/MM/yyyy", { locale: ptBR })} - ${format(range.to, "dd/MM/yyyy", { locale: ptBR })} (concluídos)`;
    }
    return "Mês atual (concluídos)";
  }, [range]);
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["reports", "top_services", fromStr, toStr],
    queryFn: () => reportsApi.topServices({ from: fromStr, to: toStr, limit: 5 }),
  });

  const data = rows.map((r) => ({
    name: r.service_name,
    count: r.count,
    revenue: Number(r.revenue),
  }));

  if (error) {
    return (
      <div className="stat-card animate-fade-in">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground">Serviços no Período</h3>
          <p className="text-sm text-muted-foreground">{periodSubtitle}</p>
        </div>
        <p className="text-sm text-destructive">Erro ao carregar relatório.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="stat-card animate-fade-in">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground">Serviços no Período</h3>
          <p className="text-sm text-muted-foreground">{periodSubtitle}</p>
        </div>
        <div className="h-64 flex items-center justify-center">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="stat-card animate-fade-in">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground">Serviços no Período</h3>
        <p className="text-sm text-muted-foreground">{periodSubtitle}</p>
      </div>
      <div className="h-64">
        {data.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <BarChart2 className="h-12 w-12" strokeWidth={1.5} />
            <p className="text-sm">Sem dados no período.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(210 15% 88%)" horizontal={true} vertical={false} />
              <XAxis
                type="number"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(220 10% 45%)", fontSize: 12 }}
              />
              <YAxis
                type="category"
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(220 10% 45%)", fontSize: 12 }}
                width={100}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(220 10% 96%)",
                  border: "1px solid hsl(220 10% 90%)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px hsl(220 30% 15% / 0.08)",
                }}
                formatter={(value: number, name: string) => {
                  if (name === "count") return [value, "Atendimentos"];
                  return [`R$ ${value.toLocaleString("pt-BR")}`, "Receita"];
                }}
              />
              <Bar
                dataKey="count"
                fill="hsl(160 45% 45%)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
