import type { BillingPlan } from "@/lib/api";
import type { Profile } from "@/contexts/AuthContext";

const PRO_PLANS: BillingPlan[] = ["pro", "premium"];

/** True when the barbershop is on the Essential plan (dashboard + link only). */
export function isEssential(profile: Profile | null): boolean {
  if (!profile) return false;
  const plan = profile.billing_plan ?? "pro";
  return plan === "essential";
}

/** True when the barbershop has Pro or Premium (full features + IA). */
export function hasPro(profile: Profile | null): boolean {
  if (!profile) return false;
  const plan = profile.billing_plan ?? "pro";
  return PRO_PLANS.includes(plan);
}

/** True when the barbershop is on the Premium plan (e.g. create new branch). */
export function hasPremium(profile: Profile | null): boolean {
  if (!profile) return false;
  return profile.billing_plan === "premium";
}
