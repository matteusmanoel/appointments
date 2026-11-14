import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "./Dashboard";
import { ErrorState } from "@/components/ErrorState";

const { mockWhatsappGet, mockSummaryGet, mockAppointmentsList } = vi.hoisted(() => ({
  mockWhatsappGet: vi.fn(),
  mockSummaryGet: vi.fn(),
  mockAppointmentsList: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { billing_plan: "essential" as const } }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    barbershopsApi: {
      get: vi.fn(() =>
        Promise.resolve({
          name: "Test Shop",
          business_hours: {
            monday: { start: "09:00", end: "18:00" },
            tuesday: { start: "09:00", end: "18:00" },
          },
        })
      ),
    },
    barbersApi: { list: vi.fn(() => Promise.resolve([])) },
    servicesApi: { list: vi.fn(() => Promise.resolve([])) },
    appointmentsApi: { list: mockAppointmentsList },
    whatsappApi: { get: mockWhatsappGet },
    integrationsApi: { getScheduledMessagesSummary: mockSummaryGet },
    reportsApi: {
      revenueByDay: vi.fn(() => Promise.resolve([])),
      topServices: vi.fn(() => Promise.resolve([])),
      mvpMetrics: vi.fn(() =>
        Promise.resolve({
          noShowRate7d: 0,
          noShowRate30d: 0,
          reminders: { sent: 0, failed: 0, skipped: 0 },
          followUps: { sent: 0, failed: 0, skipped: 0 },
        })
      ),
      agendaActivity: vi.fn(() => Promise.resolve({ events: [] })),
    },
  };
});

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}


describe("Dashboard: erro de API não vira zero atendimentos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhatsappGet.mockResolvedValue({ connected: true, status: "connected" });
    mockSummaryGet.mockResolvedValue({ queued: 0, sent: 0, failed: 0, skipped: 0 });
  });

  it("com a agenda falhando mostra ErrorState com 'Tentar de novo' e esconde 'N atendimentos confirmados'", async () => {
    mockAppointmentsList.mockRejectedValue(new Error("boom"));
    renderDashboard();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/Não conseguimos carregar a agenda/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tentar de novo/i })).toBeInTheDocument();
    expect(screen.queryByText(/atendimentos$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/confirmados\./)).not.toBeInTheDocument();
  });

  it("retry refaz a consulta e, ao dar certo, o aviso some e a contagem volta", async () => {
    let failing = true;
    mockAppointmentsList.mockImplementation(() => (failing ? Promise.reject(new Error("boom")) : Promise.resolve([])));
    renderDashboard();
    const btn = await screen.findByRole("button", { name: /Tentar de novo/i });
    failing = false;
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText(/0 atendimentos/)).toBeInTheDocument();
  });

  it("sem erro, o subtítulo normal aparece e não há alerta", async () => {
    mockAppointmentsList.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/0 atendimentos/)).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Dashboard: falha de API não vira 'R$ 0,00' nem 'Desconectado'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhatsappGet.mockResolvedValue({ connected: true, status: "connected" });
    mockSummaryGet.mockResolvedValue({ queued: 0, sent: 0, failed: 0, skipped: 0 });
  });

  it("agenda falhando: cartões mostram '—' e 'Indisponível agora', sem R$ 0,00", async () => {
    mockAppointmentsList.mockRejectedValue(new Error("boom"));
    renderDashboard();
    await screen.findByRole("button", { name: /Tentar de novo/i });
    expect(screen.queryByText(/R\$\s*0,00/)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("Indisponível agora").length).toBeGreaterThanOrEqual(4);
  });

  it("agenda ok e vazia continua mostrando zero de verdade", async () => {
    mockAppointmentsList.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/R\$\s*0,00/)).toBeInTheDocument());
    expect(screen.queryByText("Indisponível agora")).not.toBeInTheDocument();
  });

  it("WhatsApp indisponível não é exibido como 'Desconectado' e não oferece 'Conectar WhatsApp'", async () => {
    mockAppointmentsList.mockResolvedValue([]);
    mockWhatsappGet.mockRejectedValue(new Error("boom"));
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/não foi possível verificar/)).toBeInTheDocument());
    expect(screen.queryByText("Desconectado")).not.toBeInTheDocument();
    expect(screen.queryByText("Conectar WhatsApp →")).not.toBeInTheDocument();
  });

  it("WhatsApp respondendo desconectado continua como 'Desconectado' com o link de conectar", async () => {
    mockAppointmentsList.mockResolvedValue([]);
    mockWhatsappGet.mockResolvedValue({ connected: false, status: "disconnected" });
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Desconectado")).toBeInTheDocument());
    expect(screen.getByText("Conectar WhatsApp →")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("chama onRetry ao clicar e não mostra botão sem onRetry", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState message="Falhou" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<ErrorState message="Falhou" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
