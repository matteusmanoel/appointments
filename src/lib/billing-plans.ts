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
    price: "R$ 147/mês",
    priceValue: 147,
    desc: "Painel de Gestão + Link Público",
  },
  {
    id: "pro",
    label: "Profissional",
    price: "R$ 297/mês",
    priceValue: 297,
    desc: "Assistente de IA, lembretes e follow-ups",
  },
  {
    id: "premium",
    label: "Premium",
    price: "R$ 449/mês",
    priceValue: 449,
    desc: "NavalhIA escalável",
  },
];
