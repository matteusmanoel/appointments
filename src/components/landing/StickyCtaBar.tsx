import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  onCtaClick: () => void;
  className?: string;
};

export function StickyCtaBar({ onCtaClick, className }: Props) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur",
        "px-4 py-3",
        className
      )}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">Assine a partir de R$ 97/mês</p>
          <p className="text-xs text-muted-foreground truncate">
            Checkout seguro Stripe • Sem fidelidade • Cancele quando quiser
          </p>
        </div>
        <Button onClick={onCtaClick} className="shrink-0">
          Assinar agora
        </Button>
      </div>
    </div>
  );
}

