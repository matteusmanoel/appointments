import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { Plus } from "lucide-react";

const CREATE_VALUE = "__create__";

export type EntitySelectWithCreateProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  createLabel: string;
  onSelectCreate: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  disabled?: boolean;
  /** Optional class for the trigger */
  triggerClassName?: string;
  autoFocus?: boolean;
};

export function EntitySelectWithCreate({
  value,
  onValueChange,
  options,
  placeholder = "Selecione...",
  createLabel,
  onSelectCreate,
  emptyTitle = "Nenhum item cadastrado",
  emptyDescription,
  emptyActionLabel = "Cadastrar",
  onEmptyAction,
  disabled,
  triggerClassName,
  autoFocus,
}: EntitySelectWithCreateProps) {
  const handleValueChange = (v: string) => {
    if (v === CREATE_VALUE) {
      onSelectCreate();
      return;
    }
    onValueChange(v);
  };

  const effectiveValue = value === CREATE_VALUE ? "" : value;

  return (
    <Select
      value={effectiveValue || undefined}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger className={triggerClassName} autoFocus={autoFocus}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
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
            <SelectItem value={CREATE_VALUE} className="text-primary font-bold">
              <span className="absolute left-2 flex h-3.5 items-center pt-1.5 justify-center pointer-events-none">
                <Plus className="h-4 w-4 stroke-[4]" />
              </span>
              <span>{createLabel}</span>
            </SelectItem>
            <div className="border-t border-border my-1" role="separator" />
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </>
        )}
      </SelectContent>
    </Select>
  );
}
