import { fireEvent, render, screen } from "@testing-library/react";
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
const rescheduleAppointmentByToken = vi.fn();
const cancelAppointmentByToken = vi.fn();
let shopPhone: string | undefined = undefined;
vi.mock("@/lib/api", () => ({
  publicApi: {
    getBarbershop: vi.fn(async () => ({ name: "Barbearia Teste", slug: "teste", phone: shopPhone })),
    getServices: vi.fn(async () => [{ id: "s1", name: "Corte", price: 40, duration_minutes: 30 }]),
    getBarbers: vi.fn(async () => [{ id: "b1", name: "João", schedule: null }]),
    getAvailability: vi.fn(async () => []),
    createAppointment: (...a: unknown[]) => createAppointment(...a),
    rescheduleAppointmentByToken: (...a: unknown[]) => rescheduleAppointmentByToken(...a),
    cancelAppointmentByToken: (...a: unknown[]) => cancelAppointmentByToken(...a),
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
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.change(await screen.findByPlaceholderText("(11) 98765-4321"), { target: { value: "11987654321" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  await screen.findByText("Agendamento solicitado!");
}

describe("PublicBooking: tela de sucesso do cliente", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 16, 6, 0, 0));
    createAppointment.mockReset();
    rescheduleAppointmentByToken.mockReset();
    cancelAppointmentByToken.mockReset();
    createAppointment.mockResolvedValue({ public_token: "tok123" });
    rescheduleAppointmentByToken.mockResolvedValue({ id: "apt1" });
    cancelAppointmentByToken.mockResolvedValue({ ok: true, message: "Agendamento cancelado" });
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

  it("com telefone, oferece Reagendar, Cancelar e WhatsApp, sem links de copiar", async () => {
    shopPhone = "11988887777";
    renderPage();
    await bookUntilSuccess();
    expect(screen.getByRole("button", { name: "Reagendar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    const href = screen.getByRole("link", { name: "WhatsApp" }).getAttribute("href") ?? "";
    expect(href).toContain("wa.me/5511988887777");
    const text = decodeURIComponent(href.split("text=")[1] ?? "");
    expect(text).toContain("Olá! Gostaria de confirmar meu agendamento na Barbearia Teste.");
    expect(text).toContain("*Serviços:*\n• Corte — R$ 40,00");
    expect(text).toContain("*Horário:* 10:00");
    expect(text).toContain("*Barbeiro:* João");
    expect(text).toContain("*Cliente:* Cliente Teste");
    expect(text).toContain("*Telefone:* (11) 98765-4321");
    expect(text).toContain("*Total:* R$ 40,00");
    expect(screen.queryByRole("link", { name: /reagendar/i })).toBeNull();
    expect(screen.queryByText(/Copiar link/)).toBeNull();
  });

  it("Reagendar retoma o fluxo com a escolha anterior e confirma pelo reagendamento", async () => {
    renderPage();
    await bookUntilSuccess();
    fireEvent.click(screen.getByRole("button", { name: "Reagendar" }));
    expect(screen.queryByText("RESUMO")).toBeNull();
    expect(screen.queryByText(/Etapa/)).toBeNull();
    const corte = screen.getByRole("button", { name: /Corte/ });
    expect(corte).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("button", { name: "João" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("button", { name: "10:00" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("RESUMO")).toBeInTheDocument();
    expect(screen.queryByText("Pedido")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByText("Agendamento solicitado!");
    expect(rescheduleAppointmentByToken).toHaveBeenCalledWith(
      "tok123",
      expect.objectContaining({
        scheduled_date: "2026-11-16",
        scheduled_time: "10:00",
        barber_id: "b1",
      }),
    );
    expect(createAppointment).toHaveBeenCalledTimes(1);
  });

  it("Cancelar pede confirmação e só então chama a API", async () => {
    renderPage();
    await bookUntilSuccess();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Cancelar este horário?")).toBeInTheDocument();
    expect(screen.getByText("Você ainda pode remarcar num melhor horário.")).toBeInTheDocument();
    expect(screen.queryByText("Essa ação não pode ser desfeita.")).toBeNull();
    expect(cancelAppointmentByToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar horário" }));
    await screen.findByText("Agendamento cancelado");
    expect(cancelAppointmentByToken).toHaveBeenCalledWith("tok123");
    fireEvent.click(screen.getByRole("button", { name: "Reagendar" }));
    expect(screen.queryByText("Agendamento cancelado")).toBeNull();
    expect(screen.getByRole("button", { name: /Corte/ })).toHaveAttribute("aria-pressed", "true");
  });
});
