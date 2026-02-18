import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { pool } from "../db.js";

export type JwtPayload = {
  profileId: string;
  barbershopId: string;
  role: string;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
      barbershopId?: string;
    }
  }
}

export function requireJwt(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.auth = payload;
    req.barbershopId = payload.barbershopId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireToolsKey(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const raw = req.headers["x-api-key"] ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const key = typeof raw === "string" ? raw.trim() : undefined;
    if (!key) {
      res.status(401).json({ error: "Missing tools API key" });
      return;
    }

    // TEMPORARY: keep support for global TOOLS_API_KEY for backward compatibility
    if (config.toolsApiKey && key === config.toolsApiKey) {
      const id = config.barbershopId?.trim();
      req.barbershopId = id || undefined;
      next();
      return;
    }

    try {
      const r = await pool.query(
        `SELECT id, barbershop_id, key_hash
         FROM public.barbershop_api_keys
         WHERE revoked_at IS NULL`
      );
      for (const row of r.rows as { id: string; barbershop_id: string; key_hash: string }[]) {
        const ok = await bcrypt.compare(key, row.key_hash);
        if (ok) {
          req.barbershopId = row.barbershop_id;
          // best effort: update last_used_at async, sem atrasar a resposta
          void pool.query(
            "UPDATE public.barbershop_api_keys SET last_used_at = now() WHERE id = $1",
            [row.id]
          ).catch(() => {});
          next();
          return;
        }
      }
      res.status(401).json({ error: "Invalid tools API key" });
    } catch (e) {
      console.error("tools key validation error:", e);
      res.status(500).json({ error: "Tools auth error" });
    }
  })();
}

export function getBarbershopId(req: Request): string {
  const id = req.barbershopId ?? req.auth?.barbershopId ?? config.barbershopId;
  if (!id) throw new Error("barbershop_id required");
  return id;
}

export function getBarbershopIdOptional(req: Request): string | undefined {
  return req.barbershopId ?? req.auth?.barbershopId ?? config.barbershopId ?? (req.query.barbershop_id as string) ?? req.body?.barbershop_id;
}
