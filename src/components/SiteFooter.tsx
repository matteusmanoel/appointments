import { openConsentPreferences } from "@/lib/tracking";
import { cn } from "@/lib/utils";

/** Rodapé mínimo com o atalho para rever o consentimento de cookies de marketing. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("border-t border-white/8 px-4 py-6 pb-24 text-center text-xs text-white/40 md:pb-6", className)}>
      <button
        type="button"
        onClick={openConsentPreferences}
        className="underline underline-offset-4 transition-colors hover:text-white/70"
      >
        Cookies
      </button>
    </footer>
  );
}
