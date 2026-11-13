import { describe, it, expect } from "vitest";
import { buildPoolConfig, DB_TIMEOUTS, pool, directPool } from "../db.js";

describe("db pools", () => {
  const url = "postgres://u:p%40ss@ep-x-pooler.us-east-2.aws.neon.tech:5432/neondb?sslmode=require";

  it("pool pooled: timeouts de conexão/ociosa + query_timeout do cliente, SEM statement_timeout de startup", () => {
    const c = buildPoolConfig(url, "pooled", true);
    expect(c.connectionTimeoutMillis).toBe(DB_TIMEOUTS.connectionTimeoutMillis);
    expect(c.idleTimeoutMillis).toBe(DB_TIMEOUTS.idleTimeoutMillis);
    expect(c.query_timeout).toBe(DB_TIMEOUTS.queryTimeoutMillis);
    expect(c.statement_timeout).toBeUndefined();
    expect(c.host).toBe("ep-x-pooler.us-east-2.aws.neon.tech");
    expect(c.password).toBe("p@ss");
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("pool direct: pouquíssimas conexões e statement_timeout no servidor", () => {
    const c = buildPoolConfig(url.replace("-pooler", ""), "direct", false);
    expect(c.max).toBeLessThanOrEqual(5);
    expect(c.statement_timeout).toBe(DB_TIMEOUTS.directStatementTimeoutMillis);
    expect(c.query_timeout).toBeUndefined();
    expect(c.host).not.toContain("pooler");
    expect(c.ssl).toBeUndefined();
  });

  it("timeouts têm valores finitos e positivos por padrão", () => {
    for (const v of Object.values(DB_TIMEOUTS)) expect(v).toBeGreaterThan(0);
  });

  it("sem DATABASE_URL_DIRECT, directPool reaproveita o pool (mesmo comportamento de antes)", () => {
    if (!process.env.DATABASE_URL_DIRECT) expect(directPool).toBe(pool);
  });
});
