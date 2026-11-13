import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Loader2, AlertCircle, ShieldAlert, XCircle, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { whatsappApi } from "@/lib/api";
import { friendlyConnectionError } from "@/lib/whatsapp-errors";
import { ConfirmDialog } from "@/components/shared";
import { LoadingState } from "@/components/LoadingState";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export type ConnectTabProps = {
  loading: boolean;
  connection: {
    connected?: boolean;
    status?: string;
    whatsapp_phone?: string;
    last_error?: string;
    ai_paused_until?: string;
    ai_paused_by?: string;
  } | null;
  statusData: {
    status?: string;
    connected?: boolean;
    qr?: string;
    pairingCode?: string;
  } | null;
  usage: { used: number; limit: number; softExceeded: boolean; hardExceeded: boolean } | null;
  webhookWarning: string;
  testTo: string;
  setTestTo: (v: string) => void;
  testText: string;
  setTestText: (v: string) => void;
  whatsappPhone: string;
  setWhatsappPhone: (v: string) => void;
  onAssume: () => void;
  onResume: () => void;
  onStart: (phone?: string) => void;
  onDisconnect: () => void;
  onSendTest: (params?: { number?: string; text?: string }) => void;
  onOpenBillingPortal?: () => void;
  portalLoading: boolean;
  canUseWhatsApp: boolean;
  assumePending: boolean;
  resumePending: boolean;
  startPending: boolean;
  disconnectPending: boolean;
  sendTestPending: boolean;
  formatPhoneBR: (v: string | undefined) => string;
  parsePhoneBR: (v: string) => string;
  /** Se o usuário já aceitou a política de uso (ex.: localStorage/backend). Quando true, não exige novo aceite para conectar. */
  hasAcceptedPolicy?: boolean;
  /** ID do estabelecimento para persistir aceite por tenant (localStorage). */
  barbershopId?: string | null;
  /** Modo do número (só quando há múltiplas filiais). */
  numberMode?: {
    mode: "account_wide" | "per_branch";
    primary_barbershop_id?: string | null;
    barbershops: Array<{ id: string; name: string }>;
  } | null;
  onNumberModeChange?: (mode: "account_wide" | "per_branch", primaryBarbershopId?: string | null) => void;
  numberModeLoading?: boolean;
  numberModeSaving?: boolean;
  /** Sessão de pareamento aberta pelo clique em Conectar. Status antigo no banco não liga isso. */
  pairingActive?: boolean;
  /** Barra chegou a zero sem conexão: o pai encerra o pareamento e volta ao botão Conectar. */
  onPairingExpired?: () => void;
  /** Tempo em segundos da barra. Ao zerar sem conexão, o pareamento reseta. Padrão 60. */
  connectionTimeoutSeconds?: number;
};

export function ConnectTab({
  loading,
  connection,
  statusData,
  usage,
  webhookWarning,
  testTo,
  setTestTo,
  testText,
  setTestText,
  whatsappPhone,
  setWhatsappPhone,
  onAssume,
  onResume,
  onStart,
  onDisconnect,
  onSendTest,
  onOpenBillingPortal,
  portalLoading,
  canUseWhatsApp,
  assumePending,
  resumePending,
  startPending,
  disconnectPending,
  sendTestPending,
  formatPhoneBR,
  parsePhoneBR,
  hasAcceptedPolicy = false,
  barbershopId,
  numberMode = null,
  onNumberModeChange,
  numberModeLoading = false,
  numberModeSaving = false,
  pairingActive = false,
  onPairingExpired,
  connectionTimeoutSeconds = 60,
}: ConnectTabProps) {
  const [acceptedPolicy, setAcceptedPolicy] = useState(hasAcceptedPolicy);
  const [acceptedUse, setAcceptedUse] = useState(false);
  /** Percentual restante (100 → 0) para barra regressiva ao aguardar pareamento */
  const [connectingRemainingPct, setConnectingRemainingPct] = useState(100);
  /** Após fim da barra: exibir o reset ao usuário */
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [refetchResult, setRefetchResult] = useState<"success" | "error" | null>(null);
  const [refetchResultMessage, setRefetchResultMessage] = useState<string | null>(null);
  const expiredRef = useRef(onPairingExpired);
  expiredRef.current = onPairingExpired;
  const expiredFiredRef = useRef(false);

  const isConnected = !!(connection?.connected || statusData?.connected);
  const isConnecting = !isConnected && (pairingActive || startPending);

  // Limpar resultado do refetch após alguns segundos
  useEffect(() => {
    if (!refetchResult) return;
    const t = setTimeout(() => setRefetchResult(null), 8000);
    return () => clearTimeout(t);
  }, [refetchResult]);

  // Barra regressiva. No zero, sem conexão, o pareamento acaba e não recomeça.
  useEffect(() => {
    if (!isConnecting) {
      setConnectingRemainingPct(100);
      expiredFiredRef.current = false;
      return;
    }
    const start = Date.now();
    const durationMs = connectionTimeoutSeconds * 1000;
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const remainingPct = Math.max(0, 100 - (elapsed / durationMs) * 100);
      setConnectingRemainingPct(remainingPct);
      if (elapsed >= durationMs && !expiredFiredRef.current) {
        expiredFiredRef.current = true;
        clearInterval(interval);
        setRefetchResult("error");
        setRefetchResultMessage(
          "O tempo de pareamento acabou. Clique em Conectar para gerar um novo QR Code."
        );
        expiredRef.current?.();
      }
    }, 150);
    return () => clearInterval(interval);
  }, [isConnecting, connectionTimeoutSeconds]);

  useEffect(() => {
    if (acceptedPolicy && acceptedUse && barbershopId) {
      try {
        localStorage.setItem(`navalhia_wa_policy_${barbershopId}_v1`, "1");
      } catch {
        // ignore
      }
    }
  }, [acceptedPolicy, acceptedUse, barbershopId]);

  if (loading) {
    return (
      <div className="min-h-[280px] flex items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  const connectRequiresAccept = !isConnected && !isConnecting && !hasAcceptedPolicy && !acceptedPolicy;
  const canConnect = (hasAcceptedPolicy || (acceptedPolicy && acceptedUse)) && !startPending;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <MessageCircle className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground md:text-lg">Conectar WhatsApp</h3>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Pareie seu número pelo QR Code ou código no WhatsApp Business. Depois você pode testar envio e pausar a IA para atendimento manual.
          </p>
        </div>
      </div>

      {/* Aviso uso responsável — só quando desconectado e ainda não aceitou */}
      {!isConnected && !isConnecting && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0" />
              <h3 className="text-sm font-semibold text-foreground">Uso responsável</h3>
            </div>
            <p className="text-xs text-muted-foreground font-normal mt-1">
              A conexão é feita por QR (pareamento com seu número) e está sujeita às políticas do WhatsApp. Recomendamos usar um número dedicado para automação. O sistema é para atendimento a quem te procurar e reativação de clientes que já passaram pelo seu estabelecimento — não para disparos promocionais em massa.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex items-start gap-3">
              <Checkbox
                id="accept-policy"
                checked={acceptedPolicy}
                onCheckedChange={(c) => setAcceptedPolicy(!!c)}
              />
              <Label htmlFor="accept-policy" className="text-sm font-normal cursor-pointer leading-tight">
                Li e concordo que a conexão é por QR, sujeita às políticas do WhatsApp, e que posso haver restrições no uso do número.
              </Label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="accept-use"
                checked={acceptedUse}
                onCheckedChange={(c) => setAcceptedUse(!!c)}
              />
              <Label htmlFor="accept-use" className="text-sm font-normal cursor-pointer leading-tight">
                Usarei apenas para atendimento a quem me procurar e reativação de clientes existentes (não para campanhas promocionais em massa).
              </Label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status atual + Ações rápidas (integrado) */}
      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-2">
          <h3 className="text-sm font-semibold text-foreground">Status atual</h3>
          <p className="text-xs text-muted-foreground font-normal mt-0.5">
            Conecte com <strong>WhatsApp Business</strong> (QR ou código), pause a IA para atender manualmente ou retome o atendente.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {refetchResult && (
            <div
              className={cn(
                "rounded-lg border p-3 text-sm flex items-center gap-2",
                refetchResult === "success"
                  ? "border-green-600/50 bg-green-600/10 text-green-800 dark:text-green-200"
                  : "border-destructive/50 bg-destructive/10 text-destructive"
              )}
            >
              {refetchResult === "success" ? (
                <Check className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{refetchResultMessage ?? (refetchResult === "success" ? "Conexão estabelecida!" : "Erro ao conectar.")}</span>
            </div>
          )}
          {isConnected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="default"
                  className="gap-1.5 bg-green-600 hover:bg-green-600 border-green-700 text-white"
                >
                  <Check className="h-3.5 w-3.5" />
                  Conectado
                </Badge>
                {connection?.ai_paused_until && new Date(connection.ai_paused_until).getTime() > Date.now() && (
                  <Badge variant="secondary" className="gap-1.5 text-amber-700 dark:text-amber-400 border-amber-500/50">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    IA pausada
                  </Badge>
                )}
              </div>
              {connection?.whatsapp_phone && (
                <p className="text-sm text-muted-foreground">
                  Número: {connection.whatsapp_phone}
                </p>
              )}
              {connection?.ai_paused_until && new Date(connection.ai_paused_until).getTime() > Date.now() && (
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  Pausada até{" "}
                  {new Date(connection.ai_paused_until).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {connection?.ai_paused_by === "manual"
                    ? " (você assumiu)"
                    : " (mensagem do seu número)"}
                </p>
              )}
              {usage != null && usage.limit > 0 && (
                <p className="text-xs text-muted-foreground">
                  Uso este mês: {usage.used} / {usage.limit} mensagens
                  {usage.softExceeded && !usage.hardExceeded && (
                    <span className="block text-amber-600 dark:text-amber-500 mt-1">
                      Limite soft atingido. Faça upgrade para evitar bloqueio.
                    </span>
                  )}
                  {usage.hardExceeded && (
                    <span className="block text-destructive mt-1">
                      Limite atingido. A IA não responderá até o próximo mês ou faça upgrade.
                    </span>
                  )}
                </p>
              )}
              {connection?.last_error && (
                <p className="text-sm text-destructive">{friendlyConnectionError(connection.last_error)}</p>
              )}
              {webhookWarning && (
                <p className="text-xs text-amber-600 dark:text-amber-500">{webhookWarning}</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {connection?.ai_paused_until && new Date(connection.ai_paused_until).getTime() > Date.now() ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onResume}
                    disabled={resumePending}
                  >
                    {resumePending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Retomar IA
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onAssume}
                    disabled={assumePending}
                  >
                    {assumePending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Assumir atendimento
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmDisconnectOpen(true)}
                  disabled={disconnectPending}
                >
                  {disconnectPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Desconectar
                </Button>
                {canUseWhatsApp && onOpenBillingPortal && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onOpenBillingPortal}
                    disabled={portalLoading}
                  >
                    {portalLoading ? "Abrindo..." : "Adicionar novo número"}
                  </Button>
                )}
              </div>
            </>
          ) : isConnecting ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className="gap-1.5 bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Conectando…
              </Badge>
              <span className="text-sm text-muted-foreground">
                Aguardando pareamento. Escaneie o QR Code com o WhatsApp Business.
              </span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="gap-1.5 text-muted-foreground border-muted-foreground/40"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Desconectado
                </Badge>
              </div>
              {connection?.last_error && (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {friendlyConnectionError(connection.last_error)}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Input
                  id="connect-phone"
                  type="tel"
                  placeholder="Número (opcional)"
                  value={formatPhoneBR(whatsappPhone)}
                  onChange={(e) =>
                    setWhatsappPhone(parsePhoneBR(e.target.value).slice(0, 11))
                  }
                  className="h-9 w-32 sm:w-40"
                />
                <Button
                  onClick={() => onStart(whatsappPhone.trim() || undefined)}
                  disabled={!canConnect}
                >
                  {startPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Conectar WhatsApp
                </Button>
                {!canConnect && !startPending && (
                  <p className="w-full text-xs text-muted-foreground">
                    Marque as duas caixas de confirmação acima para continuar.
                  </p>
                )}
                <p className="w-full text-xs text-muted-foreground">
                  Número (opcional): preencha só se preferir conectar por código em vez de QR Code.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Número do WhatsApp por filial — só quando há múltiplas filiais */}
      {numberMode && numberMode.barbershops.length > 1 && (
        <Card className="border-border/60 bg-card/50">
          <CardHeader className="pb-2">
            <h3 className="text-sm font-semibold text-foreground">Número do WhatsApp por filial</h3>
            <p className="text-xs text-muted-foreground font-normal mt-0.5">
              Escolha se o mesmo número atende todas as filiais ou se cada filial tem seu próprio número.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="mode-account-wide"
                  name="number-mode"
                  checked={numberMode.mode === "account_wide"}
                  onChange={() =>
                    onNumberModeChange?.(
                      "account_wide",
                      numberMode.primary_barbershop_id ?? numberMode.barbershops[0]?.id
                    )
                  }
                  disabled={numberModeSaving}
                  className="h-4 w-4"
                />
                <Label htmlFor="mode-account-wide" className="cursor-pointer font-normal">
                  Mesmo número em todas as filiais
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="mode-per-branch"
                  name="number-mode"
                  checked={numberMode.mode === "per_branch"}
                  onChange={() => onNumberModeChange?.("per_branch", null)}
                  disabled={numberModeSaving}
                  className="h-4 w-4"
                />
                <Label htmlFor="mode-per-branch" className="cursor-pointer font-normal">
                  Número dedicado por filial
                </Label>
              </div>
            </div>
            {numberMode.mode === "account_wide" && (
              <>
                <p className="text-xs text-muted-foreground">
                  A IA perguntará no chat qual filial o cliente prefere e usará essa filial para agendamentos.
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">Filial onde o WhatsApp está conectado (primária)</Label>
                  <select
                    value={numberMode.primary_barbershop_id ?? numberMode.barbershops[0]?.id ?? ""}
                    onChange={(e) => onNumberModeChange?.("account_wide", e.target.value || null)}
                    disabled={numberModeSaving}
                    className="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm"
                  >
                    {numberMode.barbershops.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {numberMode.mode === "per_branch" && (
              <p className="text-xs text-muted-foreground">
                Troque a filial no seletor &quot;Todas as filiais / Unidade&quot; no topo da página e conecte o
                WhatsApp de cada filial separadamente.
              </p>
            )}
            {numberModeSaving && (
              <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Salvando…
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pareamento (QR / código) — só quando conectando */}
      {isConnecting && (
        <Card className="border-border/60 bg-card/50">
          <CardHeader className="pb-2">
            <h3 className="text-sm font-semibold text-foreground">Conectar com WhatsApp Business</h3>
            <p className="text-xs text-muted-foreground font-normal mt-0.5">
              Use o app <strong>WhatsApp Business</strong> no celular (não use o WhatsApp pessoal). Siga os passos abaixo:
            </p>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2 md:gap-8">
            <div>
              <ol className="list-decimal list-inside space-y-2 text-sm text-foreground">
                <li>Abra o app <strong>WhatsApp Business</strong> no celular.</li>
                <li>Toque no menu <strong>(⋮)</strong> ou em <strong>Configurações</strong>.</li>
                <li>Toque em <strong>Aparelhos conectados</strong> ou <strong>Dispositivos vinculados</strong>.</li>
                <li>Toque em <strong>Conectar um dispositivo</strong>.</li>
                <li>Escaneie o QR Code ao lado com a câmera do celular (ou use o código de pareamento).</li>
              </ol>
            </div>

            <div className="flex flex-col items-center gap-4 min-w-0">
              {statusData?.qr ? (
                <img
                  src={
                    typeof statusData.qr === "string" && statusData.qr.startsWith("data:")
                      ? statusData.qr
                      : `data:image/png;base64,${statusData.qr}`
                  }
                  alt="QR Code para pareamento no WhatsApp Business"
                  className="w-64 h-64 max-w-full object-contain rounded-xl border border-border bg-background p-2 shadow-sm"
                />
              ) : (
                <div className="w-64 h-64 max-w-full bg-muted animate-pulse rounded-xl border border-border flex items-center justify-center p-4 text-center">
                  <span className="text-sm text-muted-foreground">Gerando seu QR Code…</span>
                </div>
              )}
              {statusData?.pairingCode && (
                <p className="text-sm text-muted-foreground text-center w-full">
                  Código de pareamento: <strong className="font-mono">{statusData.pairingCode}</strong>
                </p>
              )}

              <div className="space-y-2 w-full max-w-sm">
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>Aguardando pareamento…</span>
                  <span className="tabular-nums shrink-0">
                    {connectingRemainingPct <= 0
                      ? "Encerrando…"
                      : `${Math.ceil((connectionTimeoutSeconds * connectingRemainingPct) / 100)}s`}
                  </span>
                </div>
                <Progress value={connectingRemainingPct} className="h-2" />
              </div>

              {webhookWarning && (
                <p className="text-xs text-amber-600 dark:text-amber-500 text-center max-w-sm">
                  {webhookWarning}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Enviar teste — só quando conectado */}
      {isConnected && (
        <Card className="border-border/60 bg-card/50">
          <CardHeader className="pb-2">
            <h3 className="text-sm font-semibold text-foreground">Mensagem de teste</h3>
            <p className="text-xs text-muted-foreground font-normal mt-0.5">
              Envie uma mensagem para um número e confira se o WhatsApp está recebendo.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="wa-test-to" className="text-xs">
                Enviar para
              </Label>
              <Input
                id="wa-test-to"
                type="tel"
                placeholder="(11) 99999-9999"
                value={formatPhoneBR(testTo)}
                onChange={(e) => setTestTo(parsePhoneBR(e.target.value).slice(0, 11))}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wa-test-text" className="text-xs">
                Mensagem (opcional)
              </Label>
              <Textarea
                id="wa-test-text"
                placeholder="Ex: Olá! Este é um teste do NavalhIA."
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                className="resize-none min-h-[80px]"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onSendTest({
                  number: testTo.trim() || undefined,
                  text: testText.trim() || undefined,
                })
              }
              disabled={sendTestPending}
            >
              {sendTestPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Enviar mensagem de teste
            </Button>
          </CardContent>
        </Card>
      )}
      <ConfirmDialog
        open={confirmDisconnectOpen}
        onOpenChange={setConfirmDisconnectOpen}
        title="Desconectar o WhatsApp?"
        description="A secretária para de responder seus clientes até você ler um novo QR Code."
        confirmLabel="Desconectar"
        variant="destructive"
        onConfirm={() => onDisconnect()}
      />
    </div>
  );
}
