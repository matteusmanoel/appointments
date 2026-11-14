import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Privacidade from "./Privacidade";

describe("Privacidade (rascunho)", () => {
  it("está marcada como rascunho pendente de revisão jurídica e usa marcadores, sem dados inventados", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/privacidade"]}>
        <Privacidade />
      </MemoryRouter>,
    );
    expect(screen.getByRole("note").textContent).toMatch(/RASCUNHO/);
    expect(screen.getByRole("note").textContent).toMatch(/revisão jurídica/);
    const text = container.textContent ?? "";
    for (const placeholder of ["[RAZÃO SOCIAL]", "[CNPJ]", "[ENDEREÇO COMPLETO]", "[E-MAIL OU CANAL DE CONTATO DO ENCARREGADO]"]) {
      expect(text).toContain(placeholder);
    }
    // nenhum CNPJ, e-mail ou telefone de verdade
    expect(text).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    expect(text).not.toMatch(/[\w.-]+@[\w-]+\.[a-z]{2,}/i);
  });

  it("nomeia Meta, TikTok e Stripe, a atribuição, a transferência internacional e como revogar", () => {
    const { container } = render(
      <MemoryRouter>
        <Privacidade />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";
    for (const term of ["Meta Platforms", "TikTok", "Stripe", "utm_source", "fbclid", "Transferência internacional", "art. 33", "90 dias", "Como mudar ou revogar", "Cookies"]) {
      expect(text).toContain(term);
    }
  });
});
