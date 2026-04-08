import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentProfile } from "@/lib/api";
import { cn } from "@/lib/utils";

const BARBERSHOP_EMOJIS = [
  "✂️", "💈", "🪒", "🧔", "👨", "💪", "🔥", "✨", "👍", "🙌",
  "😄", "😊", "🤝", "⭐", "💯", "🎯", "📅", "⏰", "📍", "🙏",
];

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
        <CardContent className="pt-0 px-4 pb-4 space-y-3">
          <RadioGroup
            value={p.emojiLevel ?? "none"}
            onValueChange={(v) => {
              const level = v as "none" | "low" | "medium";
              onChange({ emojiLevel: level, allowedEmojis: level === "none" ? [] : p.allowedEmojis });
            }}
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
          {(p.emojiLevel ?? "none") !== "none" && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                Selecione os emojis permitidos (deixe vazio para liberar todos):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {BARBERSHOP_EMOJIS.map((emoji) => {
                  const allowed = p.allowedEmojis ?? [];
                  const selected = allowed.includes(emoji);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        const current = p.allowedEmojis ?? [];
                        const next = selected
                          ? current.filter((e) => e !== emoji)
                          : [...current, emoji];
                        onChange({ allowedEmojis: next });
                      }}
                      className={cn(
                        "text-lg rounded-md border p-1.5 transition-colors hover:bg-muted",
                        selected ? "border-primary bg-primary/10" : "border-border"
                      )}
                      title={emoji}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="py-3 px-4">
          <Label className="text-sm font-medium">Figurinhas</Label>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Enviar figurinhas</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permite o agente enviar figurinhas após confirmações (requer cadastro na aba Figurinhas)
              </p>
            </div>
            <Switch
              checked={p.stickersEnabled ?? false}
              onCheckedChange={(v) => onChange({ stickersEnabled: v })}
            />
          </div>
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
      <Card>
        <CardHeader className="py-3 px-4">
          <Label className="text-sm font-medium">Uso de gírias</Label>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <RadioGroup
            value={p.slangLevel ?? "low"}
            onValueChange={(v) => onChange({ slangLevel: v as "low" | "medium" | "high" })}
            className="flex flex-wrap gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="low" id="slang-low" />
              <Label htmlFor="slang-low" className="font-normal">Poucas</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="medium" id="slang-medium" />
              <Label htmlFor="slang-medium" className="font-normal">Moderado</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="high" id="slang-high" />
              <Label htmlFor="slang-high" className="font-normal">Bastante</Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
}
