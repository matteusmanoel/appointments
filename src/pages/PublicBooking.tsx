import { useState, useEffect, useRef, type FocusEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays, startOfToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { publicApi } from "@/lib/api";
import { getTimeSlotsForDay, isPastDay, isSlotBookable, isSlotConflictError, type BarberSchedule } from "@/lib/slots";
import { formatPhoneAsTyped } from "@/lib/input-masks";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LoadingState } from "@/components/LoadingState";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Scissors,
  User,
  Calendar as CalendarIcon,
  Clock,
  MessageCircle,
  CalendarDays,
  CalendarClock,
  Ban,
  SendHorizontal,
} from "lucide-react";

function getWhatsAppUrl(phone: string | undefined, message?: string): string {
  if (!phone || !phone.trim()) return "#";
  const digits = phone.replace(/\D/g, "");
  const number = digits.startsWith("55") ? digits : `55${digits}`;
  if (!message || !message.trim()) return `https://wa.me/${number}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

const BOOKING_STEPS = [
  { id: "service", label: "Serviço", question: "Escolha o serviço.", incentive: "Pode marcar mais de um." },
  { id: "barber", label: "Barbeiro", question: "Escolha o barbeiro.", incentive: "Sem preferência também funciona." },
  { id: "time", label: "Horário", question: "Escolha o dia e o horário.", incentive: "Esse horário fica reservado para você." },
  { id: "name", label: "Nome", question: "Qual é o seu nome?", incentive: "É assim que a barbearia te chama." },
  { id: "phone", label: "Telefone", question: "Qual é o seu telefone?", incentive: "A confirmação chega por aqui." },
] as const;
const GENERIC_WHATSAPP_TEXT =
  "Olá, gostaria de agendar um horario. Quais são os serviços disponíveis?";
const GENERIC_WHATSAPP_TEXT_CONFIRMATION =
  "Olá, gostaria de confirmar meu agendamento.";
const ACTION_CARD =
  "flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left text-base font-medium text-white transition-colors hover:bg-white/10";

function AdvanceButton({
  typed,
  ready,
  pending,
  onAdvance,
}: {
  typed: boolean;
  ready: boolean;
  pending?: boolean;
  onAdvance: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Avançar"
      disabled={pending}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onAdvance}
      className={cn(
        "absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white transition-colors disabled:opacity-60",
        ready
          ? "checkout-send-pulse bg-primary shadow-[0_0_20px_hsl(239_84%_62%/0.7)]"
          : typed
            ? "bg-primary shadow-[0_0_16px_hsl(239_84%_62%/0.55)]"
            : "bg-white/10 text-white/35",
      )}
    >
      <SendHorizontal className="h-5 w-5" />
    </button>
  );
}

export default function PublicBooking() {
  const { slug } = useParams<{ slug: string }>();
  const [step, setStep] = useState(0);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [barberId, setBarberId] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    if (d.getHours() >= 20) return addDays(d, 1);
    return d;
  });
  const [selectedTime, setSelectedTime] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [success, setSuccess] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [intent, setIntent] = useState<"create" | "reschedule">("create");
  const [conflictNotice, setConflictNotice] = useState(false);
  const [publicToken, setPublicToken] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState("");
  const queryClient = useQueryClient();
  const [slideDir, setSlideDir] = useState<"next" | "prev">("next");
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    data: barbershop,
    isLoading: loadingShop,
    error: errorShop,
  } = useQuery({
    queryKey: ["public", "barbershop", slug],
    queryFn: () => publicApi.getBarbershop(slug!),
    enabled: !!slug,
  });
  const { data: services = [] } = useQuery({
    queryKey: ["public", "services", slug],
    queryFn: () => publicApi.getServices(slug!),
    enabled: !!slug,
  });
  const { data: barbers = [] } = useQuery({
    queryKey: ["public", "barbers", slug],
    queryFn: () => publicApi.getBarbers(slug!),
    enabled: !!slug,
  });
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const { data: availability = [] } = useQuery({
    queryKey: ["public", "availability", slug, dateStr],
    queryFn: () => publicApi.getAvailability(slug!, dateStr),
    enabled: !!slug && !!dateStr,
  });

  const onSlotConflict = (err: unknown) => {
    if (!isSlotConflictError(err)) return;
    setSelectedTime("");
    setConflictNotice(true);
    setStep(3);
    void queryClient.invalidateQueries({ queryKey: ["public", "availability", slug] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const totalDuration = serviceIds.reduce((acc, id) => {
        const s = services.find((x) => x.id === id);
        return acc + (s?.duration_minutes ?? 30);
      }, 0);
      const barberToUse = barberId || resolveBarberForSlot(selectedTime, totalDuration);
      if (!barberToUse) {
        throw Object.assign(new Error("Esse horário não está mais disponível."), { status: 409 });
      }
      await publicApi.createAppointment(slug!, {
        service_ids: serviceIds,
        barber_id: barberToUse,
        scheduled_date: dateStr,
        scheduled_time: selectedTime,
        client_name: clientName,
        client_phone: clientPhone,
      }).then((created) => setPublicToken(created?.public_token ?? null));
    },
    onSuccess: () => setSuccess(true),
    onError: onSlotConflict,
  });

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!publicToken) throw new Error("Agendamento não encontrado");
      const totalDuration = serviceIds.reduce((acc, id) => {
        const s = services.find((x) => x.id === id);
        return acc + (s?.duration_minutes ?? 30);
      }, 0);
      const barberToUse = barberId || resolveBarberForSlot(selectedTime, totalDuration);
      if (!barberToUse) {
        throw Object.assign(new Error("Esse horário não está mais disponível."), { status: 409 });
      }
      // O endpoint público só grava data, hora e barbeiro.
      await publicApi.rescheduleAppointmentByToken(publicToken, {
        scheduled_date: dateStr,
        scheduled_time: selectedTime,
        barber_id: barberToUse,
      });
    },
    onSuccess: () => setSuccess(true),
    onError: onSlotConflict,
  });

  const cancelMutation = useMutation({
    mutationFn: () => publicApi.cancelAppointmentByToken(publicToken!),
    onSuccess: () => {
      setCancelOpen(false);
      setSuccess(false);
      setCancelled(true);
    },
  });

  const { reset: resetCreate } = createMutation;
  const { reset: resetReschedule } = rescheduleMutation;
  useEffect(() => {
    if (step !== 5) {
      resetCreate();
      resetReschedule();
    }
  }, [step, resetCreate, resetReschedule]);
  const actionError = createMutation.isError
    ? createMutation.error
    : rescheduleMutation.isError
      ? rescheduleMutation.error
      : null;
  const showActionError = actionError != null && !isSlotConflictError(actionError);
  const submitting = createMutation.isPending || rescheduleMutation.isPending;

  const timeSlots = getTimeSlotsForDay(
    barbershop?.business_hours,
    selectedDate,
  );

  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const previous = meta?.getAttribute("content") ?? "";
    if (meta) {
      meta.setAttribute(
        "content",
        "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
      );
    }
    const blockGesture = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", blockGesture, { passive: false });
    document.addEventListener("gesturechange", blockGesture, { passive: false });
    return () => {
      if (meta) meta.setAttribute("content", previous);
      document.removeEventListener("gesturestart", blockGesture);
      document.removeEventListener("gesturechange", blockGesture);
    };
  }, []);

  useEffect(() => {
    if (timeSlots.length === 0) setSelectedTime("");
  }, [timeSlots.length]);

  useEffect(() => {
    if (step !== 4 && step !== 5) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [step]);

  const serviceKey = serviceIds.join(",");
  useEffect(() => {
    setSelectedTime("");
  }, [dateStr, barberId, serviceKey]);

  const selectedDuration = serviceIds.reduce((acc, id) => {
    const sv = services.find((x) => x.id === id);
    return acc + (sv?.duration_minutes ?? 30);
  }, 0) || 30;
  const bookableFor = (barber: { id: string; schedule?: BarberSchedule }, t: string) =>
    isSlotBookable({
      slot: t,
      date: selectedDate,
      durationMinutes: selectedDuration,
      occupied: availability.filter((x) => x.barber_id === barber.id),
      barberSchedule: barber.schedule,
    });
  const availableSlots = barberId
    ? timeSlots.filter((t) => {
        const b = barbers.find((x) => x.id === barberId);
        return b ? bookableFor(b, t) : false;
      })
    : timeSlots.filter((t) => barbers.some((b) => bookableFor(b, t)));

  function resolveBarberForSlot(slotTime: string, _durationMinutes: number): string | null {
    const b = barbers.find((x) => bookableFor(x, slotTime));
    return b?.id ?? null;
  }

  if (!slug) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-muted-foreground">Link inválido.</p>
      </div>
    );
  }
  if (errorShop || (barbershop === undefined && !loadingShop)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-destructive">NavalhIA não encontrada.</p>
      </div>
    );
  }
  if (loadingShop || !barbershop) {
    return <LoadingState fullPage />;
  }

  const startReschedule = () => {
    setFieldError("");
    setConflictNotice(false);
    setSlideDir("prev");
    setIntent("reschedule");
    setSuccess(false);
    setStep(1);
  };

  const whatsappConfirmUrl = getWhatsAppUrl(
    barbershop.phone,
    GENERIC_WHATSAPP_TEXT_CONFIRMATION,
  );

  if (cancelled) {
    return (
      <div className="flex h-dvh touch-manipulation flex-col items-center justify-center bg-[#0e0e0e] px-4 text-center text-white">
        <div className="w-full max-w-md">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
            <Check className="h-8 w-8 text-white" />
          </div>
          <h2 className="font-display text-xl font-semibold">Agendamento cancelado</h2>
          <p className="mt-2 text-sm text-white/55">O horário foi liberado.</p>
          {barbershop.phone ? (
            <a href={whatsappConfirmUrl} target="_blank" rel="noopener noreferrer" className={cn(ACTION_CARD, "mt-6")}>
              <MessageCircle className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              WhatsApp
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex h-dvh touch-manipulation flex-col items-center justify-center bg-[#0e0e0e] px-4 text-center text-white">
        <div className="w-full max-w-md">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/20">
            <Check className="h-8 w-8 text-success" />
          </div>
          <h2 className="font-display text-xl font-semibold">Agendamento solicitado!</h2>
          <p className="mt-2 text-sm text-white/55">
            Você receberá uma confirmação em breve. Status: Pendente.
          </p>
          <p className="mt-4 text-sm text-white">
            {format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR })} às {selectedTime}
          </p>
          <p className="mt-1 text-sm text-white/55">{barbershop.name}</p>
          <div className="mt-6 space-y-3 text-left">
            {publicToken ? (
              <>
                <button type="button" onClick={startReschedule} className={ACTION_CARD}>
                  <CalendarClock className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  Reagendar
                </button>
                <button type="button" onClick={() => setCancelOpen(true)} className={ACTION_CARD}>
                  <Ban className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  Cancelar
                </button>
              </>
            ) : null}
            {barbershop.phone ? (
              <a href={whatsappConfirmUrl} target="_blank" rel="noopener noreferrer" className={ACTION_CARD}>
                <MessageCircle className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                WhatsApp
              </a>
            ) : (
              <p className="text-center text-sm text-white/55">A barbearia vai confirmar o seu horário.</p>
            )}
          </div>
        </div>
        <Dialog
          open={cancelOpen}
          onOpenChange={(open) => {
            setCancelOpen(open);
            if (!open) cancelMutation.reset();
          }}
        >
          <DialogContent className="border-white/10 bg-[#14141c] text-white">
            <DialogHeader>
              <DialogTitle>Cancelar este horário?</DialogTitle>
              <DialogDescription className="text-white/60">
                Essa ação não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            {cancelMutation.isError && (
              <p role="alert" className="text-sm text-red-400">
                {cancelMutation.error instanceof Error
                  ? cancelMutation.error.message
                  : "Não foi possível cancelar."}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="flex-1 rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {cancelMutation.isPending ? "Cancelando..." : "Cancelar horário"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const selectedServices = serviceIds
    .map((id) => services.find((s) => s.id === id))
    .filter(Boolean) as typeof services;
  const selectedBarber = barbers.find((b) => b.id === barberId);
  const totalPrice = selectedServices.reduce(
    (sum, s) => sum + Number(s.price),
    0,
  );
  const buildConfirmationWhatsAppText = () => {
    const servicesLines =
      selectedServices.length > 0
        ? selectedServices.map((s) => {
            const price = Number(s.price).toFixed(2).replace(".", ",");
            return `• ${s.name} — R$ ${price}`;
          })
        : ["• (nenhum serviço selecionado)"];
    const total = totalPrice.toFixed(2).replace(".", ",");
    const barber = selectedBarber?.name ?? "Não tenho preferência";
    const dateLabel = format(selectedDate, "dd/MM/yyyy", { locale: ptBR });
    const weekday = format(selectedDate, "EEEE", { locale: ptBR });
    const phoneLabel = clientPhone.trim() ? formatPhoneAsTyped(clientPhone) : "—";
    const nameLabel = clientName?.trim() ? clientName.trim() : "—";

    return [
      `Salve! Gostaria de confirmar meu agendamento na ${barbershop.name}.`,
      "",
      "*Serviços:*",
      ...servicesLines,
      "",
      `*Data:* ${dateLabel} (${weekday})`,
      `*Horário:* ${selectedTime || "—"}`,
      `*Barbeiro:* ${barber}`,
      "",
      `*Cliente:* ${nameLabel}`,
      `*Telefone:* ${phoneLabel}`,
      "",
      `*Total:* R$ ${total}`,
    ].join("\n");
  };
  const whatsappText =
    step >= 4 ? buildConfirmationWhatsAppText() : GENERIC_WHATSAPP_TEXT;
  const whatsappUrl = getWhatsAppUrl(barbershop.phone, whatsappText);

  const bookingStep = step > 0 ? BOOKING_STEPS[step - 1] : null;
  const progress = step === 0 ? 0 : (step / BOOKING_STEPS.length) * 100;
  const money = (value: number) => value.toFixed(2).replace(".", ",");

  const goTo = (next: number) => {
    setFieldError("");
    setSlideDir(next > step ? "next" : "prev");
    setStep(next);
  };

  const validateBookingStep = (): string => {
    if (step === 1 && serviceIds.length === 0) return "Escolha pelo menos um serviço";
    if (step === 3 && (!selectedTime || timeSlots.length === 0)) return "Escolha um horário";
    if (step === 4 && !clientName.trim()) return "Nome é obrigatório";
    if (step === 5) {
      const digits = clientPhone.replace(/\D/g, "");
      if (!digits) return "Telefone é obrigatório";
      if (digits.length < 10) return "Telefone deve ter pelo menos 10 dígitos";
    }
    return "";
  };

  const continueBooking = () => {
    const message = validateBookingStep();
    setFieldError(message);
    if (message) {
      inputRef.current?.focus();
      return;
    }
    if (step < BOOKING_STEPS.length) goTo(step + 1);
  };

  const submitBooking = () => {
    const message = validateBookingStep();
    setFieldError(message);
    if (message) {
      inputRef.current?.focus();
      return;
    }
    if (intent === "reschedule" && publicToken) {
      rescheduleMutation.mutate();
      return;
    }
    createMutation.mutate();
  };

  const phoneDigits = clientPhone.replace(/\D/g, "");

  const holdFieldFocus = (e: FocusEvent<HTMLInputElement>) => {
    const next = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    if (next?.closest("button, a")) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const choiceShell = (selected: boolean) =>
    cn(
      "relative flex min-h-[4.25rem] w-full flex-1 rounded-2xl text-left transition-all duration-200 [container-type:size]",
      selected
        ? "bg-gradient-to-b from-primary via-violet-500 to-violet-300 p-1 shadow-[0_0_32px_hsl(262_83%_58%/0.5)]"
        : "bg-white/10 p-px hover:bg-white/20",
    );
  const choiceBody =
    "flex h-full min-h-0 w-full items-center overflow-hidden rounded-2xl bg-[#101014] px-[clamp(0.85rem,4cqw,1.15rem)]";
  const choiceIcon = "h-[clamp(1.15rem,18cqh,1.5rem)] w-[clamp(1.15rem,18cqh,1.5rem)] shrink-0 text-primary";
  const choiceTitle = "block truncate font-medium leading-tight text-[clamp(1rem,12cqh,1.25rem)]";
  const choiceMeta = "mt-[0.15em] block truncate leading-tight text-[clamp(0.8rem,9cqh,0.95rem)] text-white/45";
  const choiceList =
    "mt-[clamp(0.6rem,1.6dvh,1.1rem)] flex min-h-0 flex-1 flex-col gap-[clamp(0.45rem,1.2dvh,0.8rem)] overflow-y-auto overscroll-contain pb-2";

  return (
    <div className="flex h-dvh touch-manipulation flex-col overflow-hidden bg-[#0e0e0e] text-white">
      <header className="shrink-0">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <h1 className="truncate font-display text-lg font-semibold">{barbershop.name}</h1>
          {barbershop.phone ? (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm text-white/55 hover:text-white"
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </a>
          ) : null}
        </div>
        <div
          className="h-0.5 bg-white/10"
          {...(step > 0
            ? {
                role: "progressbar" as const,
                "aria-valuemin": 1,
                "aria-valuemax": BOOKING_STEPS.length,
                "aria-valuenow": step,
                "aria-valuetext": `Etapa ${step} de ${BOOKING_STEPS.length}: ${bookingStep?.label ?? ""}`,
              }
            : { "aria-hidden": true })}
        >
          <div
            className="h-full bg-gradient-to-r from-primary to-violet-400 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4">
        {step === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-md space-y-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
                <Scissors className="h-7 w-7 text-primary" />
              </div>
              <div className="space-y-2">
                <h2 className="font-display text-3xl font-bold">{barbershop.name}</h2>
                <p className="text-sm text-white/55">Agende seu horário em poucos passos.</p>
                {barbershop.address?.trim() ? (
                  <p className="pt-2 text-xs text-white/40">{barbershop.address}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => goTo(1)}
                className="lp-shimmer group relative w-full overflow-hidden rounded-2xl bg-primary py-4 text-lg font-bold text-white shadow-[0_0_32px_hsl(239_84%_62%/0.4)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_48px_hsl(239_84%_62%/0.6)]"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-primary to-violet-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <span className="relative z-10">Começar</span>
              </button>
            </div>
          </div>
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (step === 5) {
                submitBooking();
                return;
              }
              continueBooking();
            }}
          >
            <div
              key={bookingStep?.id}
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                slideDir === "next" ? "checkout-step-next" : "checkout-step-prev",
              )}
            >
              <div className="shrink-0 pt-[clamp(0.85rem,2.4dvh,1.5rem)]">
                <h2 className="font-display font-bold leading-tight text-[clamp(1.4rem,4.4dvh,2.15rem)]">{bookingStep?.question}</h2>
                <p className="mt-[clamp(0.25rem,1dvh,0.5rem)] text-[clamp(0.8rem,2.1dvh,1rem)] text-white/55">{bookingStep?.incentive}</p>
              </div>

              {step >= 4 && (
                <aside className="mt-4 shrink-0 rounded-2xl border border-white/10 bg-[#14141c] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/70">RESUMO</p>
                    <p className="font-display text-lg font-bold">
                      {selectedServices.length > 0 ? `R$ ${money(totalPrice)}` : "—"}
                    </p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex items-center gap-2 text-white/45"><Scissors className="h-4 w-4" /> Serviço</span>
                      <span className={cn("line-clamp-2 text-right", selectedServices.length ? "text-white" : "text-white/25")}>
                        {selectedServices.length ? selectedServices.map((s) => s.name).join(", ") : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-white/45"><User className="h-4 w-4" /> Barbeiro</span>
                      <span className="text-white">{selectedBarber?.name ?? "Sem preferência"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-white/45"><CalendarDays className="h-4 w-4" /> Data</span>
                      <span className="text-white">{format(selectedDate, "d 'de' MMMM", { locale: ptBR })}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-white/45"><Clock className="h-4 w-4" /> Horário</span>
                      <span className={cn(selectedTime ? "text-white" : "text-white/25")}>{selectedTime || "—"}</span>
                    </div>
                  </div>
                </aside>
              )}

                {step === 1 && (
                  <div className={choiceList}>
                    {services.length === 0 ? (
                      <p className="text-sm text-white/45">Nenhum serviço disponível.</p>
                    ) : (
                      services.map((s) => {
                        const selected = serviceIds.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setServiceIds((prev) =>
                                selected ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                              );
                              setFieldError("");
                            }}
                            aria-pressed={selected}
                            className={choiceShell(selected)}
                          >
                            <span className={choiceBody}>
                              <span className="flex min-w-0 items-center gap-[clamp(0.5rem,3cqw,0.85rem)]">
                                <Scissors className={choiceIcon} />
                                <span className="min-w-0">
                                  <span className={choiceTitle}>{s.name}</span>
                                  <span className={choiceMeta}>
                                    R$ {money(Number(s.price))} · {s.duration_minutes} min
                                  </span>
                                </span>
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {step === 2 && (
                  <div className={choiceList}>
                    <button type="button" aria-pressed={barberId === ""} onClick={() => setBarberId("")} className={choiceShell(barberId === "")}>
                      <span className={choiceBody}>
                        <span className="flex min-w-0 items-center gap-[clamp(0.5rem,3cqw,0.85rem)]">
                          <User className={choiceIcon} />
                          <span className={choiceTitle}>Não tenho preferência</span>
                        </span>
                      </span>
                    </button>
                    {barbers.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={b.id === barberId}
                        onClick={() => setBarberId(b.id)}
                        className={choiceShell(b.id === barberId)}
                      >
                        <span className={choiceBody}>
                          <span className="flex min-w-0 items-center gap-[clamp(0.5rem,3cqw,0.85rem)]">
                            <User className={choiceIcon} />
                            <span className={choiceTitle}>{b.name}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {step === 3 && (
                  <TooltipProvider delayDuration={0}>
                    <div className="mt-[clamp(0.6rem,1.6dvh,1.1rem)] flex min-h-0 flex-1 flex-col [container-type:size]">
                      <div className="flex shrink-0 items-center gap-[clamp(0.4rem,1.2cqh,0.7rem)]">
                        <button
                          type="button"
                          onClick={() => setSelectedDate((d) => addDays(d, -1))}
                          disabled={isPastDay(addDays(selectedDate, -1))}
                          aria-label="Dia anterior"
                          className="flex aspect-square h-[clamp(2.75rem,8cqh,3.75rem)] w-auto items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white/5"
                        >
                          <ChevronLeft className="h-[clamp(1rem,3.2cqh,1.4rem)] w-[clamp(1rem,3.2cqh,1.4rem)]" />
                        </button>
                        <DatePicker
                          value={selectedDate}
                          onChange={(d) => d && setSelectedDate(d)}
                          minDate={startOfToday()}
                          triggerVariant="verbose"
                          className="h-[clamp(2.75rem,8cqh,3.75rem)] flex-1 justify-center rounded-xl border-white/15 bg-white/5 text-[clamp(0.95rem,3.2cqh,1.25rem)] text-white hover:bg-white/10 [&_svg]:h-[clamp(1rem,3.2cqh,1.4rem)] [&_svg]:w-[clamp(1rem,3.2cqh,1.4rem)]"
                        />
                        <button
                          type="button"
                          onClick={() => setSelectedDate((d) => addDays(d, 1))}
                          aria-label="Próximo dia"
                          className="flex aspect-square h-[clamp(2.75rem,8cqh,3.75rem)] w-auto items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white/5"
                        >
                          <ChevronRight className="h-[clamp(1rem,3.2cqh,1.4rem)] w-[clamp(1rem,3.2cqh,1.4rem)]" />
                        </button>
                      </div>
                      {conflictNotice && (
                        <p role="alert" className="mt-4 shrink-0 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                          Esse horário acabou de ser ocupado por outra pessoa. Escolha outro horário abaixo.
                        </p>
                      )}
                      {timeSlots.length === 0 ? (
                        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-8 text-white/45">
                          <CalendarIcon className="h-12 w-12" strokeWidth={1.5} />
                          <p className="text-sm">Fechado neste dia.</p>
                        </div>
                      ) : (
                        <div className="mt-[clamp(0.5rem,1.6cqh,1rem)] grid min-h-0 flex-1 auto-rows-[minmax(3rem,1fr)] grid-cols-3 gap-[clamp(0.4rem,1.4cqh,0.8rem)] overflow-y-auto overscroll-contain pb-2 sm:grid-cols-4">
                          {timeSlots.map((t) => {
                            const available = availableSlots.includes(t);
                            const barberName = selectedBarber?.name ?? "barbeiro";
                            if (!available) {
                              return (
                                <Tooltip key={t}>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex h-full min-h-12 cursor-not-allowed items-center justify-center rounded-xl border border-white/10 bg-white/5 px-2 text-white/30 [container-type:size]">
                                      <span className="text-[clamp(1rem,42cqh,1.75rem)] leading-none">{t}</span>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Horário indisponível para o barbeiro {barberName}
                                  </TooltipContent>
                                </Tooltip>
                              );
                            }
                            const selected = selectedTime === t;
                            return (
                              <button
                                key={t}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => {
                                  setSelectedTime(t);
                                  setConflictNotice(false);
                                  setFieldError("");
                                }}
                                className={cn(
                                  "flex h-full min-h-12 items-center justify-center rounded-xl px-2 font-medium [container-type:size]",
                                  selected
                                    ? "bg-gradient-to-r from-primary to-violet-500 text-white shadow-[0_0_20px_hsl(239_84%_62%/0.45)]"
                                    : "border border-white/15 bg-white/5 text-white hover:border-primary/60",
                                )}
                              >
                                <span className="text-[clamp(1rem,42cqh,1.75rem)] leading-none">{t}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </TooltipProvider>
                )}

                {step === 4 && (
                  <div className="relative mt-6 shrink-0">
                    <Label htmlFor="booking-name" className="sr-only">Nome</Label>
                    <Input
                      ref={inputRef}
                      id="booking-name"
                      value={clientName}
                      onChange={(e) => {
                        setClientName(e.target.value);
                        setFieldError("");
                      }}
                      onBlur={holdFieldFocus}
                      placeholder="Seu nome"
                      autoComplete="name"
                      aria-invalid={!!fieldError}
                      className="h-14 rounded-xl border-white/15 bg-white/5 px-4 pr-16 text-lg text-white placeholder:text-white/30 focus-visible:ring-primary focus-visible:ring-offset-0 md:text-lg"
                    />
                    <AdvanceButton
                      typed={clientName.trim().length > 0}
                      ready={clientName.trim().length > 0}
                      pending={submitting}
                      onAdvance={continueBooking}
                    />
                  </div>
                )}

                {step === 5 && (
                  <div className="relative mt-6 shrink-0">
                    <Label htmlFor="booking-phone" className="sr-only">Telefone</Label>
                    <Input
                      ref={inputRef}
                      id="booking-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={clientPhone}
                      onChange={(e) => {
                        setClientPhone(formatPhoneAsTyped(e.target.value));
                        setFieldError("");
                      }}
                      onBlur={holdFieldFocus}
                      placeholder="(11) 98765-4321"
                      aria-invalid={!!fieldError}
                      className="h-14 rounded-xl border-white/15 bg-white/5 px-4 pr-16 text-lg text-white placeholder:text-white/30 focus-visible:ring-primary focus-visible:ring-offset-0 md:text-lg"
                    />
                    <AdvanceButton
                      typed={phoneDigits.length > 0}
                      ready={phoneDigits.length >= 10}
                      pending={submitting}
                      onAdvance={submitBooking}
                    />
                  </div>
                )}

                {fieldError && (
                  <p className="mt-3 shrink-0 text-center text-sm text-red-400" role="alert">{fieldError}</p>
                )}
                {showActionError && step === 5 && (
                  <p className="mt-3 shrink-0 text-center text-sm text-red-400" role="alert">
                    {actionError instanceof Error ? actionError.message : "Erro ao agendar."}
                  </p>
                )}
            </div>

            <div className="flex shrink-0 items-center gap-3 border-t border-white/10 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => goTo(step - 1)}
                className="rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={submitting}
                onMouseDown={(e) => {
                  if (step === 4 || step === 5) e.preventDefault();
                }}
                className="lp-shimmer group relative flex-1 overflow-hidden rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-[0_0_20px_hsl(239_84%_62%/0.4)] transition-all duration-300 hover:shadow-[0_0_48px_hsl(239_84%_62%/0.7)] disabled:opacity-60"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-primary to-violet-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <span className="relative z-10">
                  {submitting ? "Enviando..." : step === 5 ? "Confirmar" : "Continuar"}
                </span>
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
