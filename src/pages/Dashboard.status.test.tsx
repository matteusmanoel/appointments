import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "./Dashboard";

const { mockWhatsappGet, mockSummaryGet } = vi.hoisted(() => ({
  mockWhatsappGet: vi.fn(),
  mockSummaryGet: vi.fn(),
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
    appointmentsApi: { list: vi.fn(() => Promise.resolve([])) },
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

describe("Dashboard status block", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhatsappGet.mockResolvedValue({ connected: false, status: "disconnected" });
    mockSummaryGet.mockResolvedValue({ queued: 0, sent: 0, failed: 0, skipped: 0 });
  });

  it("renders status block with WhatsApp and automations", async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/WhatsApp:/)).toBeInTheDocument();
    });
    expect(screen.getByText("Desconectado")).toBeInTheDocument();
  });

  it("shows Conectar WhatsApp link when WhatsApp is disconnected", async () => {
    mockWhatsappGet.mockResolvedValue({ connected: false, status: "disconnected" });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Desconectado")).toBeInTheDocument();
    });
    const link = screen.getByRole("link", { name: /Conectar WhatsApp/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/configuracoes?tab=whatsapp");
  });

  it("shows Conectado when WhatsApp is connected", async () => {
    mockWhatsappGet.mockResolvedValue({ connected: true, status: "connected" });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Conectado")).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: /Conectar WhatsApp/i })).not.toBeInTheDocument();
  });

  it("shows automations summary with failed count when failed > 0", async () => {
    mockSummaryGet.mockResolvedValue({ queued: 2, sent: 10, failed: 3, skipped: 1 });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/2 na fila/)).toBeInTheDocument();
    });
    expect(screen.getByText(/3 falhas/)).toBeInTheDocument();
    expect(screen.getByText(/1 ignoradas/)).toBeInTheDocument();
  });

  it("does not break when getScheduledMessagesSummary fails", async () => {
    mockSummaryGet.mockRejectedValue(new Error("Network error"));
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/WhatsApp:/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Salve,/)).toBeInTheDocument();
  });

  it("does not break when whatsappApi.get fails", async () => {
    mockWhatsappGet.mockRejectedValue(new Error("Network error"));
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/Salve,/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Salve,/)).toBeInTheDocument();
  });
});
