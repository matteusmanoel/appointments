import * as React from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MonthPickerProps {
  value: Date;
  onChange: (date: Date) => void;
  disabled?: boolean;
  className?: string;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i);

export function MonthPicker({
  value,
  onChange,
  disabled,
  className,
}: MonthPickerProps) {
  const [open, setOpen] = React.useState(false);
  const year = value.getFullYear();

  const handleSelect = React.useCallback(
    (monthIndex: number) => {
      const next = new Date(value);
      next.setMonth(monthIndex);
      onChange(next);
      setOpen(false);
    },
    [value, onChange],
  );

  const label = format(value, "MMMM yyyy", { locale: ptBR });
  const capitalized = label.charAt(0).toUpperCase() + label.slice(1);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 min-w-[160px] items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors",
            className,
          )}
          aria-label={`Mês: ${capitalized}`}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" />
          <span className="capitalize">{capitalized}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="center">
        <div className="grid grid-cols-3 gap-2">
          {MONTHS.map((monthIndex) => {
            const d = new Date(year, monthIndex, 1);
            const name = format(d, "MMM", { locale: ptBR });
            const isSelected = value.getMonth() === monthIndex;
            return (
              <Button
                key={monthIndex}
                type="button"
                variant={isSelected ? "default" : "ghost"}
                size="sm"
                className="capitalize"
                onClick={() => handleSelect(monthIndex)}
              >
                {name}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
