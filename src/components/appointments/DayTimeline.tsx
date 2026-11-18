import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { serviceLabel, type AppointmentListItem, type UnavailabilityInterval } from "@/lib/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  MIN_BLOCK_PX,
  PX_PER_MINUTE_DESKTOP,
  PX_PER_MINUTE_MOBILE,
  SLOT_MINUTES,
  formatMinutes,
  nowOffsetPx,
  parseTimeToMinutes,
  placeBlocks,
  placeUnavailability,
  rangeFromSlots,
  snapClickToSlot,
  type PlacedBlock,
} from "./day-timeline";

const GUTTER_PX = 56;
const MIN_COL_MOBILE = 112;
const MIN_COL_DESKTOP = 168;

const BARBER_STYLES = [
  { block: "border-info/40 bg-info/20", avatar: "bg-info text-info-foreground" },
  { block: "border-warning/50 bg-warning/25", avatar: "bg-warning text-warning-foreground" },
  { block: "border-chart-4/50 bg-chart-4/25", avatar: "bg-chart-4 text-white" },
  { block: "border-chart-1/40 bg-chart-1/20", avatar: "bg-chart-1 text-white" },
] as const;

export type TimelineBarber = { id: string; name: string };

type DayTimelineProps = {
  barbers: TimelineBarber[];
  appointments: AppointmentListItem[];
  slots: string[];
  date: Date;
  unavailability?: UnavailabilityInterval[];
  onOpen: (appointment: AppointmentListItem) => void;
  onCreate: (time: string, barberId: string) => void;
};

function barberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function halfHourMarks(startMin: number, endMin: number): number[] {
  const marks: number[] = [];
  const first = startMin % SLOT_MINUTES === 0 ? startMin : startMin + (SLOT_MINUTES - (startMin % SLOT_MINUTES));
  for (let mins = first; mins < endMin; mins += SLOT_MINUTES) marks.push(mins);
  return marks;
}

export function DayTimelineSkeleton({ barberCount }: { barberCount: number }) {
  const cols = Math.max(barberCount, 1);
  return (
    <div className="stat-card flex h-[calc(100dvh-14rem)] min-h-[24rem] flex-col overflow-hidden p-0 max-md:h-auto max-md:min-h-[16rem] max-md:flex-1">
      <div
        className="grid shrink-0 border-b border-border"
        style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(${cols}, minmax(7rem, 1fr))` }}
      >
        <div />
        {Array.from({ length: cols }).map((_, index) => (
          <div key={index} className="flex flex-col items-center gap-2 py-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        <Skeleton className="absolute left-[18%] top-16 h-24 w-[16%] rounded-md" />
        <Skeleton className="absolute left-[40%] top-32 h-16 w-[16%] rounded-md" />
        <Skeleton className="absolute left-[62%] top-48 h-28 w-[16%] rounded-md" />
      </div>
    </div>
  );
}

export function DayTimeline({
  barbers,
  appointments,
  slots,
  date,
  unavailability = [],
  onOpen,
  onCreate,
}: DayTimelineProps) {
  const isMobile = useIsMobile();
  const pxPerMinute = isMobile ? PX_PER_MINUTE_MOBILE : PX_PER_MINUTE_DESKTOP;
  const minCol = isMobile ? MIN_COL_MOBILE : MIN_COL_DESKTOP;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollKeyRef = useRef<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const range = useMemo(() => rangeFromSlots(slots), [slots]);
  const totalHeight = range ? (range.endMin - range.startMin) * pxPerMinute : 0;
  const marks = range ? halfHourMarks(range.startMin, range.endMin) : [];
  const isToday = isSameDay(date, now);
  const nowTop = range && isToday ? nowOffsetPx(now, range, pxPerMinute) : null;

  const placed = useMemo(() => {
    if (!range) return [];
    return placeBlocks({
      appointments: appointments.map((apt) => ({
        id: apt.id,
        barberId: apt.barber_id,
        status: apt.status,
        scheduledTime: String(apt.scheduled_time ?? ""),
        durationMinutes: apt.duration_minutes,
        completedTime: apt.completed_time,
      })),
      range,
      pxPerMinute,
    });
  }, [appointments, pxPerMinute, range]);

  const openSlots = useMemo(() => {
    if (!range) return [];
    const seen = new Set<number>();
    for (const slot of slots) {
      const mins = parseTimeToMinutes(slot);
      if (Number.isFinite(mins) && mins >= range.startMin && mins < range.endMin) seen.add(mins);
    }
    return [...seen].sort((a, b) => a - b);
  }, [range, slots]);

  const bands = useMemo(() => {
    if (!range) return [];
    return placeUnavailability({ intervals: unavailability, range, pxPerMinute });
  }, [pxPerMinute, range, unavailability]);

  const blocksByBarber = useMemo(() => {
    const map = new Map<string, PlacedBlock[]>();
    for (const block of placed) {
      const list = map.get(block.barberId) ?? [];
      list.push(block);
      map.set(block.barberId, list);
    }
    return map;
  }, [placed]);

  const appointmentsById = useMemo(
    () => new Map(appointments.map((apt) => [apt.id, apt])),
    [appointments],
  );

  useEffect(() => {
    const key = format(date, "yyyy-MM-dd");
    if (scrollKeyRef.current === key) return;
    if (!isToday || nowTop == null) {
      scrollKeyRef.current = key;
      return;
    }
    let frame = 0;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const el = scrollerRef.current;
      if (!el || el.clientHeight === 0) {
        frame = window.requestAnimationFrame(run);
        return;
      }
      el.scrollTop = Math.max(0, nowTop - el.clientHeight * 0.3);
      scrollKeyRef.current = key;
    };
    frame = window.requestAnimationFrame(run);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [date, isToday, nowTop]);

  if (!range || barbers.length === 0) return null;

  const barberName = new Map(barbers.map((barber) => [barber.id, barber.name]));
  const gridStyle = {
    gridTemplateColumns: `${GUTTER_PX}px repeat(${barbers.length}, minmax(${minCol}px, 1fr))`,
    minWidth: `max(100%, ${GUTTER_PX + barbers.length * minCol}px)`,
  };

  const onColumnClick = (event: MouseEvent<HTMLDivElement>, barberId: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const slot = snapClickToSlot({
      offsetY: event.clientY - rect.top,
      range,
      pxPerMinute,
      slots,
    });
    if (slot) onCreate(slot, barberId);
  };

  return (
    <div className="stat-card flex h-[calc(100dvh-14rem)] min-h-[24rem] flex-col overflow-hidden p-0 max-md:h-auto max-md:min-h-[16rem] max-md:flex-1">
      <div
        ref={scrollerRef}
        className="scrollbar-thin min-h-0 flex-1 overflow-auto"
        role="region"
        aria-label={`Agenda de ${format(date, "d 'de' MMMM", { locale: ptBR })}`}
      >
        <div className="grid" style={gridStyle}>
          <div className="sticky left-0 top-0 z-30 flex flex-col items-center justify-center border-b border-r border-border bg-card">
            <span className="text-lg font-semibold leading-none tabular-nums">{format(date, "d")}</span>
            <span className="mt-0.5 text-[10px] uppercase text-muted-foreground">
              {format(date, "EEE", { locale: ptBR }).replace(".", "")}
            </span>
          </div>
          {barbers.map((barber, index) => {
            const style = BARBER_STYLES[index % BARBER_STYLES.length];
            const label = isMobile ? firstName(barber.name) : barber.name;
            return (
              <div
                key={barber.id}
                className="sticky top-0 z-20 flex flex-col items-center gap-1 border-b border-l border-border bg-card px-1 py-2"
              >
                <Avatar className="h-9 w-9 md:h-10 md:w-10">
                  <AvatarFallback className={cn("text-xs font-semibold", style.avatar)}>
                    {barberInitials(barber.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="w-full truncate text-center text-xs font-medium text-foreground" title={barber.name}>
                  {label}
                </span>
              </div>
            );
          })}

          <div className="sticky left-0 z-10 border-r border-border bg-card" style={{ height: totalHeight }}>
            <div className="relative h-full">
              {marks.map((mins) =>
                mins % 60 === 0 ? (
                  <span
                    key={mins}
                    className={cn(
                      "absolute right-2 text-[11px] tabular-nums text-muted-foreground",
                      mins === range.startMin ? "top-1" : "-translate-y-1/2",
                    )}
                    style={
                      mins === range.startMin
                        ? undefined
                        : { top: (mins - range.startMin) * pxPerMinute }
                    }
                  >
                    {formatMinutes(mins)}
                  </span>
                ) : null,
              )}
              {nowTop != null && (
                <span
                  className="absolute right-0 z-20 h-2.5 w-2.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-warning"
                  style={{ top: nowTop }}
                />
              )}
            </div>
          </div>

          {barbers.map((barber, index) => {
            const style = BARBER_STYLES[index % BARBER_STYLES.length];
            const blocks = blocksByBarber.get(barber.id) ?? [];
            return (
              <div
                key={barber.id}
                className="relative border-l border-border/70"
                style={{ height: totalHeight }}
                onClick={(event) => onColumnClick(event, barber.id)}
              >
                {marks.map((mins) => (
                  <div
                    key={mins}
                    className={cn(
                      "pointer-events-none absolute inset-x-0 border-t",
                      mins % 60 === 0 ? "border-border" : "border-border/40",
                    )}
                    style={{ top: (mins - range.startMin) * pxPerMinute }}
                  />
                ))}
                {openSlots.map((mins) => {
                  const time = formatMinutes(mins);
                  return (
                    <button
                      key={mins}
                      type="button"
                      className="absolute inset-x-0 z-0 cursor-pointer transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      style={{
                        top: (mins - range.startMin) * pxPerMinute,
                        height: SLOT_MINUTES * pxPerMinute,
                      }}
                      aria-label={`Agendar às ${time} com ${barber.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCreate(time, barber.id);
                      }}
                    />
                  );
                })}
                {bands.map((band) => (
                  <div
                    key={`${band.startMin}-${band.endMin}`}
                    className="pointer-events-none absolute inset-x-1 flex items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/50"
                    style={{ top: band.topPx, height: band.heightPx }}
                  >
                    {band.reason && band.heightPx >= 24 ? (
                      <span className="px-1 text-center text-[11px] text-muted-foreground">{band.reason}</span>
                    ) : null}
                  </div>
                ))}
                {nowTop != null && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-warning"
                    style={{ top: nowTop }}
                  />
                )}
                {blocks.map((block) => {
                  const apt = appointmentsById.get(block.id);
                  if (!apt) return null;
                  const start = formatMinutes(block.startMin);
                  const end = formatMinutes(block.endMin);
                  const service = serviceLabel(apt.service_names, apt.service_name);
                  const compact = block.heightPx < 56;
                  const width = `calc(${100 / block.laneCount}% - 6px)`;
                  const left = `calc(${(block.lane * 100) / block.laneCount}% + 3px)`;
                  return (
                    <button
                      key={block.id}
                      type="button"
                      className={cn(
                        "absolute z-10 cursor-pointer overflow-hidden rounded-md border px-1.5 text-left shadow-sm transition-[box-shadow,filter] hover:shadow-md hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        style.block,
                        apt.status === "completed" && "opacity-70",
                        compact ? "py-0.5" : "py-1",
                      )}
                      style={{
                        top: block.topPx + 1,
                        height: Math.max(block.heightPx - 2, MIN_BLOCK_PX - 2),
                        width,
                        left,
                      }}
                      aria-label={`${apt.client_name}, ${service}, ${start}–${end}, ${barberName.get(barber.id) ?? ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(apt);
                      }}
                    >
                      {!compact && (
                        <p className="truncate text-[11px] tabular-nums text-muted-foreground">
                          {start} – {end}
                        </p>
                      )}
                      <p className="truncate text-xs font-semibold text-foreground md:text-sm">{apt.client_name}</p>
                      {!compact && service ? (
                        <p className="truncate text-[11px] text-muted-foreground">{service}</p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
