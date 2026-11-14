import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  captureAttributionFromSearch,
  clearMarketingStorage,
  hasMarketingConsent,
  loadPixelsIfAllowed,
  observePlansSection,
  trackPageView,
} from "@/lib/tracking";

/**
 * Captura UTMs (só com aceite), dispara PageView (só nas páginas de marketing, sem query/tokens)
 * e observa a seção de planos. As rotas com dados ou tokens na URL (/login?reset_token, /onboarding?session_id,
 * /reagendar, /cancelar, /b, /app…) são barradas dentro de `tracking.ts` (preparePixelLocation).
 */
export function TrackingRoot() {
  const location = useLocation();

  // Sem aceite, não deve restar cookie de pixel nem atribuição de uma visita anterior.
  useEffect(() => {
    if (!hasMarketingConsent()) clearMarketingStorage();
  }, []);

  useEffect(() => {
    captureAttributionFromSearch(location.search);
  }, [location.search]);

  useEffect(() => {
    loadPixelsIfAllowed();
    trackPageView(location.pathname);
  }, [location.pathname, location.search]);

  useEffect(() => {
    return observePlansSection("planos");
  }, [location.pathname]);

  return null;
}
