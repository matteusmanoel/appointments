import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Papéis do painel (coluna profiles.role, CHECK admin|manager|attendant; vai no JWT).
 * A matriz completa está em docs/RBAC_MATRIZ.md.
 */
export type Role = "admin" | "manager" | "attendant";

export const ALL_ROLES: readonly Role[] = ["admin", "manager", "attendant"];
/** admin + manager: tudo que é configuração, financeiro e destrutivo. */
export const ADMIN_MANAGER: readonly Role[] = ["admin", "manager"];
export const ADMIN_ONLY: readonly Role[] = ["admin"];

function roleOf(req: Request): string {
  return String(req.auth?.role ?? "").trim().toLowerCase();
}

/** Exige que o papel do JWT esteja na lista. Papel desconhecido/ausente = 403 (fail closed). Rodar depois de requireJwt. */
export function requireRole(...roles: readonly Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!(roles as readonly string[]).includes(roleOf(req))) {
      res.status(403).json({ error: "Seu perfil não tem permissão para esta ação", required_roles: roles });
      return;
    }
    next();
  };
}

export type AccessRule = {
  /** Métodos HTTP (default: qualquer). */
  methods?: readonly string[];
  /** Caminho relativo ao ponto de montagem do router (req.path). */
  path: RegExp;
  roles: readonly Role[];
};

/**
 * Normaliza o caminho como o Express (case-insensitive, strict:false): minúsculas,
 * decodifica percent-encoding, remove barra final e resolve "." / "..".
 * Assim as regexes de accessRules acompanham o handler que o roteador escolhe
 * (ex.: /API-KEYS e /api-keys/ caem na mesma rota /api-keys).
 */
export function normalizePathForRbac(path: string): string {
  let p = path && path.length > 0 ? path : "/";
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  const h = p.indexOf("#");
  if (h >= 0) p = p.slice(0, h);
  for (let i = 0; i < 5; i++) {
    try {
      const decoded = decodeURIComponent(p);
      if (decoded === p) break;
      p = decoded;
    } catch {
      break;
    }
  }
  const parts: string[] = [];
  for (const part of p.normalize("NFC").toLowerCase().split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return "/" + parts.join("/");
}

/**
 * Tabela de regras por router: a primeira regra que casa (método + caminho) decide; sem match vale `fallback`.
 * Montar logo depois de `router.use(requireJwt)`.
 */
export function accessRules(rules: readonly AccessRule[], fallback: readonly Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    const path = normalizePathForRbac(req.path);
    const hit = rules.find(
      (r) => (!r.methods || r.methods.includes(method)) && r.path.test(path)
    );
    requireRole(...(hit ? hit.roles : fallback))(req, res, next);
  };
}

export const READ_METHODS = ["GET", "HEAD"] as const;
