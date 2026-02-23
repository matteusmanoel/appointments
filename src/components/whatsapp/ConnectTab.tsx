import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Loader2, Wifi, AlertCircle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { whatsappApi } from "@/lib/api";
import { LoadingState } from "@/components/LoadingState";

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
}: ConnectTabProps) {
  const [acceptedPolicy, setAcceptedPolicy] = useState(hasAcceptedPolicy);
  const [acceptedUse, setAcceptedUse] = useState(false);
  const [connectivityResult, setConnectivityResult] = useState<{
    api: string;
    uazapi: { ok: boolean; error?: string };
  } | null>(null);

  const connectivityMutation = useMutation({
    mutationFn: () => whatsappApi.getConnectivity(),
    onSuccess: (data) => setConnectivityResult(data),
    onError: () =>
      setConnectivityResult({
        api: "error",
        uazapi: { ok: false, error: "Falha ao chamar a API" },
      }),
  });

  const isConnected = !!(connection?.connected || statusData?.connected);
  const isConnecting =
    !isConnected &&
    (statusData?.status === "connecting" || connection?.status === "connecting");

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
    <div className="space-y-5">
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
          {connectRequiresAccept && (
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
          )}
        </Card>
      )}

      {/* Status atual */}
      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-2">
          <h3 className="text-sm font-semibold text-foreground">Status atual</h3>
        </CardHeader>
        <CardContent className="space-y-2">
          {isConnected ? (
            <>
              <div className="flex items-center gap-2 text-success">
                <Check className="h-5 w-5 shrink-0" />
                <span className="font-medium">Conectado</span>
              </div>
              {connection?.whatsapp_phone && (
                <p className="text-sm text-muted-foreground">
                  Número: {connection.whatsapp_phone}
                </p>
              )}
              {connection?.ai_paused_until && new Date(connection.ai_paused_until).getTime() > Date.now() && (
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  IA pausada até{" "}
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
                <p className="text-sm text-destructive">{connection.last_error}</p>
              )}
              {webhookWarning && (
                <p className="text-xs text-amber-600 dark:text-amber-500">{webhookWarning}</p>
              )}
            </>
          ) : isConnecting ? (
            <p className="text-sm text-muted-foreground">Conectando… Aguarde o pareamento.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Desconectado</p>
              {connection?.last_error && (
                <p className="text-sm text-destructive">{connection.last_error}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Ações rápidas */}
      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-2">
          <h3 className="text-sm font-semibold text-foreground">Ações rápidas</h3>
          <p className="text-xs text-muted-foreground font-normal mt-0.5">
            Conectar, pausar a IA para atender manualmente ou retomar o atendente.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {isConnected ? (
            <>
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
                onClick={onDisconnect}
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
            </>
          ) : !isConnecting ? (
            <>
              <div className="w-full space-y-2">
                <Label htmlFor="connect-phone" className="text-xs text-muted-foreground">
                  Número (opcional — para código de pareamento em vez de QR)
                </Label>
                <Input
                  id="connect-phone"
                  type="tel"
                  placeholder="(11) 99999-9999"
                  value={formatPhoneBR(whatsappPhone)}
                  onChange={(e) =>
                    setWhatsappPhone(parsePhoneBR(e.target.value).slice(0, 11))
                  }
                  className="h-9"
                />
              </div>
              <Button
                onClick={() => onStart(whatsappPhone.trim() || undefined)}
                disabled={!canConnect}
              >
                {startPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Conectar WhatsApp
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Diagnóstico: conectividade */}
      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Wifi className="h-4 w-4" />
            Diagnóstico
          </h3>
          <p className="text-xs text-muted-foreground font-normal mt-0.5">
            Testar se a API e a Uazapi estão acessíveis.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setConnectivityResult(null);
              connectivityMutation.mutate();
            }}
            disabled={connectivityMutation.isPending}
          >
            {connectivityMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            ) : (
              "Testar conectividade"
            )}
          </Button>
          {connectivityResult && (
            <div
              className={cn(
                "rounded-lg border p-3 text-sm",
                connectivityResult.uazapi.ok
                  ? "border-success/50 bg-success/5"
                  : "border-destructive/50 bg-destructive/5"
              )}
            >
              <p className="font-medium">
                API: {connectivityResult.api === "ok" ? "OK" : "Erro"}
              </p>
              <p className="text-muted-foreground mt-1">
                Uazapi:{" "}
                {connectivityResult.uazapi.ok
                  ? "OK"
                  : connectivityResult.uazapi.error ?? "Indisponível"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pareamento (QR / código) — só quando conectando */}
      {isConnecting && (
        <Card className="border-border/60 bg-card/50">
          <CardHeader className="pb-2">
            <h3 className="text-sm font-semibold text-foreground">Pareamento</h3>
            <p className="text-xs text-muted-foreground font-normal mt-0.5">
              Escaneie o QR Code no WhatsApp do celular ou use o código de pareamento.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {statusData?.qr ? (
              <img
                src={
                  typeof statusData.qr === "string" && statusData.qr.startsWith("data:")
                    ? statusData.qr
                    : `data:image/png;base64,${statusData.qr}`
                }
                alt="QR Code WhatsApp"
                className="w-48 h-48 object-contain rounded-lg border border-border"
              />
            ) : (
              <div className="w-48 h-48 bg-muted animate-pulse rounded-lg" />
            )}
            {statusData?.pairingCode && (
              <p className="text-sm text-muted-foreground">
                Código: <strong className="font-mono">{statusData.pairingCode}</strong>
              </p>
            )}
            {webhookWarning && (
              <p className="text-xs text-amber-600 dark:text-amber-500 text-center max-w-sm">
                {webhookWarning}
              </p>
            )}
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
    </div>
  );
}
