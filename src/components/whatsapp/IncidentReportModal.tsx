import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle, BookOpen, CheckCircle2, Copy } from "lucide-react";
import { whatsappApi } from "@/lib/api";

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  // Agendamento
  double_booking: "Agendamento em horário já ocupado",
  ignored_availability: "Ignorou disponibilidade",
  reagendamento_incorreto: "Reagendamento incorreto",
  falha_fechamento: "Falha no fechamento do agendamento",
  // Conversação
  abertura_robotizada: "Abertura robotizada / sem naturalidade",
  loop_conversacional: "Loop conversacional",
  pergunta_duplicada: "Pergunta duplicada / repetida",
  erro_retomada_tool: "Erro na retomada após tool failure",
  // Segurança / exposição
  uuid_leak: "Mostrou ID/UUID",
  asked_phone: "Pediu telefone do cliente",
  exposicao_erro_tecnico: "Exposição de erro técnico",
  hallucination: "Resposta incoerente / inventou",
  // Memória e contexto
  memoria_incorreta: "Memória do cliente usada incorretamente",
  wrong_policy: "Política errada",
  // Tom e estilo
  tone_issue: "Problema de tom",
  // Pós-atendimento
  follow_up_ruim: "Follow-up inadequado",
  lembrete_inadequado: "Lembrete inadequado",
  cobranca_ruim: "Cobrança problemática",
  // Operacional
  concorrencia_ruido: "Concorrência / ruído operacional",
};

const INCIDENT_GROUPS: Array<{ label: string; types: string[] }> = [
  {
    label: "Agendamento",
    types: ["double_booking", "ignored_availability", "reagendamento_incorreto", "falha_fechamento"],
  },
  {
    label: "Conversação",
    types: ["abertura_robotizada", "loop_conversacional", "pergunta_duplicada", "erro_retomada_tool"],
  },
  {
    label: "Segurança / Exposição",
    types: ["uuid_leak", "asked_phone", "exposicao_erro_tecnico", "hallucination"],
  },
  {
    label: "Memória e Contexto",
    types: ["memoria_incorreta", "wrong_policy"],
  },
  {
    label: "Tom e Estilo",
    types: ["tone_issue"],
  },
  {
    label: "Pós-atendimento",
    types: ["follow_up_ruim", "lembrete_inadequado", "cobranca_ruim"],
  },
  {
    label: "Operacional",
    types: ["concorrencia_ruido"],
  },
];

const SEVERITY_LABELS: Record<string, { label: string; color: string }> = {
  critical: { label: "Crítica", color: "destructive" },
  medium: { label: "Média", color: "secondary" },
  light: { label: "Leve", color: "outline" },
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

type Step = "select" | "loading" | "result" | "saving" | "saved";

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
  const [step, setStep] = useState<Step>("select");
  const [incidentType, setIncidentType] = useState<string>("");
  const [severity, setSeverity] = useState<"critical" | "medium" | "light">("medium");
  const [managerNote, setManagerNote] = useState("");
  const [result, setResult] = useState<IncidentDiagnoseResult | null>(null);
  const [savedIncidentId, setSavedIncidentId] = useState<string | null>(null);
  const [savedScenarioDraft, setSavedScenarioDraft] = useState<Record<string, unknown> | null>(null);
  const [copied, setCopied] = useState(false);
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

  const handleSaveToBenchmark = async () => {
    setError(null);
    setStep("saving");
    try {
      const saved = await whatsappApi.saveIncident({
        incident_type: incidentType,
        severity,
        manager_note: managerNote.trim() || undefined,
        conversation_id: conversationId,
        transcript,
        settings_snapshot: settingsSnapshot,
        diagnosis_result: result ? (result as unknown as Record<string, unknown>) : undefined,
      });
      setSavedIncidentId(saved.id);
      setSavedScenarioDraft(saved.benchmark_scenario_draft);
      setStep("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar incidente");
      setStep("result");
    }
  };

  const handleCopyDraft = () => {
    if (!savedScenarioDraft) return;
    navigator.clipboard.writeText(JSON.stringify(savedScenarioDraft, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClose = () => {
    setStep("select");
    setIncidentType("");
    setSeverity("medium");
    setManagerNote("");
    setResult(null);
    setSavedIncidentId(null);
    setSavedScenarioDraft(null);
    setCopied(false);
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
          <DialogTitle>Reportar problema da IA</DialogTitle>
          <DialogDescription>
            {step === "select" && "Classifique e descreva o problema. A IA irá sugerir uma correção."}
            {step === "loading" && "Analisando incidente…"}
            {step === "result" && "Sugestão de correção"}
            {step === "saving" && "Salvando incidente no benchmark…"}
            {step === "saved" && "Incidente registrado com sucesso"}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: select ── */}
        {step === "select" && (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Tipo de problema</Label>
              <Select value={incidentType} onValueChange={setIncidentType}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_GROUPS.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel className="text-xs text-muted-foreground">{group.label}</SelectLabel>
                      {group.types.map((type) => (
                        <SelectItem key={type} value={type}>
                          {INCIDENT_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Severidade</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as "critical" | "medium" | "light")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Crítica — bloqueia o agendamento ou expõe dado sensível</SelectItem>
                  <SelectItem value="medium">Média — prejudica a experiência mas não bloqueia</SelectItem>
                  <SelectItem value="light">Leve — problema estético ou de tom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Observação (opcional)</Label>
              <Textarea
                placeholder="Descreva o que aconteceu e qual era o comportamento esperado."
                value={managerNote}
                onChange={(e) => setManagerNote(e.target.value)}
                rows={3}
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
                Analisar com IA
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: loading / saving ── */}
        {(step === "loading" || step === "saving") && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {step === "saving" ? "Salvando…" : "Analisando…"}
            </p>
          </div>
        )}

        {/* ── Step: result ── */}
        {step === "result" && result && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2">
              <Badge variant={SEVERITY_LABELS[severity]?.color as "destructive" | "secondary" | "outline" ?? "secondary"}>
                {SEVERITY_LABELS[severity]?.label ?? severity}
              </Badge>
              <span className="text-xs text-muted-foreground">{INCIDENT_TYPE_LABELS[incidentType] ?? incidentType}</span>
            </div>

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

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                variant="secondary"
                onClick={handleSaveToBenchmark}
                className="gap-1.5"
              >
                <BookOpen className="h-4 w-4" />
                Salvar no benchmark
              </Button>
              <Button variant="outline" onClick={handleApplyDraft}>
                Aplicar no rascunho
              </Button>
              <Button onClick={handleApplyAndPublish}>
                Aplicar e publicar
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: saved ── */}
        {step === "saved" && savedIncidentId && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              Incidente salvo com sucesso
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">ID do incidente</span>
                <code className="text-xs font-mono">{savedIncidentId.slice(0, 8)}…</code>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tipo</span>
                <span>{INCIDENT_TYPE_LABELS[incidentType] ?? incidentType}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Severidade</span>
                <Badge variant={SEVERITY_LABELS[severity]?.color as "destructive" | "secondary" | "outline" ?? "secondary"}>
                  {SEVERITY_LABELS[severity]?.label ?? severity}
                </Badge>
              </div>
            </div>

            {savedScenarioDraft && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Rascunho de cenário benchmark
                  </p>
                  <Button variant="ghost" size="sm" onClick={handleCopyDraft} className="h-6 px-2 text-xs gap-1">
                    <Copy className="h-3 w-3" />
                    {copied ? "Copiado!" : "Copiar JSON"}
                  </Button>
                </div>
                <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto max-h-48 leading-relaxed">
                  {JSON.stringify(savedScenarioDraft, null, 2)}
                </pre>
                <p className="text-xs text-muted-foreground">
                  Cole este rascunho em{" "}
                  <code className="font-mono">backend/benchmark/scenarios/barbershop/</code>,
                  ajuste os <code className="font-mono">turns</code> e <code className="font-mono">expected</code>,
                  e rode <code className="font-mono">npx tsx benchmark/cli.ts run</code>.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={handleClose}>Fechar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
