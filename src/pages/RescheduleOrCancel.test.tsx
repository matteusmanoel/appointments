import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RescheduleOrCancel from "./RescheduleOrCancel";

vi.mock("@/lib/api", async (orig) => {
  const mod = await orig<typeof import("@/lib/api")>();
  return {
    ...mod,
    publicApi: {
      ...mod.publicApi,
      getAppointmentByToken: vi.fn(),
      getBarbershop: vi.fn(),
      getBarbers: vi.fn(async () => []),
      getAvailability: vi.fn(async () => []),
      cancelAppointmentByToken: vi.fn(),
    },
  };
});
import { publicApi } from "@/lib/api";

function pad(n: number) { return String(n).padStart(2, "0"); }
function appt(hoursAhead: number) {
  const d = new Date(Date.now() + hoursAhead * 3600_000);
  return {
    id: "a1", barbershop_id: "b1", barber_id: "x", scheduled_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    scheduled_time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, duration_minutes: 30, status: "pending", barbershop_name: "Barbearia X", slug: "bx", service_names: "Corte",
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/cancelar/tok"]}>
        <Routes><Route path="/cancelar/:token" element={<RescheduleOrCancel />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RescheduleOrCancel", () => {
  beforeEach(() => {
    vi.mocked(publicApi.getBarbershop).mockResolvedValue({ name: "Barbearia X", phone: "5511999990001" } as never);
  });

  it("mostra a regra das 2 h antes de qualquer ação", async () => {
    vi.mocked(publicApi.getAppointmentByToken).mockResolvedValue(appt(10) as never);
    renderPage();
    expect(await screen.findByTestId("regra-2h")).toHaveTextContent(/2 horas antes/);
  });

  it("falha do cancelamento aparece na tela com a mensagem da API e link para o WhatsApp", async () => {
    vi.mocked(publicApi.getAppointmentByToken).mockResolvedValue(appt(10) as never);
    vi.mocked(publicApi.cancelAppointmentByToken).mockRejectedValue(new Error("Só é possível cancelar até 2 horas antes do horário"));
    renderPage();
    fireEvent.click(await screen.findByText("Sim, cancelar"));
    fireEvent.click(await screen.findByText("Confirmar cancelamento"));
    const err = await screen.findByTestId("erro-acao");
    expect(err).toHaveTextContent(/2 horas antes/);
    expect(err.querySelector("a")?.getAttribute("href")).toContain("wa.me/5511999990001");
  });

  it("a menos de 2 h: botão desabilitado e aviso explicando o motivo", async () => {
    vi.mocked(publicApi.getAppointmentByToken).mockResolvedValue(appt(1) as never);
    renderPage();
    fireEvent.click(await screen.findByText("Sim, cancelar"));
    const btn = await screen.findByText("Confirmar cancelamento");
    await waitFor(() => expect(btn.closest("button")).toBeDisabled());
    expect(screen.getByRole("alert")).toHaveTextContent(/menos de 2 horas/);
  });
});

describe("RescheduleOrCancel: falha ao carregar o agendamento", () => {
  beforeEach(() => {
    vi.mocked(publicApi.getBarbershop).mockResolvedValue({ name: "Barbearia X", phone: "5511999990001" } as never);
    vi.mocked(publicApi.getAppointmentByToken).mockReset();
  });

  it("404 diz que não foi encontrado/cancelado, sem botão de tentar de novo", async () => {
    vi.mocked(publicApi.getAppointmentByToken).mockRejectedValue(Object.assign(new Error("Agendamento não encontrado ou já cancelado"), { status: 404 }));
    renderPage();
    expect(await screen.findByText(/não encontrado ou já cancelado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tentar de novo/ })).toBeNull();
  });

  it("5xx/rede NÃO diz 'cancelado': mostra erro de carregamento e 'Tentar de novo' refaz a consulta", async () => {
    vi.mocked(publicApi.getAppointmentByToken).mockRejectedValueOnce(Object.assign(new Error("Bad Gateway"), { status: 502 }));
    renderPage();
    expect(await screen.findByTestId("erro-carregar")).toHaveTextContent(/Não conseguimos carregar o seu agendamento/);
    expect(screen.queryByText(/já cancelado/)).toBeNull();
    vi.mocked(publicApi.getAppointmentByToken).mockResolvedValue(appt(10) as never);
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(await screen.findByTestId("regra-2h")).toBeInTheDocument();
  });

  it("erro de rede sem status também é tratado como falha temporária", async () => {
    vi.mocked(publicApi.getAppointmentByToken).mockRejectedValue(new TypeError("Failed to fetch"));
    renderPage();
    expect(await screen.findByTestId("erro-carregar")).toBeInTheDocument();
  });

  it("a tela de cancelar oferece reagendar e vice-versa", async () => {
    vi.mocked(publicApi.getAppointmentByToken).mockResolvedValue(appt(10) as never);
    renderPage();
    const box = await screen.findByTestId("trocar-acao");
    expect(box.querySelector("a")?.getAttribute("href")).toBe("/reagendar/tok");
  });
});
