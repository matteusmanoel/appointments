import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgres://navalhia:navalhia_secret@localhost:5432/navalhia";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "dev";

const { pool } = await import("../src/db.js");

const bs = await pool.query("SELECT id, name FROM public.barbershops LIMIT 5");
console.log("Barbershops:", JSON.stringify(bs.rows));

const clients = await pool.query("SELECT COUNT(*) FROM public.clients");
console.log("Clients:", clients.rows[0].count);

const appts = await pool.query("SELECT COUNT(*), status FROM public.appointments GROUP BY status ORDER BY status");
console.log("Appointments by status:", JSON.stringify(appts.rows));

const svc = await pool.query("SELECT COUNT(*) FROM public.appointment_services");
console.log("Appointment services:", svc.rows[0].count);

const clientsWithAppts = await pool.query(`
  SELECT c.id, c.name, c.phone, COUNT(a.id) appt_count,
         COUNT(a.id) FILTER (WHERE a.status='completed') completed
  FROM public.clients c
  JOIN public.appointments a ON a.client_id = c.id
  GROUP BY c.id, c.name, c.phone
  ORDER BY appt_count DESC LIMIT 5
`);
console.log("Top clients:", JSON.stringify(clientsWithAppts.rows.map(r => ({
  name: r.name, phone: "***"+r.phone.slice(-4), appts: r.appt_count, completed: r.completed
}))));

await pool.end();
