import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  helpText?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: "default" | "accent" | "success";
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  helpText,
  trend,
  variant = "default",
}: StatCardProps) {
  return (
    <div className="stat-card animate-fade-in">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {helpText && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label={`Ajuda sobre ${title}`}
                  >
                    <Info className="w-3 h-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{helpText}</TooltipContent>
              </Tooltip>
            )}
          </div>
          <p
            className={cn(
              "text-2xl font-semibold",
              variant === "accent" && "text-accent",
              variant === "success" && "text-success"
            )}
          >
            {value}
          </p>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
          {trend && (
            <div
              className={cn(
                "flex items-center gap-1 mt-2 text-sm font-medium",
                trend.isPositive ? "text-success" : "text-destructive"
              )}
            >
              {trend.isPositive ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span>{trend.value}%</span>
              <span className="text-muted-foreground font-normal">vs ontem</span>
            </div>
          )}
        </div>
        <div
          className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center",
            variant === "default" && "bg-primary/10 text-primary",
            variant === "accent" && "bg-accent/10 text-accent",
            variant === "success" && "bg-success/10 text-success"
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
