import { describe, expect, it } from "vitest";
import {
  LOCAL_DATABASE_URL_ERROR,
  assertLocalDatabaseUrl,
  inspectDatabaseUrl,
  isLocalDatabaseUrl,
} from "../db/local-database-url.js";

describe("guarda de DATABASE_URL (somente local)", () => {
  it("aceita localhost, 127.0.0.1, ::1 e socket Unix", () => {
    expect(isLocalDatabaseUrl("postgres://navalhia:secret@localhost:55432/navalhia")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u:p@127.0.0.1:55432/db")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@[::1]:55432/db")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@/navalhia?host=/var/run/postgresql")).toBe(true);
    expect(inspectDatabaseUrl("postgres://u:p@/navalhia?host=/tmp").kind).toBe("socket");
    expect(assertLocalDatabaseUrl("postgres://u@localhost/db")).toContain("localhost");
  });

  it("recusa host remoto e não vaza credenciais na mensagem", () => {
    const remote = "postgres://navalhia:super-secret-pass@ep-fancy-field-b665zoxi.us-east-1.aws.neon.tech/neondb";
    expect(isLocalDatabaseUrl(remote)).toBe(false);
    expect(() => assertLocalDatabaseUrl(remote)).toThrow(LOCAL_DATABASE_URL_ERROR);
    try {
      assertLocalDatabaseUrl(remote);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toMatch(/super-secret-pass|navalhia|neon\.tech|ep-fancy/);
      expect(msg).toBe(LOCAL_DATABASE_URL_ERROR);
    }
    expect(isLocalDatabaseUrl("postgres://u:p@10.0.0.8:5432/db")).toBe(false);
    expect(isLocalDatabaseUrl("postgres://u:p@host.docker.internal:5432/db")).toBe(false);
    expect(() => assertLocalDatabaseUrl("")).toThrow(/ausente/);
    expect(() => assertLocalDatabaseUrl("not a url")).toThrow(/inválido/);
  });
});
