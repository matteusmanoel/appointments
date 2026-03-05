import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  PanelLeft,
  PanelRight,
  MessageCircle,
  MoreVertical,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Send,
  Search,
  Star,
  User,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { clientsApi, whatsappApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toastError, toastSuccess } from "@/lib/toast-helpers";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

function normalizeDigits(v: string): string {
  return (v || "").replace(/\D/g, "");
}

function safeParseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getBarbershopStorageKey(suffix: string): string {
  const stored = safeParseJson<{ barbershop_id?: string }>(
    localStorage.getItem("profile")
  );
  const bid = stored?.barbershop_id || "default";
  return `navalhia_wa_${suffix}_${bid}_v1`;
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTimeHm(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function highlightText(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const re = new RegExp(escapeRegExp(q), "ig");
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) != null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    parts.push(
      <mark
        key={`${start}-${end}`}
        className="rounded bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-500/30"
      >
        {text.slice(start, end)}
      </mark>
    );
    lastIndex = end;
    if (re.lastIndex === match.index) re.lastIndex++; // safety
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

function MessageStatusIcon(props: { deliveryStatus?: string | null; isPending?: boolean }) {
  if (props.isPending) {
    return <Clock className="h-3.5 w-3.5 opacity-80" />;
  }
  const s = (props.deliveryStatus ?? "").toLowerCase();
  if (s === "delivered" || s === "read") {
    return <CheckCheck className="h-3.5 w-3.5 opacity-80" />;
  }
  if (s === "sent") {
    return <Check className="h-3.5 w-3.5 opacity-80" />;
  }
  return null;
}

export type InboxViewProps = {
  isActive: boolean;
  whatsappConnected: boolean;
};

export function InboxView({
  isActive,
  whatsappConnected,
}: InboxViewProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ai" | "manual">(
    "all"
  );
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [messageInput, setMessageInput] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [clientPickerQuery, setClientPickerQuery] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement | null>());
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [seenMap, setSeenMap] = useState<Record<string, string>>({});
  const [showInbox, setShowInbox] = useState(true);
  const [showDetails, setShowDetails] = useState(true);
  const [showToolMessages, setShowToolMessages] = useState(false);

  const whatsappConfigQuery = useQuery({
    queryKey: ["integrations", "whatsapp"],
    queryFn: () => whatsappApi.get(),
    enabled: isActive,
    staleTime: 30_000,
  });
  const aiPausedUntil = whatsappConfigQuery.data?.ai_paused_until;
  const isGlobalAiPaused = Boolean(aiPausedUntil && new Date(aiPausedUntil) > new Date());

  const conversationsQuery = useQuery({
    queryKey: [
      "integrations",
      "whatsapp",
      "conversations",
      search,
      statusFilter,
    ],
    queryFn: () =>
      whatsappApi.listConversations({
        limit: 100,
        search,
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
    enabled: isActive,
    refetchInterval: 8_000,
  });

  const conversations = conversationsQuery.data?.conversations ?? [];

  useEffect(() => {
    const pins = safeParseJson<string[]>(
      localStorage.getItem(getBarbershopStorageKey("pins"))
    );
    setPinnedIds(Array.isArray(pins) ? pins.filter((x) => typeof x === "string") : []);
    const seen = safeParseJson<Record<string, string>>(
      localStorage.getItem(getBarbershopStorageKey("seen"))
    );
    setSeenMap(seen && typeof seen === "object" && !Array.isArray(seen) ? seen : {});
  }, []);

  useEffect(() => {
    localStorage.setItem(getBarbershopStorageKey("pins"), JSON.stringify(pinnedIds));
  }, [pinnedIds]);

  useEffect(() => {
    localStorage.setItem(getBarbershopStorageKey("seen"), JSON.stringify(seenMap));
  }, [seenMap]);

  const sortedConversations = useMemo(() => {
    const pinned = new Set(pinnedIds);
    return [...conversations].sort((a, b) => {
      const ap = pinned.has(a.id) ? 1 : 0;
      const bp = pinned.has(b.id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bt - at;
    });
  }, [conversations, pinnedIds]);

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  useEffect(() => {
    if (!selectedConversationId && conversations.length > 0) {
      setSelectedConversationId(sortedConversations[0]?.id ?? conversations[0].id);
    }
    if (
      selectedConversationId &&
      conversations.length > 0 &&
      !conversations.some((c) => c.id === selectedConversationId)
    ) {
      setSelectedConversationId(sortedConversations[0]?.id ?? conversations[0].id);
    }
  }, [conversations, sortedConversations, selectedConversationId]);

  const messagesQuery = useQuery({
    queryKey: [
      "integrations",
      "whatsapp",
      "conversations",
      selectedConversationId,
      "messages",
    ],
    queryFn: () =>
      whatsappApi.getConversationMessages(selectedConversationId!, {
        limit: 300,
      }),
    enabled: isActive && !!selectedConversationId,
    refetchInterval: 5_000,
  });

  const clientsQuery = useQuery({
    queryKey: ["clients", "picker", clientPickerQuery],
    queryFn: () => clientsApi.list(clientPickerQuery.trim()),
    enabled: isActive && newConversationOpen,
    staleTime: 30_000,
  });

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!selectedConversationId) {
        throw new Error("Selecione uma conversa");
      }
      const clean = text.trim();
      if (!clean) {
        throw new Error("Digite uma mensagem");
      }
      return whatsappApi.sendConversationMessage(selectedConversationId, clean);
    },
    onMutate: async (text: string) => {
      const conversationId = selectedConversationId;
      if (!conversationId) return;

      const clean = text.trim();
      if (!clean) return;

      setMessageInput("");

      await queryClient.cancelQueries({
        queryKey: ["integrations", "whatsapp", "conversations", conversationId, "messages"],
      });

      const previous = queryClient.getQueryData<{ messages: Array<{ id: string; role: "user" | "assistant" | "tool"; content: string; created_at: string; tool_name?: string | null }> }>([
        "integrations",
        "whatsapp",
        "conversations",
        conversationId,
        "messages",
      ]);

      const nowIso = new Date().toISOString();
      const tempId = `tmp-${Date.now()}`;
      const nextMessages = [
        ...(previous?.messages ?? []),
        {
          id: tempId,
          role: "assistant" as const,
          content: clean,
          created_at: nowIso,
          delivery_status: "sent" as const,
        },
      ];
      queryClient.setQueryData(
        ["integrations", "whatsapp", "conversations", conversationId, "messages"],
        { messages: nextMessages }
      );

      // mark as seen immediately
      setSeenMap((prevSeen) => ({ ...prevSeen, [conversationId]: nowIso }));

      // Scroll to latest
      window.setTimeout(() => {
        const el = messageRefs.current.get(tempId);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 0);

      return { previous, conversationId, tempId };
    },
    onSuccess: (data, _text, ctx) => {
      if (ctx?.conversationId && ctx?.tempId && data?.message_id) {
        queryClient.setQueryData(
          ["integrations", "whatsapp", "conversations", ctx.conversationId, "messages"],
          (old: { messages: Array<{ id: string; role: string; content: string; created_at: string; delivery_status?: string }> } | undefined) => {
            if (!old?.messages) return old;
            return {
              messages: old.messages.map((m) =>
                m.id === ctx.tempId
                  ? { ...m, id: data.message_id, delivery_status: "sent" as const }
                  : m
              ),
            };
          }
        );
        messageRefs.current.set(data.message_id, messageRefs.current.get(ctx.tempId) ?? null);
        messageRefs.current.delete(ctx.tempId);
      }
      toastSuccess("Mensagem enviada.");
    },
    onError: (e, _text, ctx) => {
      if (ctx?.conversationId) {
        if (ctx.previous) {
          queryClient.setQueryData(
            ["integrations", "whatsapp", "conversations", ctx.conversationId, "messages"],
            ctx.previous
          );
        } else {
          queryClient.invalidateQueries({
            queryKey: ["integrations", "whatsapp", "conversations", ctx.conversationId, "messages"],
          });
        }
      }
      toastError(e instanceof Error ? e.message : "Falha ao enviar mensagem");
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "conversations"],
      });
      if (selectedConversationId) {
        queryClient.invalidateQueries({
          queryKey: [
            "integrations",
            "whatsapp",
            "conversations",
            selectedConversationId,
            "messages",
          ],
        });
      }
    },
  });

  const syncConversationMutation = useMutation({
    mutationFn: (conversationId: string) => whatsappApi.syncConversationMessages(conversationId),
    onSuccess: (data, conversationId) => {
      if (data.inserted > 0) toastSuccess(`${data.inserted} mensagem(ns) sincronizada(s).`);
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "conversations", conversationId, "messages"],
      });
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "conversations"],
      });
    },
    onError: (e) => toastError(e instanceof Error ? e.message : "Falha ao sincronizar"),
  });

  const lastSyncByConversationRef = useRef<Record<string, number>>({});
  const SYNC_COOLDOWN_MS = 60_000;
  useEffect(() => {
    if (!selectedConversationId || !whatsappConnected) return;
    const now = Date.now();
    const last = lastSyncByConversationRef.current[selectedConversationId] ?? 0;
    if (now - last < SYNC_COOLDOWN_MS) return;
    lastSyncByConversationRef.current[selectedConversationId] = now;
    syncConversationMutation.mutate(selectedConversationId);
  }, [selectedConversationId, whatsappConnected]);

  const assumeMutation = useMutation({
    mutationFn: () => whatsappApi.assume(),
    onSuccess: () => {
      toastSuccess("IA pausada para atendimento manual.");
      queryClient.invalidateQueries({ queryKey: ["integrations", "whatsapp"] });
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "conversations"],
      });
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao pausar IA"),
  });
  const resumeGlobalMutation = useMutation({
    mutationFn: () => whatsappApi.resume(),
    onSuccess: () => {
      toastSuccess("IA global retomada.");
      queryClient.invalidateQueries({ queryKey: ["integrations", "whatsapp"] });
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "conversations"],
      });
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao retomar IA"),
  });

  const resumeConversationMutation = useMutation({
    mutationFn: async (conversationId: string) =>
      whatsappApi.resumeConversation(conversationId),
    onSuccess: () => {
      toastSuccess("IA retomada para esta conversa.");
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "conversations"],
      });
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao retomar IA"),
  });

  const assumeConversationMutation = useMutation({
    mutationFn: async (conversationId: string) =>
      whatsappApi.assumeConversation(conversationId),
    onSuccess: () => {
      toastSuccess("Conversa assumida. IA pausada para este contato.");
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "conversations"],
      });
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao assumir conversa"),
  });

  const startConversationMutation = useMutation({
    mutationFn: async (params: { client_id?: string; phone?: string }) =>
      whatsappApi.startConversation(params),
    onSuccess: async (r) => {
      toastSuccess(r.created ? "Conversa iniciada." : "Conversa aberta.");
      setNewConversationOpen(false);
      setClientPickerQuery("");
      await queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "conversations"],
      });
      setSelectedConversationId(r.conversation_id);
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Falha ao iniciar conversa"),
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async (conversationId: string) =>
      whatsappApi.deleteConversation(conversationId),
    onSuccess: async () => {
      toastSuccess("Conversa deletada.");
      setDeleteConfirmOpen(false);
      const deletedId = selectedConversationId;
      await queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "conversations"],
      });
      if (deletedId) {
        setSelectedConversationId(null);
      }
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Falha ao deletar conversa"),
  });

  const contactQuery = useQuery({
    queryKey: [
      "integrations",
      "whatsapp",
      "conversations",
      selectedConversationId,
      "contact",
    ],
    queryFn: () => whatsappApi.getConversationContact(selectedConversationId!),
    enabled: isActive && !!selectedConversationId,
  });

  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactNotes, setContactNotes] = useState("");
  useEffect(() => {
    if (!selectedConversationId) {
      setContactName("");
      setContactPhone("");
      setContactNotes("");
      return;
    }
    const d = contactQuery.data;
    if (!d) return;
    setContactName(d.contact?.name ?? d.fallback_phone ?? "");
    setContactPhone(d.contact?.phone ?? d.fallback_phone ?? "");
    setContactNotes(d.contact?.notes ?? "");
  }, [selectedConversationId, contactQuery.data]);

  const patchContactMutation = useMutation({
    mutationFn: (body: { name?: string; phone?: string; notes?: string }) =>
      whatsappApi.patchConversationContact(selectedConversationId!, body),
    onSuccess: () => {
      toastSuccess("Contato atualizado.");
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "conversations"],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "integrations",
          "whatsapp",
          "conversations",
          selectedConversationId,
          "contact",
        ],
      });
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Falha ao atualizar contato"),
  });

  const handleSaveContact = () => {
    patchContactMutation.mutate({
      name: contactName.trim() || undefined,
      phone: contactPhone.trim() || undefined,
      notes: contactNotes.trim() || undefined,
    });
  };

  const messages = messagesQuery.data?.messages ?? [];
  const displayedMessages = useMemo(
    () =>
      showToolMessages ? messages : messages.filter((m) => m.role === "user" || m.role === "assistant"),
    [messages, showToolMessages]
  );
  const lastMessageCreatedAt = messages.length
    ? messages[messages.length - 1]!.created_at
    : null;

  // mark as seen when opening conversation / receiving new messages
  useEffect(() => {
    if (!selectedConversationId) return;
    if (!lastMessageCreatedAt) return;
    setSeenMap((prev) => {
      const prevSeen = prev[selectedConversationId];
      if (!prevSeen) return { ...prev, [selectedConversationId]: lastMessageCreatedAt };
      const prevT = new Date(prevSeen).getTime();
      const nextT = new Date(lastMessageCreatedAt).getTime();
      if (!Number.isFinite(prevT) || nextT > prevT) {
        return { ...prev, [selectedConversationId]: lastMessageCreatedAt };
      }
      return prev;
    });
  }, [selectedConversationId, lastMessageCreatedAt]);

  const matchMessageIds = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    const out: string[] = [];
    for (const m of displayedMessages) {
      if ((m.content || "").toLowerCase().includes(q)) out.push(m.id);
    }
    return out;
  }, [displayedMessages, findQuery]);

  useEffect(() => {
    if (activeMatchIdx >= matchMessageIds.length) {
      setActiveMatchIdx(0);
    }
  }, [activeMatchIdx, matchMessageIds.length]);

  useEffect(() => {
    if (!findOpen) return;
    const t = window.setTimeout(() => findInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [findOpen]);

  const scrollToMatch = useCallback(
    (idx: number) => {
      const id = matchMessageIds[idx];
      if (!id) return;
      const el = messageRefs.current.get(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [matchMessageIds]
  );

  const goNextMatch = useCallback(() => {
    if (matchMessageIds.length === 0) return;
    setActiveMatchIdx((prev) => {
      const next = (prev + 1) % matchMessageIds.length;
      window.setTimeout(() => scrollToMatch(next), 0);
      return next;
    });
  }, [matchMessageIds.length, scrollToMatch]);

  const goPrevMatch = useCallback(() => {
    if (matchMessageIds.length === 0) return;
    setActiveMatchIdx((prev) => {
      const next = (prev - 1 + matchMessageIds.length) % matchMessageIds.length;
      window.setTimeout(() => scrollToMatch(next), 0);
      return next;
    });
  }, [matchMessageIds.length, scrollToMatch]);

  const isTextInputTarget = (e: KeyboardEvent) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || t.isContentEditable;
  };

  useEffect(() => {
    if (!selectedConversationId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const isNewConversation = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (isNewConversation) {
        e.preventDefault();
        setNewConversationOpen(true);
        return;
      }
      const isFind = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f";
      if (isFind) {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (e.key === "Escape" && findOpen) {
        e.preventDefault();
        setFindOpen(false);
        return;
      }
      if (findOpen && e.key === "Enter" && !isTextInputTarget(e)) {
        e.preventDefault();
        if (e.shiftKey) goPrevMatch();
        else goNextMatch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedConversationId, findOpen, goNextMatch, goPrevMatch]);

  if (!whatsappConnected) {
    return (
      <div className="h-full rounded-xl border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground flex flex-col items-center justify-center gap-3">
        <p>Conecte um número de WhatsApp para usar o atendimento aqui.</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/app/integracoes">Configurar conexão</Link>
        </Button>
      </div>
    );
  }

  const manualCount = conversations.filter((c) => !!c.paused_until).length;
  const aiCount = conversations.length - manualCount;
  const selectedPausedUntil = selectedConversation?.paused_until ?? null;
  const selectedIsManual =
    !!selectedPausedUntil &&
    !Number.isNaN(new Date(selectedPausedUntil).getTime()) &&
    new Date(selectedPausedUntil).getTime() > Date.now();

  const gridColsClass =
    showInbox && showDetails
      ? "lg:grid-cols-[360px_minmax(0,1fr)_360px]"
      : showInbox && !showDetails
        ? "lg:grid-cols-[360px_minmax(0,1fr)]"
        : !showInbox && showDetails
          ? "lg:grid-cols-[minmax(0,1fr)_360px]"
          : "lg:grid-cols-[minmax(0,1fr)]";

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 rounded-xl border border-border/70 bg-card px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {conversations.length} conv · {aiCount} IA · {manualCount} manual
          </span>
          {isGlobalAiPaused && (
            <Badge variant="secondary" className="font-normal text-xs">
              IA pausada
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="hidden lg:flex items-center gap-0.5 rounded-lg border border-border/70 bg-background/60 p-0.5">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant={showInbox ? "default" : "ghost"}
                    className="h-7 w-7"
                    onClick={() => setShowInbox((v) => !v)}
                    aria-label={showInbox ? "Ocultar lista" : "Mostrar lista"}
                  >
                    <PanelLeft className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showInbox ? "Ocultar lista" : "Mostrar lista"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant={showDetails ? "default" : "ghost"}
                    className="h-7 w-7"
                    onClick={() => setShowDetails((v) => !v)}
                    aria-label={showDetails ? "Ocultar detalhes" : "Mostrar detalhes"}
                  >
                    <PanelRight className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showDetails ? "Ocultar painel" : "Mostrar painel"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => setNewConversationOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Nova conversa
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => conversationsQuery.refetch()}
                  disabled={conversationsQuery.isRefetching}
                  aria-label="Atualizar lista"
                >
                  <RefreshCw
                    className={cn("h-4 w-4", conversationsQuery.isRefetching && "animate-spin")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Atualizar lista</TooltipContent>
            </Tooltip>
            {isGlobalAiPaused ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-border/70"
                    onClick={() => resumeGlobalMutation.mutate()}
                    disabled={resumeGlobalMutation.isPending}
                    aria-label="Retomar IA global"
                  >
                    <PlayCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Retomar IA global</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-border/70"
                    onClick={() => assumeMutation.mutate()}
                    disabled={assumeMutation.isPending}
                    aria-label="Pausar IA global"
                  >
                    <PauseCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Pausar IA global</TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Mais opções">
                <MoreVertical className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/app/integracoes">Configurar conexão</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowInbox((v) => !v)}>
                {showInbox ? "Ocultar lista de conversas" : "Mostrar lista de conversas"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowDetails((v) => !v)}>
                {showDetails ? "Ocultar painel de detalhes" : "Mostrar painel de detalhes"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className={cn("grid grid-cols-1 gap-3 flex-1 min-h-0 overflow-hidden", gridColsClass)}>
        {showInbox && (
        <div className="rounded-xl border border-border/70 bg-card flex flex-col min-h-0 shadow-sm overflow-hidden">
          <div className="p-3 border-b border-border/70 space-y-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="h-9"
            />
            <div className="flex items-center gap-1 rounded-md bg-muted/40 p-1">
              {[
                { id: "all", label: "Todas" },
                { id: "ai", label: "IA" },
                { id: "manual", label: "Manual" },
              ].map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant={statusFilter === item.id ? "default" : "ghost"}
                  className="h-7 flex-1"
                  onClick={() =>
                    setStatusFilter(item.id as "all" | "ai" | "manual")
                  }
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {sortedConversations.map((c) => {
                const isPinned = pinnedIds.includes(c.id);
                const seenAt = seenMap[c.id];
                const lastAt = c.last_message?.created_at ?? c.last_message_at ?? null;
                const unread =
                  !!lastAt &&
                  (!seenAt ||
                    new Date(lastAt).getTime() >
                      new Date(seenAt).getTime());
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "group relative w-full rounded-lg border transition-all",
                      selectedConversationId === c.id
                        ? "bg-primary/10 border-primary/50 shadow-sm"
                        : "bg-background border-border/70 hover:bg-muted/40 hover:border-border"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedConversationId(c.id)}
                      className="w-full text-left px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-medium text-sm truncate block">
                            {c.client_name ||
                              c.client_phone ||
                              c.external_thread_id}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate block">
                            {c.client_phone || c.external_thread_id}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1">
                            {unread && (
                              <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            )}
                            {c.paused_until &&
                            new Date(c.paused_until).getTime() > Date.now() ? (
                              <Badge variant="secondary">Manual</Badge>
                            ) : (
                              <Badge variant="outline">IA</Badge>
                            )}
                          </div>
                          {c.last_message_at && (
                            <span className="text-[10px] text-muted-foreground">
                              {formatTimeHm(c.last_message_at)}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1.5">
                        {c.last_message?.content || "Sem mensagens"}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={isPinned ? "Desafixar conversa" : "Fixar conversa"}
                      className={cn(
                        "absolute right-2 top-2 hidden group-hover:inline-flex items-center justify-center rounded-md border bg-background/80 p-1 text-muted-foreground hover:text-foreground",
                        isPinned && "inline-flex text-primary border-primary/30"
                      )}
                      onClick={() => {
                        setPinnedIds((prev) => {
                          if (prev.includes(c.id)) return prev.filter((x) => x !== c.id);
                          return [c.id, ...prev].slice(0, 50);
                        });
                      }}
                    >
                      <Star className={cn("h-3.5 w-3.5", isPinned && "fill-primary")} />
                    </button>
                  </div>
                );
              })}
              {conversations.length === 0 && (
                <div className="p-3 text-sm text-muted-foreground">
                  Nenhuma conversa encontrada.
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        )}

        <div className="rounded-xl border border-border/70 bg-card flex flex-col min-h-0 shadow-sm overflow-hidden">
          <div className="p-3 border-b border-border/70 flex items-center justify-between gap-2 bg-card/80">
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">
                {selectedConversation
                  ? selectedConversation.client_name ||
                    selectedConversation.client_phone ||
                    selectedConversation.external_thread_id
                  : "Selecione uma conversa"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {selectedConversation?.client_phone ||
                  selectedConversation?.external_thread_id ||
                  "—"}
              </p>
              {selectedIsManual && selectedPausedUntil && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Manual até <span className="font-medium">{formatTimeHm(selectedPausedUntil)}</span> (auto-retoma)
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedConversation && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFindOpen((v) => !v)}
                >
                  <Search className="h-4 w-4 mr-1" />
                  Buscar
                </Button>
              )}
              {selectedConversationId && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => syncConversationMutation.mutate(selectedConversationId)}
                        disabled={syncConversationMutation.isPending}
                      >
                        <RefreshCw
                          className={cn("h-4 w-4 mr-1", syncConversationMutation.isPending && "animate-spin")}
                        />
                        Sync
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Recarregar histórico do WhatsApp
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {selectedConversation?.paused_until ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    resumeConversationMutation.mutate(selectedConversation.id)
                  }
                  disabled={resumeConversationMutation.isPending}
                >
                  <PlayCircle className="h-4 w-4 mr-1" />
                  Retomar IA
                </Button>
              ) : (
                selectedConversation && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      assumeConversationMutation.mutate(selectedConversation.id)
                    }
                    disabled={assumeConversationMutation.isPending}
                  >
                    <PauseCircle className="h-4 w-4 mr-1" />
                    Assumir conversa
                  </Button>
                )
              )}
              {selectedConversationId &&
                (messagesQuery.data?.messages?.length ?? 0) > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const messages = messagesQuery.data?.messages ?? [];
                      const transcript = messages
                        .map((m) =>
                          `${m.role === "user" ? "Cliente" : "Atendente"}: ${m.content}`
                        )
                        .join("\n");
                      const intro =
                        "Conversa exportada do Atendimento WhatsApp. Analise e sugira ajustes no agente.\n\n---\n\n";
                      sessionStorage.setItem(
                        "navalhia_diagnostic_transcript",
                        intro + transcript
                      );
                      navigate("/app/integracoes?step=preview&openDiagnostic=1");
                    }}
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    Enviar para diagnóstico
                  </Button>
                )}
              {selectedConversation && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Abrir menu da conversa">
                      <MoreVertical className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setShowToolMessages((v) => !v)}
                    >
                      {showToolMessages ? "Ocultar mensagens técnicas" : "Mostrar mensagens técnicas"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setDeleteConfirmOpen(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      Deletar conversa
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {selectedConversationId && (
            <div className="border-b border-border/70 lg:hidden">
              <Collapsible open={contactOpen} onOpenChange={setContactOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  >
                    {contactOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <User className="h-4 w-4" />
                    Contato
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-3 pb-3 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Nome</label>
                        <Input
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                          placeholder="Nome do cliente"
                          className="h-8 mt-0.5"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Telefone</label>
                        <Input
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                          placeholder="Telefone"
                          className="h-8 mt-0.5"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Observações</label>
                      <Textarea
                        value={contactNotes}
                        onChange={(e) => setContactNotes(e.target.value)}
                        placeholder="Notas sobre o cliente"
                        className="mt-0.5 min-h-[72px]"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveContact}
                      disabled={patchContactMutation.isPending}
                    >
                      {patchContactMutation.isPending ? "Salvando…" : "Salvar contato"}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {selectedConversation && findOpen && (
            <div className="border-b border-border/70 px-3 py-2 flex flex-wrap items-center gap-2 bg-muted/20">
              <Input
                ref={findInputRef}
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  setActiveMatchIdx(0);
                }}
                placeholder="Buscar nesta conversa… (Enter próximo / Shift+Enter anterior)"
                className="h-8 w-[260px]"
              />
              <Badge variant="outline" className="font-normal">
                {findQuery.trim()
                  ? `${matchMessageIds.length} resultado(s)${
                      matchMessageIds.length > 0 ? ` • ${activeMatchIdx + 1}/${matchMessageIds.length}` : ""
                    }`
                  : "Digite para buscar"}
              </Badge>
              <div className="flex items-center gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={goPrevMatch} disabled={matchMessageIds.length === 0}>
                  Anterior
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={goNextMatch} disabled={matchMessageIds.length === 0}>
                  Próximo
                </Button>
              </div>
              <div className="flex-1" />
              <Button type="button" size="sm" variant="ghost" onClick={() => setFindOpen(false)}>
                Fechar
              </Button>
            </div>
          )}

          <ScrollArea className="flex-1 p-3">
            <div className="space-y-2">
              {displayedMessages.map((m) => {
                const isMatch =
                  !!findQuery.trim() &&
                  (m.content || "").toLowerCase().includes(findQuery.trim().toLowerCase());
                const isActive = matchMessageIds[activeMatchIdx] === m.id;
                const isPending = m.id.startsWith("tmp-");
                return (
                <div
                  key={m.id}
                  ref={(el) => {
                    messageRefs.current.set(m.id, el);
                  }}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm max-w-[86%] whitespace-pre-wrap",
                    m.role === "user"
                      ? "bg-background border"
                      : "ml-auto bg-primary text-primary-foreground"
                    ,
                    isMatch && "ring-1 ring-yellow-500/40",
                    isActive && "ring-2 ring-yellow-500/80"
                  )}
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] opacity-80">
                    {m.role === "user" ? (
                      <UserRound className="h-3 w-3" />
                    ) : (
                      <Bot className="h-3 w-3" />
                    )}
                    <span>{m.role === "user" ? "Cliente" : "Atendente"}</span>
                    <span>•</span>
                    <span>
                      {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {m.role === "assistant" && (
                      <>
                        <span>•</span>
                        <MessageStatusIcon deliveryStatus={m.delivery_status} isPending={isPending} />
                      </>
                    )}
                  </div>
                  {m.content
                    ? highlightText(m.content, findQuery)
                    : m.role === "tool"
                    ? "[tool]"
                    : ""}
                </div>
              )})}
              {!selectedConversationId && (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <MessageCircle className="h-4 w-4" />
                  Escolha uma conversa à esquerda para visualizar o histórico.
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="shrink-0 p-3 border-t border-border/70 flex gap-2 items-end bg-card/80">
            <Textarea
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Digite uma mensagem… (Enter envia, Shift+Enter quebra linha)"
              className="min-h-[52px] max-h-[160px] bg-background/60 border-border/70"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const text = messageInput;
                  sendMutation.mutate(text);
                }
                const isSendCombo =
                  (e.ctrlKey || e.metaKey) && e.key === "Enter";
                if (isSendCombo) {
                  e.preventDefault();
                  sendMutation.mutate(messageInput);
                }
              }}
              disabled={!selectedConversationId || sendMutation.isPending}
            />
            <Button
              type="button"
              onClick={() => sendMutation.mutate(messageInput)}
              disabled={!selectedConversationId || sendMutation.isPending || !messageInput.trim()}
              className="h-[52px] w-[52px] p-0 shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {showDetails && (
        <div className="hidden lg:flex rounded-xl border border-border/70 bg-card flex-col min-h-0 shadow-sm overflow-hidden">
          <div className="p-3 border-b border-border/70">
            <p className="text-sm font-semibold">Detalhes</p>
            <p className="text-xs text-muted-foreground">
              Pin, contato e controles do atendimento.
            </p>
          </div>
          {!selectedConversation ? (
            <div className="p-4 text-sm text-muted-foreground">
              Selecione uma conversa para ver detalhes.
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {selectedConversation.client_name ||
                          selectedConversation.client_phone ||
                          selectedConversation.external_thread_id}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {selectedConversation.client_phone ||
                          selectedConversation.external_thread_id}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const id = selectedConversation.id;
                        setPinnedIds((prev) =>
                          prev.includes(id)
                            ? prev.filter((x) => x !== id)
                            : [id, ...prev].slice(0, 50)
                        );
                      }}
                    >
                      <Star
                        className={cn(
                          "h-4 w-4 mr-1",
                          pinnedIds.includes(selectedConversation.id) &&
                            "fill-primary text-primary"
                        )}
                      />
                      {pinnedIds.includes(selectedConversation.id)
                        ? "Fixada"
                        : "Fixar"}
                    </Button>
                  </div>
                  {selectedIsManual && selectedPausedUntil && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Manual até{" "}
                      <span className="font-medium">
                        {formatTimeHm(selectedPausedUntil)}
                      </span>{" "}
                      (auto-retoma)
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-border/70 bg-background/70 p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Contato
                  </p>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-muted-foreground">
                      Nome
                    </label>
                    <Input
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="Nome do cliente"
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-muted-foreground">
                      Telefone
                    </label>
                    <Input
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="Telefone"
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-muted-foreground">
                      Observações
                    </label>
                    <Textarea
                      value={contactNotes}
                      onChange={(e) => setContactNotes(e.target.value)}
                      placeholder="Notas sobre o cliente"
                      className="min-h-[92px]"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveContact}
                    disabled={patchContactMutation.isPending}
                  >
                    {patchContactMutation.isPending ? "Salvando…" : "Salvar"}
                  </Button>
                </div>

                <div className="rounded-lg border border-border/70 bg-background/70 p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Atendimento
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedConversation.paused_until &&
                    new Date(selectedConversation.paused_until).getTime() >
                      Date.now() ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          resumeConversationMutation.mutate(
                            selectedConversation.id
                          )
                        }
                        disabled={resumeConversationMutation.isPending}
                      >
                        <PlayCircle className="h-4 w-4 mr-1" />
                        Retomar IA
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          assumeConversationMutation.mutate(
                            selectedConversation.id
                          )
                        }
                        disabled={assumeConversationMutation.isPending}
                      >
                        <PauseCircle className="h-4 w-4 mr-1" />
                        Assumir
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      Deletar
                    </Button>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
        )}
      </div>

      <CommandDialog open={newConversationOpen} onOpenChange={setNewConversationOpen}>
        <CommandInput
          placeholder="Buscar cliente por nome/telefone…"
          value={clientPickerQuery}
          onValueChange={setClientPickerQuery}
        />
        <CommandList>
          <CommandEmpty>
            {clientsQuery.isLoading ? "Carregando..." : "Nenhum cliente encontrado."}
          </CommandEmpty>
          <CommandGroup heading="Clientes">
            {(clientsQuery.data ?? []).slice(0, 20).map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.name} ${c.phone}`}
                onSelect={() =>
                  startConversationMutation.mutate({ client_id: c.id })
                }
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.phone}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Iniciar por telefone">
            {normalizeDigits(clientPickerQuery).length >= 8 ? (
              <CommandItem
                value={`start:${normalizeDigits(clientPickerQuery)}`}
                onSelect={() =>
                  startConversationMutation.mutate({
                    phone: normalizeDigits(clientPickerQuery),
                  })
                }
              >
                Iniciar conversa com{" "}
                <span className="font-medium">
                  {normalizeDigits(clientPickerQuery)}
                </span>
              </CommandItem>
            ) : (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                Digite um telefone (mín. 8 dígitos) para iniciar uma nova conversa.
              </div>
            )}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Deletar conversa?"
        description="Isso removerá o histórico desta conversa na NavalhIA (mensagens e runtime). Esta ação não pode ser desfeita."
        confirmLabel="Deletar"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={async () => {
          if (!selectedConversationId) return;
          await deleteConversationMutation.mutateAsync(selectedConversationId);
        }}
      />
    </div>
  );
}
