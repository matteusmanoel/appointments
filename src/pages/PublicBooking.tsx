import { useState, useEffect, useRef, type FocusEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays, startOfToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [conflictNotice, setConflictNotice] = useState(false);
  const [publicToken, setPublicToken] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<"reschedule" | "cancel" | "error" | null>(null);
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
    onError: (err) => {
      if (isSlotConflictError(err)) {
        setSelectedTime("");
        setConflictNotice(true);
        setStep(3);
        void queryClient.invalidateQueries({ queryKey: ["public", "availability", slug] });
      }
    },
  });

  const { reset: resetCreate } = createMutation;
  useEffect(() => {
    if (step !== 5) resetCreate();
  }, [step, resetCreate]);
  const showCreateError = createMutation.isError && !isSlotConflictError(createMutation.error);

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
    return () => {
      if (meta) meta.setAttribute("content", previous);
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

  const copyManageLink = async (kind: "reschedule" | "cancel") => {
    if (!publicToken) return;
    try {
      const path = kind === "reschedule" ? "reagendar" : "cancelar";
      await navigator.clipboard.writeText(`${window.location.origin}/${path}/${publicToken}`);
      setCopiedLink(kind);
    } catch {
      setCopiedLink("error");
    }
  };

  if (success) {
    const whatsappUrl = getWhatsAppUrl(
      barbershop.phone,
      GENERIC_WHATSAPP_TEXT_CONFIRMATION,
    );
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <div className="stat-card max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Agendamento solicitado!
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Você receberá uma confirmação em breve. Status: Pendente.
          </p>
          <p className="text-sm text-foreground">
            {format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR })} às{" "}
            {selectedTime}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {barbershop.name}
          </p>
          {publicToken && (
            <div className="mt-4 space-y-2 rounded-xl border border-white/10 bg-white/5 p-3 text-left" data-testid="links-gerenciar">
              <p className="text-sm font-medium text-foreground">Precisa mudar ou cancelar?</p>
              <p className="text-xs text-muted-foreground">
                Guarde estes links: cancelamento e reagendamento valem até 2 horas antes do horário.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/reagendar/${publicToken}`}>Reagendar</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/cancelar/${publicToken}`}>Cancelar</Link>
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => void copyManageLink("reschedule")}>
                  Copiar link de reagendar
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => void copyManageLink("cancel")}>
                  Copiar link de cancelar
                </Button>
              </div>
              <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground" data-testid="copy-feedback">
                {copiedLink === "reschedule" && "Link de reagendar copiado."}
                {copiedLink === "cancel" && "Link de cancelar copiado."}
                {copiedLink === "error" && "Não foi possível copiar. Use os botões Reagendar e Cancelar acima e guarde o endereço da página."}
              </p>
            </div>
          )}
          <div className="mt-4 space-y-2">
            {barbershop.phone ? (
              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white"
                asChild
              >
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Retornar para o WhatsApp
                </a>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">A barbearia vai confirmar o seu horário.</p>
            )}
          </div>
        </div>
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
      "🧾 Serviços:",
      ...servicesLines,
      "",
      `📅 Data: ${dateLabel} (${weekday})`,
      `🕒 Horário: ${selectedTime || "—"}`,
      `💈 Barbeiro: ${barber}`,
      "",
      `👤 Cliente: ${nameLabel}`,
      `📞 Telefone: ${phoneLabel}`,
      "",
      `💰 Total: R$ ${total}`,
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

  const holdFieldFocus = (e: FocusEvent<HTMLInputElement>) => {
    const next = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    if (next?.closest("button, a")) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const choiceShell = (selected: boolean) =>
    cn(
      "relative w-full rounded-2xl text-left transition-all duration-200",
      selected
        ? "bg-gradient-to-b from-primary via-violet-500 to-violet-300 p-1 shadow-[0_0_32px_hsl(262_83%_58%/0.5)]"
        : "bg-white/10 p-px hover:bg-white/20",
    );

  return (
    <div className="flex min-h-screen flex-col bg-[#0e0e0e] text-white">
      <header className="border-b border-white/10 px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
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
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 lg:py-10">
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
                const message = validateBookingStep();
                setFieldError(message);
                if (message) {
                  inputRef.current?.focus();
                  return;
                }
                createMutation.mutate();
                return;
              }
              continueBooking();
            }}
          >
            <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
              <div className={slideDir === "next" ? "checkout-step-next" : "checkout-step-prev"}>
                <h2 className="font-display text-2xl font-bold sm:text-3xl">{bookingStep?.question}</h2>
                <p className="mt-2 text-sm text-white/55">{bookingStep?.incentive}</p>

                {step === 1 && (
                  <div className="mt-6 space-y-3">
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
                            className={choiceShell(selected)}
                          >
                            <span className="flex items-center justify-between gap-3 rounded-2xl bg-[#101014] px-4 py-3.5">
                              <span className="flex items-center gap-3">
                                <Scissors className="h-5 w-5 text-primary" />
                                <span>
                                  <span className="block font-medium text-white">{s.name}</span>
                                  <span className="text-sm text-white/45">
                                    R$ {money(Number(s.price))} · {s.duration_minutes} min
                                  </span>
                                </span>
                              </span>
                              {selected && <Check className="h-5 w-5 text-primary" />}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {step === 2 && (
                  <div className="mt-6 space-y-3">
                    <button type="button" onClick={() => setBarberId("")} className={choiceShell(barberId === "")}>
                      <span className="flex items-center justify-between gap-3 rounded-2xl bg-[#101014] px-4 py-3.5">
                        <span className="flex items-center gap-3">
                          <User className="h-5 w-5 text-primary" />
                          <span className="font-medium">Não tenho preferência</span>
                        </span>
                        {barberId === "" && <Check className="h-5 w-5 text-primary" />}
                      </span>
                    </button>
                    {barbers.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBarberId(b.id)}
                        className={choiceShell(b.id === barberId)}
                      >
                        <span className="flex items-center justify-between gap-3 rounded-2xl bg-[#101014] px-4 py-3.5">
                          <span className="flex items-center gap-3">
                            <User className="h-5 w-5 text-primary" />
                            <span className="font-medium">{b.name}</span>
                          </span>
                          {barberId === b.id && <Check className="h-5 w-5 text-primary" />}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {step === 3 && (
                  <TooltipProvider delayDuration={0}>
                    <div className="mt-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedDate((d) => addDays(d, -1))}
                          disabled={isPastDay(addDays(selectedDate, -1))}
                          aria-label="Dia anterior"
                          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white/5"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <DatePicker
                          value={selectedDate}
                          onChange={(d) => d && setSelectedDate(d)}
                          minDate={startOfToday()}
                          triggerVariant="verbose"
                          className="h-11 flex-1 justify-center rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                        />
                        <button
                          type="button"
                          onClick={() => setSelectedDate((d) => addDays(d, 1))}
                          aria-label="Próximo dia"
                          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white/5"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                      {conflictNotice && (
                        <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                          Esse horário acabou de ser ocupado por outra pessoa. Escolha outro horário abaixo.
                        </p>
                      )}
                      {timeSlots.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-8 text-white/45">
                          <CalendarIcon className="h-12 w-12" strokeWidth={1.5} />
                          <p className="text-sm">Fechado neste dia.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                          {timeSlots.map((t) => {
                            const available = availableSlots.includes(t);
                            const barberName = selectedBarber?.name ?? "barbeiro";
                            if (!available) {
                              return (
                                <Tooltip key={t}>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-base text-white/30">
                                      {t}
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
                                onClick={() => {
                                  setSelectedTime(t);
                                  setConflictNotice(false);
                                  setFieldError("");
                                }}
                                className={cn(
                                  "min-h-11 rounded-xl px-3 py-3 text-base font-medium",
                                  selected
                                    ? "bg-gradient-to-r from-primary to-violet-500 text-white shadow-[0_0_20px_hsl(239_84%_62%/0.45)]"
                                    : "border border-white/15 bg-white/5 text-white hover:border-primary/60",
                                )}
                              >
                                {t}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </TooltipProvider>
                )}

                {step === 4 && (
                  <div className="mt-6">
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
                      className="h-14 rounded-xl border-white/15 bg-white/5 px-4 text-lg text-white placeholder:text-white/30 focus-visible:ring-primary focus-visible:ring-offset-0 md:text-lg"
                    />
                  </div>
                )}

                {step === 5 && (
                  <div className="mt-6">
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
                      className="h-14 rounded-xl border-white/15 bg-white/5 px-4 text-lg text-white placeholder:text-white/30 focus-visible:ring-primary focus-visible:ring-offset-0 md:text-lg"
                    />
                  </div>
                )}

                {fieldError && (
                  <p className="mt-3 text-center text-sm text-red-400" role="alert">{fieldError}</p>
                )}
                {showCreateError && step === 5 && (
                  <p className="mt-3 text-center text-sm text-red-400" role="alert">
                    {createMutation.error instanceof Error
                      ? createMutation.error.message
                      : "Erro ao agendar."}
                  </p>
                )}
              </div>

              <aside className="rounded-2xl border border-white/10 bg-[#14141c] p-4 lg:sticky lg:top-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/70">Pedido</p>
                  <p className="font-display text-lg font-bold">
                    {selectedServices.length > 0 ? `R$ ${money(totalPrice)}` : "—"}
                  </p>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex items-center gap-2 text-white/45"><Scissors className="h-4 w-4" /> Serviço</span>
                    <span className={cn("text-right", selectedServices.length ? "text-white" : "text-white/25")}>
                      {selectedServices.length
                        ? selectedServices.map((s) => s.name).join(", ")
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-white/45"><User className="h-4 w-4" /> Barbeiro</span>
                    <span className={cn(step >= 2 ? "text-white" : "text-white/25")}>
                      {step >= 2 ? (selectedBarber?.name ?? "Sem preferência") : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-white/45"><CalendarDays className="h-4 w-4" /> Data</span>
                    <span className={cn(step >= 3 ? "text-white" : "text-white/25")}>
                      {step >= 3
                        ? format(selectedDate, "d 'de' MMMM", { locale: ptBR })
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-white/45"><Clock className="h-4 w-4" /> Horário</span>
                    <span className={cn(selectedTime ? "text-white" : "text-white/25")}>{selectedTime || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/45">Nome</span>
                    <span className={cn(clientName.trim() ? "text-white" : "text-white/25")}>{clientName.trim() || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/45">Telefone</span>
                    <span className={cn(clientPhone.trim() ? "text-white" : "text-white/25")}>
                      {clientPhone.trim() ? formatPhoneAsTyped(clientPhone) : "—"}
                    </span>
                  </div>
                </div>
              </aside>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => goTo(step - 1)}
                className="rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                onMouseDown={(e) => {
                  if (step === 4 || step === 5) e.preventDefault();
                }}
                className="lp-shimmer group relative flex-1 overflow-hidden rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-[0_0_20px_hsl(239_84%_62%/0.4)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_48px_hsl(239_84%_62%/0.7)] disabled:opacity-60"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-primary to-violet-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <span className="relative z-10">
                  {createMutation.isPending ? "Enviando..." : step === 5 ? "Confirmar" : "Continuar"}
                </span>
              </button>
            </div>

            <footer className="mt-4 border-t border-white/10 pt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-white/55">
                <span>Etapa {step} de {BOOKING_STEPS.length} · {bookingStep?.label}</span>
                <span className="tabular-nums">{Math.round(progress)}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={BOOKING_STEPS.length}
                aria-valuenow={step}
                aria-valuetext={`Etapa ${step} de ${BOOKING_STEPS.length}: ${bookingStep?.label ?? ""}`}
              >
                <div
                  className="checkout-progress-fill h-full rounded-full bg-gradient-to-r from-primary to-violet-400 shadow-[0_0_12px_hsl(239_84%_62%/0.65)]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </footer>
          </form>
        )}
      </main>
    </div>
  );
}
