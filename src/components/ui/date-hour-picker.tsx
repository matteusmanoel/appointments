import * as React from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface DateHourPickerValue {
  date: Date | null;
  time: string;
}

export interface DateHourPickerProps {
  value: DateHourPickerValue;
  onChange: (value: DateHourPickerValue) => void;
  disabled?: boolean;
  minDate?: Date;
  className?: string;
  placeholder?: string;
  /** Time step in minutes for the time input. Default 30. */
  timeStep?: number;
}

function formatDisplay(
  value: DateHourPickerValue,
  placeholder: string,
): string {
  if (!value.date) return placeholder;
  const dateStr = format(value.date, "dd/MM/yyyy", { locale: ptBR });
  const timeStr =
    value.time && /^\d{1,2}:\d{2}$/.test(value.time) ? value.time : "00:00";
  return `${dateStr} ${timeStr}`;
}

export function DateHourPicker({
  value,
  onChange,
  disabled,
  minDate,
  className,
  placeholder = "Selecione data e hora",
  timeStep = 30,
}: DateHourPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [localTime, setLocalTime] = React.useState(value.time || "09:00");

  const displayValue = formatDisplay(value, placeholder);

  const handleSelectDate = React.useCallback(
    (d: Date | undefined) => {
      if (d) {
        onChange({
          date: d,
          time:
            localTime && /^\d{1,2}:\d{2}$/.test(localTime)
              ? localTime
              : "09:00",
        });
      }
    },
    [onChange, localTime],
  );

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocalTime(v);
    onChange({
      date: value.date,
      time: v || "00:00",
    });
  };

  React.useEffect(() => {
    if (value.time) setLocalTime(value.time);
  }, [value.time]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setOpen(false);
      return;
    }
    setLocalTime(
      value.time && /^\d{1,2}:\d{2}$/.test(value.time) ? value.time : "09:00",
    );
    setOpen(true);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors",
            !value.date && "text-muted-foreground",
            className,
          )}
          aria-label={value.date ? displayValue : placeholder}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" />
          <span className="truncate flex-1">{displayValue}</span>

          <Clock className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-3 space-y-4">
          <Calendar
            mode="single"
            selected={value.date ?? undefined}
            onSelect={handleSelectDate}
            disabled={minDate ? (date) => date < minDate : undefined}
            initialFocus
          />
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs">Horário</Label>
            <Input
              type="time"
              value={localTime}
              onChange={handleTimeChange}
              step={timeStep * 60}
              className="h-10 text-center items-center justify-center font-bold"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
