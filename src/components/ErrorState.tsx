import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  /** O que não carregou, em linguagem simples. */
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Estado de erro padrão das telas de dados: nunca deixa a falha parecer "lista vazia" ou "zero atendimentos".
 */
export function ErrorState({
  message = "Não conseguimos carregar os dados. Confira a internet e tente de novo.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
      <p className="text-sm font-medium text-foreground">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  );
}
