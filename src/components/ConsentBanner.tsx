import { useEffect, useId, useState } from "react";
import {
  CONSENT_OPEN_EVENT,
  getConsentChoice,
  hasPixelIds,
  setConsent,
  trackPageView,
} from "@/lib/tracking";

/**
 * Banner mínimo e acessível de consentimento (LGPD) para pixels de marketing.
 * Só aparece quando há ID de pixel no build e o visitante ainda não escolheu
 * (ou pediu para mudar pelo link «Cookies» do rodapé).
 */
export function ConsentBanner() {
  const titleId = useId();
  const descId = useId();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    setAvailable(hasPixelIds());
    setOpen(hasPixelIds() && getConsentChoice() === null);
    const onOpen = () => setOpen(true);
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, onOpen);
  }, []);

  if (!available || !open) return null;

  const choose = (choice: "granted" | "denied") => {
    setConsent(choice);
    setOpen(false);
    if (choice === "granted") {
      trackPageView(window.location.pathname);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-x-0 bottom-0 z-[80] p-4 pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-2xl rounded-2xl border border-white/15 bg-[#121212]/95 p-4 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md text-left">
        <h2 id={titleId} className="text-sm font-semibold text-white">
          Cookies de marketing
        </h2>
        <p id={descId} className="mt-2 text-sm text-white/70 leading-relaxed">
          Se você aceitar, usamos cookies da Meta e do TikTok só para medir anúncios
          (visitas, início de checkout e compra). Sem o aceite, esses scripts não
          são carregados e nenhum evento é enviado. A escolha fica neste navegador
          e pode ser alterada no link Cookies do rodapé.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:border-white/30 hover:text-white"
          >
            Recusar
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_hsl(239_84%_62%/0.4)] hover:bg-primary/90"
          >
            Aceitar
          </button>
        </div>
      </div>
    </div>
  );
}
