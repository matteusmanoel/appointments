-- Add slug to barbershops for public booking URL
ALTER TABLE public.barbershops
ADD COLUMN IF NOT EXISTS slug text UNIQUE;

-- Backfill: slugify name for existing rows (lowercase, replace spaces with -, remove non-alnum)
UPDATE public.barbershops
SET slug = LOWER(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9\s-]', '', 'g'))
WHERE slug IS NULL;

UPDATE public.barbershops
SET slug = REGEXP_REPLACE(REGEXP_REPLACE(slug, '\s+', '-', 'g'), '-+', '-', 'g')
WHERE slug IS NOT NULL AND slug ~ '\s';

-- Ensure uniqueness: append id suffix if duplicate
WITH numbered AS (
  SELECT id, slug, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at) AS rn
  FROM public.barbershops
  WHERE slug IS NOT NULL
)
UPDATE public.barbershops b
SET slug = b.slug || '-' || LEFT(b.id::text, 8)
FROM numbered n
WHERE b.id = n.id AND n.rn > 1;

-- Default for any still null (new rows will set explicitly)
UPDATE public.barbershops
SET slug = 'barbearia-' || LEFT(id::text, 8)
WHERE slug IS NULL;

ALTER TABLE public.barbershops
ALTER COLUMN slug SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_barbershops_slug ON public.barbershops(slug);
