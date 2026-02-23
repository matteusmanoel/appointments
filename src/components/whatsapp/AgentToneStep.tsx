import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentProfile } from "@/lib/api";
import { cn } from "@/lib/utils";

const TONE_PRESETS: { id: string; label: string; desc: string; example: string }[] = [
  { id: "default", label: "Padrão", desc: "Curto, simpático, descolado. Gírias leves.", example: "Oi! Tudo bem? Em que posso ajudar?" },
  { id: "formal", label: "Formal", desc: "Educado e profissional, sem gírias.", example: "Bom dia. Como posso ajudá-lo hoje?" },
  { id: "casual", label: "Descolado", desc: "Bem próximo, como um amigo.", example: "E aí! Bora agendar esse corte?" },
  { id: "minimal", label: "Minimalista", desc: "Objetivo, respostas curtas.", example: "Sim. Horário disponível às 14h." },
  { id: "sales", label: "Vendas", desc: "Proativo em sugerir serviços e agendar.", example: "Temos corte e barba. Quer agendar para quando?" },
];

function TruncateWithTooltip({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("block truncate", className)}>{text}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function AgentToneStep({
  profile,
  onChange,
}: {
  profile: AgentProfile | Record<string, unknown>;
  onChange: (updates: Partial<AgentProfile>) => void;
}) {
  const p = profile as AgentProfile;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3 px-4">
          <Label className="text-sm font-medium">Preset de tom</Label>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <RadioGroup
            value={p.tonePreset ?? "default"}
            onValueChange={(v) => onChange({ tonePreset: v })}
            className="grid gap-2"
          >
            {TONE_PRESETS.map((preset) => (
              <div key={preset.id} className="flex items-start gap-3 rounded-md border p-2.5 hover:bg-muted/50">
                <RadioGroupItem value={preset.id} id={`tone-${preset.id}`} className="mt-0.5" />
                <Label htmlFor={`tone-${preset.id}`} className="font-normal cursor-pointer flex-1 min-w-0">
                  <span className="font-medium block">{preset.label}</span>
                  <TruncateWithTooltip text={preset.desc} className="text-sm text-muted-foreground mt-0.5" />
                  <span className="text-xs text-muted-foreground/80 block mt-1 italic">&quot;{preset.example}&quot;</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="py-3 px-4">
          <Label className="text-sm font-medium">Emojis</Label>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <RadioGroup
            value={p.emojiLevel ?? "medium"}
            onValueChange={(v) => onChange({ emojiLevel: v as "none" | "low" | "medium" })}
            className="flex flex-wrap gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="none" id="emoji-none" />
              <Label htmlFor="emoji-none" className="font-normal">Nenhum</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="low" id="emoji-low" />
              <Label htmlFor="emoji-low" className="font-normal">Poucos</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="medium" id="emoji-medium" />
              <Label htmlFor="emoji-medium" className="font-normal">Moderado</Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="py-3 px-4">
          <Label className="text-sm font-medium">Objetividade</Label>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <RadioGroup
            value={p.verbosity ?? "normal"}
            onValueChange={(v) => onChange({ verbosity: v as "short" | "normal" })}
            className="flex flex-wrap gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="short" id="verb-short" />
              <Label htmlFor="verb-short" className="font-normal">Respostas curtas</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="normal" id="verb-normal" />
              <Label htmlFor="verb-normal" className="font-normal">Normal</Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="py-3 px-4">
          <Label className="text-sm font-medium">Estilo de vendas</Label>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <RadioGroup
            value={p.salesStyle ?? "soft"}
            onValueChange={(v) => onChange({ salesStyle: v as "soft" | "direct" })}
            className="flex flex-wrap gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="soft" id="sales-soft" />
              <Label htmlFor="sales-soft" className="font-normal">Leve</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="direct" id="sales-direct" />
              <Label htmlFor="sales-direct" className="font-normal">Direto</Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
}
