import { useQuery } from "@tanstack/react-query";
import { whatsappApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  AI_HARD_CAP_BADGE_TEXT,
  aiThresholdBadgeText,
  aiUsageAlertLevel,
} from "./ai-usage-alert";

const USAGE_QUERY_KEY = ["integrations", "whatsapp", "usage"] as const;

/** Badge de alerta no painel admin quando o tenant chega a 80% ou ao teto de IA no período atual. */
export function AiUsageAlertBadge() {
  const { data: usage } = useQuery({
    queryKey: USAGE_QUERY_KEY,
    queryFn: () => whatsappApi.getUsage(),
    staleTime: 60_000,
    retry: false,
  });

  if (!usage) return null;
  const level = aiUsageAlertLevel(usage);
  if (!level) return null;

  const isHard = level === "hard_cap";
  const text = isHard ? AI_HARD_CAP_BADGE_TEXT : aiThresholdBadgeText(usage.used, usage.limit);
  const label = isHard ? "Limite de IA" : "Uso de IA";

  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3 text-sm",
        isHard
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-500",
      )}
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0">
              <Badge
                variant={isHard ? "destructive" : "outline"}
                className={cn(
                  !isHard && "border-yellow-600/50 text-yellow-800 dark:text-yellow-400",
                )}
              >
                {label}
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent>{text}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span>{text}</span>
    </div>
  );
}
