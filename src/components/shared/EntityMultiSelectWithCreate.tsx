import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmptyState } from "@/components/EmptyState";
import { Plus } from "lucide-react";

export type EntityMultiSelectWithCreateProps = {
  value: string[];
  onChange: (value: string[]) => void;
  options: { value: string; label: string; subtitle?: string }[];
  placeholder?: string;
  createLabel: string;
  onSelectCreate: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  disabled?: boolean;
  trigger: ReactNode;
};

export function EntityMultiSelectWithCreate({
  value,
  onChange,
  options,
  placeholder = "Selecione...",
  createLabel,
  onSelectCreate,
  emptyTitle = "Nenhum item cadastrado",
  emptyDescription,
  emptyActionLabel = "Cadastrar",
  onEmptyAction,
  disabled,
  trigger,
}: EntityMultiSelectWithCreateProps) {
  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...value, id]);
    } else {
      onChange(value.filter((x) => x !== id));
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className="z-[100] w-full min-w-[var(--radix-popover-trigger-width)] p-2"
        align="start"
      >
        {options.length === 0 ? (
          <div className="p-2">
            <EmptyState
              icon={<Plus className="h-8 w-8 text-muted-foreground" />}
              title={emptyTitle}
              description={emptyDescription}
              action={
                (onEmptyAction ?? onSelectCreate) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      (onEmptyAction ?? onSelectCreate)();
                    }}
                  >
                    {emptyActionLabel}
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            <div className="border-b border-border pb-2 mb-2">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-bold text-primary hover:bg-muted/50 text-left"
                onClick={onSelectCreate}
              >
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                  <Plus className="h-4 w-4 stroke-[4]" />
                </span>
                {createLabel}
              </button>
            </div>
            <div className="max-h-60 space-y-2 overflow-y-auto p-1">
              {options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={value.includes(opt.value)}
                    onCheckedChange={(c) => toggle(opt.value, !!c)}
                  />
                  <span className="flex-1">{opt.label}</span>
                  {opt.subtitle && (
                    <span className="text-muted-foreground text-xs">
                      {opt.subtitle}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
