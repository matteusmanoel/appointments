import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AgendaActivityFeed } from "./AgendaActivityFeed";

vi.mock("@/lib/api", () => ({
  reportsApi: {
    agendaActivity: vi.fn(() =>
      Promise.resolve({
        events: [
          {
            id: "act-1",
            type: "appointment_created",
            actor: "ai",
            client_name: "João",
            scheduled_date: "2026-09-20",
            scheduled_time: "14:00:00",
            summary: null,
            created_at: new Date().toISOString(),
            conversation_id: null,
          },
          {
            id: "act-2",
            type: "confirmed",
            actor: "ai",
            client_name: "Maria",
            scheduled_date: "2026-09-21",
            scheduled_time: "17:00:00",
            summary: null,
            created_at: new Date().toISOString(),
            conversation_id: null,
          },
          {
            id: "act-3",
            type: "payment_recognized",
            actor: "ai",
            client_name: "Pedro",
            scheduled_date: null,
            scheduled_time: null,
            summary: "PIX recebido",
            created_at: new Date().toISOString(),
            conversation_id: null,
          },
        ],
      }),
    ),
  },
}));

vi.mock("@/lib/native-ai-ui", () => ({ nativeAiUiEnabled: true }));

describe("AgendaActivityFeed", () => {
  it("shows the activity event from the tool create", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgendaActivityFeed />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Atividade da agenda")).toBeInTheDocument();
    });
    expect(screen.getByText(/João/)).toBeInTheDocument();
    expect(screen.getByText(/agendou/)).toBeInTheDocument();
    expect(screen.getByText(/confirmou presença/)).toBeInTheDocument();
    expect(screen.getByText(/PIX recebido/)).toBeInTheDocument();
  });
});
