import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Lock } from "lucide-react";
import type { AgentProfile } from "@/lib/api";
import { cn } from "@/lib/utils";

type HardRuleKey = keyof NonNullable<AgentProfile["hardRules"]>;

const FIXED_RULES: { key: HardRuleKey; label: string; desc: string }[] = [
  { key: "doNotAskPhone", label: "Nunca pedir telefone", desc: "O sistema já identifica o cliente pelo número." },
  { key: "doNotInventPlaces", label: "Nunca inventar endereços", desc: "Não sugerir lugares que não existem." },
];

const PREFERENCES: { key: HardRuleKey; label: string; desc: string }[] = [
  { key: "alwaysSteerToBooking", label: "Sempre direcionar para agendamento", desc: "Puxar a conversa para marcar horário." },
  { key: "showTopServicesWhenUnknown", label: "Mostrar principais serviços quando não existir", desc: "Se pedirem algo que não temos, listar os principais e CTA." },
];

export function AgentBehaviorStep({
  profile,
  onChange,
}: {
  profile: AgentProfile | Record<string, unknown>;
  onChange: (updates: Partial<AgentProfile>) => void;
}) {
  const p = profile as AgentProfile;
  const hardRules = (p.hardRules ?? {}) as Record<string, boolean | undefined>;
  const setRule = (key: string, value: boolean) => {
    onChange({ hardRules: { ...hardRules, [key]: value } });
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Regras fixas do sistema</Label>
          </div>
          <p className="text-xs text-muted-foreground font-normal">
            Não editáveis; sempre ativas para segurança e conformidade.
          </p>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4 space-y-3">
          {FIXED_RULES.map((b) => (
            <Tooltip key={b.key}>
              <TooltipTrigger asChild>
                <div className="flex items-start gap-3 rounded-md border p-2.5 bg-muted/30 cursor-default opacity-90">
                  <Checkbox id={`rule-fixed-${b.key}`} checked disabled className="pointer-events-none" />
                  <div className="flex-1 min-w-0">
                    <Label htmlFor={`rule-fixed-${b.key}`} className="font-medium cursor-default">{b.label}</Label>
                    <p className="text-sm text-muted-foreground mt-0.5">{b.desc}</p>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                Regra fixa do sistema
              </TooltipContent>
            </Tooltip>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="py-3 px-4">
          <Label className="text-sm font-medium">Preferências do agente</Label>
          <p className="text-xs text-muted-foreground font-normal">
            Você pode ativar ou desativar conforme a necessidade.
          </p>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4 space-y-3">
          {PREFERENCES.map((b) => (
            <div key={b.key} className={cn("flex items-start gap-3 rounded-md border p-2.5 hover:bg-muted/50")}>
              <Checkbox
                id={`rule-pref-${b.key}`}
                checked={hardRules[b.key] !== false}
                onCheckedChange={(checked) => setRule(b.key, checked === true)}
              />
              <div className="flex-1 min-w-0">
                <Label htmlFor={`rule-pref-${b.key}`} className="font-medium cursor-pointer">{b.label}</Label>
                <p className="text-sm text-muted-foreground mt-0.5">{b.desc}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
