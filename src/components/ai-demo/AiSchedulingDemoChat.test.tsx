/**
 * Manual checklist (see plan):
 * - Desktop: 2 colunas, scroll ok, blur ok
 * - Mobile: abre no chat, alterna para Conversas e volta
 * - Reiniciar: mantém modal aberto e reseta mensagens
 * - Reset por evasão: limpa chat e mostra instruções
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiSchedulingDemoChat } from "./AiSchedulingDemoChat";

describe("AiSchedulingDemoChat", () => {
  it("when open, modal shows sidebar with Mensagens (simulado)", () => {
    render(
      <AiSchedulingDemoChat open={true} onOpenChange={() => {}} />
    );
    expect(screen.getByText("Mensagens (simulado)")).toBeInTheDocument();
  });

  it("when open, chat header shows IA de atendimento", () => {
    render(
      <AiSchedulingDemoChat open={true} onOpenChange={() => {}} />
    );
    const subtitle = document.getElementById("demo-chat-subtitle");
    expect(subtitle).toBeInTheDocument();
    expect(subtitle).toHaveTextContent("IA de atendimento");
  });

  it("when closed, modal content is not in document", () => {
    render(
      <AiSchedulingDemoChat open={false} onOpenChange={() => {}} />
    );
    expect(screen.queryByText("Mensagens (simulado)")).not.toBeInTheDocument();
  });
});
