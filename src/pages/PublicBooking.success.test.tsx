import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const createAppointment = vi.fn();
let shopPhone: string | undefined = undefined;
vi.mock("@/lib/api", () => ({
  publicApi: {
    getBarbershop: vi.fn(async () => ({ name: "Barbearia Teste", slug: "teste", phone: shopPhone })),
    getServices: vi.fn(async () => [{ id: "s1", name: "Corte", price: 40, duration_minutes: 30 }]),
    getBarbers: vi.fn(async () => [{ id: "b1", name: "João", schedule: null }]),
    getAvailability: vi.fn(async () => []),
    createAppointment: (...a: unknown[]) => createAppointment(...a),
  },
}));

import PublicBooking from "./PublicBooking";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/b/teste"]}>
        <Routes>
          <Route path="/b/:slug" element={<PublicBooking />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function bookUntilSuccess() {
  fireEvent.click(await screen.findByRole("button", { name: "Começar" }));
  fireEvent.click(await screen.findByText("Corte"));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.click(await screen.findByText("João"));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.click(await screen.findByRole("button", { name: "10:00" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.change(await screen.findByPlaceholderText(/Seu nome|Nome/i), { target: { value: "Cliente Teste" } });
  fireEvent.change(screen.getByPlaceholderText("(11) 99999-9999"), { target: { value: "11987654321" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  await screen.findByText("Agendamento solicitado!");
}

describe("PublicBooking: tela de sucesso do cliente", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 16, 6, 0, 0));
    createAppointment.mockReset();
    createAppointment.mockResolvedValue({ public_token: "tok123" });
    shopPhone = undefined;
  });
  afterEach(() => vi.useRealTimers());

  it("barbearia sem telefone: o cliente NÃO vê instrução de dono («Configurar WhatsApp»/«Configurações»)", async () => {
    renderPage();
    await bookUntilSuccess();
    expect(screen.queryByText(/Configurar WhatsApp/)).toBeNull();
    expect(screen.queryByText(/Configurações/)).toBeNull();
    expect(document.querySelector('a[href="/app/configuracoes"]')).toBeNull();
    expect(screen.getByText(/A barbearia vai confirmar o seu horário/)).toBeInTheDocument();
  });

  it("copiar link dá feedback e copia o link certo (reagendar e cancelar)", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    await bookUntilSuccess();
    fireEvent.click(screen.getByRole("button", { name: /Copiar link de reagendar/ }));
    await waitFor(() => expect(screen.getByTestId("copy-feedback")).toHaveTextContent("Link de reagendar copiado."));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/reagendar/tok123`);
    fireEvent.click(screen.getByRole("button", { name: /Copiar link de cancelar/ }));
    await waitFor(() => expect(screen.getByTestId("copy-feedback")).toHaveTextContent("Link de cancelar copiado."));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/cancelar/tok123`);
  });

  it("sem permissão para copiar, avisa em vez de falhar em silêncio", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
    renderPage();
    await bookUntilSuccess();
    fireEvent.click(screen.getByRole("button", { name: /Copiar link de reagendar/ }));
    await waitFor(() => expect(screen.getByTestId("copy-feedback")).toHaveTextContent(/Não foi possível copiar/));
  });
});
