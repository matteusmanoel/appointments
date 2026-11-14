import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  captureAttributionFromSearch,
  loadPixelsIfAllowed,
  observePlansSection,
  trackPageView,
} from "@/lib/tracking";

/** Captura UTMs em toda navegação SPA, dispara PageView e observa a seção de planos. */
export function TrackingRoot() {
  const location = useLocation();

  useEffect(() => {
    captureAttributionFromSearch(location.search);
  }, [location.search]);

  useEffect(() => {
    loadPixelsIfAllowed();
    trackPageView(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  useEffect(() => {
    return observePlansSection("planos");
  }, [location.pathname]);

  return null;
}
