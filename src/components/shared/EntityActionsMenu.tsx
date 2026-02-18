import { MoreVertical, Pencil, Trash2, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type EntityAction = "edit" | "delete" | "activate" | "deactivate";

interface EntityActionsMenuProps {
  onEdit?: () => void;
  onDelete?: () => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
  isActive?: boolean;
  /** quais ações mostrar; default: edit + delete (e activate/deactivate se isActive !== undefined) */
  actions?: EntityAction[];
  "aria-label"?: string;
}

export function EntityActionsMenu({
  onEdit,
  onDelete,
  onActivate,
  onDeactivate,
  isActive,
  actions = ["edit", "delete"],
  "aria-label": ariaLabel = "Abrir menu de ações",
}: EntityActionsMenuProps) {
  const showEdit = actions.includes("edit") && onEdit;
  const showDelete = actions.includes("delete") && onDelete;
  const showActivate = actions.includes("activate") && onActivate && isActive === false;
  const showDeactivate = actions.includes("deactivate") && onDeactivate && isActive === true;

  if (!showEdit && !showDelete && !showActivate && !showDeactivate) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={ariaLabel}>
          <MoreVertical className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </DropdownMenuItem>
        )}
        {showActivate && (
          <DropdownMenuItem onClick={onActivate}>
            <UserCheck className="mr-2 h-4 w-4" />
            Ativar
          </DropdownMenuItem>
        )}
        {showDeactivate && (
          <DropdownMenuItem onClick={onDeactivate}>
            <UserX className="mr-2 h-4 w-4" />
            Desativar
          </DropdownMenuItem>
        )}
        {showDelete && (
          <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            Excluir
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
