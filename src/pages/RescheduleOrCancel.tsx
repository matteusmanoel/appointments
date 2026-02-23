import { useState } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { publicApi, type PublicAppointment } from "@/lib/api";
import { getTimeSlotsForDay } from "@/lib/slots";
import { LoadingState } from "@/components/LoadingState";
import { DatePicker } from "@/components/ui/date-picker";
import { Clock, Scissors, ArrowLeft } from "lucide-react";

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isSlotOccupied(
  slotTime: string,
  occupied: Array<{ scheduled_time: string; duration_minutes: number }>,
  durationMinutes: number
): boolean {
  const slotStart = parseTime(slotTime);
  const slotEnd = slotStart + durationMinutes;
  for (const o of occupied) {
    const oStart = parseTime(String(o.scheduled_time).slice(0, 5));
    const oEnd = oStart + (o.duration_minutes ?? 30);
    if (slotStart < oEnd && slotEnd > oStart) return true;
  }
  return false;
}

export default function RescheduleOrCancel() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const isCancel = location.pathname.includes("/cancelar/");
  const queryClient = useQueryClient();

  const [selectedDate, setSelectedDate] = useState<Date>(() => addDays(new Date(), 1));
  const [selectedTime, setSelectedTime] = useState("");
  const [barberId, setBarberId] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [done, setDone] = useState<"cancelled" | "rescheduled" | null>(null);

  const {
    data: appointment,
    isLoading: loadingAppointment,
    error: errorAppointment,
  } = useQuery({
    queryKey: ["public", "appointment", token],
    queryFn: () => publicApi.getAppointmentByToken(token!),
    enabled: !!token,
  });

  const slug = appointment?.slug ?? null;
  const { data: barbershop } = useQuery({
    queryKey: ["public", "barbershop", slug],
    queryFn: () => publicApi.getBarbershop(slug!),
    enabled: !!slug && isCancel === false,
  });
  const { data: barbers = [] } = useQuery({
    queryKey: ["public", "barbers", slug],
    queryFn: () => publicApi.getBarbers(slug!),
    enabled: !!slug && isCancel === false,
  });
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const { data: availability = [] } = useQuery({
    queryKey: ["public", "availability", slug, dateStr],
    queryFn: () => publicApi.getAvailability(slug!, dateStr),
    enabled: !!slug && !!dateStr && isCancel === false,
  });

  const cancelMutation = useMutation({
    mutationFn: () => publicApi.cancelAppointmentByToken(token!),
    onSuccess: () => {
      setDone("cancelled");
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: () =>
      publicApi.rescheduleAppointmentByToken(token!, {
        scheduled_date: dateStr,
        scheduled_time: selectedTime,
        barber_id: barberId || undefined,
      }),
    onSuccess: () => {
      setDone("rescheduled");
      queryClient.invalidateQueries({ queryKey: ["public", "appointment", token] });
    },
  });

  const timeSlots = getTimeSlotsForDay(barbershop?.business_hours, selectedDate);
  const availabilityForBarber = barberId
    ? availability.filter((a) => a.barber_id === barberId)
    : availability;
  const availableSlots = appointment
    ? timeSlots.filter(
        (t) =>
          !isSlotOccupied(t, availabilityForBarber, appointment.duration_minutes)
      )
    : [];

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-muted-foreground">Link inválido.</p>
      </div>
    );
  }

  if (loadingAppointment || errorAppointment) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        {loadingAppointment && <LoadingState />}
        {errorAppointment && (
          <div className="text-center">
            <p className="text-destructive">Agendamento não encontrado ou já cancelado.</p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/">Voltar ao início</Link>
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!appointment) {
    return null;
  }

  if (done) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <p className="text-lg">
            {done === "cancelled"
              ? "Agendamento cancelado."
              : "Agendamento reagendado com sucesso."}
          </p>
          {appointment.slug && (
            <Button asChild>
              <Link to={`/b/${appointment.slug}`}>Fazer novo agendamento</Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link to="/">Voltar ao início</Link>
          </Button>
        </div>
      </div>
    );
  }

  const bookingLink = appointment.slug ? `/b/${appointment.slug}` : "/";

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to={bookingLink} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Voltar ao agendamento
          </Link>
        </Button>

        <div className="rounded-lg border bg-card p-4 space-y-2">
          <h1 className="font-semibold text-lg flex items-center gap-2">
            <Scissors className="h-5 w-5" />
            {appointment.barbershop_name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {appointment.service_names && `${appointment.service_names} — `}
            {format(new Date(appointment.scheduled_date + "T00:00:00"), "EEEE, d 'de' MMMM", {
              locale: ptBR,
            })}{" "}
            às {appointment.scheduled_time}
          </p>
        </div>

        {isCancel ? (
          <div className="space-y-4">
            {!cancelConfirm ? (
              <>
                <p className="text-muted-foreground text-sm">
                  Deseja cancelar este agendamento? Você poderá marcar outro horário depois.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setCancelConfirm(false)} asChild>
                    <Link to={bookingLink}>Não, voltar</Link>
                  </Button>
                  <Button variant="destructive" onClick={() => setCancelConfirm(true)}>
                    Sim, cancelar
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-sm">Tem certeza?</p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setCancelConfirm(false)}>
                    Voltar
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => cancelMutation.mutate()}
                    disabled={cancelMutation.isPending}
                  >
                    {cancelMutation.isPending ? "Cancelando…" : "Confirmar cancelamento"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="font-medium">Escolha nova data e horário</h2>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Data</label>
              <DatePicker
                value={selectedDate}
                onChange={(d) => d && setSelectedDate(d)}
                minDate={new Date(new Date().setHours(0, 0, 0, 0))}
                placeholder="Selecione a data"
                triggerVariant="verbose"
              />
            </div>

            {barbers.length > 1 && (
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Barbeiro (opcional)</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={barberId}
                  onChange={(e) => setBarberId(e.target.value)}
                >
                  <option value="">Qualquer</option>
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Horário</label>
              <div className="flex flex-wrap gap-2">
                {availableSlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum horário disponível nesta data.
                  </p>
                ) : (
                  availableSlots.map((t) => (
                    <Button
                      key={t}
                      type="button"
                      variant={selectedTime === t ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedTime(t)}
                    >
                      {t}
                    </Button>
                  ))
                )}
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => rescheduleMutation.mutate()}
              disabled={!selectedTime || rescheduleMutation.isPending}
            >
              {rescheduleMutation.isPending ? "Reagendando…" : "Confirmar reagendamento"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
