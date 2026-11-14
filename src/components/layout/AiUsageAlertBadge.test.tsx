import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { AiUsageAlertBadge } from "./AiUsageAlertBadge";
import {
  AI_HARD_CAP_BADGE_TEXT,
  aiThresholdBadgeText,
  aiUsageAlertLevel,
  aiUsagePercent,
} from "./ai-usage-alert";

vi.mock("@/lib/api", () => ({
  whatsappApi: {
    getUsage: vi.fn(),
  },
}));

import { whatsappApi } from "@/lib/api";

const getUsage = vi.mocked(whatsappApi.getUsage);

function renderBadge() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AiUsageAlertBadge />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("aiUsageAlertLevel", () => {
  it("não alerta com plano sem IA (limite 0), mesmo com hardExceeded", () => {
    expect(aiUsageAlertLevel({ used: 3, limit: 0, hardExceeded: true })).toBeNull();
  });
  it("teto prevalece sobre o aviso de 80%", () => {
    expect(aiUsageAlertLevel({ used: 1000, limit: 500, hardExceeded: true, thresholdExceeded: true })).toBe("hard_cap");
  });
  it("aviso leve no limiar, inclusive quando a API já manda thresholdExceeded", () => {
    expect(aiUsageAlertLevel({ used: 400, limit: 500, hardExceeded: false })).toBe("threshold");
    expect(aiUsageAlertLevel({ used: 399, limit: 500, hardExceeded: false })).toBeNull();
    expect(aiUsageAlertLevel({ used: 100, limit: 500, hardExceeded: false, thresholdExceeded: true })).toBe("threshold");
    expect(aiUsagePercent(400, 500)).toBe(80);
    expect(aiThresholdBadgeText(400, 500)).toBe("Uso de IA em 80% do limite do plano este mês");
  });
});

describe("AiUsageAlertBadge", () => {
  it("mostra o badge de teto com o texto em pt-BR", async () => {
    getUsage.mockResolvedValue({
      used: 1000,
      limit: 500,
      softExceeded: true,
      hardExceeded: true,
      billingPlan: "pro",
      thresholdPct: 80,
      thresholdExceeded: true,
    });
    renderBadge();
    await waitFor(() => expect(screen.getByText(AI_HARD_CAP_BADGE_TEXT)).toBeInTheDocument());
    expect(AI_HARD_CAP_BADGE_TEXT).toBe(
      "Limite de IA atingido: o atendimento automático parou de responder seus clientes até o próximo ciclo. Responda manualmente ou faça upgrade.",
    );
    expect(screen.getByText("Limite de IA")).toBeInTheDocument();
  });

  it("mostra o aviso leve em 80% e não mostra nada abaixo do limiar ou se a API falhar", async () => {
    getUsage.mockResolvedValue({
      used: 400,
      limit: 500,
      softExceeded: false,
      hardExceeded: false,
      billingPlan: "pro",
      thresholdPct: 80,
      thresholdExceeded: true,
    });
    const { unmount } = renderBadge();
    await waitFor(() => expect(screen.getByText("Uso de IA em 80% do limite do plano este mês")).toBeInTheDocument());
    unmount();

    getUsage.mockResolvedValue({
      used: 10,
      limit: 500,
      softExceeded: false,
      hardExceeded: false,
      billingPlan: "pro",
      thresholdPct: 80,
      thresholdExceeded: false,
    });
    const r2 = renderBadge();
    await waitFor(() => expect(getUsage).toHaveBeenCalled());
    expect(r2.container).toBeEmptyDOMElement();
    r2.unmount();

    getUsage.mockRejectedValue(new Error("rede"));
    const r3 = renderBadge();
    await waitFor(() => expect(getUsage).toHaveBeenCalled());
    expect(r3.container).toBeEmptyDOMElement();
  });
});
