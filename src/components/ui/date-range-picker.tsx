import * as React from "react";
import { format, subDays, startOfMonth, type Locale } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

type RangeValue = { from: Date | null; to: Date | null } | null;

export type TriggerVariant = "compact" | "verbose";
export type MobileVariant = "compact" | "verbose" | "auto";

export interface DateRangePickerProps {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  disabled?: boolean;
  className?: string;
  /** Compact = short format (dd/MM/yyyy). Verbose = long format by extent (pt-BR). Default: verbose */
  triggerVariant?: TriggerVariant;
  /** On mobile: compact, verbose, or auto (compact when narrow). Default: auto */
  mobileVariant?: MobileVariant;
}

const PRESETS = [
  {
    label: "Hoje",
    getValue: () => {
      const today = new Date();
      return { from: today, to: today };
    },
  },
  {
    label: "Últimos 7 dias",
    getValue: () => {
      const today = new Date();
      return { from: subDays(today, 6), to: today };
    },
  },
  {
    label: "Últimos 30 dias",
    getValue: () => {
      const today = new Date();
      return { from: subDays(today, 29), to: today };
    },
  },
  {
    label: "Mês atual",
    getValue: () => {
      const today = new Date();
      return { from: startOfMonth(today), to: today };
    },
  },
];

function formatRangeCompact(from: Date, to: Date | null, locale: Locale) {
  if (!to || from.getTime() === to.getTime()) {
    return format(from, "dd/MM/yyyy", { locale });
  }
  return `${format(from, "dd/MM/yyyy", { locale })} - ${format(to, "dd/MM/yyyy", { locale })}`;
}

function formatRangeVerbose(from: Date, to: Date | null, locale: Locale) {
  const fromStr = format(from, "EEEE, d 'de' MMMM", { locale });
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (!to || from.getTime() === to.getTime()) {
    return cap(fromStr);
  }
  const toStr = format(to, "EEEE, d 'de' MMMM", { locale });
  return `${cap(fromStr)} – ${cap(toStr)}`;
}

export function DateRangePicker({
  value,
  onChange,
  disabled,
  className,
  triggerVariant = "verbose",
  mobileVariant = "auto",
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const isMobile = useIsMobile();

  const useVerboseTrigger = React.useMemo(() => {
    if (mobileVariant === "auto")
      return !isMobile || triggerVariant === "verbose";
    if (mobileVariant === "verbose") return true;
    return triggerVariant === "verbose";
  }, [isMobile, mobileVariant, triggerVariant]);

  const displayValue = React.useMemo(() => {
    if (!value?.from) return "Período";
    const from = value.from;
    const to = value.to ?? null;
    return useVerboseTrigger
      ? formatRangeVerbose(from, to, ptBR)
      : formatRangeCompact(from, to, ptBR);
  }, [value, useVerboseTrigger]);

  const handleSelect = React.useCallback(
    (range: { from?: Date; to?: Date } | undefined) => {
      if (!range) {
        onChange(null);
        return;
      }
      const from = range.from ?? null;
      const to = range.to ?? range.from ?? null;
      onChange({ from, to });
      if (from && to) setOpen(false);
    },
    [onChange],
  );

  const handleClear = React.useCallback(() => {
    onChange(null);
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-10 px-3 gap-2 justify-start",
            !value?.from && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate max-w-full">{displayValue}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="center">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="grid grid-cols-4 flex-1 gap-1">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs h-8 px-2"
                  onClick={() => {
                    onChange(preset.getValue());
                    setOpen(false);
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={handleClear}
              aria-label="Limpar período"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={value ?? undefined}
            onSelect={(range) => handleSelect(range ?? undefined)}
            initialFocus
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
