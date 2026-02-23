import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { StatCard } from "@/components/dashboard/StatCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { AppointmentsList } from "@/components/dashboard/AppointmentsList";
import { RankingCard } from "@/components/dashboard/RankingCard";
import { TopServices } from "@/components/dashboard/TopServices";
import { Calendar, DollarSign, Users, TrendingUp, MessageCircle, AlertCircle } from "lucide-react";
import { useState } from "react";
import { startOfMonth } from "date-fns";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { appointmentsApi, barbershopsApi, barbersApi, servicesApi, whatsappApi, integrationsApi, reportsApi } from "@/lib/api";
import { getTimeSlotsForDay } from "@/lib/slots";
import { useAuth } from "@/contexts/AuthContext";
import { SetupChecklist } from "@/components/SetupChecklist";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const today = todayISO();
  const { data: barbershop } = useQuery({
    queryKey: ["barbershop"],
    queryFn: () => barbershopsApi.get(),
    retry: false,
    staleTime: 2 * 60 * 1000,
  });
  const { data: barbers = [] } = useQuery({
    queryKey: ["barbers"],
    queryFn: () => barbersApi.list(),
  });
  const { data: services = [] } = useQuery({
    queryKey: ["services"],
    queryFn: () => servicesApi.list(),
  });
  const { data: appointments = [] } = useQuery({
    queryKey: ["appointments", today],
    queryFn: () => appointmentsApi.list({ date: today }),
  });
  const { data: whatsapp } = useQuery({
    queryKey: ["whatsapp"],
    queryFn: () => whatsappApi.get(),
    retry: false,
    staleTime: 60 * 1000,
  });
  const { data: automationsSummary } = useQuery({
    queryKey: ["automations-summary"],
    queryFn: () => integrationsApi.getScheduledMessagesSummary(),
    retry: false,
    staleTime: 60 * 1000,
  });
  const { data: mvpMetrics } = useQuery({
    queryKey: ["reports", "mvp-metrics"],
    queryFn: () => reportsApi.mvpMetrics(),
    retry: false,
    staleTime: 2 * 60 * 1000,
  });
  const { profile } = useAuth();
  const greetingName = barbershop?.name?.trim() || "NavalhIA";
  const [range, setRange] = useState<{
    from: Date | null;
    to: Date | null;
  } | null>(() => {
    const now = new Date();
    return { from: startOfMonth(now), to: now };
  });

  const confirmed = appointments.filter(
    (a) => a.status === "confirmed" || a.status === "pending",
  );
  const completed = appointments.filter((a) => a.status === "completed");
  const revenueToday = completed.reduce((s, a) => s + Number(a.price), 0);
  const countToday = confirmed.length;

  // Taxa de ocupação: minutos agendados / capacidade em minutos (horário de funcionamento × barbeiros ativos)
  const todayDate = new Date();
  const openSlots = getTimeSlotsForDay(
    barbershop?.business_hours,
    todayDate,
  ).length;
  const activeBarbersCount = barbers.filter(
    (b) => b.status === "active" || b.status === "break",
  ).length;
  const capacityMinutes = openSlots * 30 * Math.max(1, activeBarbersCount);
  const bookedMinutes = appointments
    .filter((a) => ["pending", "confirmed", "completed"].includes(a.status))
    .reduce((sum, a) => sum + (a.duration_minutes ?? 0), 0);
  const occupancyPct =
    capacityMinutes > 0
      ? Math.min(100, Math.round((bookedMinutes / capacityMinutes) * 100))
      : 0;

  const setupLoading =
    barbershop === undefined ||
    (barbershop !== null && services === undefined);
  const setupError = barbershop === null;

  return (
    <div className="animate-fade-in">
      <SetupChecklist
        profile={profile}
        barbershop={barbershop ?? undefined}
        servicesCount={services.length}
        barbersCount={barbers.length}
        whatsappConnected={!!whatsapp?.connected}
        loading={setupLoading}
        error={setupError}
      />
      {/* Header */}
      <div className="page-header">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="page-title">Salve, {greetingName}! 👋</h1>
            <p className="page-subtitle">
              Agenda organizada para hoje. Você tem{" "}
              <span className="font-medium text-foreground">
                {countToday} atendimentos
              </span>{" "}
              confirmados.
            </p>
          </div>
          <div className="mt-2 w-full md:mt-0 md:w-auto">
            <DateRangePicker value={range} onChange={setRange} className="w-full md:w-auto" />
          </div>
        </div>
      </div>

      {/* Status: WhatsApp + Automações */}
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-border/50 bg-muted/30 p-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">WhatsApp:</span>
          <span className={whatsapp?.connected ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>
            {whatsapp?.connected ? "Conectado" : "Desconectado"}
          </span>
        </div>
        {(automationsSummary && (automationsSummary.queued > 0 || automationsSummary.failed > 0 || automationsSummary.skipped > 0)) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Automações:</span>
            <span>{automationsSummary.queued} na fila</span>
            {automationsSummary.failed > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <AlertCircle className="h-4 w-4" />
                {automationsSummary.failed} falhas
              </span>
            )}
            {automationsSummary.skipped > 0 && <span>{automationsSummary.skipped} ignoradas</span>}
          </div>
        )}
        {whatsapp && !whatsapp.connected && (
          <Link
            to="/configuracoes?tab=whatsapp"
            className="text-sm font-medium text-primary hover:underline"
          >
            Conectar WhatsApp →
          </Link>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Faturamento Hoje"
          value={`R$ ${revenueToday.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          subtitle={
            completed.length > 0
              ? `${completed.length} concluídos`
              : "Nenhum concluído ainda"
          }
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

      {/* MVP metrics: no-show, reminders, follow-ups */}
      {mvpMetrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="No-show (7 dias)"
            value={`${mvpMetrics.noShowRate7d}%`}
            subtitle="Últimos 7 dias"
            icon={<Users className="w-5 h-5" />}
          />
          <StatCard
            title="No-show (30 dias)"
            value={`${mvpMetrics.noShowRate30d}%`}
            subtitle="Últimos 30 dias"
            icon={<Users className="w-5 h-5" />}
          />
          <StatCard
            title="Lembretes"
            value={`${mvpMetrics.reminders.sent} enviados`}
            subtitle={`${mvpMetrics.reminders.failed} falhas · ${mvpMetrics.reminders.skipped} ignorados`}
            icon={<MessageCircle className="w-5 h-5" />}
          />
          <StatCard
            title="Follow-ups"
            value={`${mvpMetrics.followUps.sent} enviados`}
            subtitle={`${mvpMetrics.followUps.failed} falhas · ${mvpMetrics.followUps.skipped} ignorados`}
            icon={<MessageCircle className="w-5 h-5" />}
          />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <RevenueChart range={range} />
        <TopServices range={range} />
      </div>

      {/* Appointments + Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AppointmentsList range={range} />
        <RankingCard range={range} />
      </div>
    </div>
  );
}
