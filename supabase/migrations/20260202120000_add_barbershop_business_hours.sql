-- Add business_hours to barbershops (base for availability/slots)
ALTER TABLE public.barbershops
ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT '{
  "monday": {"start": "09:00", "end": "19:00"},
  "tuesday": {"start": "09:00", "end": "19:00"},
  "wednesday": {"start": "09:00", "end": "19:00"},
  "thursday": {"start": "09:00", "end": "19:00"},
  "friday": {"start": "09:00", "end": "19:00"},
  "saturday": {"start": "09:00", "end": "18:00"},
  "sunday": null
}'::jsonb;
