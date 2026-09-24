import { describe, it, expect } from "vitest";
import { evaluateSingleTurn } from "./deterministic.js";

describe("evaluateSingleTurn — past_time_suggestion", () => {
  it("não confunde a tabela de horário de funcionamento com sugestão de horário passado (bug real 23/09)", () => {
    const reply =
      "Status agora: já encerramos as atividades de hoje. A Cavalier Barbearia abre " +
      "novamente na quinta-feira, das 09:00 às 19:00. \n\n" +
      "Aqui está a tabela de expediente da semana:\n" +
      "Segunda: 09:00–19:00\n" +
      "Terça: 09:00–19:00\n" +
      "Quarta: 09:00–19:00\n" +
      "Quinta: 09:00–19:00\n" +
      "Sexta: 09:00–19:00\n" +
      "Sábado: 09:00–18:00\n" +
      "Domingo: Fechado\n\n" +
      "Qual serviço você gostaria de agendar para amanhã?";
    const violations = evaluateSingleTurn(reply);
    expect(violations.find((v) => v.type === "past_time_suggestion")).toBeUndefined();
  });

  it("não confunde o horário de reabertura de outro dia com sugestão de horário passado hoje (variante real)", () => {
    const reply =
      "Status agora: já encerramos o atendimento hoje. Nossos horários de funcionamento são:\n" +
      "Segunda: 09:00–19:00\n" +
      "Terça: 09:00–19:00\n" +
      "Quarta: 09:00–19:00\n" +
      "Quinta: 09:00–19:00\n" +
      "Sexta: 09:00–19:00\n" +
      "Sábado: 09:00–18:00\n" +
      "Domingo: fechado\n\n" +
      "Voltamos a atender na quinta-feira, às 09:00. Qual serviço você gostaria de agendar para o próximo dia?";
    const violations = evaluateSingleTurn(reply);
    expect(violations.find((v) => v.type === "past_time_suggestion")).toBeUndefined();
  });

  it("ainda detecta uma sugestão real de horário já passado hoje", () => {
    const now = new Date();
    // Horário bem antes de agora hoje, fora de qualquer formato de faixa/tabela.
    const pastHour = Math.max(0, now.getHours() - 5);
    const reply = `Que tal hoje às ${String(pastHour).padStart(2, "0")}:00? Ainda temos esse horário livre.`;
    const violations = evaluateSingleTurn(reply);
    // Só é uma violação real se de fato já passou mais de 30min desse horário.
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const slotMins = pastHour * 60;
    if (slotMins < nowMins - 30) {
      expect(violations.find((v) => v.type === "past_time_suggestion")).toBeDefined();
    }
  });

  it("não sinaliza quando não há a palavra 'hoje'", () => {
    const reply = "Nosso horário de funcionamento: Segunda a sexta 09:00–19:00, sábado 09:00–18:00.";
    const violations = evaluateSingleTurn(reply);
    expect(violations.find((v) => v.type === "past_time_suggestion")).toBeUndefined();
  });
});
