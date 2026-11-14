import { Link } from "react-router-dom";
import { PRIVACY_POLICY_PATH, openConsentPreferences } from "@/lib/tracking";
import { cn } from "@/lib/utils";

/** Rodapé mínimo com a Política de Privacidade e o atalho para rever o consentimento de cookies de marketing. */
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
      <span aria-hidden="true" className="mx-2">
        ·
      </span>
      <Link to={PRIVACY_POLICY_PATH} className="underline underline-offset-4 transition-colors hover:text-white/70">
        Política de Privacidade
      </Link>
    </footer>
  );
}
