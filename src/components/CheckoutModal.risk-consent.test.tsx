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
import { WHATSAPP_RISK_NOTICE_TEXT, WHATSAPP_RISK_NOTICE_VERSION } from "@/lib/whatsapp-risk-notice";

function fillForm() {
  fireEvent.change(document.getElementById("barbershop_name")!, { target: { value: "Barbearia Teste" } });
  fireEvent.change(document.getElementById("phone")!, { target: { value: "45999990000" } });
  fireEvent.change(document.getElementById("email")!, { target: { value: "dono@example.test" } });
}

describe("CheckoutModal: aceite do aviso do WhatsApp antes de pagar", () => {
  beforeEach(() => {
    createCheckout.mockClear();
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  });

  it("mostra o aviso na íntegra e a caixa desmarcada; o botão de pagar fica desativado sem o aceite", () => {
    render(<CheckoutModal open onOpenChange={() => {}} />);
    fillForm();
    expect(screen.getByTestId("whatsapp-risk-notice").textContent).toContain(WHATSAPP_RISK_NOTICE_TEXT);
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("button", { name: /Ir para pagamento/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sem marcar não envia nada ao servidor (nem forçando o submit do formulário)", async () => {
    render(<CheckoutModal open onOpenChange={() => {}} />);
    fillForm();
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/aceite do aviso/i));
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("marcando a caixa habilita o botão e envia o aceite com a versão do texto", async () => {
    render(<CheckoutModal open onOpenChange={() => {}} />);
    fillForm();
    fireEvent.click(screen.getByRole("checkbox"));
    const btn = screen.getByRole("button", { name: /Ir para pagamento/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(createCheckout).toHaveBeenCalledTimes(1));
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ whatsapp_risk_accepted: true, whatsapp_risk_notice_version: WHATSAPP_RISK_NOTICE_VERSION, email: "dono@example.test" }),
    );
  });

  it("desmarcar de novo volta a bloquear", () => {
    render(<CheckoutModal open onOpenChange={() => {}} />);
    fillForm();
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    fireEvent.click(box);
    expect((screen.getByRole("button", { name: /Ir para pagamento/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
