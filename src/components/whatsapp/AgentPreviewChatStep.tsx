import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MessageCircle, Send, AlertTriangle, Loader2, FileText, Activity, Trash2, Copy, RotateCcw, RefreshCw, Paperclip, X } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
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
type DiagnosticAttachment = { id: string; name: string; mimeType?: string; text: string };
type DiagnosticAssistantPayload = {
  recommended_profile_patch?: Record<string, unknown>;
  recommended_additional_instructions_patch?: string | null;
  risk_notes: string[];
  expected_outcomes: string[];
};
type DiagnosticMessage = {
  role: "user" | "assistant";
  content: string;
  payload?: DiagnosticAssistantPayload;
};

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
  openDiagnosticFromInbox,
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
  /** When true, open diagnostic modal and pre-fill from sessionStorage (navalhia_diagnostic_transcript). */
  openDiagnosticFromInbox?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [violations, setViolations] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [objectives, setObjectives] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [diagnosticMessages, setDiagnosticMessages] = useState<DiagnosticMessage[]>([]);
  const [diagnosticInput, setDiagnosticInput] = useState("");
  const [diagnosticAttachments, setDiagnosticAttachments] = useState<DiagnosticAttachment[]>([]);
  const [rollbackConfirmId, setRollbackConfirmId] = useState<string | null>(null);
  const [versionsDrawerOpen, setVersionsDrawerOpen] = useState(false);
  const [diagnosticModalOpen, setDiagnosticModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!openDiagnosticFromInbox) return;
    const transcript = sessionStorage.getItem("navalhia_diagnostic_transcript");
    if (!transcript) return;
    setDiagnosticModalOpen(true);
    setDiagnosticMessages([{ role: "user", content: transcript }]);
    sessionStorage.removeItem("navalhia_diagnostic_transcript");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("openDiagnostic");
      return next;
    }, { replace: true });
  }, [openDiagnosticFromInbox, setSearchParams]);

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

  const runAnalyzeConversation = async () => {
    const text = messages
      .map((m) => `${m.role === "user" ? "user" : "assistant"}: ${m.content}`)
      .join("\n");
    if (!text.trim()) return;
    await sendDiagnosticMessage(text.trim(), true);
  };

  const applyDiagnosticPatch = (
    payload: DiagnosticAssistantPayload | undefined,
    publish: boolean
  ) => {
    if (!payload) return;
    onApplyAnalyzerResult?.(
      {
        profile: payload.recommended_profile_patch,
        instructions: payload.recommended_additional_instructions_patch ?? undefined,
      },
      publish
    );
    setDiagnosticModalOpen(false);
  };

  const sendDiagnosticMessage = async (
    explicitText?: string,
    openModalOnStart = false
  ) => {
    const text = (explicitText ?? diagnosticInput).trim();
    if (!text || analyzing) return;
    if (openModalOnStart) setDiagnosticModalOpen(true);

    const userMessage: DiagnosticMessage = { role: "user", content: text };
    const nextMessages = [...diagnosticMessages, userMessage];
    setDiagnosticMessages(nextMessages);
    setDiagnosticInput("");
    setAnalyzing(true);
    setError(null);
    try {
      const res = await whatsappApi.diagnosticChat({
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        objectives: objectives.length ? objectives : undefined,
        attachments:
          diagnosticAttachments.length > 0
            ? diagnosticAttachments.map((a) => ({
                name: a.name,
                mime_type: a.mimeType,
                text: a.text,
              }))
            : undefined,
      });
      setDiagnosticMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.reply,
          payload: {
            recommended_profile_patch: res.recommended_profile_patch,
            recommended_additional_instructions_patch:
              res.recommended_additional_instructions_patch ?? null,
            risk_notes: res.risk_notes ?? [],
            expected_outcomes: res.expected_outcomes ?? [],
          },
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao diagnosticar");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAttachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const acceptedExtensions = ["txt", "md", "json", "csv", "log", "xml", "yaml", "yml"];
    const readTasks = Array.from(files).map(async (file) => {
      const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
      const isTextLike = file.type.startsWith("text/") || acceptedExtensions.includes(ext);
      if (!isTextLike) {
        throw new Error(`Arquivo ${file.name} não é texto. Use .txt, .md, .json, .csv, .log, .xml, .yaml ou .yml.`);
      }
      const text = await file.text();
      return {
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mimeType: file.type || undefined,
        text: text.slice(0, 20_000),
      } satisfies DiagnosticAttachment;
    });
    try {
      const read = await Promise.all(readTasks);
      setDiagnosticAttachments((prev) => [...prev, ...read].slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao ler anexos");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 space-y-4">
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
      <div className="flex flex-nowrap gap-2 items-center overflow-x-auto pb-1 scrollbar-thin shrink-0">
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setVersionsDrawerOpen(true)}
          disabled={versions.length === 0}
        >
          Versões do chatbot
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDiagnosticModalOpen(true)}
        >
          <FileText className="h-4 w-4 mr-1" />
          Diagnóstico
        </Button>
        {messages.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runAnalyzeConversation}
            disabled={loading || analyzing}
          >
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
            Analisar conversa
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-[520px] flex flex-col rounded-lg border bg-muted/30 overflow-hidden">
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
        <Sheet open={versionsDrawerOpen} onOpenChange={setVersionsDrawerOpen}>
          <SheetContent side="right" className="w-full max-w-md">
            <SheetHeader>
              <div className="flex items-center gap-2">
                <RefreshCw
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                <SheetTitle>Versões do chatbot</SheetTitle>
              </div>
              <SheetDescription>
                Reverter para uma versão anterior publicada.
              </SheetDescription>
            </SheetHeader>
            <ul className="mt-6 space-y-2">
              {versions.map((v, idx) => (
                <li
                  key={v.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md border p-2.5",
                    v.status === "active" ? "bg-primary/5 border-primary/20" : "bg-muted/30"
                  )}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-sm font-medium tabular-nums">
                      {versions.length - idx}
                    </span>
                    <Badge
                      variant={v.status === "active" ? "default" : "secondary"}
                      className={cn(
                        "shrink-0",
                        v.status === "active"
                          ? "bg-primary"
                          : "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {v.status === "active" ? "Publicado" : "Rascunho"}
                    </Badge>
                    <span className="text-xs text-muted-foreground truncate">
                      {formatVersionDate(v.created_at)}
                    </span>
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
          </SheetContent>
        </Sheet>
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
      <Dialog open={diagnosticModalOpen} onOpenChange={setDiagnosticModalOpen}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Diagnóstico com IA (Chat interno)
            </DialogTitle>
            <DialogDescription>
              Converse com o LLM para revisar atendimentos e refinar o agente. Você pode enviar texto livre e anexos de conversa (arquivos de texto).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
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
            <div className="rounded-lg border bg-muted/20 overflow-hidden">
              <ScrollArea className="h-[380px] sm:h-[420px] p-3">
                <div className="space-y-3">
                  {diagnosticMessages.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Envie uma pergunta para o diagnóstico, por exemplo: &quot;Analise esta conversa e sugira ajustes no tom e na conversão sem perder naturalidade.&quot;
                    </p>
                  )}
                  {diagnosticMessages.map((msg, idx) => (
                    <div key={idx} className="space-y-2">
                      <div
                        className={cn(
                          "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                          msg.role === "user"
                            ? "ml-auto max-w-[90%] bg-primary text-primary-foreground"
                            : "max-w-[95%] border bg-background"
                        )}
                      >
                        {msg.content}
                      </div>
                      {msg.role === "assistant" && msg.payload && (
                        <div className="space-y-2">
                          {msg.payload.expected_outcomes.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Resultado esperado: {msg.payload.expected_outcomes.join(" ")}
                            </p>
                          )}
                          {msg.payload.risk_notes.length > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-500">
                              Atenção: {msg.payload.risk_notes.join(" ")}
                            </p>
                          )}
                          {((msg.payload.recommended_profile_patch &&
                            Object.keys(msg.payload.recommended_profile_patch).length > 0) ||
                            msg.payload.recommended_additional_instructions_patch != null) && (
                            <>
                              <div className="rounded-lg border border-border/80 bg-muted/50 px-4 py-3 font-mono text-xs space-y-1.5 mt-2">
                                <p className="font-sans font-semibold text-foreground mb-1.5">Alterações sugeridas</p>
                                {formatPatchDiff(
                                  msg.payload.recommended_profile_patch,
                                  msg.payload.recommended_additional_instructions_patch ?? undefined,
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
                                  onClick={() => applyDiagnosticPatch(msg.payload, false)}
                                >
                                  Aplicar como rascunho
                                </Button>
                                <Button type="button" size="sm" onClick={() => applyDiagnosticPatch(msg.payload, true)}>
                                  Aplicar e publicar
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {analyzing && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      LLM analisando contexto...
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.json,.csv,.log,.xml,.yaml,.yml,text/plain,text/markdown,application/json,text/csv,text/xml,application/xml"
              multiple
              className="hidden"
              onChange={(e) => void handleAttachFiles(e.target.files)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="h-4 w-4 mr-1" />
                Anexar arquivos
              </Button>
              {diagnosticAttachments.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDiagnosticAttachments([])}
                >
                  Limpar anexos
                </Button>
              )}
            </div>
            {diagnosticAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {diagnosticAttachments.map((att) => (
                  <span
                    key={att.id}
                    className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-1 text-xs"
                  >
                    {att.name}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setDiagnosticAttachments((prev) =>
                          prev.filter((item) => item.id !== att.id)
                        )
                      }
                      aria-label={`Remover ${att.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Textarea
                value={diagnosticInput}
                onChange={(e) => setDiagnosticInput(e.target.value)}
                placeholder="Digite a pergunta para o LLM (ex.: identifique falhas de abordagem comercial e sugira ajustes)."
                className="min-h-[88px]"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={!diagnosticInput.trim() || analyzing}
                  onClick={() => void sendDiagnosticMessage()}
                >
                  {analyzing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Enviar ao LLM
                </Button>
              </div>
            </div>
            {applyFeedback && (
              <Alert variant={applyFeedback.type === "error" ? "destructive" : "default"} className="py-2">
                <AlertDescription>{applyFeedback.message}</AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
