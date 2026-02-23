-- Multi-branch: accounts (group) and memberships. Barbershops belong to an account.
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.account_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_account_memberships_profile ON public.account_memberships(profile_id);
CREATE INDEX IF NOT EXISTS idx_account_memberships_account ON public.account_memberships(account_id);
CREATE INDEX IF NOT EXISTS idx_barbershops_account ON public.barbershops(account_id);

-- Backfill: one account per barbershop, then one membership per profile to their barbershop's account
DO $$
DECLARE
  r RECORD;
  aid uuid;
BEGIN
  FOR r IN SELECT id, name FROM public.barbershops WHERE account_id IS NULL
  LOOP
    INSERT INTO public.accounts (name) VALUES (r.name) RETURNING id INTO aid;
    UPDATE public.barbershops SET account_id = aid WHERE id = r.id;
  END LOOP;
END $$;

INSERT INTO public.account_memberships (profile_id, account_id, role)
SELECT p.id, b.account_id, 'owner'
FROM public.profiles p
JOIN public.barbershops b ON b.id = p.barbershop_id
WHERE b.account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.account_memberships am WHERE am.profile_id = p.id AND am.account_id = b.account_id);

COMMENT ON TABLE public.accounts IS 'Group for multi-branch; barbershops belong to an account.';
COMMENT ON TABLE public.account_memberships IS 'Profile access to accounts (and thus to all barbershops under that account).';
