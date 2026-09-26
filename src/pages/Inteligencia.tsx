import { useRef, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  BrainCircuit,
  BellRing,
  CalendarClock,
  Clock,
  Trash2,
  Activity,
  Wifi,
  WifiOff,
  Lock,
  Calendar,
  SendHorizontal,
  Users,
} from "lucide-react";
import { format, isToday, isTomorrow, parseISO, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { whatsappApi, integrationsApi, reportsApi, appointmentsApi, waitlistApi, barbersApi } from "@/lib/api";
import type { WaitlistEntry } from "@/lib/api";
import type { AppointmentListItem } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { nativeAiUiEnabled } from "@/lib/native-ai-ui";
import { toastError, toastSuccess } from "@/lib/toast-helpers";
import { formatPhoneEditable } from "@/lib/input-masks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivityEvent = {
  id: string;
  type: string;
  actor: string;
  client_name: string | null;
  client_phone: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  summary: string | null;
  created_at: string;
  conversation_id: string | null;
  barber_name: string | null;
  service_names: string | null;
  last_client_message: string | null;
  wap_contact_name: string | null;
  name_confirmed: boolean | null;
  client_photo_url: string | null;
};

type ScheduledMessage = {
  id: string;
  type: string;
  to_phone: string;
  status: string;
  run_after: string;
  last_error?: string;
  created_at: string;
  client_name?: string;
  service_names?: string;
  appt_date?: string;
  appt_time?: string;
};

// ---------------------------------------------------------------------------
// Palette & helpers
// ---------------------------------------------------------------------------

const AVATAR_PALETTE = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-cyan-500",
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function ClientAvatar({
  name,
  size = "sm",
  photoUrl,
  onClick,
}: {
  name?: string | null;
  size?: "sm" | "md";
  photoUrl?: string | null;
  onClick?: () => void;
}) {
  const label = name?.trim() || "?";
  const initials =
    label === "?"
      ? "?"
      : label
          .split(" ")
          .filter(Boolean)
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
          .toUpperCase();
  const color = AVATAR_PALETTE[hashStr(label) % AVATAR_PALETTE.length];
  const dim = size === "sm" ? "w-10 h-10 text-xs" : "w-14 h-14 text-sm";
  const className = cn(
    "rounded-full flex items-center justify-center text-white font-semibold shrink-0 overflow-hidden",
    !photoUrl && color,
    dim,
    onClick && "cursor-zoom-in ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  );
  const inner = photoUrl ? (
    <img src={photoUrl} alt="" className="w-full h-full object-cover" />
  ) : (
    initials
  );
  if (!onClick) {
    return (
      <span className={className} aria-hidden>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      aria-label={`Ver foto de ${label}`}
    >
      {inner}
    </button>
  );
}

function fmtPhone(phone?: string | null): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

function relTime(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return "";
  }
}

function fmtApptDate(dateStr?: string | null, timeStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = parseISO(dateStr);
    const base = isToday(d)
      ? "hoje"
      : isTomorrow(d)
        ? "amanhã"
        : format(d, "EEE, dd/MM", { locale: ptBR });
    const time = timeStr ? ` às ${timeStr.slice(0, 5).replace(":", "h")}` : "";
    return base + time;
  } catch {
    return dateStr + (timeStr ? ` às ${timeStr}` : "");
  }
}

// ---------------------------------------------------------------------------
// useActivitySound hook — short distinct melodies, not a single beep
// ---------------------------------------------------------------------------

type ToneStep = { freq: number; dur: number; at: number };

const EVENT_MELODIES: Record<string, ToneStep[]> = {
  appointment_created: [
    { freq: 523.25, dur: 0.1, at: 0 },
    { freq: 659.25, dur: 0.1, at: 0.11 },
    { freq: 783.99, dur: 0.18, at: 0.22 },
  ],
  rescheduled: [
    { freq: 587.33, dur: 0.09, at: 0 },
    { freq: 698.46, dur: 0.09, at: 0.1 },
    { freq: 523.25, dur: 0.16, at: 0.22 },
  ],
  cancelled: [
    { freq: 392, dur: 0.12, at: 0 },
    { freq: 311.13, dur: 0.2, at: 0.14 },
  ],
};

const LS_KEY = "intel_last_seen_event_id";

let sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!sharedAudioCtx) sharedAudioCtx = new AudioContext();
  return sharedAudioCtx;
}

if (typeof document !== "undefined") {
  const unlockAudio = () => {
    void getAudioCtx().resume();
  };
  document.addEventListener("click", unlockAudio);
  document.addEventListener("touchend", unlockAudio);
}

async function playMelody(steps: ToneStep[]) {
  const ctx = getAudioCtx();
  if (ctx.state === "suspended") await ctx.resume();
  const start = ctx.currentTime + 0.02;
  for (const step of steps) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = step.freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = start + step.at;
    const t1 = t0 + step.dur;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }
}

function useActivitySound(events: ActivityEvent[] | undefined) {
  const lastSeenId = useRef<string | null>(localStorage.getItem(LS_KEY));

  useEffect(() => {
    if (!events || events.length === 0) return;
    if (document.visibilityState !== "visible") return;

    const newest = events[0];
    if (!newest) return;
    if (newest.id === lastSeenId.current) return;

    if (lastSeenId.current !== null) {
      const melody = EVENT_MELODIES[newest.type];
      if (melody) {
        try {
          void playMelody(melody);
        } catch {
          // AudioContext may be unavailable
        }
      }
    }

    lastSeenId.current = newest.id;
    localStorage.setItem(LS_KEY, newest.id);
  }, [events]);
}

// ---------------------------------------------------------------------------
// Event labels / colors
// ---------------------------------------------------------------------------

const EVENT_LABELS: Record<string, string> = {
  appointment_created: "Agendado",
  cancelled: "Cancelado",
  rescheduled: "Reagendado",
  appointment_updated: "Atualizado",
  confirmed: "Confirmado",
  no_show: "Não compareceu",
  reminder_sent: "Lembrete",
  waitlist_offered: "Encaixe",
  conversation_started: "Novo contato",
};

function buildActivityLabel(e: ActivityEvent): string {
  const when = fmtApptDate(e.scheduled_date, e.scheduled_time);
  const svc = e.service_names?.trim() ?? "";
  const clock = e.scheduled_time ? e.scheduled_time.slice(0, 5).replace(":", "h") : "";
  switch (e.type) {
    case "appointment_created":
      return `Agendou ${svc ? `${svc} ` : ""}${when}`.trim();
    case "rescheduled":
      return when ? `Reagendou para ${when}` : "Reagendou o horário";
    case "cancelled":
      return `Cancelou${svc ? ` ${svc}` : ""}${when ? ` de ${when}` : ""}`;
    case "no_show":
      return `Não apareceu para ${svc || "o atendimento"}${clock ? ` às ${clock}` : ""}`;
    case "confirmed":
      return `Confirmou${svc ? ` ${svc}` : ""}${when ? ` de ${when}` : ""}`;
    case "reminder_sent":
      if (e.summary === "reminder_2h") return when ? `Recebeu lembrete de 2h para ${when}` : "Recebeu lembrete de 2h";
      return when ? `Recebeu lembrete de 24h para ${when}` : "Recebeu lembrete de 24h";
    case "waitlist_offered":
      return when ? `Ofereceu encaixe em ${when}` : "Ofereceu encaixe ao próximo da fila";
    case "conversation_started":
      return e.summary ? `Iniciou conversa: "${e.summary.slice(0, 60)}"` : "Iniciou conversa";
    default:
      return EVENT_LABELS[e.type] ?? e.type;
  }
}

function activityBadge(e: ActivityEvent): { label: string; className: string } | null {
  if (e.type === "reminder_sent") {
    if (e.summary === "reminder_2h") {
      return {
        label: "Lembrete 2h",
        className: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
      };
    }
    return {
      label: "Lembrete 24h",
      className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    };
  }
  if (e.type === "waitlist_offered") {
    return {
      label: "Encaixe",
      className: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
    };
  }
  const tone = EVENT_BADGE[e.type];
  if (!tone) return null;
  return {
    label: EVENT_LABELS[e.type] ?? e.type,
    className: cn(tone.bg, tone.text),
  };
}

function useFreshIds(ids: string[]): Set<string> {
  const prev = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const key = ids.join("|");
  useEffect(() => {
    const current = key ? key.split("|") : [];
    if (prev.current) {
      const added = current.filter((id) => !prev.current?.has(id));
      if (added.length > 0) {
        setFresh(new Set(added));
        const timer = window.setTimeout(() => setFresh(new Set()), 1800);
        prev.current = new Set(current);
        return () => window.clearTimeout(timer);
      }
    }
    prev.current = new Set(current);
  }, [key]);
  return fresh;
}

const EVENT_BADGE: Record<
  string,
  { bg: string; text: string }
> = {
  appointment_created: {
    bg: "bg-emerald-100 dark:bg-emerald-900",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  cancelled: {
    bg: "bg-red-100 dark:bg-red-900",
    text: "text-red-700 dark:text-red-300",
  },
  rescheduled: {
    bg: "bg-amber-100 dark:bg-amber-900",
    text: "text-amber-700 dark:text-amber-300",
  },
  appointment_updated: {
    bg: "bg-blue-100 dark:bg-blue-900",
    text: "text-blue-700 dark:text-blue-300",
  },
  no_show: {
    bg: "bg-orange-100 dark:bg-orange-900",
    text: "text-orange-700 dark:text-orange-300",
  },
  confirmed: {
    bg: "bg-sky-100 dark:bg-sky-900",
    text: "text-sky-700 dark:text-sky-300",
  },
  conversation_started: {
    bg: "bg-teal-100 dark:bg-teal-900",
    text: "text-teal-700 dark:text-teal-300",
  },
};

// ---------------------------------------------------------------------------
// FeedAtividade — full-width
// ---------------------------------------------------------------------------

function FeedAtividade() {
  const { data, isLoading } = useQuery({
    queryKey: ["intel-agenda-activity"],
    queryFn: () => reportsApi.agendaActivity(40),
    refetchInterval: 8_000,
  });

  const events = (data?.events ?? []) as ActivityEvent[];
  useActivitySound(events);
  const freshIds = useFreshIds(events.map((e) => e.id));
  const [photo, setPhoto] = useState<ActivityEvent | null>(null);
  const photoName =
    photo && photo.name_confirmed === false && photo.wap_contact_name
      ? photo.wap_contact_name
      : (photo?.client_name ?? "Cliente");

  return (
    <>
    <Card className="flex h-full w-full flex-col overflow-hidden">
      <CardHeader className="pb-3 shrink-0 border-b">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-500" />
          Feed de Atividade
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">
          {isLoading && (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 rounded bg-muted animate-pulse" />
              ))}
            </div>
          )}
          {!isLoading && events.length === 0 && (
            <EmptyState
              className="my-auto min-h-[12rem] flex-1"
              icon={<Activity className="h-12 w-12" strokeWidth={1.5} />}
              title="Nenhuma atividade recente"
              description="Agendamentos, confirmações e lembretes aparecem aqui."
            />
          )}
          <ul className="divide-y">
            {events.map((e) => {
              const badge = activityBadge(e);
              const story = buildActivityLabel(e);
              const actorLabel = e.actor === "ai" ? "IA" : e.actor === "system" ? "Sistema" : "Gestor";
              const displayName =
                e.name_confirmed === false && e.wap_contact_name
                  ? e.wap_contact_name
                  : (e.client_name ?? "Desconhecido");
              const isNew = e.name_confirmed === false;

              return (
                <li
                  key={e.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors",
                    freshIds.has(e.id) && "bg-primary/10",
                  )}
                >
                  <ClientAvatar
                    name={displayName}
                    size="md"
                    photoUrl={e.client_photo_url}
                    onClick={() => setPhoto(e)}
                  />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">{displayName}</span>
                      {isNew && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          NOVO
                        </Badge>
                      )}
                      {e.client_phone && (
                        <span className="text-xs text-muted-foreground">
                          {fmtPhone(e.client_phone)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{story}</p>
                    {e.barber_name && (
                      <p className="text-xs text-muted-foreground truncate">com {e.barber_name}</p>
                    )}
                    {e.last_client_message && (
                      <p className="text-xs text-muted-foreground italic line-clamp-2">
                        Cliente: “{e.last_client_message}”
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {badge ? (
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", badge.className)}>
                        {badge.label}
                      </span>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        {EVENT_LABELS[e.type] ?? e.type}
                      </Badge>
                    )}
                    <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                      {actorLabel}
                    </span>
                    <span className="text-xs text-muted-foreground">{relTime(e.created_at)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
    <Dialog open={!!photo} onOpenChange={(open) => !open && setPhoto(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{photoName}</DialogTitle>
          <DialogDescription>{photo?.client_phone ? fmtPhone(photo.client_phone) : "Contato"}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center py-2">
          {photo?.client_photo_url ? (
            <img
              src={photo.client_photo_url}
              alt={photoName}
              className="max-h-64 max-w-full rounded-2xl object-contain"
            />
          ) : (
            <div
              className={cn(
                "rounded-full flex items-center justify-center text-white font-bold w-28 h-28 text-3xl",
                AVATAR_PALETTE[hashStr(photoName) % AVATAR_PALETTE.length],
              )}
            >
              {photoName
                .split(" ")
                .filter(Boolean)
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase() || "?"}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// ProximosAtendimentos — upcoming appointments timeline
// ---------------------------------------------------------------------------

type ApptGroup = { label: string; items: AppointmentListItem[] };

const WEEKDAY_BR: Record<number, string> = {
  0: "Dom",
  1: "Seg",
  2: "Ter",
  3: "Qua",
  4: "Qui",
  5: "Sex",
  6: "Sáb",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "Confirmado", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
  pending: { label: "Pendente", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  completed: { label: "Concluído", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  cancelled: { label: "Cancelado", cls: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
};

function groupByDate(items: AppointmentListItem[]): ApptGroup[] {
  const map = new Map<string, AppointmentListItem[]>();
  for (const item of items) {
    if (!map.has(item.scheduled_date)) map.set(item.scheduled_date, []);
    map.get(item.scheduled_date)!.push(item);
  }
  return Array.from(map.entries()).map(([date, appts]) => {
    const d = parseISO(date);
    let label: string;
    if (isToday(d)) label = "Hoje";
    else if (isTomorrow(d)) label = "Amanhã";
    else {
      const wd = WEEKDAY_BR[d.getDay()] ?? format(d, "EEE", { locale: ptBR });
      label = `${wd}, ${format(d, "dd/MM")}`;
    }
    return { label, items: appts };
  });
}

function FilaDeEncaixe() {
  const queryClient = useQueryClient();
  const [barberById, setBarberById] = useState<Record<string, string>>({});
  const { data, isLoading, isError } = useQuery({
    queryKey: ["intel-waitlist"],
    queryFn: () => waitlistApi.list(),
    refetchInterval: 30_000,
  });
  const { data: barbers } = useQuery({
    queryKey: ["barbers"],
    queryFn: () => barbersApi.list(),
  });
  const activeBarbers = (barbers ?? []).filter((b) => b.status === "active");
  const dispatchMutation = useMutation({
    mutationFn: ({ id, barberId }: { id: string; barberId: string }) =>
      waitlistApi.dispatch(id, barberId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["intel-waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["intel-agenda-activity"] });
      toastSuccess(res.message || "Encaixe enviado.");
    },
    onError: (e) => {
      toastError("Não foi possível disparar o encaixe.", e);
    },
  });
  const rows = data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {isLoading && (
        <div className="space-y-2 p-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 rounded bg-muted animate-pulse" />
          ))}
        </div>
      )}
      {isError && (
        <EmptyState
          className="my-auto min-h-[12rem] flex-1"
          icon={<Users className="h-12 w-12" strokeWidth={1.5} />}
          title="Não foi possível carregar"
          description="A fila de encaixe não respondeu. Tente de novo em instantes."
        />
      )}
      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          className="my-auto min-h-[12rem] flex-1"
          icon={<Users className="h-12 w-12" strokeWidth={1.5} />}
          title="Fila vazia"
          description="Nenhum cliente aguardando encaixe."
        />
      )}
      <ul className="divide-y">
        {rows.map((row: WaitlistEntry) => {
          const when = fmtApptDate(row.desired_date, row.desired_time) || "assim que possível";
          const selected = barberById[row.id];
          const sending = dispatchMutation.isPending && dispatchMutation.variables?.id === row.id;
          return (
            <li key={row.id} className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-3">
                <ClientAvatar name={row.client_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.client_name || "Cliente"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatPhoneEditable(row.client_phone)}
                    {row.service_name ? ` · ${row.service_name}` : ""}
                    {` · ${when}`}
                    {row.barber_name ? ` · prefere ${row.barber_name}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                    row.status === "notified"
                      ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
                  )}
                >
                  {row.status === "notified" ? "Notificado" : "Na fila"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={selected}
                  onValueChange={(value) => setBarberById((prev) => ({ ...prev, [row.id]: value }))}
                >
                  <SelectTrigger className="h-8 flex-1" aria-label="Barbeiro disponível">
                    <SelectValue placeholder="Barbeiro disponível" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBarbers.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0"
                  disabled={!selected || sending}
                  onClick={() => {
                    if (!selected) return;
                    dispatchMutation.mutate({ id: row.id, barberId: selected });
                  }}
                >
                  {sending ? "Enviando…" : "Disparar"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProximosAtendimentos() {
  const navigate = useNavigate();
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const dayAfterTomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["intel-upcoming-appts", todayISO],
    queryFn: () =>
      appointmentsApi.list({
        from: todayISO,
        to: dayAfterTomorrow,
        status: "pending,confirmed",
        limit: 30,
      }),
    refetchInterval: 30_000,
  });

  const items = data ?? [];
  const groups = useMemo(() => groupByDate(items), [items]);

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <Tabs defaultValue="proximos" className="flex h-full min-h-0 flex-col">
      <CardHeader className="shrink-0 space-y-3 border-b pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Calendar className="w-4 h-4 text-indigo-500" />
          Próximos Atendimentos
          <span className="ml-auto text-xs text-muted-foreground font-normal">48h</span>
        </CardTitle>
        <TabsList className="grid h-9 w-full grid-cols-2">
          <TabsTrigger value="proximos" className="text-xs">Próximos</TabsTrigger>
          <TabsTrigger value="fila" className="text-xs">Fila de encaixe</TabsTrigger>
        </TabsList>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <TabsContent value="proximos" className="mt-0 h-full min-h-0">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">
          {isLoading && (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 rounded bg-muted animate-pulse" />
              ))}
            </div>
          )}
          {!isLoading && groups.length === 0 && (
            <EmptyState
              className="my-auto min-h-[12rem] flex-1"
              icon={<Calendar className="h-12 w-12" strokeWidth={1.5} />}
              title="Agenda livre"
              description="Nenhum atendimento nas próximas 48h."
            />
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="sticky top-0 z-10 bg-muted/70 backdrop-blur-sm px-4 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b">
                {g.label}
              </div>
              <ul className="divide-y">
                {g.items.map((a) => {
                  const statusInfo = STATUS_BADGE[a.status];
                  const services =
                    Array.isArray(a.service_names) && a.service_names.length > 0
                      ? a.service_names.join(", ")
                      : a.service_name;
                  const time = a.scheduled_time.slice(0, 5).replace(":", "h");
                  const day = String(a.scheduled_date ?? "").slice(0, 10);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
                        onClick={() =>
                          navigate(
                            `/app/agendamentos?view=grade&grade_view=day&date=${day}`,
                            { state: { editAppointment: a } },
                          )
                        }
                      >
                      <span className="w-12 text-sm font-bold text-center shrink-0 tabular-nums">
                        {time}
                      </span>
                      <ClientAvatar name={a.client_name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.client_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {services}
                          {a.barber_name ? ` · ${a.barber_name}` : ""}
                        </p>
                      </div>
                      {statusInfo && (
                        <span
                          className={cn(
                            "text-xs font-medium px-2 py-0.5 rounded-full shrink-0",
                            statusInfo.cls,
                          )}
                        >
                          {statusInfo.label}
                        </span>
                      )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        </TabsContent>
        <TabsContent value="fila" className="mt-0 h-full min-h-0">
          <FilaDeEncaixe />
        </TabsContent>
      </CardContent>
      </Tabs>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// LembretesPendentes — enriched
// ---------------------------------------------------------------------------

const REMINDER_LABELS: Record<string, string> = {
  reminder_24h: "24h antes",
  reminder_2h: "2h antes",
};

const REMINDER_BADGE: Record<string, string> = {
  reminder_24h: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  reminder_2h: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
};

function LembretesPendentes() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["intel-reminders"],
    queryFn: () =>
      integrationsApi.listScheduledMessages({
        type: ["reminder_24h", "reminder_2h"],
        status: "queued",
        limit: 30,
      }),
    refetchInterval: 30_000,
  });

  const [pendingSkipId, setPendingSkipId] = useState<string | null>(null);
  const [pendingDispatchId, setPendingDispatchId] = useState<string | null>(null);

  const skipMutation = useMutation({
    mutationFn: (id: string) => integrationsApi.skipScheduledMessage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["intel-reminders"] });
      setPendingSkipId(null);
      toastSuccess("Lembrete cancelado.");
    },
    onError: (e) => {
      toastError("Não foi possível cancelar o lembrete.", e);
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: (id: string) => integrationsApi.dispatchNowScheduledMessage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["intel-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["intel-agenda-activity"] });
      setPendingDispatchId(null);
      toastSuccess("Lembrete enviado.");
    },
    onError: (e) => {
      toastError("Não foi possível enviar o lembrete.", e);
    },
  });

  const reminders = [...(data ?? [])].sort(
    (a, b) => new Date(a.run_after).getTime() - new Date(b.run_after).getTime(),
  );
  const pendingSkip = reminders.find((r) => r.id === pendingSkipId);
  const pendingDispatch = reminders.find((r) => r.id === pendingDispatchId);

  return (
    <>
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="pb-3 shrink-0 border-b">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-orange-500" />
          Lembretes Pendentes
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">
          {isLoading && (
            <div className="space-y-2 p-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 rounded bg-muted animate-pulse" />
              ))}
            </div>
          )}
          {isError && (
            <EmptyState
              className="my-auto min-h-[12rem] flex-1"
              icon={<CalendarClock className="h-12 w-12" strokeWidth={1.5} />}
              title="Não foi possível carregar"
              description="A fila de lembretes não respondeu. Tente de novo em instantes."
            />
          )}
          {!isLoading && !isError && reminders.length === 0 && (
            <EmptyState
              className="my-auto min-h-[12rem] flex-1"
              icon={<BellRing className="h-12 w-12" strokeWidth={1.5} />}
              title="Nenhum lembrete na fila"
              description="Lembretes de 24h e de 2h aparecem aqui."
            />
          )}
          <ul className="divide-y">
            {reminders.map((r: ScheduledMessage) => {
              const apptLabel = fmtApptDate(r.appt_date, r.appt_time);
              const dispara = new Date(r.run_after).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <ClientAvatar name={r.client_name} size="sm" />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-sm font-medium truncate">
                      {r.client_name || fmtPhone(r.to_phone)}
                    </p>
                    {r.service_names && (
                      <p className="text-xs text-muted-foreground truncate">
                        {r.service_names}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          REMINDER_BADGE[r.type] ?? "bg-muted text-muted-foreground",
                        )}
                      >
                        {REMINDER_LABELS[r.type] ?? r.type}
                      </span>
                      {apptLabel && (
                        <span className="text-xs text-muted-foreground">
                          {apptLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Dispara {dispara}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 shrink-0"
                      disabled={dispatchMutation.isPending}
                      onClick={() => setPendingDispatchId(r.id)}
                      title="Enviar este lembrete agora"
                    >
                      <SendHorizontal className="w-3.5 h-3.5" />
                      <span className="sr-only">Enviar agora</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive shrink-0"
                      disabled={skipMutation.isPending}
                      onClick={() => setPendingSkipId(r.id)}
                      title="Cancelar este lembrete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="sr-only">Cancelar</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
    <AlertDialog open={!!pendingSkipId} onOpenChange={(open) => !open && setPendingSkipId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar lembrete?</AlertDialogTitle>
          <AlertDialogDescription>
            O lembrete de {pendingSkip?.client_name || fmtPhone(pendingSkip?.to_phone) || "este cliente"} sai da fila e não será enviado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={skipMutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (!pendingSkipId || skipMutation.isPending) return;
              skipMutation.mutate(pendingSkipId);
            }}
          >
            {skipMutation.isPending ? "Cancelando…" : "Cancelar lembrete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={!!pendingDispatchId} onOpenChange={(open) => !open && setPendingDispatchId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Enviar lembrete agora?</AlertDialogTitle>
          <AlertDialogDescription>
            Enviar agora para {pendingDispatch?.client_name || fmtPhone(pendingDispatch?.to_phone) || "este cliente"} e remover da fila.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction
            disabled={dispatchMutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (!pendingDispatchId || dispatchMutation.isPending) return;
              dispatchMutation.mutate(pendingDispatchId);
            }}
          >
            {dispatchMutation.isPending ? "Enviando…" : "Enviar agora"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// UpgradeCard — shown when WhatsApp not connected
// ---------------------------------------------------------------------------

function UpgradeCard() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
      <div className="relative">
        {/* blurred mock sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-30 blur-sm pointer-events-none select-none w-full max-w-2xl mx-auto">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-40 rounded-xl bg-muted border" />
          ))}
        </div>
        {/* overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="rounded-full bg-background p-4 border shadow-lg">
            <Lock className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="bg-background/95 backdrop-blur-sm rounded-xl px-6 py-4 border shadow-lg max-w-sm">
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2 justify-center">
              <BrainCircuit className="w-5 h-5 text-primary" />
              Tela Inteligência
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Conecte o WhatsApp para monitorar conversas, feed de atividade com alertas sonoros, saúde do agente e lembretes em tempo real.
            </p>
            <Button asChild className="w-full">
              <Link to="/app/integracoes">
                <Wifi className="w-4 h-4 mr-2" />
                Conectar WhatsApp
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Inteligencia() {
  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => whatsappApi.status(),
    retry: false,
    staleTime: 30_000,
  });

  const connected = statusData?.connected === true;
  const showReadonly = !nativeAiUiEnabled || (!statusLoading && !connected);

  return (
    <div className="relative mx-auto flex h-[calc(100dvh-5.5rem)] max-w-7xl flex-col gap-4 overflow-hidden md:h-[calc(100dvh-4rem)]">
      <div
        className="pointer-events-none fixed inset-x-0 top-14 z-40 h-px overflow-hidden md:top-0 md:left-[calc(var(--sidebar-width)+var(--sidebar-gap))]"
        aria-hidden
      >
        <div className="live-line" />
      </div>
      {/* Header */}
      <div className="flex items-center gap-3">
        <BrainCircuit className="w-6 h-6 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Inteligência</h1>
          <p className="text-sm text-muted-foreground">
            Monitor central do agente NavalhIA
          </p>
        </div>
        {!statusLoading && (
          <Badge
            variant={connected ? "default" : "secondary"}
            className={cn(
              "gap-1.5 shrink-0",
              connected
                ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                : "text-muted-foreground",
            )}
          >
            {connected ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            {connected ? "WhatsApp conectado" : "Desconectado"}
          </Badge>
        )}
        <BellRing
          className="w-4 h-4 text-muted-foreground shrink-0"
          title="Alertas sonoros ativos quando aba está visível"
        />
      </div>

      {showReadonly ? (
        <UpgradeCard />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex min-h-0 flex-[1.25]">
            <FeedAtividade />
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
            <ProximosAtendimentos />
            <LembretesPendentes />
          </div>
        </div>
      )}
    </div>
  );
}
