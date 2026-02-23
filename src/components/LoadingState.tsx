import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  /** When true, uses min-h-screen and centers in viewport (e.g. ProtectedRoute, Onboarding). */
  fullPage?: boolean;
  className?: string;
}

export function LoadingState({ fullPage, className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4",
        fullPage ? "min-h-screen w-full" : "min-h-[200px] w-full py-8",
        className,
      )}
    >
      <div className="w-full max-w-sm space-y-3 px-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}
