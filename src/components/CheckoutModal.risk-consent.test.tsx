import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Radix (checkbox/dialog) usa ResizeObserver, ausente no jsdom.
vi.hoisted(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const createCheckout = vi.fn(async () => ({ url: "https://checkout.example/s" }));
vi.mock("@/lib/api", () => ({
  billingApi: { createCheckout: (...a: unknown[]) => (createCheckout as (...x: unknown[]) => unknown)(...a), createEmbeddedCheckout: vi.fn() },
}));

import { CheckoutModal } from "./CheckoutModal";
import { WHATSAPP_RISK_NOTICE_TEXT, WHATSAPP_RISK_NOTICE_VERSION, WHATSAPP_RISK_REQUIRED_MESSAGE } from "@/lib/whatsapp-risk-notice";

function fillAndReachPlan() {
  fireEvent.change(document.getElementById("checkout-email")!, { target: { value: "dono@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.change(document.getElementById("checkout-phone")!, { target: { value: "45999990000" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.change(document.getElementById("checkout-name")!, { target: { value: "Barbearia Teste" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("CheckoutModal: aceite do aviso do WhatsApp antes de pagar", () => {
  beforeEach(() => {
    createCheckout.mockClear();
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  });

  it("mostra o aviso na íntegra e a caixa desmarcada; o botão de pagar NÃO fica desativado (o motivo aparece ao clicar)", () => {
    render(<CheckoutModal open onOpenChange={() => {}} />);
    fillAndReachPlan();
    expect(screen.getByTestId("whatsapp-risk-notice").textContent).toContain(WHATSAPP_RISK_NOTICE_TEXT);
    expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("button", { name: /Ir para pagamento/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("clicar em pagar sem aceitar mostra a mensagem, leva o foco à caixa e não envia nada", async () => {
    render(<CheckoutModal open onOpenChange={() => {}} />);
    fillAndReachPlan();
    fireEvent.click(screen.getByRole("button", { name: /Ir para pagamento/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(WHATSAPP_RISK_REQUIRED_MESSAGE));
    expect(document.activeElement).toBe(document.getElementById("whatsapp_risk"));
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("e-mail vazio segura o foco no passo atual; no plano, marcar a caixa limpa o aviso", async () => {
    render(<CheckoutModal open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("checkout-email")));
    expect(screen.queryByRole("checkbox")).toBeNull();
    fillAndReachPlan();
    fireEvent.click(screen.getByRole("button", { name: /Ir para pagamento/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(WHATSAPP_RISK_REQUIRED_MESSAGE));
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("sem marcar não envia nada ao servidor (nem forçando o submit do formulário)", async () => {
    render(<CheckoutModal open onOpenChange={() => {}} />);
    fillAndReachPlan();
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/aceite do aviso/i));
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("marcando a caixa envia o aceite com a versão do texto", async () => {
    render(<CheckoutModal open onOpenChange={() => {}} />);
    fillAndReachPlan();
    fireEvent.click(screen.getByRole("checkbox"));
    const btn = screen.getByRole("button", { name: /Ir para pagamento/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(createCheckout).toHaveBeenCalledTimes(1));
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ whatsapp_risk_accepted: true, whatsapp_risk_notice_version: WHATSAPP_RISK_NOTICE_VERSION, email: "dono@example.test" }),
    );
  });

  it("desmarcar de novo volta a exigir o aceite ao clicar", async () => {
    render(<CheckoutModal open onOpenChange={() => {}} />);
    fillAndReachPlan();
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /Ir para pagamento/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/aceite do aviso/i));
    expect(createCheckout).not.toHaveBeenCalled();
  });
});
