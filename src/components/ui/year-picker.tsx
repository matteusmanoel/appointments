import * as React from "react";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface YearPickerProps {
  value: Date;
  onChange: (date: Date) => void;
  disabled?: boolean;
  className?: string;
  /** Number of years before/after current to show. Default 2 → range of 5 years. */
  range?: number;
}

export function YearPicker({
  value,
  onChange,
  disabled,
  className,
  range = 2,
}: YearPickerProps) {
  const [open, setOpen] = React.useState(false);
  const currentYear = new Date().getFullYear();
  const years = Array.from(
    { length: range * 2 },
    (_, i) => currentYear - range + i,
  );

  const handleSelect = React.useCallback(
    (y: number) => {
      const next = new Date(value);
      next.setFullYear(y);
      onChange(next);
      setOpen(false);
    },
    [value, onChange],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 min-w-[80px] items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors",
            className,
          )}
          aria-label={`Ano: ${value.getFullYear()}`}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" />
          <span>{format(value, "yyyy")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="center">
        <div className="grid grid-cols-2 gap-1">
          {years.map((y) => {
            const isSelected = value.getFullYear() === y;
            return (
              <Button
                key={y}
                type="button"
                variant={isSelected ? "default" : "ghost"}
                size="sm"
                onClick={() => handleSelect(y)}
              >
                {y}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
