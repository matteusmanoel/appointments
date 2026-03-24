import type { BillingPlan } from "@/lib/api";

/** Fonte única de metadados dos planos (preços, labels, descrições). */
export const BILLING_PLANS: {
  id: BillingPlan;
  label: string;
  price: string;
  priceValue: number;
  desc: string;
}[] = [
  {
    id: "essential",
    label: "Essencial",
    price: "R$ 97/mês",
    priceValue: 97,
    desc: "Painel de Gestão + Link Público",
  },
  {
    id: "pro",
    label: "Profissional",
    price: "R$ 197/mês",
    priceValue: 197,
    desc: "Assistente de IA, lembretes e follow-ups",
  },
  {
    id: "premium",
    label: "Premium",
    price: "R$ 349/mês",
    priceValue: 349,
    desc: "NavalhIA escalável",
  },
];
