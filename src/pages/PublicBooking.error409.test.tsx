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
vi.mock("@/lib/api", () => ({
  publicApi: {
    getBarbershop: vi.fn(async () => ({ name: "Barbearia Teste", slug: "teste", phone: "11999990000" })),
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

async function goToLastStep() {
  fireEvent.click(await screen.findByRole("button", { name: "Começar" }));
  fireEvent.click(await screen.findByText("Corte"));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.click(await screen.findByText("João"));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.click(await screen.findByRole("button", { name: "10:00" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.change(await screen.findByPlaceholderText(/Seu nome|Nome/i), { target: { value: "Cliente Teste" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.change(await screen.findByPlaceholderText("(11) 98765-4321"), { target: { value: "11987654321" } });
}

describe("PublicBooking: erro do passo 4 depois de um 409", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 16, 6, 0, 0)); // segunda 06:00 local: todos os horários de hoje estão livres
    createAppointment.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("erro comum aparece com role=alert; um 409 volta ao passo 3 sem deixar o erro velho; confirmar de novo não mostra o erro anterior", async () => {
    createAppointment.mockRejectedValueOnce(new Error("Falha temporária no servidor"));
    renderPage();
    await goToLastStep();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    const err = await screen.findByRole("alert");
    expect(err.textContent).toMatch(/Falha temporária/);

    // 2.ª tentativa: o servidor responde 409 (horário ocupado)
    createAppointment.mockRejectedValueOnce(Object.assign(new Error("Horário já ocupado para este barbeiro"), { status: 409 }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByText(/acabou de ser ocupado por outra pessoa/);
    // voltou ao passo 3: nenhum erro velho na tela
    expect(screen.queryByText(/Falha temporária/)).toBeNull();
    expect(screen.queryByText(/Horário já ocupado para este barbeiro/)).toBeNull();

    // escolhe outro horário e volta ao passo 5 (nome → telefone, já preenchidos): sem erro antigo
    fireEvent.click(await screen.findByRole("button", { name: "11:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    await screen.findByRole("button", { name: "Confirmar" });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
