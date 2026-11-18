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
  /** Substitui o texto do botão quando a data está preenchida. */
  formatDate?: (date: Date) => string;
  /** Calendário maior, para toque no mobile. */
  size?: "default" | "touch";
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
  formatDate,
  size = "default",
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
    if (formatDate) return formatDate(value);
    return useVerboseTrigger
      ? formatVerbose(value, ptBR)
      : formatCompact(value, ptBR);
  }, [formatDate, value, useVerboseTrigger, placeholder]);

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
            "flex h-10 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors",
            !value && "text-muted-foreground",
            className,
          )}
          aria-label={value ? displayValue : placeholder}
        >
          <CalendarIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          <span className="min-w-0 flex-1 truncate text-left">{displayValue}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-auto p-0", size === "touch" && "w-fit max-w-[calc(100vw-1rem)]")}
        align={size === "touch" ? "center" : "start"}
      >
        <Calendar
          mode="single"
          selected={value ?? undefined}
          onSelect={handleSelect}
          disabled={minDate ? (date) => date < minDate : undefined}
          initialFocus
          className={size === "touch" ? "p-3" : undefined}
          classNames={
            size === "touch"
              ? {
                  month: "space-y-3",
                  caption: "flex justify-center pt-1 relative items-center h-12",
                  caption_label: "text-lg font-semibold",
                  nav_button: "inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 p-0 text-white opacity-100 hover:bg-indigo-500 [&_svg]:h-6 [&_svg]:w-6",
                  head_cell: "text-muted-foreground w-12 rounded-md text-center text-sm font-medium",
                  row: "mt-1.5 flex w-full",
                  cell: "relative h-12 w-12 p-0 text-center focus-within:relative focus-within:z-20",
                  day: "inline-flex h-12 w-12 items-center justify-center rounded-xl p-0 text-base font-medium aria-selected:opacity-100",
                  day_selected:
                    "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-xl",
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}
