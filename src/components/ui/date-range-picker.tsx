import * as React from "react";
import { format, subDays, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

type RangeValue = { from: Date | null; to: Date | null } | null;

export interface DateRangePickerProps {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  disabled?: boolean;
  className?: string;
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

export function DateRangePicker({ value, onChange, disabled, className }: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);

  const displayValue = React.useMemo(() => {
    if (!value?.from) return "Período";
    if (value.from && !value.to) {
      return format(value.from, "dd/MM/yyyy", { locale: ptBR });
    }
    return `${format(value.from, "dd/MM/yyyy", { locale: ptBR })} - ${format(
      value.to ?? value.from,
      "dd/MM/yyyy",
      { locale: ptBR }
    )}`;
  }, [value]);

  const handleSelect = React.useCallback(
    (range: { from?: Date; to?: Date } | undefined) => {
      if (!range) {
        onChange(null);
        return;
      }
      onChange({
        from: range.from ?? null,
        to: range.to ?? range.from ?? null,
      });
    },
    [onChange]
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
          className={cn("h-9 px-3 gap-2 justify-start", !value?.from && "text-muted-foreground", className)}
        >
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate max-w-[160px] md:max-w-[220px]">{displayValue}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="end">
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
                  onClick={() => onChange(preset.getValue())}
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

