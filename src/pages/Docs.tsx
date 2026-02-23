import { useState, useMemo, useEffect, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Home,
  Search,
  Play,
  Eye,
  EyeOff,
  X,
  Copy,
} from "lucide-react";
import {
  docsGroups,
  totalEndpoints,
  findEndpointById,
  SCHEMAS_COUNT,
  type DocEndpoint,
} from "./docs-data";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "";

/** Renderiza JSON com cores para chave/valor */
function JsonHighlight({ text }: { text: string }) {
  try {
    const parsed = JSON.parse(text);
    return (
      <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0">
        {renderValue(parsed, 0)}
      </pre>
    );
  } catch {
    return <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 text-foreground">{text}</pre>;
  }
}

function renderValue(value: unknown, indent: number): ReactNode {
  const pad = "  ".repeat(indent);
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === "boolean") return <span className="text-purple-600 dark:text-purple-400">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-amber-600 dark:text-amber-400">{value}</span>;
  if (typeof value === "string") return <span className="text-emerald-700 dark:text-emerald-400">"{value}"</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return (
      <>
        [{"\n"}
        {value.map((item, i) => (
          <span key={i}>
            {pad}  {renderValue(item, indent + 1)}
            {i < value.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {pad}]
      </>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return (
      <>
        {"{"}
        {"\n"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {pad}  <span className="text-sky-600 dark:text-sky-400">"{k}"</span>: {renderValue(v, indent + 1)}
            {i < entries.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {"\n"}
        {pad}
        {"}"}
      </>
    );
  }
  return String(value);
}

/** Badge de método HTTP no estilo UAZAPI: POST verde, GET azul, DELETE vermelho, PATCH âmbar */
function MethodBadge({ method, small }: { method: string; small?: boolean }) {
  const styles: Record<string, string> = {
    GET: "bg-[#0ea5e9] text-white",
    POST: "bg-[#22c55e] text-white",
    PATCH: "bg-[#f59e0b] text-white",
    PUT: "bg-[#8b5cf6] text-white",
    DELETE: "bg-[#ef4444] text-white",
  };
  return (
    <span
      className={`inline-flex items-center font-semibold ${small ? "rounded px-1.5 py-0.5 text-[10px]" : "rounded px-2 py-0.5 text-xs"} ${styles[method] ?? "bg-muted text-muted-foreground"}`}
    >
      {method}
    </span>
  );
}

function Sidebar({
  selectedId,
  onSelect,
  openGroups,
  setOpenGroups,
  searchQuery,
  setSearchQuery,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  openGroups: Set<string>;
  setOpenGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}) {
  const [endpointsExpanded, setEndpointsExpanded] = useState(true);
  const toggleGroup = (name: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return docsGroups;
    const q = searchQuery.toLowerCase();
    return docsGroups
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter(
          (ep) =>
          ep.title.toLowerCase().includes(q) ||
          ep.path.toLowerCase().includes(q) ||
          ep.method.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [searchQuery]);

  return (
    <aside className="w-[280px] shrink-0 border-r border-border bg-[hsl(var(--card))] flex flex-col h-full min-h-0 overflow-hidden">
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <span className="text-primary-foreground font-bold text-sm">N</span>
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-foreground truncate">NavalhIA</div>
              <div className="text-xs text-muted-foreground">Docs & API</div>
            </div>
          </div>
          <ThemeToggle />
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar docs, endpoints..."
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto py-2">
        <button
          onClick={() => onSelect(null)}
          className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${selectedId === null ? "bg-[hsl(217,91%,60%)] text-white" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
        >
          <Home className="h-4 w-4 shrink-0" />
          Overview
        </button>

        <button
          onClick={() => setEndpointsExpanded((e) => !e)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/60"
        >
          <span>ENDPOINTS</span>
          <span className="flex items-center gap-1">
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {totalEndpoints}
            </span>
            {endpointsExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </span>
        </button>

        {endpointsExpanded &&
          filteredGroups.map((group) => (
            <div key={group.name} className="mt-0.5">
              <button
                onClick={() => toggleGroup(group.name)}
                className="w-full flex items-center justify-between px-4 py-2 text-sm text-foreground hover:bg-muted/60"
              >
                <span className="flex items-center gap-1.5">
                  {openGroups.has(group.name) ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  {group.name}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.endpoints.length}
                </span>
              </button>
              {openGroups.has(group.name) && (
                <div className="pl-2 pr-1 pb-1">
                  {group.endpoints.map((ep) => (
                    <button
                      key={ep.id}
                      onClick={() => onSelect(ep.id)}
                      className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors ${selectedId === ep.id ? "bg-[hsl(217,91%,97%)] dark:bg-[hsl(217,91%,15%)] text-[hsl(217,91%,50%)]" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                    >
                      <MethodBadge method={ep.method} small />
                      <span className="truncate">{ep.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

        {SCHEMAS_COUNT > 0 && (
          <button className="w-full flex items-center justify-between px-4 py-2.5 mt-2 text-sm font-semibold text-foreground hover:bg-muted/60">
            <span>SCHEMAS</span>
            <span className="flex items-center gap-1">
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {SCHEMAS_COUNT}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </span>
          </button>
        )}
      </nav>
    </aside>
  );
}

function OverviewContent() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold text-foreground">NavalhIA API</h1>
        <span className="rounded-full bg-[#22c55e] text-white text-xs font-medium px-2.5 py-1">
          v1.0.0
        </span>
      </div>
      <p className="text-foreground/90">
        API para gerenciamento no NavalhIA: agendamentos, clientes, barbeiros, serviços,
        relatórios, fidelidade e integrações (WhatsApp, ferramentas externas).
      </p>

      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <span aria-hidden>⚠️</span> Recomendação
        </h2>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
          Use sempre o header <code className="rounded bg-amber-100 dark:bg-amber-900/50 px-1">Authorization: Bearer &lt;token&gt;</code> nos
          endpoints protegidos. Obtenha o token via <strong>POST /api/auth/login</strong>.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">Autenticação</h2>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-sm">
          <li>Endpoints regulares requerem o header <code className="rounded bg-muted px-1 py-0.5">Authorization: Bearer &lt;token&gt;</code></li>
          <li>Obtenha o token via <strong className="text-foreground">POST /api/auth/login</strong></li>
          <li>Endpoints em <strong className="text-foreground">/api/public/*</strong> são públicos</li>
          <li>Endpoints em <strong className="text-foreground">/api/tools/*</strong> usam header <code className="rounded bg-muted px-1 py-0.5">X-API-Key</code></li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">Resumo</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
            <div className="text-2xl font-bold text-[hsl(217,91%,50%)]">{totalEndpoints}</div>
            <div className="text-xs text-muted-foreground mt-1">Endpoints</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{SCHEMAS_COUNT}</div>
            <div className="text-xs text-muted-foreground mt-1">Schemas</div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">API Servers</h2>
        <div className="rounded border border-border bg-muted/30 p-3">
          <code className="text-sm font-mono text-foreground break-all">
            {API_BASE_URL || "https://sua-api.exemplo.com"}
          </code>
        </div>
      </section>
    </div>
  );
}

function EndpointDetailContent({ endpoint }: { endpoint: DocEndpoint }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <MethodBadge method={endpoint.method} />
        <code className="text-sm font-mono text-foreground bg-muted px-2 py-1 rounded">
          {endpoint.path}
        </code>
      </div>
      <h1 className="text-2xl font-bold text-foreground">{endpoint.title}</h1>
      <p className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
        {endpoint.description}
      </p>

      {endpoint.bodyExample && (
        <div>
          <p className="text-sm font-medium text-foreground mb-1">Exemplo de requisição:</p>
          <pre className="rounded-lg border border-border bg-muted/50 p-3 text-sm font-mono overflow-x-auto">
            {endpoint.bodyExample}
          </pre>
        </div>
      )}

      {(endpoint.bodyParams?.length ?? 0) > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-foreground mt-6 mb-2">Request</h3>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Body</h4>
          <div className="space-y-4">
            {endpoint.bodyParams?.map((p) => (
              <div
                key={p.name}
                className="rounded-lg border border-border p-3 space-y-1"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-medium text-foreground">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.type}</span>
                  {p.required && (
                    <span className="text-xs rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                      required
                    </span>
                  )}
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground">{p.description}</p>
                )}
                {p.example && (
                  <p className="text-xs text-muted-foreground">Example: {p.example}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {endpoint.queryParams && endpoint.queryParams.length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Query params</h4>
          <div className="space-y-3">
            {endpoint.queryParams.map((p) => (
              <div key={p.name} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-foreground">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.type}</span>
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-lg font-semibold text-foreground mt-6 mb-3">Responses</h3>
        <div className="flex flex-wrap gap-2">
          {endpoint.responses.map((r) => (
            <button
              key={r.status}
              type="button"
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
            >
              <span className="font-mono font-medium text-foreground">{r.status}</span>
              <span className="text-muted-foreground">{r.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function TryItPanel({
  endpoint,
  onSendRequest,
  response,
  sending,
}: {
  endpoint: DocEndpoint | null;
  onSendRequest: (
    url: string,
    method: string,
    body: string | null,
    token: string | null,
  ) => void;
  response: { status: number; body: string } | null;
  sending: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"tryit" | "code">("tryit");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (endpoint) setBody(endpoint.bodyExample ?? "{}");
  }, [endpoint]);

  if (!endpoint) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[320px] px-6 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Play className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">Select an endpoint to test</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
          Select an endpoint, webhook, or schema from the sidebar to view documentation
        </p>
      </div>
    );
  }

  const fullUrl = `${API_BASE_URL || ""}${endpoint.path}`
    .replace(/:id/g, "uuid")
    .replace(/:slug/g, "minha-navalhia");

  const codeSnippet = endpoint.bodyParams?.length
    ? `fetch("${fullUrl}", {
  method: "${endpoint.method}",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer <seu-token>"
  },
  body: JSON.stringify({ /* seus dados */ })
}).then((res) => res.json()).then(console.log);`
    : `fetch("${fullUrl}", {
  method: "${endpoint.method}",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer <seu-token>"
  }
}).then((res) => res.json()).then(console.log);`;

  const handleSend = () => {
    onSendRequest(
      fullUrl,
      endpoint.method,
      endpoint.bodyParams?.length ? body : null,
      token || null,
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex border-b border-border shrink-0">
        <button
          onClick={() => setActiveTab("tryit")}
          className={`px-4 py-2.5 text-sm font-medium ${activeTab === "tryit" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Try It
        </button>
        <button
          onClick={() => setActiveTab("code")}
          className={`px-4 py-2.5 text-sm font-medium flex items-center gap-1.5 ${activeTab === "code" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Copy className="h-3.5 w-3.5" />
          Code
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === "code" ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <pre className="rounded-lg border border-border bg-muted/30 p-3 text-xs font-mono overflow-x-auto whitespace-pre text-foreground">
              {codeSnippet}
            </pre>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto shrink-0 p-4 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <MethodBadge method={endpoint.method} />
                <code className="text-xs font-mono text-foreground break-all">
                  {fullUrl}
                </code>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Authorization (Bearer token) *
                </label>
                <div className="relative flex items-center gap-1 rounded border border-input bg-background">
                  <input
                    type={showToken ? "text" : "password"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Enter your token"
                    className="flex-1 min-w-0 rounded border-0 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:ring-0"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((s) => !s)}
                    className="p-2 text-muted-foreground hover:text-foreground"
                    aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setToken("")}
                    className="p-2 text-muted-foreground hover:text-foreground"
                    aria-label="Limpar token"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {endpoint.bodyParams && endpoint.bodyParams.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <h5 className="text-xs font-medium text-muted-foreground">Body</h5>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-muted/50"
                      >
                        + Novo
                      </button>
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-muted/50 flex items-center gap-1"
                      >
                        Padrão
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Enter request body (JSON)"
                    rows={8}
                    className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                    spellCheck={false}
                  />
                </div>
              )}

              <button
                onClick={handleSend}
                disabled={sending}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-[#f97316] hover:bg-[#ea580c] text-white font-medium py-2.5 text-sm disabled:opacity-50 transition-colors"
              >
                <Play className="h-4 w-4 shrink-0" />
                {sending ? "Enviando…" : "Send API Request"}
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col border-t border-border rounded-t-lg bg-muted/20 overflow-hidden">
              <div className="shrink-0 px-4 py-2 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground">
                  {response ? `Response ${response.status}` : "Response"}
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-4">
                {response ? (
                  <JsonHighlight text={response.body} />
                ) : (
                  <div className="text-sm text-muted-foreground h-full flex flex-col items-center justify-center text-center">
                    <p>No response yet</p>
                    <p className="text-xs mt-1">Send a request to see the actual response</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Docs() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(docsGroups.map((g) => g.name)),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [response, setResponse] = useState<{ status: number; body: string } | null>(null);
  const [sending, setSending] = useState(false);

  const endpoint = useMemo(
    () => (selectedId ? findEndpointById(selectedId) : undefined),
    [selectedId],
  );

  const handleSendRequest = async (
    url: string,
    method: string,
    body: string | null,
    token: string | null,
  ) => {
    setSending(true);
    setResponse(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, { method, headers, body: body ?? undefined });
      const text = await res.text();
      let parsed: string;
      try {
        parsed = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        parsed = text;
      }
      setResponse({ status: res.status, body: parsed });
    } catch (e) {
      setResponse({
        status: 0,
        body: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-background flex flex-col">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          selectedId={selectedId}
          onSelect={setSelectedId}
          openGroups={openGroups}
          setOpenGroups={setOpenGroups}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto border-r border-border">
          <div className="max-w-3xl mx-auto px-8 py-8">
            {!endpoint ? (
              <OverviewContent />
            ) : (
              <EndpointDetailContent endpoint={endpoint} />
            )}
          </div>
        </main>
        <aside className="w-[400px] shrink-0 flex flex-col min-h-0 border-border bg-[hsl(var(--card))] overflow-hidden">
          <TryItPanel
            endpoint={endpoint ?? null}
            onSendRequest={handleSendRequest}
            response={response}
            sending={sending}
          />
        </aside>
      </div>
    </div>
  );
}
