import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

export interface FiltersBarProps {
  /** Left slot (e.g. Status). */
  left?: ReactNode;
  /** Center slot (date/range) – always centered on desktop. */
  center?: ReactNode;
  /** Right slot (e.g. Barbeiros multiselect or Colunas/Export). */
  right?: ReactNode;
  className?: string;
}

/** Single-line filter bar: left | center (date) | right. Mobile stacks vertically. */
export function FiltersBar({
  left,
  center,
  right,
  className,
}: FiltersBarProps) {
  return (
    <div className={cn("stat-card mb-4", className)}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <div className="flex flex-wrap items-end justify-start gap-3 min-w-0">
          {left}
        </div>
        <div className="flex flex-wrap items-end justify-center gap-3 min-w-0">
          {center}
        </div>
        <div className="flex flex-wrap items-end justify-end gap-3 min-w-0">
          {right}
        </div>
      </div>
    </div>
  );
}

export type FiltersBarFieldWidth = "date" | "barber" | "status" | "auto";

export interface FiltersBarFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
  width?: FiltersBarFieldWidth;
}

const WIDTH_CLASS: Record<FiltersBarFieldWidth, string> = {
  date: "w-full min-w-[200px]",
  barber: "w-full min-w-[160px]",
  status: "w-full min-w-[140px]",
  auto: "",
};

/** Label + control slot with consistent spacing and min-widths. */
export function FiltersBarField({
  label,
  children,
  className,
  width = "auto",
}: FiltersBarFieldProps) {
  return (
    <div className={cn(WIDTH_CLASS[width], className)}>
      <label className="text-sm font-medium text-foreground mb-1.5 block">
        {label}
      </label>
      {children}
    </div>
  );
}

export interface BarberOption {
  id: string;
  name: string;
}

export interface BarbersMultiSelectProps {
  barbers: BarberOption[];
  /** Empty array = "Todos" (all selected). */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  className?: string;
}

/** Reusable barbers multiselect: Popover + Checkboxes, count badge, "Limpar". */
export function BarbersMultiSelect({
  barbers,
  selectedIds,
  onChange,
  label = "Barbeiros",
  className,
}: BarbersMultiSelectProps) {
  const isAll = selectedIds.length === 0;
  const displayCount = isAll ? barbers.length : selectedIds.length;

  return (
    <div className={cn("w-full min-w-[160px]", className)}>
      <label className="text-sm font-medium text-foreground mb-1.5 block">
        {label}
      </label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1 h-10 w-full justify-between">
            <span className="truncate">
              {isAll ? "Todos" : `${displayCount} selecionado(s)`}
            </span>
            {!isAll && displayCount > 0 ? (
              <span className="text-xs bg-primary/20 text-primary px-1.5 rounded shrink-0">
                {displayCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-2">
          <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto">
            {barbers.map((b) => (
              <label
                key={b.id}
                className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  checked={isAll || selectedIds.includes(b.id)}
                  onCheckedChange={(checked) => {
                    if (isAll) {
                      if (checked) return;
                      onChange(barbers.filter((x) => x.id !== b.id).map((x) => x.id));
                    } else if (checked) {
                      onChange([...selectedIds, b.id]);
                    } else {
                      const next = selectedIds.filter((id) => id !== b.id);
                      onChange(next);
                    }
                  }}
                />
                <span className="text-sm">{b.name}</span>
              </label>
            ))}
          </div>
          {!isAll && selectedIds.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={() => onChange([])}
            >
              Limpar filtro
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
