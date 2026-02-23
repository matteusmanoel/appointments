import * as React from "react";
import { format, type Locale } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

export type TriggerVariant = "compact" | "verbose";
export type MobileVariant = "compact" | "verbose" | "auto";

export interface DatePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  disabled?: boolean;
  minDate?: Date;
  className?: string;
  placeholder?: string;
  /** Compact = dd/MM/yyyy. Verbose = EEEE, d 'de' MMMM (by extent). Default: verbose */
  triggerVariant?: TriggerVariant;
  /** On mobile: compact, verbose, or auto. Default: auto */
  mobileVariant?: MobileVariant;
}

function formatCompact(d: Date, locale: Locale) {
  return format(d, "dd/MM/yyyy", { locale });
}

function formatVerbose(d: Date, locale: Locale) {
  const s = format(d, "EEEE, d 'de' MMMM", { locale });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function DatePicker({
  value,
  onChange,
  disabled,
  minDate,
  className,
  placeholder = "Selecione a data",
  triggerVariant = "verbose",
  mobileVariant = "auto",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const isMobile = useIsMobile();

  const useVerboseTrigger = React.useMemo(() => {
    if (mobileVariant === "auto")
      return !isMobile || triggerVariant === "verbose";
    if (mobileVariant === "verbose") return true;
    return triggerVariant === "verbose";
  }, [isMobile, mobileVariant, triggerVariant]);

  const displayValue = React.useMemo(() => {
    if (!value) return placeholder;
    return useVerboseTrigger
      ? formatVerbose(value, ptBR)
      : formatCompact(value, ptBR);
  }, [value, useVerboseTrigger, placeholder]);

  const handleSelect = React.useCallback(
    (d: Date | undefined) => {
      if (d) {
        onChange(d);
        setOpen(false);
      }
    },
    [onChange],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors",
            !value && "text-muted-foreground",
            className,
          )}
          aria-label={value ? displayValue : placeholder}
        >
          <CalendarIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          <span className="truncate">{displayValue}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          onSelect={handleSelect}
          disabled={minDate ? (date) => date < minDate : undefined}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
