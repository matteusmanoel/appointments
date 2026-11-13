import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthError } from "./api";
import { shouldRetryQuery, MAX_QUERY_RETRIES } from "./query-retry";
// A configuração REAL do app (não `retry: false`): é ela que mantinha o skeleton para sempre.
import { queryClient } from "@/App";
import PublicBooking from "@/pages/PublicBooking";
import RescheduleOrCancel from "@/pages/RescheduleOrCancel";

describe("shouldRetryQuery", () => {
  it("não repete 401/4xx; repete rede e 5xx no máximo duas vezes", () => {
    expect(shouldRetryQuery(0, new AuthError())).toBe(false);
    expect(shouldRetryQuery(0, Object.assign(new Error("x"), { status: 404 }))).toBe(false);
    expect(shouldRetryQuery(0, Object.assign(new Error("x"), { status: 429 }))).toBe(false);
    expect(shouldRetryQuery(0, Object.assign(new Error("x"), { status: 500 }))).toBe(true);
    expect(shouldRetryQuery(1, Object.assign(new Error("x"), { status: 503 }))).toBe(true);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, Object.assign(new Error("x"), { status: 503 }))).toBe(false);
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(2, new TypeError("Failed to fetch"))).toBe(false);
  });

  it("o QueryClient do app usa essa política", () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
  });
});

describe("telas públicas com o QueryClient real do app (sem backend)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it("/b/:slug sem backend (fetch falha) chega ao estado de erro em poucos segundos, sem skeleton infinito", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/b/minha-barbearia"]}>
          <Routes>
            <Route path="/b/:slug" element={<PublicBooking />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText(/Barbearia não encontrada/)).toBeInTheDocument(), { timeout: 9000 });
    // 1 tentativa + no máximo 2 repetições para a query da barbearia
    const shopCalls = fetchMock.mock.calls.filter(([url]) => /\/api\/public\/minha-barbearia$/.test(String(url)));
    expect(shopCalls.length).toBe(1 + MAX_QUERY_RETRIES);
  }, 15000);

  it("/reagendar/:token com 404 mostra o erro na hora (4xx não repete)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "Agendamento não encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/reagendar/abc"]}>
          <Routes>
            <Route path="/reagendar/:token" element={<RescheduleOrCancel />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText(/Agendamento não encontrado ou já cancelado/)).toBeInTheDocument(), { timeout: 2500 });
    const appCalls = fetchMock.mock.calls.filter(([url]) => /\/api\/public\/appointments\/abc$/.test(String(url)));
    expect(appCalls.length).toBe(1);
  });

  it("/reagendar/:token sem backend (5xx) também termina em erro (2 repetições)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/reagendar/abc"]}>
          <Routes>
            <Route path="/reagendar/:token" element={<RescheduleOrCancel />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    // 5xx não pode parecer «agendamento cancelado»: mostra erro de carregamento (com «Tentar de novo»).
    await waitFor(() => expect(screen.getByText(/Não conseguimos carregar o seu agendamento/)).toBeInTheDocument(), { timeout: 9000 });
  }, 15000);
});
