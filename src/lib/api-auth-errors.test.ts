import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api, ApiError, AuthError } from "./api";
import {
  loginErrorMessage,
  LOGIN_CONNECTION_MESSAGE,
  LOGIN_CREDENTIALS_MESSAGE,
  LOGIN_RATE_LIMIT_MESSAGE,
} from "./auth-errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("api(): 401 de formulário não desloga", () => {
  const original = window.location;
  beforeEach(() => {
    localStorage.setItem("token", "tok");
    localStorage.setItem("profile", "{}");
    Object.defineProperty(window, "location", { value: { href: "/app/configuracoes" }, writable: true, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "location", { value: original, writable: true, configurable: true });
    localStorage.clear();
  });

  it("senha atual incorreta (401 em /api/auth/password) mostra o erro e MANTÉM a sessão", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Senha atual incorreta" })));
    const err = (await api("/api/auth/password", { method: "PATCH", body: "{}" }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe("Senha atual incorreta");
    expect(localStorage.getItem("token")).toBe("tok");
    expect(localStorage.getItem("profile")).toBe("{}");
    expect(window.location.href).toBe("/app/configuracoes");
  });

  it("token expirado em /api/auth/password (401 com outra mensagem) ainda desloga", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Invalid or expired token" })));
    const err = (await api("/api/auth/password", { method: "PATCH", body: "{}" }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(AuthError);
    expect(localStorage.getItem("token")).toBeNull();
    expect(window.location.href).toBe("/login");
  });

  it("401 em outras rotas continua deslogando (sessão expirada)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Unauthorized" })));
    const err = (await api("/api/clients").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(AuthError);
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("401 no login vira ApiError(401) sem redirecionar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, {})));
    const err = (await api("/api/auth/login", { method: "POST", body: "{}" }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(window.location.href).toBe("/app/configuracoes");
  });
});

describe("loginErrorMessage: nada de mensagem de desenvolvedor", () => {
  it("401 → credenciais; 5xx/rede/timeout/erro desconhecido → conexão; 429 → muitas tentativas", () => {
    expect(loginErrorMessage(new ApiError("x", 401))).toBe(LOGIN_CREDENTIALS_MESSAGE);
    expect(loginErrorMessage(new ApiError("Internal Server Error", 500))).toBe(LOGIN_CONNECTION_MESSAGE);
    expect(loginErrorMessage(new ApiError("Bad Gateway", 502))).toBe(LOGIN_CONNECTION_MESSAGE);
    expect(loginErrorMessage(new ApiError("slow down", 429))).toBe(LOGIN_RATE_LIMIT_MESSAGE);
    expect(loginErrorMessage(new TypeError("Failed to fetch"))).toBe(LOGIN_CONNECTION_MESSAGE);
    expect(loginErrorMessage(new Error("A requisição demorou demais. Tente novamente."))).toBe(LOGIN_CONNECTION_MESSAGE);
    expect(loginErrorMessage(undefined)).toBe(LOGIN_CONNECTION_MESSAGE);
  });

  it("nenhuma mensagem menciona porta, API ou backend", () => {
    for (const m of [LOGIN_CONNECTION_MESSAGE, LOGIN_CREDENTIALS_MESSAGE, LOGIN_RATE_LIMIT_MESSAGE]) {
      expect(m).not.toMatch(/3003|backend|API|ECONNREFUSED|fetch/i);
    }
  });
});
