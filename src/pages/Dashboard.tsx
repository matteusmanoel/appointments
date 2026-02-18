import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { AppointmentsList } from "@/components/dashboard/AppointmentsList";
import { TopServices } from "@/components/dashboard/TopServices";
import {
  Calendar,
  DollarSign,
  Users,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { appointmentsApi, barbershopsApi, barbersApi } from "@/lib/api";
import { getTimeSlotsForDay } from "@/lib/slots";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const today = todayISO();
  const { data: barbershop } = useQuery({
    queryKey: ["barbershop"],
    queryFn: () => barbershopsApi.get(),
  });
  const { data: barbers = [] } = useQuery({
    queryKey: ["barbers"],
    queryFn: () => barbersApi.list(),
  });
  const { data: appointments = [] } = useQuery({
    queryKey: ["appointments", today],
    queryFn: () => appointmentsApi.list({ date: today }),
  });
  const greetingName = barbershop?.name?.trim() || "barbearia";
  const [range, setRange] = useState<{ from: Date | null; to: Date | null } | null>(null);

  const confirmed = appointments.filter((a) => a.status === "confirmed" || a.status === "pending");
  const completed = appointments.filter((a) => a.status === "completed");
  const revenueToday = completed.reduce((s, a) => s + Number(a.price), 0);
  const countToday = confirmed.length;

  // Taxa de ocupação: minutos agendados / capacidade em minutos (horário de funcionamento × barbeiros ativos)
  const todayDate = new Date();
  const openSlots = getTimeSlotsForDay(barbershop?.business_hours, todayDate).length;
  const activeBarbersCount = barbers.filter((b) => b.status === "active" || b.status === "break").length;
  const capacityMinutes = openSlots * 30 * Math.max(1, activeBarbersCount);
  const bookedMinutes = appointments
    .filter((a) => ["pending", "confirmed", "completed"].includes(a.status))
    .reduce((sum, a) => sum + (a.duration_minutes ?? 0), 0);
  const occupancyPct =
    capacityMinutes > 0
      ? Math.min(100, Math.round((bookedMinutes / capacityMinutes) * 100))
      : 0;

  return (
    <MainLayout>
      <div className="animate-fade-in">
        {/* Header */}
        <div className="page-header">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="page-title">Salve, {greetingName}! 👋</h1>
              <p className="page-subtitle">
                Agenda organizada para hoje. Você tem{" "}
                <span className="font-medium text-foreground">{countToday} atendimentos</span> confirmados.
              </p>
            </div>
            <div className="mt-2 md:mt-0">
              <DateRangePicker value={range} onChange={setRange} />
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Faturamento Hoje"
            value={`R$ ${revenueToday.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
            subtitle={completed.length > 0 ? `${completed.length} concluídos` : "Nenhum concluído ainda"}
            icon={<DollarSign className="w-6 h-6" />}
            variant="success"
          />
          <StatCard
            title="Agendamentos"
            value={String(countToday)}
            subtitle={`${appointments.filter((a) => a.status === "pending").length} pendentes`}
            icon={<Calendar className="w-6 h-6" />}
          />
          <StatCard
            title="Clientes Atendidos"
            value={String(completed.length)}
            subtitle="Hoje"
            icon={<Users className="w-6 h-6" />}
          />
          <StatCard
            title="Taxa de Ocupação"
            value={`${occupancyPct}%`}
            subtitle="Baseado na agenda de hoje"
            helpText="Minutos agendados hoje ÷ (horário de funcionamento × barbeiros ativos, em minutos)."
            icon={<TrendingUp className="w-6 h-6" />}
            variant="accent"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <RevenueChart range={range} />
          <TopServices range={range} />
        </div>

        {/* Appointments */}
        <div className="grid grid-cols-1 gap-6">
          <AppointmentsList range={range} />
        </div>
      </div>
    </MainLayout>
  );
}
