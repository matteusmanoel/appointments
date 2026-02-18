import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db.js";
import { config } from "../config.js";
import { JwtPayload, requireJwt } from "../middleware/auth.js";

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().optional(),
});

const changePasswordBody = z.object({
  current_password: z.string().min(1, "Senha atual é obrigatória"),
  new_password: z.string().min(8, "Nova senha deve ter no mínimo 8 caracteres"),
});

export const authRouter = Router();

authRouter.get("/me", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const profileId = req.auth?.profileId;
  if (!profileId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const r = await pool.query(
    "SELECT id, email, full_name, barbershop_id, role, must_change_password FROM public.profiles WHERE id = $1",
    [profileId]
  );
  if (r.rows.length === 0) {
    res.status(401).json({ error: "Profile not found" });
    return;
  }
  const row = r.rows[0];
  res.json({
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    barbershop_id: row.barbershop_id,
    role: row.role,
    must_change_password: Boolean(row.must_change_password),
  });
});

authRouter.post("/login", async (req: Request, res: Response): Promise<void> => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;
  const r = await pool.query(
    `SELECT id, user_id, barbershop_id, full_name, email, role, password_hash, must_change_password
     FROM public.profiles WHERE email = $1`,
    [email]
  );
  if (r.rows.length === 0) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const row = r.rows[0];
  if (!row.password_hash) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const payload: JwtPayload = {
    profileId: row.id,
    barbershopId: row.barbershop_id,
    role: row.role,
    email: row.email ?? email,
  };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
  res.json({
    token,
    profile: {
      id: row.id,
      email,
      full_name: row.full_name,
      barbershop_id: row.barbershop_id,
      role: row.role,
      must_change_password: Boolean(row.must_change_password),
    },
  });
});

authRouter.patch("/password", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const profileId = req.auth?.profileId;
  if (!profileId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = changePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { current_password, new_password } = parsed.data;
  const r = await pool.query(
    "SELECT password_hash FROM public.profiles WHERE id = $1",
    [profileId]
  );
  if (r.rows.length === 0) {
    res.status(401).json({ error: "Profile not found" });
    return;
  }
  const row = r.rows[0];
  if (!row.password_hash) {
    res.status(400).json({ error: "Senha não configurada para esta conta" });
    return;
  }
  const ok = await bcrypt.compare(current_password, row.password_hash);
  if (!ok) {
    res.status(401).json({ error: "Senha atual incorreta" });
    return;
  }
  const password_hash = await bcrypt.hash(new_password, 10);
  await pool.query(
    "UPDATE public.profiles SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2",
    [password_hash, profileId]
  );
  res.status(204).send();
});

authRouter.post("/register", async (req: Request, res: Response): Promise<void> => {
  const parsed = registerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { email, password, full_name } = parsed.data;
  const existing = await pool.query("SELECT 1 FROM public.profiles WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }
  // Tenant isolation: only BARBERSHOP_ID from env (e.g. seed/bootstrap). New tenants come from billing webhook.
  const barbershopId = config.barbershopId;
  if (!barbershopId) {
    res.status(400).json({ error: "Registration disabled; use checkout to create an account" });
    return;
  }
  const password_hash = await bcrypt.hash(password, 10);
  const idResult = await pool.query(
    `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, password_hash, role)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'admin')
     RETURNING id, user_id, barbershop_id, full_name, email, role`,
    [barbershopId, full_name ?? null, email, password_hash]
  );
  const row = idResult.rows[0];
  const payload: JwtPayload = {
    profileId: row.id,
    barbershopId: row.barbershop_id,
    role: row.role,
    email: row.email,
  };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
  res.status(201).json({
    token,
    profile: {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      barbershop_id: row.barbershop_id,
      role: row.role,
    },
  });
});
