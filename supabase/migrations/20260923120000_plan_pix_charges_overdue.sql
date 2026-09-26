-- Add overdue_1 and overdue_2 status values to plan_pix_charges
-- so the overdue billing sweep can track day+5 and day+10 reminders.

ALTER TABLE public.plan_pix_charges
  DROP CONSTRAINT IF EXISTS plan_pix_charges_status_check;

ALTER TABLE public.plan_pix_charges
  ADD CONSTRAINT plan_pix_charges_status_check
  CHECK (status IN ('pending', 'sent', 'paid', 'failed', 'skipped', 'overdue_1', 'overdue_2'));
