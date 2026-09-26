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
          <p className="text-sm font-medium truncate">Sua secretária no WhatsApp, 24 horas</p>
          <p className="text-xs text-muted-foreground truncate">
            Pronto em 30 min • Sem fidelidade • Cancele quando quiser
          </p>
        </div>
        <Button onClick={onCtaClick} className="lp-shimmer shrink-0 shadow-[0_0_16px_hsl(239_84%_62%/0.4)]">
          Quero minha secretária
        </Button>
      </div>
    </div>
  );
}

