import { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface EntityFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  contentClassName?: string;
}

/**
 * Dialog reutilizável para formulários de entidade (criar/editar).
 * Coloque o conteúdo do formulário em children e botões em footer.
 */
export function EntityFormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  contentClassName,
}: EntityFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-[calc(100vw-2rem)] sm:max-w-[425px] max-h-[85vh] overflow-hidden grid grid-rows-[auto,1fr,auto]",
          contentClassName,
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div
          className={cn(
            "overflow-y-auto overflow-x-hidden scrollbar-thin min-w-0",
            "px-4 sm:px-6 py-4",
            footer && "pb-6"
          )}
        >
          {children}
        </div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
