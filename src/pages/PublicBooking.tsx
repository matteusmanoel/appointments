import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publicApi } from "@/lib/api";
import { getTimeSlotsForDay } from "@/lib/slots";
import { formatPhoneBR, parsePhoneBR } from "@/lib/input-masks";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getWhatsAppUrl(phone: string | undefined, message?: string): string {
  if (!phone || !phone.trim()) return "#";
  const digits = phone.replace(/\D/g, "");
  const number = digits.startsWith("55") ? digits : `55${digits}`;
  if (!message || !message.trim()) return `https://wa.me/${number}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function isSlotOccupied(
  slotTime: string,
  occupied: Array<{ scheduled_time: string; duration_minutes: number }>,
): boolean {
  const slotStart = parseTime(slotTime);
  const slotEnd = slotStart + 30;
  for (const o of occupied) {
    const oStart = parseTime(String(o.scheduled_time).slice(0, 5));
    const oEnd = oStart + (o.duration_minutes ?? 30);
    if (slotStart < oEnd && slotEnd > oStart) return true;
  }
  return false;
}

const STEPS = ["Serviço", "Barbeiro", "Data e horário", "Seus dados"];
const BOOKING_CARD_MIN_HEIGHT = "min-h-[520px]";
const GENERIC_WHATSAPP_TEXT =
  "Olá, gostaria de agendar um horario. Quais são os serviços disponíveis?";

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
      const barberToUse =
        barberId ||
        resolveBarberForSlot(selectedTime, totalDuration) ||
        barbers[0]?.id;
      if (!barberToUse) throw new Error("Nenhum barbeiro disponível.");
      await publicApi.createAppointment(slug!, {
        service_ids: serviceIds,
        barber_id: barberToUse,
        scheduled_date: dateStr,
        scheduled_time: selectedTime,
        client_name: clientName,
        client_phone: clientPhone,
      });
    },
    onSuccess: () => setSuccess(true),
  });

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

  const availabilityForBarber = barberId
    ? availability.filter((a) => a.barber_id === barberId)
    : [];
  const availableSlots = barberId
    ? timeSlots.filter((t) => !isSlotOccupied(t, availabilityForBarber))
    : timeSlots.filter((t) =>
        barbers.some((b) =>
          !isSlotOccupied(t, availability.filter((a) => a.barber_id === b.id))
        )
      );

  function resolveBarberForSlot(slotTime: string, durationMinutes: number): string | null {
    const slotStart = parseTime(slotTime);
    for (const barber of barbers) {
      const barberOccupied = availability.filter((a) => a.barber_id === barber.id);
      let conflict = false;
      for (let m = 0; m < durationMinutes; m += 30) {
        const t = formatMins(slotStart + m);
        if (isSlotOccupied(t, barberOccupied)) {
          conflict = true;
          break;
        }
      }
      if (!conflict) return barber.id;
    }
    return null;
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
        <p className="text-destructive">Barbearia não encontrada.</p>
      </div>
    );
  }
  if (loadingShop || !barbershop) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (success) {
    const whatsappUrl = getWhatsAppUrl(barbershop.phone, GENERIC_WHATSAPP_TEXT);
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
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="mt-4 block w-full">
                  <Button
                    className="w-full bg-green-600 hover:bg-green-700 text-white disabled:opacity-60"
                    asChild={!!barbershop.phone}
                    disabled={!barbershop.phone}
                  >
                    {barbershop.phone ? (
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="w-4 h-4 mr-2" />
                        Retornar para o WhatsApp
                      </a>
                    ) : (
                      <span>
                        <MessageCircle className="w-4 h-4 mr-2" />
                        Retornar para o WhatsApp
                      </span>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {barbershop.phone
                  ? "Abrir conversa no WhatsApp"
                  : "Cadastre o telefone nas configurações da barbearia"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
            const price = Number(s.price)
              .toFixed(2)
              .replace(".", ",");
            return `• ${s.name} — R$ ${price}`;
          })
        : ["• (nenhum serviço selecionado)"];
    const total = totalPrice.toFixed(2).replace(".", ",");
    const barber = selectedBarber?.name ?? "Não tenho preferência";
    const dateLabel = format(selectedDate, "dd/MM/yyyy", { locale: ptBR });
    const weekday = format(selectedDate, "EEEE", { locale: ptBR });
    const phoneLabel = clientPhone ? formatPhoneBR(clientPhone) : "—";
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
    step === 4 ? buildConfirmationWhatsAppText() : GENERIC_WHATSAPP_TEXT;
  const whatsappUrl = getWhatsAppUrl(barbershop.phone, whatsappText);

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      {step > 0 && (
        <header className="bg-background border-b border-border py-3 px-4 sm:py-4">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-2 sm:gap-3">
            <h1 className="text-base sm:text-lg font-semibold text-foreground truncate">
              {barbershop.name}
            </h1>
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex-shrink-0">
                    <Button
                      className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-60"
                      asChild={!!barbershop.phone}
                      disabled={!barbershop.phone}
                    >
                      {barbershop.phone ? (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MessageCircle className="w-4 h-4 mr-1.5" />
                          Agendar via WhatsApp
                        </a>
                      ) : (
                        <span>
                          <MessageCircle className="w-4 h-4 mr-1.5" />
                          Agendar via WhatsApp
                        </span>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {barbershop.phone
                    ? "Abrir conversa no WhatsApp"
                    : "Cadastre o telefone nas configurações da barbearia"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </header>
      )}
      <main
        className={`max-w-2xl mx-auto w-full p-4 pb-8 sm:pb-12 flex-1 flex flex-col ${
          step === 0 ? "justify-center" : ""
        }`}
      >
        {step > 0 && (
          <nav
            className="mb-4 sm:mb-8 flex-shrink-0"
            aria-label="Etapas do agendamento"
          >
            <div className="flex items-stretch gap-0 rounded-xl border border-border bg-card overflow-hidden shadow-sm">
              {STEPS.map((label, i) => {
                const stepNum = i + 1;
                const isCurrent = step === stepNum;
                const isPast = step > stepNum;
                const isFuture = step < stepNum;
                const canGo = isPast || isCurrent;
                const isLast = i === STEPS.length - 1;
                return (
                  <div key={label} className="flex flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => canGo && setStep(stepNum)}
                      disabled={isFuture}
                      className={`flex flex-1 min-w-0 flex-col items-center gap-1 px-3 py-4 text-center transition-colors ${
                        isCurrent
                          ? "bg-primary text-primary-foreground"
                          : isPast
                            ? "bg-muted/60 hover:bg-muted text-foreground"
                            : "bg-muted/30 text-muted-foreground cursor-not-allowed"
                      } ${canGo ? "cursor-pointer" : ""}`}
                      aria-current={isCurrent ? "step" : undefined}
                      aria-disabled={isFuture}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          isCurrent
                            ? "bg-primary-foreground/20"
                            : isPast
                              ? "bg-background/80"
                              : "bg-muted"
                        }`}
                      >
                        {isPast ? <Check className="h-4 w-4" /> : stepNum}
                      </span>
                      <span className="text-xs font-medium truncate w-full">
                        {label}
                      </span>
                    </button>
                    {!isLast && (
                      <div
                        className={`w-px shrink-0 self-stretch ${
                          isPast ? "bg-primary/30" : "bg-border"
                        }`}
                        aria-hidden
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </nav>
        )}

        {step === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-sm space-y-6 stat-card text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Scissors className="w-7 h-7 text-primary" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold text-foreground">
                  {barbershop.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Agende seu horário em poucos passos.
                </p>
                {barbershop.address?.trim() ? (
                  <p className="text-xs text-muted-foreground pt-2">
                    {barbershop.address}
                  </p>
                ) : null}
              </div>
              <Button
                className="w-full btn-accent min-h-11 sm:min-h-10"
                onClick={() => setStep(1)}
              >
                Começar
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div
            className={`stat-card space-y-4 flex flex-col flex-1 ${BOOKING_CARD_MIN_HEIGHT}`}
          >
            <h2 className="font-semibold text-foreground text-base sm:text-lg">
              Escolha o serviço
            </h2>
            <p className="text-sm text-muted-foreground">
              Você pode selecionar mais de um.
            </p>
            <div className="space-y-2 flex-1 overflow-y-auto min-h-0">
              {services.map((s) => {
                const selected = serviceIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setServiceIds((prev) =>
                        selected
                          ? prev.filter((id) => id !== s.id)
                          : [...prev, s.id],
                      )
                    }
                    className={`w-full flex items-center justify-between p-4 rounded-lg border text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Scissors className="w-5 h-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-foreground">{s.name}</p>
                        <p className="text-sm text-muted-foreground">
                          R$ {Number(s.price).toFixed(2)} · {s.duration_minutes}{" "}
                          min
                        </p>
                      </div>
                    </div>
                    {selected && <Check className="w-5 h-5 text-primary" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-auto pt-4 flex gap-2">
              <Button
                variant="outline"
                className="flex-1 min-h-11 sm:min-h-10"
                onClick={() => setStep(0)}
              >
                Voltar
              </Button>
              <Button
                className="flex-1 min-h-11 sm:min-h-10"
                onClick={() => setStep(2)}
                disabled={serviceIds.length === 0}
              >
                Continuar
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div
            className={`stat-card space-y-4 flex flex-col flex-1 ${BOOKING_CARD_MIN_HEIGHT}`}
          >
            <h2 className="font-semibold text-foreground text-base sm:text-lg">
              Escolha o barbeiro
            </h2>
            <div className="space-y-2 flex-1 overflow-y-auto min-h-0">
              <button
                type="button"
                onClick={() => setBarberId("")}
                className={`w-full flex items-center justify-between p-4 rounded-lg border text-left transition-colors ${
                  barberId === ""
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-muted-foreground" />
                  <p className="font-medium text-foreground">
                    Não tenho preferência
                  </p>
                </div>
                {barberId === "" && (
                  <Check className="w-5 h-5 text-primary" />
                )}
              </button>
              {barbers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBarberId(b.id)}
                  className={`w-full flex items-center justify-between p-4 rounded-lg border text-left transition-colors ${
                    barberId === b.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-muted-foreground" />
                    <p className="font-medium text-foreground">{b.name}</p>
                  </div>
                  {barberId === b.id && (
                    <Check className="w-5 h-5 text-primary" />
                  )}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-auto pt-4 min-h-11 sm:min-h-0">
              <Button
                variant="outline"
                className="flex-1 min-h-11 sm:min-h-10"
                onClick={() => setStep(1)}
              >
                Voltar
              </Button>
              <Button
                className="flex-1 min-h-11 sm:min-h-10"
                onClick={() => setStep(3)}
              >
                Continuar
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <TooltipProvider delayDuration={0}>
            <div
              className={`stat-card space-y-4 flex flex-col flex-1 ${BOOKING_CARD_MIN_HEIGHT}`}
            >
              <h2 className="font-semibold text-foreground text-base sm:text-lg">
                Data e horário
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSelectedDate((d) => addDays(d, -1))}
                  aria-label="Dia anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
                      aria-label="Escolher data"
                    >
                      <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                      {format(selectedDate, "EEEE, d 'de' MMMM", {
                        locale: ptBR,
                      })}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="center">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(d) => d && setSelectedDate(d)}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSelectedDate((d) => addDays(d, 1))}
                  aria-label="Próximo dia"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              {timeSlots.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground py-8 min-h-[200px]">
                  <CalendarIcon className="h-12 w-12" strokeWidth={1.5} />
                  <p className="text-sm">Fechado neste dia.</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 flex-1 content-start min-h-0">
                  {timeSlots.map((t) => {
                    const available = availableSlots.includes(t);
                    const barberName = selectedBarber?.name ?? "barbeiro";
                    if (available) {
                      return (
                        <Button
                          key={t}
                          variant={selectedTime === t ? "default" : "outline"}
                          className="min-h-11 py-3 text-base font-medium"
                          onClick={() => setSelectedTime(t)}
                        >
                          {t}
                        </Button>
                      );
                    }
                    return (
                      <Tooltip key={t}>
                        <TooltipTrigger asChild>
                          <span className="inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-md border border-input bg-muted/50 px-4 py-3 text-base font-medium text-muted-foreground opacity-60">
                            {t}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Horário indisponível para o barbeiro {barberName}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              )}
              <div className="flex gap-2 mt-auto pt-4 min-h-11 sm:min-h-0">
                <Button
                  variant="outline"
                  className="flex-1 min-h-11 sm:min-h-10 text-sm sm:text-base"
                  onClick={() => setStep(2)}
                >
                  Voltar
                </Button>
                <Button
                  className="flex-1 min-h-11 sm:min-h-10 text-sm sm:text-base"
                  onClick={() => setStep(4)}
                  disabled={!selectedTime || timeSlots.length === 0}
                >
                  Continuar
                </Button>
              </div>
            </div>
          </TooltipProvider>
        )}

        {step === 4 && (
          <div
            className={`stat-card flex flex-col flex-1 ${BOOKING_CARD_MIN_HEIGHT}`}
          >
            <div className="flex flex-col flex-1 min-h-0 space-y-4">
            <h2 className="font-semibold text-foreground text-base sm:text-lg">
              Seus dados
            </h2>
            <div className="space-y-4 flex-shrink-0">
              <div>
                <Label htmlFor="name" className="text-base">
                  Nome <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Seu nome"
                  className="mt-1 min-h-12 h-12 text-base"
                />
              </div>
              <div>
                <Label htmlFor="phone" className="text-base">
                  Telefone <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formatPhoneBR(clientPhone)}
                  onChange={(e) =>
                    setClientPhone(parsePhoneBR(e.target.value).slice(0, 11))
                  }
                  placeholder="(11) 99999-9999"
                  className="mt-1 min-h-12 h-12 text-base"
                />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 space-y-4 flex-shrink-0">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-foreground flex items-center gap-2 text-base">
                  <Check className="w-5 h-5 text-primary shrink-0" />
                  Resumo
                </p>
                <p className="text-lg font-bold text-green-600 whitespace-nowrap">
                  R$ {totalPrice.toFixed(2).replace(".", ",")}
                </p>
              </div>
              <div className="space-y-3 text-base pt-1">
                <div className="space-y-2">
                  {selectedServices.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 text-foreground"
                    >
                      <span className="flex items-center gap-2">
                        <Scissors className="w-5 h-5 text-muted-foreground shrink-0" />
                        {s.name}
                      </span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        R$ {Number(s.price).toFixed(2).replace(".", ",")}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-foreground pt-1 border-t border-border">
                  <User className="w-5 h-5 text-muted-foreground shrink-0" />
                  <span>{selectedBarber?.name ?? "Não tenho preferência"}</span>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <CalendarDays className="w-5 h-5 text-muted-foreground shrink-0" />
                  <span>
                    {format(selectedDate, "EEEE, d 'de' MMMM", {
                      locale: ptBR,
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <Clock className="w-5 h-5 text-muted-foreground shrink-0" />
                  <span>{selectedTime}</span>
                </div>
              </div>
            </div>
            </div>
            <div className="flex gap-2 mt-auto pt-4 min-h-11 sm:min-h-0 flex-shrink-0">
              <Button
                variant="outline"
                className="flex-1 min-h-11 sm:min-h-10"
                onClick={() => setStep(3)}
              >
                Voltar
              </Button>
              <Button
                className="flex-1 min-h-11 sm:min-h-10"
                onClick={() => createMutation.mutate()}
                disabled={
                  !clientName.trim() ||
                  !clientPhone.trim() ||
                  createMutation.isPending
                }
              >
                {createMutation.isPending ? "Enviando..." : "Confirmar"}
              </Button>
            </div>
            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : "Erro ao agendar."}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
