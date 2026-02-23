import { useState, useCallback, useEffect, useRef, Fragment } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { X, Loader2, RotateCcw, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { getWhatsAppSupportUrl } from "@/lib/whatsapp-sales";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  createInitialState,
  runDemoAgent,
  getSessionSeed,
  getUiHints,
  type DemoSessionState,
  type DemoAgentReply,
  type DemoTraceEvent,
} from "@/lib/demo-agent";
import { FakeWhatsAppInbox } from "@/components/ai-demo/FakeWhatsAppInbox";

type Message = { role: "user" | "bot"; text: string };

const TRACE_STEP_MS = 350;
const MAX_MESSAGE_LENGTH = 400;

function traceLabel(ev: DemoTraceEvent): string {
  switch (ev.type) {
    case "list_services":
      return "Buscando serviços…";
    case "get_next_slots":
      return "Procurando próximos horários…";
    case "check_availability":
      return "Checando disponibilidade…";
    default:
      return "Consultando agenda…";
  }
}

const PROGRESS_LABELS = ["Serviço", "Data", "Hora", "Confirmação", "Final"];

type Props = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAssinarClick?: () => void;
  onWhatsAppClick?: () => void;
};

/** Render text with *word* as bold and preserve line breaks (WhatsApp-style). */
function renderBotText(text: string) {
  const lines = text.split(/\n/);
  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*[^*]+\*)/g);
    const content = parts.map((part, i) => {
      if (part.startsWith("*") && part.endsWith("*")) {
        return <strong key={i}>{part.slice(1, -1)}</strong>;
      }
      return <span key={i}>{part}</span>;
    });
    return (
      <Fragment key={lineIndex}>
        {content}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </Fragment>
    );
  });
}

export function AiSchedulingDemoChat({
  open = false,
  onOpenChange,
  onAssinarClick,
  onWhatsAppClick,
}: Props) {
  const [isOpen, setIsOpen] = useState(open);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentState, setAgentState] = useState<DemoSessionState>(createInitialState);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [pendingReply, setPendingReply] = useState<DemoAgentReply | null>(null);
  const [traceStepIndex, setTraceStepIndex] = useState(0);
  const [showInboxOnMobile, setShowInboxOnMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const effectiveOpen = onOpenChange ? open : isOpen;
  const setEffectiveOpen = onOpenChange ?? setIsOpen;

  const uiHints = getUiHints(agentState);

  useEffect(() => {
    if (onOpenChange) setIsOpen(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!effectiveOpen) setShowInboxOnMobile(false);
  }, [effectiveOpen]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, suggestions]);

  const applyReply = useCallback((reply: DemoAgentReply) => {
    setAgentState(reply.state);
    setPendingReply(null);
    setTraceStepIndex(0);
    setIsThinking(false);
    if (reply.reset) {
      setMessages([{ role: "bot", text: reply.message }]);
      setSuggestions(reply.suggestions);
      return;
    }
    const parts = reply.message.split("[[MSG]]").map((p) => p.trim()).filter(Boolean);
    setMessages((m) => {
      const next = [...m];
      for (const part of parts) next.push({ role: "bot", text: part });
      return next;
    });
    setSuggestions(reply.suggestions);
  }, []);

  useEffect(() => {
    if (pendingReply == null || traceStepIndex >= pendingReply.trace.length) return;
    const id = setTimeout(() => {
      setTraceStepIndex((i) => {
        const next = i + 1;
        if (next >= (pendingReply?.trace.length ?? 0)) {
          applyReply(pendingReply!);
          return 0;
        }
        return next;
      });
    }, TRACE_STEP_MS);
    return () => clearTimeout(id);
  }, [pendingReply, traceStepIndex, applyReply]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.slice(0, MAX_MESSAGE_LENGTH).trim();
      if (!trimmed) return;

      setMessages((m) => [...m, { role: "user", text: trimmed }]);
      setInputValue("");
      setSuggestions([]);
      setIsThinking(true);

      const reply: DemoAgentReply = runDemoAgent(
        trimmed,
        agentState,
        undefined,
        new Date(),
        getSessionSeed()
      );

      if (reply.trace.length > 0) {
        setPendingReply(reply);
        setTraceStepIndex(0);
      } else {
        applyReply(reply);
      }
    },
    [agentState, applyReply]
  );

  const didInitialOpen = useRef(false);
  useEffect(() => {
    if (!effectiveOpen) {
      didInitialOpen.current = false;
      return;
    }
    if (!didInitialOpen.current && messages.length === 0) {
      didInitialOpen.current = true;
      const opening =
        "Salve! 😄 Bora deixar na régua? Quer ver os serviços ou já quer agendar? ✂️";
      setMessages([{ role: "bot", text: opening }]);
      setSuggestions(["Ver serviços", "Quero agendar"]);
    }
  }, [effectiveOpen, messages.length]);

  const handleClose = () => setEffectiveOpen(false);

  const handleRestart = () => {
    setMessages([]);
    setAgentState(createInitialState());
    setSuggestions([]);
    setInputValue("");
    setPendingReply(null);
    setTraceStepIndex(0);
    setIsThinking(false);
    didInitialOpen.current = false;
    const opening =
      "Salve! 😄 Bora deixar na régua? Quer ver os serviços ou já quer agendar? ✂️";
    setMessages([{ role: "bot", text: opening }]);
    setSuggestions(["Ver serviços", "Quero agendar"]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  const handleChipClick = (suggestion: string) => {
    sendMessage(suggestion);
  };

  const appointmentCreated = agentState.appointmentCreated;

  return (
    <>
      <Dialog open={effectiveOpen} onOpenChange={(o) => setEffectiveOpen(o)}>
        <DialogPortal>
          <DialogOverlay className="bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className={cn(
              "fixed left-0 right-0 top-0 z-50 flex flex-col overflow-hidden shadow-2xl border-0 border-b bg-card",
              "max-h-[100dvh] h-[100dvh] rounded-none",
              "md:left-1/2 md:right-auto md:top-1/2 md:w-[calc(100vw-2rem)] md:max-w-[1100px] md:h-[min(720px,85vh)] md:max-h-[85vh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            )}
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">
              Demo de agendamento com IA — NavalhIA (simulação)
            </DialogPrimitive.Title>
            <TooltipProvider>
              <div className="flex flex-1 min-w-0 min-h-0">
                {showInboxOnMobile ? (
                  <div className="flex flex-col flex-1 min-w-0 md:hidden border-r bg-muted/30">
                    <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        onClick={() => setShowInboxOnMobile(false)}
                        aria-label="Voltar ao chat"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        Voltar
                      </Button>
                      <span className="text-xs text-muted-foreground">Lista simulada</span>
                    </div>
                    <FakeWhatsAppInbox className="flex-1 min-h-0 overflow-hidden !w-full !border-r-0" aria-hidden={false} />
                  </div>
                ) : (
                  <FakeWhatsAppInbox className="hidden md:flex" />
                )}
                <div
                  className={cn(
                    "flex flex-col flex-1 min-w-0 bg-background",
                    showInboxOnMobile ? "hidden md:flex" : "flex",
                  )}
                >
                  <div className="flex flex-col border-b bg-muted/50 shrink-0">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 md:px-4 md:py-3">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <img
                          src="/logo-app.svg"
                          alt=""
                          className="w-8 h-8 md:w-9 md:h-9 rounded-full object-contain shrink-0 bg-primary/5 p-1"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">NavalhIA</p>
                          <p className="text-[11px] md:text-xs text-muted-foreground flex items-center gap-1 truncate" id="demo-chat-subtitle">
                            <span className="inline-block w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-green-500 shrink-0" />
                            <span className="truncate">IA de atendimento • responde na hora</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground border">
                                Simulação
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[200px]">
                              Esta conversa não envia mensagens de verdade. No produto real, seus clientes recebem no WhatsApp.
                            </TooltipContent>
                          </Tooltip>
                          <span className="hidden sm:inline-block shrink-0 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground border">
                            Sem envio real
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 min-w-[44px] min-h-[44px] md:h-8 md:w-8 md:min-w-0 md:min-h-0"
                              onClick={handleRestart}
                              aria-label="Reiniciar chat"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Reiniciar conversa</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 min-w-[44px] min-h-[44px] md:h-8 md:w-8 md:min-w-0 md:min-h-0"
                              onClick={handleClose}
                              aria-label="Fechar"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Fechar</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    {!appointmentCreated && (
                      <div className="px-3 pb-2 md:px-4 flex items-center gap-1 overflow-x-auto">
                        {PROGRESS_LABELS.map((label, i) => (
                          <span
                            key={label}
                            className={cn(
                              "shrink-0 text-[10px] font-medium rounded-full px-2 py-1",
                              i <= uiHints.progressStep
                                ? "bg-primary/15 text-primary"
                                : "text-muted-foreground bg-muted/50",
                            )}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4 space-y-3 min-h-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-muted/20 via-background to-muted/10"
                  >
                <p className="text-[10px] md:text-[11px] text-muted-foreground mb-2 px-2 py-1.5 rounded bg-muted/30" role="status">
                  Você está falando com a NavalhIA (simulação). Use frases de agendamento: &quot;corte amanhã 10h&quot;, &quot;ver serviços&quot;.
                </p>
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex flex-col",
                      msg.role === "user" ? "items-end" : "items-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3 py-2 md:px-4 text-sm whitespace-pre-wrap",
                        msg.role === "user"
                          ? "bg-muted text-foreground rounded-br-md border border-border/50"
                          : "bg-green-600 text-green-50 rounded-bl-md shadow-sm",
                      )}
                    >
                      {msg.role === "bot" ? renderBotText(msg.text) : msg.text}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                      Agora
                    </span>
                  </div>
                ))}

                {isThinking && (
                  <div className="flex justify-start flex-col items-start">
                    <div className="rounded-2xl rounded-bl-md px-4 py-2 bg-green-600 text-green-50 text-sm flex items-center gap-2 shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      {pendingReply && traceStepIndex < pendingReply.trace.length
                        ? traceLabel(pendingReply.trace[traceStepIndex])
                        : "Consultando agenda…"}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5 px-1">Agora</span>
                  </div>
                )}

                {suggestions.length > 0 && !isThinking && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {suggestions.map((s) => (
                      <Button
                        key={s}
                        variant="outline"
                        size="sm"
                        className="text-xs min-h-[36px] md:min-h-0"
                        onClick={() => handleChipClick(s)}
                      >
                        {s}
                      </Button>
                    ))}
                  </div>
                )}

                {appointmentCreated && (
                  <div className="flex flex-col gap-3 pt-2">
                    <div className="rounded-xl border bg-muted/30 p-3 text-left">
                      <p className="text-xs font-medium text-foreground mb-2">
                        No produto real isso acontece no seu WhatsApp
                      </p>
                      <ul className="text-[11px] text-muted-foreground space-y-1 list-disc list-inside">
                        <li>Sua agenda atualiza na hora</li>
                        <li>Lembretes e confirmação automáticos</li>
                        <li>Cliente pode reagendar ou cancelar pelo chat</li>
                      </ul>
                    </div>
                    <Button size="sm" onClick={onAssinarClick} className="w-full">
                      Assinar e ativar no meu WhatsApp
                    </Button>
                    <a
                      href={getWhatsAppSupportUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm" className="w-full">
                        Tirar dúvidas via WhatsApp
                      </Button>
                    </a>
                    <p className="text-[10px] text-muted-foreground text-center">
                      Checkout Stripe • Sem fidelidade
                    </p>
                  </div>
                )}
              </div>

              {!appointmentCreated && (
                <form
                  onSubmit={handleSubmit}
                  className="shrink-0 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3"
                >
                  <div className="flex gap-2 items-end">
                    <textarea
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (inputValue.trim()) sendMessage(inputValue);
                        }
                      }}
                      placeholder={uiHints.placeholder || "Digite sua mensagem..."}
                      className="flex-1 min-w-0 rounded-lg border bg-background px-3 py-2.5 text-base md:text-sm resize-none min-h-[44px] max-h-[120px]"
                      maxLength={MAX_MESSAGE_LENGTH}
                      disabled={isThinking}
                      aria-label="Mensagem"
                      rows={1}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isThinking || !inputValue.trim()}
                      className="shrink-0 min-h-[44px] min-w-[64px] md:min-h-[40px] md:min-w-0"
                    >
                      Enviar
                    </Button>
                  </div>
                  <p className="text-[10px] md:text-[11px] text-muted-foreground mt-1.5 truncate">
                    {uiHints.helperExamples.length > 0
                      ? `Ex.: ${uiHints.helperExamples.slice(0, 3).join(", ")} • Enter envia`
                      : "Enter envia, Shift+Enter quebra linha"}
                  </p>
                </form>
              )}
                  </div>
                </div>
            </TooltipProvider>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  );
}
