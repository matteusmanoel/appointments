import { addDays, format, isSameDay, startOfWeek, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS_SHORT = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
const WEEKDAYS_SHORT = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

export function formatTimelineDayLabel(date: Date): string {
  const weekday = format(date, "EEEE", { locale: ptBR }).replace(/-feira$/i, "");
  const rest = `${date.getDate()} de ${MONTHS_SHORT[date.getMonth()].replace(".", "")}`;
  return `${weekday}, ${rest}`;
}

type WeekDayStripProps = {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  className?: string;
};

export function WeekDayStrip({ selectedDate, onSelect, className }: WeekDayStripProps) {
  const start = startOfWeek(selectedDate, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const today = new Date();

  return (
    <div className={cn("flex w-full items-center gap-0.5", className)}>
      <button
        type="button"
        className="flex h-11 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        onClick={() => onSelect(subDays(selectedDate, 7))}
        aria-label="Semana anterior"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div className="grid min-w-0 flex-1 grid-cols-7 gap-0.5">
        {days.map((day) => {
          const selected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, today);
          const label = format(day, "EEEE, d 'de' MMMM", { locale: ptBR });
          return (
            <button
              key={format(day, "yyyy-MM-dd")}
              type="button"
              aria-pressed={selected}
              aria-label={label}
              onClick={() => onSelect(day)}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-xl px-0.5 py-1 leading-none",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
                !selected && isToday && "ring-1 ring-primary/50",
              )}
            >
              <span className="text-[9px] lowercase">{MONTHS_SHORT[day.getMonth()]}</span>
              <span className="mt-0.5 text-sm font-semibold tabular-nums">{format(day, "dd")}</span>
              <span className="mt-0.5 text-[9px] lowercase">{WEEKDAYS_SHORT[day.getDay()]}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="flex h-11 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        onClick={() => onSelect(addDays(selectedDate, 7))}
        aria-label="Próxima semana"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
