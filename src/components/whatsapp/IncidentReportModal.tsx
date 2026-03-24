import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle } from "lucide-react";
import { whatsappApi } from "@/lib/api";

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  double_booking: "Agendamento em horário já ocupado",
  ignored_availability: "Ignorou disponibilidade",
  asked_phone: "Pediu telefone do cliente",
  uuid_leak: "Mostrou ID/UUID",
  tone_issue: "Problema de tom",
  wrong_policy: "Política errada",
  hallucination: "Resposta incoerente/inventou",
};

export type IncidentDiagnoseResult = {
  summary: string;
  question_to_confirm: string;
  recommended_profile_patch?: Record<string, unknown>;
  recommended_additional_instructions_patch?: string | null;
  recommended_custom_rules_patch?: {
    add?: Array<Record<string, unknown>>;
    update?: Array<{ id: string; patch: Record<string, unknown> }>;
    disable?: string[];
  };
  suite_scenarios_to_run?: string[];
  risk_notes: string[];
};

/** Merge incident diagnose result into current profile + instructions for API update. */
export function mergeIncidentPatch(
  currentProfile: Record<string, unknown>,
  currentInstructions: string | null,
  result: IncidentDiagnoseResult
): { agent_profile: Record<string, unknown>; additional_instructions: string | null } {
  const baseProfile = { ...currentProfile, ...(result.recommended_profile_patch ?? {}) };
  let customRules = Array.isArray(baseProfile.customRules) ? [...(baseProfile.customRules as Record<string, unknown>[])] : [];
  const crp = result.recommended_custom_rules_patch;
  if (crp) {
    const disableSet = new Set(crp.disable ?? []);
    if (disableSet.size > 0) {
      customRules = customRules.map((r) =>
        disableSet.has(String((r as { id?: string }).id ?? ""))
          ? { ...r, enabled: false }
          : r
      );
    }
    for (const u of crp.update ?? []) {
      const i = customRules.findIndex((r) => (r as { id?: string }).id === u.id);
      if (i >= 0) customRules[i] = { ...customRules[i], ...u.patch } as Record<string, unknown>;
    }
    const toAdd = (crp.add ?? []).map((r) => ({ ...r, id: (r as { id?: string }).id ?? crypto.randomUUID() }));
    customRules = [...customRules, ...toAdd];
  }
  return {
    agent_profile: { ...baseProfile, customRules },
    additional_instructions: result.recommended_additional_instructions_patch ?? currentInstructions ?? null,
  };
}

const PROFILE_PATCH_LABELS: Record<string, string> = {
  tonePreset: "Preset de tom",
  emojiLevel: "Emojis",
  verbosity: "Objetividade",
  salesStyle: "Estilo de vendas",
  hardRules: "Regras de comportamento",
};

function formatDiffLines(
  result: IncidentDiagnoseResult,
  currentProfile: Record<string, unknown>
): string[] {
  const lines: string[] = [];
  const patch = result.recommended_profile_patch;
  if (patch && Object.keys(patch).length > 0) {
    for (const [key, newVal] of Object.entries(patch)) {
      const label = PROFILE_PATCH_LABELS[key] ?? key;
      const oldVal = currentProfile[key];
      const oldStr = oldVal === undefined || oldVal === null ? "—" : String(oldVal);
      const newStr = newVal === undefined || newVal === null ? "—" : String(newVal);
      lines.push(`${label}: ${oldStr} → ${newStr}`);
    }
  }
  if (
    result.recommended_additional_instructions_patch !== undefined &&
    result.recommended_additional_instructions_patch !== null
  ) {
    lines.push("Instruções adicionais: (atualizado)");
  }
  const crp = result.recommended_custom_rules_patch;
  if (crp) {
    const add = crp.add?.length ?? 0;
    const update = crp.update?.length ?? 0;
    const disable = crp.disable?.length ?? 0;
    const parts: string[] = [];
    if (add > 0) parts.push(`+${add} adicionada(s)`);
    if (update > 0) parts.push(`${update} atualizada(s)`);
    if (disable > 0) parts.push(`${disable} desativada(s)`);
    if (parts.length > 0) lines.push(`Regras customizadas: ${parts.join(", ")}`);
  }
  return lines;
}

export function IncidentReportModal({
  open,
  onClose,
  transcript,
  settingsSnapshot,
  conversationId,
  promptVersionId,
  toolTrace,
  currentProfileForDiff = {},
  onApplyDraft,
  onApplyAndPublish,
}: {
  open: boolean;
  onClose: () => void;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  settingsSnapshot: { agent_profile?: Record<string, unknown>; additional_instructions?: string | null };
  conversationId?: string;
  promptVersionId?: string | null;
  toolTrace?: Array<{ name: string; args?: Record<string, unknown>; result?: unknown }>;
  currentProfileForDiff?: Record<string, unknown>;
  onApplyDraft: (result: IncidentDiagnoseResult) => void;
  onApplyAndPublish: (result: IncidentDiagnoseResult) => void;
}) {
  const [step, setStep] = useState<"select" | "loading" | "result">("select");
  const [incidentType, setIncidentType] = useState<string>("");
  const [managerNote, setManagerNote] = useState("");
  const [result, setResult] = useState<IncidentDiagnoseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!incidentType) return;
    setError(null);
    setStep("loading");
    try {
      const res = await whatsappApi.diagnoseIncident({
        incident_type: incidentType,
        manager_note: managerNote.trim() || undefined,
        conversation_id: conversationId,
        prompt_version_id: promptVersionId ?? undefined,
        settings_snapshot: settingsSnapshot,
        transcript,
        tool_trace: toolTrace,
      });
      setResult(res);
      setStep("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao analisar incidente");
      setStep("select");
    }
  };

  const handleClose = () => {
    setStep("select");
    setIncidentType("");
    setManagerNote("");
    setResult(null);
    setError(null);
    onClose();
  };

  const handleApplyDraft = () => {
    if (result) {
      onApplyDraft(result);
      handleClose();
    }
  };

  const handleApplyAndPublish = () => {
    if (result) {
      onApplyAndPublish(result);
      handleClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? handleClose() : undefined)}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reportar problema</DialogTitle>
          <DialogDescription>
            {step === "select" &&
              "Selecione o tipo de incidente e opcionalmente descreva o que aconteceu. O assistente irá sugerir uma correção."}
            {step === "loading" && "Analisando incidente…"}
            {step === "result" && result && "Sugestão de correção"}
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Tipo de incidente</Label>
              <Select value={incidentType} onValueChange={setIncidentType}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INCIDENT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Observação (opcional)</Label>
              <Textarea
                placeholder="Ex.: Cliente reclamou que a IA confirmou horário já ocupado."
                value={managerNote}
                onChange={(e) => setManagerNote(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button onClick={handleAnalyze} disabled={!incidentType}>
                Analisar
              </Button>
            </div>
          </div>
        )}

        {step === "loading" && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-foreground">{result.summary}</p>
            <p className="text-sm font-medium text-foreground">{result.question_to_confirm}</p>
            {result.risk_notes.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside text-sm">
                    {result.risk_notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {formatDiffLines(result, currentProfileForDiff).length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium text-muted-foreground mb-2">Alterações sugeridas:</p>
                <ul className="list-disc list-inside space-y-1">
                  {formatDiffLines(result, currentProfileForDiff).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button variant="secondary" onClick={handleApplyDraft}>
                Aplicar no rascunho
              </Button>
              <Button onClick={handleApplyAndPublish}>
                Aplicar e publicar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
