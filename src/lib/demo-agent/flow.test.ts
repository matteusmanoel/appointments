import { describe, it, expect } from "vitest";
import { createInitialState, runDemoAgent } from "./flow";
import { DEFAULT_DEMO_CATALOG } from "./catalog";

const refDate = new Date("2025-03-15T10:00:00"); // Saturday 10:00

describe("demo-agent flow", () => {
  it("createInitialState returns clean state", () => {
    const s = createInitialState();
    expect(s.serviceIds).toEqual([]);
    expect(s.date).toBeNull();
    expect(s.appointmentCreated).toBe(false);
  });

  it("greeting returns opening message", () => {
    const state = createInitialState();
    const reply = runDemoAgent("oi", state, DEFAULT_DEMO_CATALOG, refDate);
    expect(reply.message).toMatch(/Salve|serviços|agendar/);
    expect(reply.reset).toBe(false);
    expect(reply.suggestions.length).toBeGreaterThan(0);
  });

  it("list_services intent returns service list", () => {
    const state = createInitialState();
    const reply = runDemoAgent("quero ver os serviços", state, DEFAULT_DEMO_CATALOG, refDate);
    expect(reply.message).toMatch(/R\$|Corte|Barba/);
    expect(reply.trace.some((t) => t.type === "list_services")).toBe(true);
  });

  it("book flow: corte amanhã 10h reaches confirmation or slots", () => {
    let state = createInitialState();
    const r1 = runDemoAgent("quero um corte amanhã às 10h", state, DEFAULT_DEMO_CATALOG, refDate);
    state = r1.state;
    expect(r1.message.length).toBeGreaterThan(0);
    if (r1.state.lastBotQuestion === "confirm") {
      const r2 = runDemoAgent("sim", state, DEFAULT_DEMO_CATALOG, refDate);
      expect(r2.state.lastBotQuestion).toBe("name");
      const r3 = runDemoAgent("Mateus", r2.state, DEFAULT_DEMO_CATALOG, refDate);
      expect(r3.appointmentCreated).toBe(true);
      expect(r3.message).toMatch(/confirmado|Aguardamos/);
    } else if (r1.state.lastBotQuestion === "date" || r1.state.lastBotQuestion === "time") {
      expect(r1.message).toMatch(/quando|horário|data/);
    }
  });

  it("out-of-scope increments strikes and eventually resets", () => {
    let state = createInitialState();
    const r1 = runDemoAgent("quero uma pizza", state, DEFAULT_DEMO_CATALOG, refDate);
    expect(r1.message).toMatch(/visual|serviços|agendar/);
    expect(r1.state.outOfScopeStrikes).toBe(1);
    state = r1.state;
    const r2 = runDemoAgent("e um hamburguer", state, DEFAULT_DEMO_CATALOG, refDate);
    expect(r2.reset).toBe(true);
    expect(r2.message).toMatch(/agendamento|Começando de novo/);
    expect(r2.state.outOfScopeStrikes).toBe(0);
  });

  it("max turns returns CTA message", () => {
    let state = createInitialState();
    state.turnsUsed = 20;
    const reply = runDemoAgent("oi", state, DEFAULT_DEMO_CATALOG, refDate);
    expect(reply.message).toMatch(/limite|assinar|produto real/);
  });
});
