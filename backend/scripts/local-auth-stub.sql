-- Stub for local Postgres (no Supabase): auth schema and uid() so RLS in migrations can be created.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT NULL::uuid;
$$ LANGUAGE sql STABLE;
