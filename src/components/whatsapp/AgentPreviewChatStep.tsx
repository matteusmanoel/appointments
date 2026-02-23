import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MessageCircle, Send, AlertTriangle, Loader2, FileText, ChevronDown, Activity, Trash2, Copy, RotateCcw } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { whatsappApi, type AgentProfile } from "@/lib/api";
import { cn } from "@/lib/utils";

function formatVersionDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const PROFILE_PATCH_LABELS: Record<string, string> = {
  tonePreset: "Preset de tom",
  emojiLevel: "Emojis",
  verbosity: "Objetividade",
  salesStyle: "Estilo de vendas",
  hardRules: "Regras de comportamento",
};

function formatPatchDiff(
  patch: Record<string, unknown> | undefined,
  instructionsPatch: string | null | undefined,
  currentProfile: Record<string, unknown>
): string[] {
  const lines: string[] = [];
  if (patch && Object.keys(patch).length > 0) {
    for (const [key, newVal] of Object.entries(patch)) {
      const label = PROFILE_PATCH_LABELS[key] ?? key;
      const oldVal = currentProfile[key];
      const oldStr = oldVal === undefined || oldVal === null ? "—" : String(oldVal);
      const newStr = newVal === undefined || newVal === null ? "—" : String(newVal);
      lines.push(`${label}: ${oldStr} → ${newStr}`);
    }
  }
  if (instructionsPatch !== undefined && instructionsPatch !== null) {
    lines.push("Instruções adicionais: (atualizado)");
  }
  return lines;
}

const SCENARIOS: { label: string; messages: Array<{ role: "user" | "assistant"; content: string }> }[] = [
  { label: "Saudação", messages: [{ role: "user", content: "Oi" }] },
  { label: "Serviço inexistente", messages: [{ role: "user", content: "Vocês fazem pizza?" }] },
  { label: "Hoje 17:45", messages: [{ role: "user", content: "Quero cortar o cabelo hoje às 17:45" }] },
  { label: "Ver serviços", messages: [{ role: "user", content: "Quais serviços vocês têm?" }] },
];

type ChatMessage = { role: "user" | "assistant"; content: string };

const ANALYZER_OBJECTIVES = [
  { id: "mais vendas", label: "Mais vendas" },
  { id: "mais direto", label: "Mais direto" },
  { id: "menos emoji", label: "Menos emoji" },
  { id: "evitar confirmações redundantes", label: "Evitar confirmações redundantes" },
];

export function AgentPreviewChatStep({
  draftProfile,
  draftAdditionalInstructions,
  onPublish,
  onRollback,
  onApplyAnalyzerResult,
  versions,
  isPublishing,
  isRollingBack,
  applyFeedback,
}: {
  draftProfile: AgentProfile | Record<string, unknown>;
  draftAdditionalInstructions?: string | null;
  onPublish: () => void;
  onRollback: (versionId: string) => void;
  onApplyAnalyzerResult?: (patch: { profile?: Record<string, unknown>; instructions?: string | null }, publish: boolean) => void;
  versions: Array<{ id: string; status: string; created_at: string }>;
  isPublishing: boolean;
  isRollingBack: boolean;
  /** Feedback from applying diagnostic result (draft or publish). Set by parent from mutation state. */
  applyFeedback?: { type: "success" | "error"; message: string } | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [violations, setViolations] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [objectives, setObjectives] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzerResult, setAnalyzerResult] = useState<{
    recommended_profile_patch?: Record<string, unknown>;
    recommended_additional_instructions_patch?: string | null;
    risk_notes: string[];
    expected_outcomes: string[];
  } | null>(null);
  const [rollbackConfirmId, setRollbackConfirmId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: health } = useQuery({
    queryKey: ["integrations", "whatsapp", "ai-health"],
    queryFn: () => whatsappApi.getAiHealth(),
  });

  const runSimulate = async (extraMessages: ChatMessage[] = []) => {
    const all = extraMessages.length ? extraMessages : messages;
    if (all.length === 0) return;
    setLoading(true);
    setError(null);
    setViolations([]);
    try {
      const res = await whatsappApi.simulateAiChat({
        messages: all,
        draft_profile: Object.keys(draftProfile ?? {}).length ? (draftProfile as Record<string, unknown>) : undefined,
        draft_additional_instructions: draftAdditionalInstructions ?? undefined,
      });
      const newMessages: ChatMessage[] = [...all, { role: "assistant", content: res.reply }];
      setMessages(newMessages);
      setViolations(res.violations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao simular");
    } finally {
      setLoading(false);
    }
  };

  const runScenario = (scenario: (typeof SCENARIOS)[0]) => {
    setMessages(scenario.messages);
    runSimulate(scenario.messages);
  };

  const clearChat = () => {
    setMessages([]);
    setViolations([]);
    setError(null);
  };

  const lastAssistantMessage = messages.length > 0 && messages[messages.length - 1].role === "assistant"
    ? messages[messages.length - 1].content
    : null;
  const copyLastReply = () => {
    if (!lastAssistantMessage) return;
    void navigator.clipboard.writeText(lastAssistantMessage);
  };

  const sendUser = () => {
    const text = input.trim();
    if (!text) return;
    const newMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    runSimulate(newMessages);
  };

  const violationLabels: Record<string, string> = {
    phone_ask: "Pediu telefone",
    uuid_leak: "Exposição de ID/UUID",
    excessive_emojis: "Excesso de emojis",
  };

  return (
    <div className="space-y-4">
      {health?.regression_detected && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Comportamento indesejado detectado</AlertTitle>
          <AlertDescription>
            Nas últimas 24h houve mais violações que o esperado (pedido de telefone, IDs expostos ou excesso de emojis).
            Revise o perfil do agente ou use &quot;Diagnóstico&quot; para aplicar uma correção sugerida.
          </AlertDescription>
        </Alert>
      )}
      {health && health.total_messages > 0 && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm flex items-center gap-2 flex-wrap">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span>Últimos 7 dias: {health.total_messages} mensagens</span>
          {health.messages_with_violations > 0 && (
            <span className="text-amber-600 dark:text-amber-500">
              • {health.messages_with_violations} com possível violação
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        {SCENARIOS.map((s) => (
          <Button
            key={s.label}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => runScenario(s)}
            disabled={loading}
          >
            {s.label}
          </Button>
        ))}
        {messages.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => runScenario({ label: "", messages })} disabled={loading}>
            Rodar novamente
          </Button>
        )}
      </div>
      <div className="rounded-lg border bg-muted/30 overflow-hidden flex flex-col h-[280px]">
        <div className="shrink-0 px-3 py-2 border-b bg-muted/50 text-sm font-medium flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Chat de simulação
          </span>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearChat} disabled={loading || messages.length === 0}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Limpar chat
            </Button>
            {lastAssistantMessage && (
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={copyLastReply}>
                <Copy className="h-3.5 w-3.5 mr-1" />
                Copiar resposta
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="flex-1 min-h-0 p-3">
          <div className="space-y-2">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Clique em um cenário ou digite uma mensagem para testar.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm max-w-[85%]",
                  m.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-background border"
                )}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Atendente pensando...</span>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="shrink-0 p-2 border-t flex gap-2">
          <input
            type="text"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Digite uma mensagem..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendUser()}
          />
          <Button type="button" size="sm" onClick={sendUser} disabled={loading}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {violations.length > 0 && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          <AlertTitle>Possíveis violações nesta simulação</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              {violations.map((v) => (
                <li key={v}>{violationLabels[v] ?? v}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {versions.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <Label className="text-sm font-medium">Versões publicadas</Label>
            <p className="text-xs text-muted-foreground font-normal">
              Reverter para uma versão anterior publicada.
            </p>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <ul className="space-y-2">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md border p-2.5",
                    v.status === "active" ? "bg-primary/5 border-primary/20" : "bg-muted/30"
                  )}
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium block">{formatVersionDate(v.created_at)}</span>
                    <span className="text-xs text-muted-foreground capitalize">{v.status === "active" ? "Ativa" : "Anterior"}</span>
                  </div>
                  {v.status !== "active" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRollbackConfirmId(v.id)}
                      disabled={isRollingBack}
                    >
                      {isRollingBack ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                      Reverter
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <ConfirmDialog
        open={rollbackConfirmId !== null}
        onOpenChange={(open) => !open && setRollbackConfirmId(null)}
        title="Reverter para esta versão?"
        description="A versão atual será substituída pela versão selecionada. Esta ação pode ser desfeita publicando novamente."
        confirmLabel="Reverter"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (rollbackConfirmId) {
            onRollback(rollbackConfirmId);
            setRollbackConfirmId(null);
          }
        }}
      />
      <Collapsible open={analyzerOpen} onOpenChange={setAnalyzerOpen} className="mt-4 border rounded-lg">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50">
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Diagnóstico: analisar conversa exportada
          </span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", analyzerOpen && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Cole o texto exportado do WhatsApp (.txt) ou envie o arquivo. Escolha os objetivos e clique em Analisar.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const r = new FileReader();
                r.onload = () => setChatText(String(r.result ?? ""));
                r.readAsText(f);
              }
            }}
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              Enviar .txt
            </Button>
          </div>
          <textarea
            className="w-full rounded border bg-background px-2 py-1.5 text-sm min-h-[80px]"
            placeholder="Ou cole aqui o texto da conversa..."
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
          />
          <div>
            <p className="text-xs font-medium mb-1">Objetivos</p>
            <div className="flex flex-wrap gap-2">
              {ANALYZER_OBJECTIVES.map((o) => (
                <label key={o.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={objectives.includes(o.id)}
                    onChange={(e) =>
                      setObjectives((prev) => (e.target.checked ? [...prev, o.id] : prev.filter((x) => x !== o.id)))
                    }
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!chatText.trim() || analyzing}
            onClick={async () => {
              setAnalyzing(true);
              setAnalyzerResult(null);
              try {
                const res = await whatsappApi.analyzeChat({
                  chat_text: chatText.trim(),
                  objectives: objectives.length ? objectives : undefined,
                });
                setAnalyzerResult({
                  recommended_profile_patch: res.recommended_profile_patch,
                  recommended_additional_instructions_patch: res.recommended_additional_instructions_patch ?? null,
                  risk_notes: res.risk_notes ?? [],
                  expected_outcomes: res.expected_outcomes ?? [],
                });
              } catch (e) {
                setError(e instanceof Error ? e.message : "Erro ao analisar");
              } finally {
                setAnalyzing(false);
              }
            }}
          >
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Analisar
          </Button>
          {analyzerResult && (
            <div className="space-y-3 text-sm border-t pt-3">
              {analyzerResult.expected_outcomes.length > 0 && (
                <p><strong>Resultado esperado:</strong> {analyzerResult.expected_outcomes.join(" ")}</p>
              )}
              {analyzerResult.risk_notes.length > 0 && (
                <p className="text-amber-600 dark:text-amber-500"><strong>Atenção:</strong> {analyzerResult.risk_notes.join(" ")}</p>
              )}
              {((analyzerResult.recommended_profile_patch && Object.keys(analyzerResult.recommended_profile_patch).length > 0) || analyzerResult.recommended_additional_instructions_patch != null) && (
                <>
                  <div className="rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-xs space-y-1">
                    <p className="font-sans font-medium text-muted-foreground mb-1">Alterações sugeridas</p>
                    {formatPatchDiff(
                      analyzerResult.recommended_profile_patch,
                      analyzerResult.recommended_additional_instructions_patch ?? undefined,
                      draftProfile as Record<string, unknown>
                    ).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onApplyAnalyzerResult?.(
                        {
                          profile: analyzerResult.recommended_profile_patch,
                          instructions: analyzerResult.recommended_additional_instructions_patch ?? undefined,
                        },
                        false
                      )}
                    >
                      Aplicar como rascunho
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        onApplyAnalyzerResult?.(
                          {
                            profile: analyzerResult.recommended_profile_patch,
                            instructions: analyzerResult.recommended_additional_instructions_patch ?? undefined,
                          },
                          true
                        );
                      }}
                    >
                      Aplicar e publicar
                    </Button>
                  </div>
                </>
              )}
              {applyFeedback && (
                <Alert variant={applyFeedback.type === "error" ? "destructive" : "default"} className="py-2">
                  <AlertDescription>{applyFeedback.message}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
