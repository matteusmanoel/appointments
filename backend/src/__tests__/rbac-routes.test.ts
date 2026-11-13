import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import express from "express";
import { app } from "../app.js";
import { config } from "../config.js";
import { accessRules, normalizePathForRbac, requireRole } from "../middleware/rbac.js";

// Tenant que não existe: qualquer escrita acidental de um papel permitido não atinge dado real.
const GHOST_TENANT = "00000000-0000-4000-8000-0000000000aa";
const ZERO = "00000000-0000-4000-8000-000000000000";

// O limiter global do app é por IP (120/min); cada chamada usa um IP de origem diferente via X-Forwarded-For.
let ipSeq = 0;
const nextIp = () => `10.${Math.floor(ipSeq / 65000) % 250}.${Math.floor((ipSeq % 65000) / 250)}.${(ipSeq++ % 250) + 1}`;

type R = "admin" | "manager" | "attendant";
const tok = (role: string) =>
  jwt.sign({ profileId: ZERO, barbershopId: GHOST_TENANT, role, email: "t@test.com" }, config.jwtSecret ?? "test-secret");

type Case = { method: "get" | "post" | "patch" | "put" | "delete"; path: string; allowed: R[]; skipAllowedCall?: boolean };
const ALL: R[] = ["admin", "manager", "attendant"];
const AM: R[] = ["admin", "manager"];

// Matriz documentada em docs/RBAC_MATRIZ.md
const MATRIX: Case[] = [
  { method: "get", path: "/api/appointments", allowed: ALL },
  { method: "get", path: "/api/clients", allowed: ALL },
  { method: "post", path: "/api/clients", allowed: ALL },
  { method: "delete", path: `/api/clients/${ZERO}`, allowed: AM },
  { method: "get", path: "/api/barbers", allowed: ALL },
  { method: "post", path: "/api/barbers", allowed: AM },
  { method: "patch", path: `/api/barbers/${ZERO}`, allowed: AM },
  { method: "delete", path: `/api/barbers/${ZERO}`, allowed: AM },
  { method: "get", path: "/api/services", allowed: ALL },
  { method: "post", path: "/api/services", allowed: AM },
  { method: "delete", path: `/api/services/${ZERO}`, allowed: AM },
  { method: "get", path: "/api/waitlist", allowed: ALL },
  { method: "get", path: "/api/loyalty/stats", allowed: ALL },
  { method: "get", path: "/api/reports/revenue_by_day", allowed: AM },
  { method: "get", path: "/api/reports/commissions_by_barber", allowed: AM },
  { method: "get", path: "/api/reports/mvp-metrics", allowed: AM },
  { method: "get", path: "/api/reports/agenda-activity", allowed: ALL },
  { method: "get", path: "/api/plans", allowed: ALL },
  { method: "post", path: "/api/plans", allowed: AM },
  { method: "post", path: `/api/plans/charges/${ZERO}/pix`, allowed: AM },
  { method: "post", path: "/api/plans/subscriptions", allowed: AM },
  { method: "get", path: "/api/intelligence/day-summary", allowed: ALL },
  { method: "get", path: "/api/intelligence/reactivation", allowed: AM },
  { method: "post", path: "/api/intelligence/reactivation/queue", allowed: AM },
  { method: "get", path: "/api/barbershops/closures", allowed: ALL },
  { method: "get", path: "/api/barbershops", allowed: ALL },
  { method: "patch", path: "/api/barbershops", allowed: AM },
  { method: "post", path: "/api/barbershops/closures", allowed: AM },
  { method: "post", path: "/api/barbershops", allowed: ["admin"], skipAllowedCall: true },
  { method: "get", path: "/api/integrations/api-keys", allowed: ["admin"] },
  { method: "get", path: "/api/integrations/API-KEYS", allowed: ["admin"] },
  { method: "delete", path: `/api/integrations/Api-Keys/${ZERO}`, allowed: ["admin"] },
  { method: "patch", path: "/api/integrations/N8N-WEBHOOK", allowed: ["admin"], skipAllowedCall: true },
  { method: "post", path: "/api/integrations/api-keys", allowed: ["admin"], skipAllowedCall: true },
  { method: "patch", path: "/api/integrations/n8n-webhook", allowed: ["admin"], skipAllowedCall: true },
  { method: "get", path: "/api/integrations/automations/templates", allowed: AM },
  { method: "post", path: "/api/integrations/automations/campaigns", allowed: AM },
  { method: "get", path: "/api/integrations/whatsapp/ai-settings", allowed: AM },
  { method: "put", path: "/api/integrations/whatsapp/ai-settings", allowed: AM, skipAllowedCall: true },
  { method: "post", path: "/api/integrations/whatsapp/connect", allowed: AM, skipAllowedCall: true },
  { method: "get", path: "/api/integrations/whatsapp/knowledge/sources", allowed: AM },
  { method: "get", path: "/api/integrations/whatsapp/stickers", allowed: AM },
  { method: "get", path: "/api/integrations/whatsapp/status", allowed: ALL },
  { method: "get", path: "/api/integrations/whatsapp/conversations", allowed: ALL },
  { method: "get", path: `/api/integrations/whatsapp/conversations/${ZERO}/messages`, allowed: ALL },
  { method: "post", path: `/api/integrations/whatsapp/conversations/${ZERO}/assume`, allowed: ALL },
  { method: "delete", path: `/api/integrations/whatsapp/conversations/${ZERO}`, allowed: AM },
  { method: "post", path: "/api/billing/portal", allowed: ["admin"] },
  { method: "delete", path: "/api/account/barbershop", allowed: ["admin"], skipAllowedCall: true },
  { method: "delete", path: "/api/account", allowed: ["admin"], skipAllowedCall: true },
];

describe("RBAC nas rotas autenticadas (admin / manager / attendant)", () => {
  for (const c of MATRIX) {
    it(`${c.method.toUpperCase()} ${c.path.replace(ZERO, ":id")} → permitido para [${c.allowed.join(",")}]`, async () => {
      for (const role of ["admin", "manager", "attendant"] as R[]) {
        if (c.allowed.includes(role) && c.skipAllowedCall) continue;
        const res = await request(app)[c.method](c.path).set("X-Forwarded-For", nextIp()).set("Authorization", `Bearer ${tok(role)}`).send({});
        if (c.allowed.includes(role)) {
          expect([401, 403], `${role} deveria passar do RBAC (status ${res.status})`).not.toContain(res.status);
        } else {
          expect(res.status, `${role} deveria receber 403`).toBe(403);
          expect(res.body.error).toMatch(/permiss/i);
        }
      }
    });
  }

  it("papel desconhecido, vazio ou em caixa diferente: desconhecido/vazio → 403 (fail closed); 'Manager' é normalizado", async () => {
    for (const role of ["owner", "", "superuser", "root"]) {
      const res = await request(app).get("/api/barbers").set("X-Forwarded-For", nextIp()).set("Authorization", `Bearer ${tok(role)}`);
      expect(res.status, `role=${JSON.stringify(role)}`).toBe(403);
    }
    const ok = await request(app).get("/api/barbers").set("X-Forwarded-For", nextIp()).set("Authorization", `Bearer ${tok("Manager")}`);
    expect(ok.status).not.toBe(403);
  });

  it("sem token continua 401 (RBAC não substitui autenticação)", async () => {
    const res = await request(app).delete(`/api/clients/${ZERO}`).set("X-Forwarded-For", nextIp());
    expect(res.status).toBe(401);
  });

  it("requireRole/accessRules: primeira regra que casa vence, sem match usa o fallback", async () => {
    const mini = express();
    mini.use((req, _res, next) => {
      req.auth = { profileId: "p", barbershopId: "b", role: String(req.headers["x-role"]), email: "e" };
      next();
    });
    mini.use(
      accessRules(
        [
          { methods: ["GET"], path: /^\/open/, roles: ["attendant", "manager", "admin"] },
          { path: /^\/open/, roles: ["admin"] },
        ],
        ["manager", "admin"]
      )
    );
    mini.all("*", (_req, res) => res.json({ ok: true }));
    const call = (m: "get" | "post", p: string, role: string) => request(mini)[m](p).set("x-role", role);
    expect((await call("get", "/open", "attendant")).status).toBe(200);
    expect((await call("post", "/open", "attendant")).status).toBe(403);
    expect((await call("post", "/open", "admin")).status).toBe(200);
    expect((await call("get", "/other", "attendant")).status).toBe(403);
    expect((await call("get", "/other", "manager")).status).toBe(200);

    const only = express();
    only.use((req, _res, next) => {
      req.auth = { profileId: "p", barbershopId: "b", role: "admin", email: "e" };
      next();
    });
    only.get("/x", requireRole("manager"), (_req, res) => res.json({ ok: true }));
    expect((await request(only).get("/x")).status).toBe(403);
  });

  it("bypass de caixa/encoding/barra final: gerente e atendente recebem 403 em /API-KEYS e variantes", async () => {
    const variants: { method: "get" | "patch" | "delete"; path: string }[] = [
      { method: "get", path: "/api/integrations/API-KEYS" },
      { method: "get", path: "/api/integrations/Api-Keys" },
      { method: "get", path: "/api/integrations/api-keys/" },
      { method: "delete", path: `/api/integrations/Api-Keys/${ZERO}` },
      { method: "get", path: "/api/integrations/%41PI-KEYS" },
      { method: "get", path: "/api/integrations/api%2Dkeys" },
      { method: "patch", path: "/api/integrations/N8N-WEBHOOK" },
      { method: "get", path: "/api/integrations/n8n-webhook/" },
    ];
    for (const v of variants) {
      for (const role of ["manager", "attendant"] as R[]) {
        const res = await request(app)[v.method](v.path).set("X-Forwarded-For", nextIp()).set("Authorization", `Bearer ${tok(role)}`).send({});
        expect(res.status, `${role} ${v.method.toUpperCase()} ${v.path}`).toBe(403);
        expect(res.body.error).toMatch(/permiss/i);
      }
      const admin = await request(app)[v.method](v.path).set("X-Forwarded-For", nextIp()).set("Authorization", `Bearer ${tok("admin")}`).send({});
      expect(admin.status, `admin ${v.method.toUpperCase()} ${v.path}`).not.toBe(403);
    }
  });

  it("normalizePathForRbac: caixa, barra final, encoding e '..'", () => {
    expect(normalizePathForRbac("/API-KEYS")).toBe("/api-keys");
    expect(normalizePathForRbac("/Api-Keys/")).toBe("/api-keys");
    expect(normalizePathForRbac("/api-keys/")).toBe("/api-keys");
    expect(normalizePathForRbac("/%41PI-KEYS")).toBe("/api-keys");
    expect(normalizePathForRbac("/api%2Dkeys")).toBe("/api-keys");
    expect(normalizePathForRbac("/whatsapp/../API-KEYS")).toBe("/api-keys");
    expect(normalizePathForRbac("/n8n-webhook/")).toBe("/n8n-webhook");
    expect(normalizePathForRbac("/")).toBe("/");
  });
});
