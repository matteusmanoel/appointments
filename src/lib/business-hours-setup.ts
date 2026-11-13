/**
 * O backend cria toda barbearia com um horário padrão (seg–sex 09–19, sáb 09–18, dom fechado), e o link público
 * já nasce no ar. O passo "horário de funcionamento" do checklist só vale como feito depois que o dono
 * salvou o horário ou confirmou o padrão. Aqui ficam as regras puras + o flag de confirmação.
 */
type Day = { start?: string; end?: string } | null | undefined;
export type HoursLike = Partial<Record<"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday", Day>>;

const ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const LABEL: Record<(typeof ORDER)[number], string> = {
  monday: "Seg",
  tuesday: "Ter",
  wednesday: "Qua",
  thursday: "Qui",
  friday: "Sex",
  saturday: "Sáb",
  sunday: "Dom",
};

export const DB_DEFAULT_HOURS: HoursLike = {
  monday: { start: "09:00", end: "19:00" },
  tuesday: { start: "09:00", end: "19:00" },
  wednesday: { start: "09:00", end: "19:00" },
  thursday: { start: "09:00", end: "19:00" },
  friday: { start: "09:00", end: "19:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

const norm = (d: Day): string => (d && d.start && d.end ? `${d.start.slice(0, 5)}-${d.end.slice(0, 5)}` : "closed");

export function isDefaultBusinessHours(bh: unknown): boolean {
  if (!bh || typeof bh !== "object") return false;
  const o = bh as HoursLike;
  return ORDER.every((d) => norm(o[d]) === norm(DB_DEFAULT_HOURS[d]));
}

/** "Seg–Sex 09:00–19:00 · Sáb 09:00–18:00 · Dom fechado" (agrupa dias consecutivos iguais). */
export function summarizeBusinessHours(bh: unknown): string {
  if (!bh || typeof bh !== "object") return "";
  const o = bh as HoursLike;
  const parts: string[] = [];
  let i = 0;
  while (i < ORDER.length) {
    const key = norm(o[ORDER[i]]);
    let j = i;
    while (j + 1 < ORDER.length && norm(o[ORDER[j + 1]]) === key) j++;
    const days = i === j ? LABEL[ORDER[i]] : `${LABEL[ORDER[i]]}–${LABEL[ORDER[j]]}`;
    parts.push(key === "closed" ? `${days} fechado` : `${days} ${key.replace("-", "–")}`);
    i = j + 1;
  }
  return parts.join(" · ");
}

const key = (barbershopId: string) => `navalhia_hours_confirmed_${barbershopId}`;

export function isHoursConfirmed(barbershopId: string | undefined): boolean {
  if (!barbershopId) return false;
  try {
    return localStorage.getItem(key(barbershopId)) === "1";
  } catch {
    return false;
  }
}

export function confirmHours(barbershopId: string | undefined): void {
  if (!barbershopId) return;
  try {
    localStorage.setItem(key(barbershopId), "1");
  } catch {
    /* ignore */
  }
}

/** Passo do checklist: feito se o dono mudou o padrão OU confirmou o padrão. */
export function hoursStepDone(bh: unknown, barbershopId: string | undefined): boolean {
  if (!bh || typeof bh !== "object") return false;
  return !isDefaultBusinessHours(bh) || isHoursConfirmed(barbershopId);
}
