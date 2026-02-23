import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db.js";
import { config } from "../config.js";
import { JwtPayload, requireJwt } from "../middleware/auth.js";
import { sendPasswordResetEmail } from "../lib/ses.js";

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const forgotPasswordBody = z.object({ email: z.string().email() });
const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().optional(),
});

const changePasswordBody = z.object({
  current_password: z.string().min(1, "Senha atual é obrigatória"),
  new_password: z.string().min(8, "Nova senha deve ter no mínimo 8 caracteres"),
});

function generateTempPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const forgotPasswordRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many requests" },
  standardHeaders: true,
});

export const authRouter = Router();

authRouter.get("/me", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const profileId = req.auth?.profileId;
  if (!profileId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const r = await pool.query(
    `SELECT p.id, p.email, p.full_name, p.barbershop_id, p.role, p.must_change_password,
            COALESCE(b.billing_plan, 'pro') AS billing_plan
     FROM public.profiles p
     LEFT JOIN public.barbershops b ON b.id = p.barbershop_id
     WHERE p.id = $1`,
    [profileId]
  );
  if (r.rows.length === 0) {
    res.status(401).json({ error: "Profile not found" });
    return;
  }
  const row = r.rows[0];
  const barbershopsRows = await pool.query<{ id: string; name: string; slug: string | null; billing_plan: string | null }>(
    `SELECT b.id, b.name, b.slug, b.billing_plan
     FROM public.barbershops b
     INNER JOIN public.account_memberships am ON am.account_id = b.account_id
     WHERE am.profile_id = $1
     ORDER BY b.name`,
    [profileId]
  );
  const barbershops = barbershopsRows.rows.length > 0
    ? barbershopsRows.rows.map((x) => ({ id: x.id, name: x.name, slug: x.slug ?? undefined, billing_plan: x.billing_plan ?? "pro" }))
    : (row.barbershop_id
        ? [{ id: row.barbershop_id, name: "", slug: undefined, billing_plan: row.billing_plan ?? "pro" }]
        : []);
  if (barbershops.length === 1 && barbershops[0].name === "") {
    const bRow = await pool.query<{ name: string; slug: string | null }>(
      "SELECT name, slug FROM public.barbershops WHERE id = $1",
      [barbershops[0].id]
    );
    if (bRow.rows[0]) {
      barbershops[0].name = bRow.rows[0].name;
      barbershops[0].slug = bRow.rows[0].slug ?? undefined;
    }
  }
  // Current barbershop comes from JWT (switch context), not from profile row, so the selector shows the active unit after switch
  const currentBarbershopId = req.auth?.barbershopId ?? row.barbershop_id;
  const billingPlanForCurrent =
    barbershops.find((b) => b.id === currentBarbershopId)?.billing_plan ?? row.billing_plan ?? "pro";
  res.json({
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    barbershop_id: currentBarbershopId,
    role: row.role,
    must_change_password: Boolean(row.must_change_password),
    billing_plan: billingPlanForCurrent,
    barbershops,
  });
});

authRouter.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Credenciais inválidas", details: parsed.error.flatten() });
      return;
    }
    const { email, password } = parsed.data;
    const r = await pool.query(
      `SELECT p.id, p.user_id, p.barbershop_id, p.full_name, p.email, p.role, p.password_hash, p.must_change_password,
              COALESCE(b.billing_plan, 'pro') AS billing_plan
       FROM public.profiles p
       LEFT JOIN public.barbershops b ON b.id = p.barbershop_id
       WHERE p.email = $1`,
      [email]
    );
    if (r.rows.length === 0) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const row = r.rows[0];
    const passwordHash = row.password_hash != null ? String(row.password_hash).trim() : null;
    if (!passwordHash) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const ok = await bcrypt.compare(password, passwordHash);
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
        billing_plan: row.billing_plan ?? "pro",
      },
    });
  } catch (err) {
    console.error("[auth/login] error:", err);
    res.status(500).json({ error: "Login failed. Try again or contact support." });
  }
});

authRouter.post("/forgot-password", forgotPasswordRateLimit, async (req: Request, res: Response): Promise<void> => {
  const parsed = forgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(204).send();
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const r = await pool.query<{ id: string; password_hash: string | null }>(
    "SELECT id, password_hash FROM public.profiles WHERE LOWER(TRIM(email)) = $1 LIMIT 1",
    [email]
  );
  if (r.rows.length === 0) {
    res.status(204).send();
    return;
  }
  const row = r.rows[0];
  const profileId = row.id;
  const oldHash = row.password_hash;
  const tempPassword = generateTempPassword();
  const newHash = await bcrypt.hash(tempPassword, 10);
  await pool.query(
    "UPDATE public.profiles SET password_hash = $1, must_change_password = true, updated_at = now() WHERE id = $2",
    [newHash, profileId]
  );
  if (config.fromEmail) {
    try {
      await sendPasswordResetEmail({
        to: parsed.data.email,
        appUrl: config.appUrl.replace(/\/$/, ""),
        tempPassword,
      });
    } catch (err) {
      console.error("[auth/forgot-password] email send failed:", err);
      if (oldHash != null) {
        await pool.query(
          "UPDATE public.profiles SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2",
          [oldHash, profileId]
        ).catch((e) => console.error("[auth/forgot-password] rollback failed:", e));
      }
    }
  }
  res.status(204).send();
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

const switchBarbershopBody = z.object({ barbershop_id: z.string().uuid() });

authRouter.post("/switch-barbershop", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const profileId = req.auth?.profileId;
  if (!profileId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = switchBarbershopBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "barbershop_id inválido", details: parsed.error.flatten() });
    return;
  }
  const { barbershop_id } = parsed.data;
  const r = await pool.query<{ id: string; role: string; email: string }>(
    `SELECT b.id, p.role, p.email
     FROM public.barbershops b
     INNER JOIN public.account_memberships am ON am.account_id = b.account_id
     INNER JOIN public.profiles p ON p.id = am.profile_id
     WHERE am.profile_id = $1 AND b.id = $2`,
    [profileId, barbershop_id]
  );
  if (r.rows.length === 0) {
    const fallback = await pool.query<{ role: string; email: string }>(
      `SELECT p.role, p.email FROM public.profiles p WHERE p.id = $1 AND p.barbershop_id = $2`,
      [profileId, barbershop_id]
    );
    if (fallback.rows.length === 0) {
      res.status(403).json({ error: "Você não tem acesso a esta unidade" });
      return;
    }
    const row = fallback.rows[0];
    const payload: JwtPayload = {
      profileId,
      barbershopId: barbershop_id,
      role: row.role,
      email: row.email ?? "",
    };
    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
    res.json({ token, barbershop_id });
    return;
  }
  const row = r.rows[0];
  const payload: JwtPayload = {
    profileId,
    barbershopId: row.id,
    role: row.role,
    email: row.email ?? "",
  };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
  res.json({ token, barbershop_id: row.id });
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
  const planRow = await pool.query(
    "SELECT COALESCE(billing_plan, 'pro') AS billing_plan FROM public.barbershops WHERE id = $1",
    [row.barbershop_id]
  );
  const billingPlan = planRow.rows[0]?.billing_plan ?? "pro";
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
      billing_plan: billingPlan,
    },
  });
});
