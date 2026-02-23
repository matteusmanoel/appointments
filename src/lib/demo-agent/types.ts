/**
 * Types for the deterministic demo agent (zero LLM).
 * Mirrors concepts from backend agent: slot-filling, intent, tools shape.
 */

export type DemoIntent =
  | "book"
  | "list_services"
  | "reschedule"
  | "cancel"
  | "greeting"
  | "unknown";

export interface DemoService {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  category?: string;
}

export interface DaySchedule {
  start: string; // "09:00"
  end: string;   // "18:00"
}

export type DayKey =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export interface DemoBarber {
  id: string;
  name: string;
  schedule: Partial<Record<DayKey, DaySchedule>>;
}

export interface DemoCatalog {
  barbershopName: string;
  services: DemoService[];
  barbers: DemoBarber[];
  businessHours: Partial<Record<DayKey, DaySchedule>>;
}

export interface DemoSessionState {
  intent: DemoIntent;
  serviceIds: string[];
  barberId: string | null;
  date: string | null;   // yyyy-MM-dd
  time: string | null;  // HH:mm
  clientName: string | null;
  turnsUsed: number;
  lastBotQuestion: "service" | "barber" | "date" | "time" | "confirm" | "name" | null;
  outOfScopeStrikes: number;
  /** After confirmation + create, we show success and CTA */
  appointmentCreated: boolean;
}

export interface Slot {
  time: string;
  barber_id: string;
  barber_name: string;
}

export interface CheckAvailabilityResult {
  date: string;
  time: string;
  duration_minutes: number;
  total_price: number;
  requested: {
    available: boolean;
    barbers: Array<{ barber_id: string; barber_name: string }>;
  };
  alternatives: Array<{ time: string; barber_id: string; barber_name: string }>;
}

export interface GetNextSlotsResult {
  date: string;
  slots: Slot[];
  duration_minutes?: number;
}

export type DemoTraceEvent =
  | { type: "list_services" }
  | { type: "get_next_slots"; date: string }
  | { type: "check_availability"; date: string; time: string };

export type DemoProgressStage = "service" | "date" | "time" | "confirm" | "final";

export interface DemoUiHints {
  stage: DemoProgressStage;
  placeholder: string;
  helperExamples: string[];
  /** 0..4 for steps service -> date -> time -> confirm -> final */
  progressStep: number;
}

export interface DemoAgentReply {
  /** Main bot message (can contain multiple parts split by [[MSG]]) */
  message: string;
  /** Quick-reply chips for the user */
  suggestions: string[];
  /** Trace for UI to show "consultando agenda..." */
  trace: DemoTraceEvent[];
  /** Updated state (caller should persist) */
  state: DemoSessionState;
  /** True if chat was reset due to out-of-scope */
  reset: boolean;
  /** True if we just "created" the appointment (show success + CTA) */
  appointmentCreated: boolean;
  /** Hints for UI: placeholder, progress, examples */
  uiHints?: DemoUiHints;
}
