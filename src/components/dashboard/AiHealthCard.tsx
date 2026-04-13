import { useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { whatsappApi } from "@/lib/api";
import { nativeAiUiEnabled } from "@/lib/native-ai-ui";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "react-router-dom";

export function AiHealthCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ai-health"],
    queryFn: () => whatsappApi.getAiHealth(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="stat-card animate-pulse">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-2">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-7 w-16 rounded bg-muted" />
            <div className="h-3 w-32 rounded bg-muted" />
          </div>
          <div className="w-12 h-12 rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="stat-card">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground mb-1">IA — Saúde</p>
            <p className="text-sm text-muted-foreground">WhatsApp não conectado</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center text-muted-foreground">
            <Bot className="w-6 h-6" />
          </div>
        </div>
      </div>
    );
  }

  const violationRate =
    data.total_messages > 0
      ? Math.round((data.messages_with_violations / data.total_messages) * 100)
      : 0;

  const isHealthy = !data.regression_detected && violationRate < 5;
  const isWarning = data.regression_detected || (violationRate >= 5 && violationRate < 15);
  const isCritical = violationRate >= 15;

  const statusLabel = isCritical
    ? "Atenção necessária"
    : isWarning
      ? "Verificar"
      : "Saudável";

  const StatusIcon = isCritical ? XCircle : isWarning ? AlertTriangle : CheckCircle2;
  const statusColor = isCritical
    ? "text-destructive"
    : isWarning
      ? "text-amber-500 dark:text-amber-400"
      : "text-success";
  const iconBg = isCritical
    ? "bg-destructive/10 text-destructive"
    : isWarning
      ? "bg-amber-500/10 text-amber-500 dark:text-amber-400"
      : "bg-success/10 text-success";

  const topViolation = data.by_violation
    ? Object.entries(data.by_violation).sort((a, b) => b[1] - a[1])[0]
    : null;

  const violationLabels: Record<string, string> = {
    ai_exposure: "exposição IA",
    phone_ask: "pediu telefone",
    uuid_leak: "vazou ID",
    excessive_emojis: "emojis excessivos",
    duplicate_confirmation: "confirmação dupla",
    missing_required_tool: "ferramenta não usada",
    loop_detected: "loop detectado",
    markdown_overuse: "formatação excessiva",
    false_closure: "fechamento falso",
    technical_apology: "desculpa técnica",
    past_time_suggestion: "horário no passado",
    pre_booking_claim: "agendou sem criar",
  };

  return (
    <div className="stat-card animate-fade-in">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground mb-1">IA — Saúde (7 dias)</p>
          <div className="flex items-center gap-1.5">
            <StatusIcon className={cn("w-4 h-4 flex-shrink-0", statusColor)} />
            <p className={cn("text-lg font-semibold", statusColor)}>{statusLabel}</p>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {data.total_messages} msgs · {violationRate}% c/ violação
          </p>
          {data.regression_detected && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">
              Regressão detectada nas últimas 24h
            </p>
          )}
          {topViolation && topViolation[1] > 0 && !isHealthy && (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-xs text-muted-foreground mt-1 truncate cursor-default">
                  Mais freq: {violationLabels[topViolation[0]] ?? topViolation[0]} ({topViolation[1]}×)
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Tipo de violação mais frequente no período
              </TooltipContent>
            </Tooltip>
          )}
          <Link
            to={
              nativeAiUiEnabled
                ? "/app/integracoes?step=preview"
                : "/app/integracoes?step=connect"
            }
            className="text-xs text-primary hover:underline mt-2 block"
          >
            Ver detalhes →
          </Link>
        </div>
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0", iconBg)}>
          <Bot className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
