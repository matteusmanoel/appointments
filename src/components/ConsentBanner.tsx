import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import {
  CONSENT_OPEN_EVENT,
  PRIVACY_POLICY_PATH,
  captureAttributionFromSearch,
  getConsentChoice,
  hasPixelIds,
  setConsent,
  trackPageView,
} from "@/lib/tracking";

/** Aparência única para os dois botões: Aceitar e Recusar têm o mesmo peso visual. */
const CHOICE_BUTTON_CLASS =
  "rounded-xl border border-white/40 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/**
 * Banner mínimo e acessível de consentimento (LGPD) para pixels de marketing.
 * Só aparece quando há ID de pixel no build e o visitante ainda não escolheu
 * (ou pediu para mudar pelo link «Cookies» do rodapé).
 * Se o texto abaixo mudar, mude também CONSENT_NOTICE_VERSION em `tracking.ts`.
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
    const { reloadRecommended } = setConsent(choice);
    setOpen(false);
    if (choice === "granted") {
      captureAttributionFromSearch(window.location.search);
      trackPageView(window.location.pathname);
    } else if (reloadRecommended) {
      // Só recarregar descarrega por completo os scripts da Meta e do TikTok já carregados.
      window.location.reload();
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
          Cookies e dados de marketing
        </h2>
        <p id={descId} className="mt-2 text-sm text-white/70 leading-relaxed">
          Se você aceitar, usamos cookies e identificadores da Meta e do TikTok para medir anúncios (visitas, início
          de checkout e compra). Também guardamos neste navegador, por até 90 dias, a origem do seu acesso (UTM e
          identificadores de clique) e a enviamos ao Stripe, nosso processador de pagamentos, junto com o checkout.
          Esses destinatários ficam fora do Brasil (transferência internacional de dados). Se você recusar, nenhum
          script é carregado e nada disso é coletado ou enviado. Você pode mudar a escolha a qualquer momento no
          link Cookies do rodapé. Detalhes na{" "}
          <Link to={PRIVACY_POLICY_PATH} className="underline underline-offset-4 hover:text-white">
            Política de Privacidade
          </Link>
          .
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => choose("denied")} className={CHOICE_BUTTON_CLASS}>
            Recusar
          </button>
          <button type="button" onClick={() => choose("granted")} className={CHOICE_BUTTON_CLASS}>
            Aceitar
          </button>
        </div>
      </div>
    </div>
  );
}
