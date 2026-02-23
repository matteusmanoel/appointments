import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function getLast7Days() {
  const to = new Date();
  const from = subDays(to, 6);
  return {
    from: format(from, "yyyy-MM-dd"),
    to: format(to, "yyyy-MM-dd"),
  };
}

type RangeValue = { from: Date | null; to: Date | null } | null;

interface RevenueChartProps {
  range?: RangeValue;
}

export function RevenueChart({ range }: RevenueChartProps) {
  const fallback = getLast7Days();
  const fromStr =
    range?.from && range?.to ? format(range.from, "yyyy-MM-dd") : fallback.from;
  const toStr =
    range?.from && range?.to ? format(range.to, "yyyy-MM-dd") : fallback.to;
  const periodSubtitle = React.useMemo(() => {
    if (range?.from && range?.to) {
      return `${format(range.from, "dd/MM/yyyy", { locale: ptBR })} - ${format(range.to, "dd/MM/yyyy", { locale: ptBR })} (concluídos)`;
    }
    return "Últimos 7 dias (concluídos)";
  }, [range]);
  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["reports", "revenue_by_day", fromStr, toStr],
    queryFn: () => reportsApi.revenueByDay({ from: fromStr, to: toStr }),
  });

  const data = rows.map((r) => {
    const d = new Date(r.date + "T12:00:00");
    const dayOfWeek = d.getDay();
    return {
      name: WEEKDAY_LABELS[dayOfWeek] ?? r.date,
      revenue: Number(r.revenue),
      appointments: r.appointments,
    };
  });

  if (error) {
    return (
      <div className="stat-card animate-fade-in">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground">
            Faturamento no Período
          </h3>
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
          <h3 className="text-lg font-semibold text-foreground">
            Faturamento no Período
          </h3>
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
        <h3 className="text-lg font-semibold text-foreground">
          Faturamento no Período
        </h3>
        <p className="text-sm text-muted-foreground">{periodSubtitle}</p>
      </div>
      <div className="h-64">
        {data.length === 0 ? (
          <EmptyState
            className="h-full"
            icon={<TrendingUp className="h-12 w-12" strokeWidth={1.5} />}
            title="Sem dados no período"
            description="Não há faturamento de atendimentos concluídos no intervalo."
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(160 45% 45%)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(160 45% 45%)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(210 15% 88%)"
                vertical={false}
              />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(220 10% 45%)", fontSize: 12 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(220 10% 45%)", fontSize: 12 }}
                tickFormatter={(value) => `R$${value}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(220 10% 96%)",
                  border: "1px solid hsl(220 10% 90%)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px hsl(220 30% 15% / 0.08)",
                }}
                formatter={(value: number) => [
                  `R$ ${value.toLocaleString("pt-BR")}`,
                  "Receita",
                ]}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(160 45% 45%)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorRevenue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
