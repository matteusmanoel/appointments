import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { integrationsApi, billingApi, whatsappApi, type ApiKeyItem } from "@/lib/api";
import { formatPhoneBR, parsePhoneBR } from "@/lib/input-masks";
import { hasPro } from "@/lib/plan";
import { useAuth } from "@/contexts/AuthContext";
import { Key, Plus, Trash2, Copy, Check } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared";
import { toastError, toastSuccess } from "@/lib/toast-helpers";
import { UpgradeGate } from "@/components/UpgradeGate";
import { WhatsAppSetupStepper, TAB_CONFIG } from "@/components/whatsapp/WhatsAppSetupStepper";
import { ConnectTab } from "@/components/whatsapp/ConnectTab";

function ApiKeysTab() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<{
    api_key: string;
    name: string;
  } | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: keys, isLoading } = useQuery({
    queryKey: ["integrations", "api-keys"],
    queryFn: () => integrationsApi.listApiKeys(),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => integrationsApi.createApiKey(name),
    onSuccess: (data) => {
      setCreatedKey({ api_key: data.api_key, name: data.name });
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["integrations", "api-keys"] });
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao criar chave"),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => integrationsApi.revokeApiKey(id),
    onSuccess: () => {
      setRevokeId(null);
      queryClient.invalidateQueries({ queryKey: ["integrations", "api-keys"] });
      toastSuccess("Chave revogada");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao revogar"),
  });

  const handleCreate = () => {
    const name = newKeyName.trim() || "n8n";
    createMutation.mutate(name);
    setCreateOpen(false);
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopied(true);
    toastSuccess("Chave copiada");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="flex flex-col gap-6 h-full min-h-[400px]">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Key className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Chaves de API</h3>
            <p className="text-sm text-muted-foreground">
              Use no header <code className="text-xs bg-muted px-1 rounded">X-API-Key</code> nas requisições (n8n, integrações).
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Key className="h-4 w-4" />
            Suas chaves
          </h4>
          {isLoading ? (
            <Skeleton className="h-24 w-full rounded-xl shrink-0" />
          ) : (
            <div className="rounded-xl border border-border/60 bg-card/50 overflow-hidden">
              {keys?.length === 0 ? (
                <div className="flex-1 flex items-center justify-center min-h-[200px] p-6">
                  <EmptyState
                    icon={<Key className="h-12 w-12" strokeWidth={1.5} />}
                    title="Nenhuma chave de API"
                    description="Crie uma chave para usar no n8n ou outras integrações."
                    action={
                      <Button onClick={() => setCreateOpen(true)} size="sm">
                        <Plus className="h-4 w-4 mr-2" />
                        Nova chave
                      </Button>
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {(keys ?? []).map((k: ApiKeyItem) => (
                    <li
                      key={k.id}
                      className="flex items-center justify-between p-4 bg-card text-card-foreground"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Key className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium">{k.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Criada em{" "}
                            {new Date(k.created_at).toLocaleDateString("pt-BR")}
                            {k.last_used_at &&
                              ` · Último uso: ${new Date(k.last_used_at).toLocaleString("pt-BR")}`}
                          </p>
                        </div>
                      </div>
                      {k.revoked ? (
                        <span className="text-sm text-muted-foreground shrink-0">
                          Revogada
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive shrink-0"
                          onClick={() => setRevokeId(k.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {keys && keys.length > 0 && (
                <div className="p-4 border-t border-border/60">
                  <Button onClick={() => setCreateOpen(true)} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Nova chave
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova chave de API</DialogTitle>
            <DialogDescription>
              Dê um nome para identificar esta chave (ex.: n8n-prod).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="key-name">Nome</Label>
              <Input
                id="key-name"
                placeholder="n8n"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!createdKey}
        onOpenChange={(open) => !open && setCreatedKey(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chave criada</DialogTitle>
            <DialogDescription>
              Copie e guarde esta chave. Ela não será exibida novamente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg bg-muted p-3 font-mono text-sm break-all">
            <span className="flex-1 select-all">{createdKey?.api_key}</span>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => createdKey && copyKey(createdKey.api_key)}
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!revokeId}
        onOpenChange={(open) => !open && setRevokeId(null)}
        title="Revogar chave"
        description="Esta chave deixará de funcionar. Requisições com ela retornarão 401."
        onConfirm={async () => {
          if (revokeId) await revokeMutation.mutateAsync(revokeId);
        }}
        variant="destructive"
      />
    </>
  );
}

export default function Integracoes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  const stepParam = searchParams.get("step") ?? (searchParams.get("openDiagnostic") === "1" ? "preview" : "connect");
  const validStep = TAB_CONFIG.some((t) => t.id === stepParam) ? stepParam : "connect";

  const [webhookWarning, setWebhookWarning] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testText, setTestText] = useState("");
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [waPolicyAccepted, setWaPolicyAccepted] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const canUseWhatsAppAndNotifications = hasPro(profile);

  const { data: whatsappConnection, isLoading: whatsappLoading } = useQuery({
    queryKey: ["integrations", "whatsapp"],
    queryFn: () => whatsappApi.get(),
    enabled: canUseWhatsAppAndNotifications,
    retry: false,
  });

  const whatsappStatusQuery = useQuery({
    queryKey: ["integrations", "whatsapp", "status"],
    queryFn: () => whatsappApi.status(),
    enabled:
      canUseWhatsAppAndNotifications &&
      (whatsappConnection?.status === "connecting" ||
        whatsappConnection?.status === "connected"),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "connecting" && !query.state.error
        ? 3000
        : false,
  });

  const { data: whatsappUsage } = useQuery({
    queryKey: ["integrations", "whatsapp", "usage"],
    queryFn: () => whatsappApi.getUsage(),
    enabled: !!whatsappConnection?.connected,
    retry: false,
  });

  const hasMultipleBarbershops = (profile?.barbershops?.length ?? 0) > 1;
  const { data: numberModeData, isLoading: numberModeLoading } = useQuery({
    queryKey: ["integrations", "whatsapp", "number-mode"],
    queryFn: () => whatsappApi.getNumberMode(),
    enabled: canUseWhatsAppAndNotifications && hasMultipleBarbershops,
    retry: false,
  });

  const numberModeMutation = useMutation({
    mutationFn: (body: { mode: "account_wide" | "per_branch"; primary_barbershop_id?: string | null }) =>
      whatsappApi.updateNumberMode(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "whatsapp", "number-mode"] });
      toastSuccess("Modo do número atualizado.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao atualizar modo"),
  });

  useEffect(() => {
    if (profile?.barbershop_id) {
      try {
        setWaPolicyAccepted(
          localStorage.getItem(`navalhia_wa_policy_${profile.barbershop_id}_v1`) === "1"
        );
      } catch {
        setWaPolicyAccepted(false);
      }
    } else {
      setWaPolicyAccepted(false);
    }
  }, [profile?.barbershop_id]);

  const whatsappStartMutation = useMutation({
    mutationFn: (phone?: string) => whatsappApi.start(phone),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "whatsapp"] });
      queryClient.invalidateQueries({
        queryKey: ["integrations", "whatsapp", "status"],
      });
      if (data?.webhook_warning) setWebhookWarning(data.webhook_warning);
      else setWebhookWarning("");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao conectar"),
  });

  const whatsappDisconnectMutation = useMutation({
    mutationFn: () => whatsappApi.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "whatsapp"] });
      toastSuccess("WhatsApp desconectado.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao desconectar"),
  });

  const whatsappSendTestMutation = useMutation({
    mutationFn: (params?: { number?: string; text?: string }) =>
      whatsappApi.sendTest(params),
    onSuccess: () => toastSuccess("Mensagem de teste enviada."),
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao enviar teste"),
  });

  const whatsappAssumeMutation = useMutation({
    mutationFn: () => whatsappApi.assume(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "whatsapp"] });
      toastSuccess("IA pausada. Você pode atender manualmente.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao pausar IA"),
  });

  const whatsappResumeMutation = useMutation({
    mutationFn: () => whatsappApi.resume(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "whatsapp"] });
      toastSuccess("IA retomada.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao retomar IA"),
  });

  const handleOpenBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const { url } = await billingApi.createPortalSession();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Erro ao abrir portal de cobrança");
    } finally {
      setPortalLoading(false);
    }
  };

  const handleStepChange = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("step", v);
      return next;
    });
  };

  const whatsappConnected = !!(
    whatsappConnection?.connected ||
    whatsappStatusQuery.data?.connected
  );

  const connectStepContent = (
    <ConnectTab
      loading={whatsappLoading}
      connection={whatsappConnection ?? null}
      statusData={whatsappStatusQuery.data ?? null}
      usage={whatsappUsage ?? null}
      webhookWarning={webhookWarning}
      testTo={testTo}
      setTestTo={setTestTo}
      testText={testText}
      setTestText={setTestText}
      whatsappPhone={whatsappPhone}
      setWhatsappPhone={setWhatsappPhone}
      onAssume={() => whatsappAssumeMutation.mutate()}
      onResume={() => whatsappResumeMutation.mutate()}
      onStart={(phone) => whatsappStartMutation.mutate(phone)}
      onDisconnect={() => whatsappDisconnectMutation.mutate()}
      onSendTest={(params) => whatsappSendTestMutation.mutate(params)}
      onOpenBillingPortal={
        canUseWhatsAppAndNotifications ? handleOpenBillingPortal : undefined
      }
      portalLoading={portalLoading}
      canUseWhatsApp={canUseWhatsAppAndNotifications}
      assumePending={whatsappAssumeMutation.isPending}
      resumePending={whatsappResumeMutation.isPending}
      startPending={whatsappStartMutation.isPending}
      disconnectPending={whatsappDisconnectMutation.isPending}
      sendTestPending={whatsappSendTestMutation.isPending}
      formatPhoneBR={formatPhoneBR}
      parsePhoneBR={parsePhoneBR}
      hasAcceptedPolicy={waPolicyAccepted}
      barbershopId={profile?.barbershop_id ?? null}
      onRefetchStatus={whatsappStatusQuery.refetch}
      connectionTimeoutSeconds={60}
      numberMode={
        numberModeData
          ? {
              mode: numberModeData.mode,
              primary_barbershop_id: numberModeData.primary_barbershop_id ?? null,
              barbershops: numberModeData.barbershops,
            }
          : null
      }
      onNumberModeChange={(mode, primaryBarbershopId) =>
        numberModeMutation.mutate({
          mode,
          primary_barbershop_id: mode === "account_wide" ? primaryBarbershopId ?? undefined : null,
        })
      }
      numberModeLoading={numberModeLoading}
      numberModeSaving={numberModeMutation.isPending}
    />
  );

  return (
    <div className="space-y-6">
      {!canUseWhatsAppAndNotifications && (
        <UpgradeGate
          featureName="Integrações (WhatsApp, notificações)"
          requiredPlan="pro"
          variant="inline"
        >
          {null}
        </UpgradeGate>
      )}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Integrações
        </h1>
        <p className="text-muted-foreground mt-1">
          Conecte WhatsApp (IA), configure horários, chaves de API e notificações. Use o header{" "}
          <code className="text-xs bg-muted px-1 rounded">X-API-Key</code> nas requisições.
        </p>
      </div>

      <div className="rounded-xl border border-border/80 bg-card/50 overflow-hidden">
        <WhatsAppSetupStepper
          connectStepContent={connectStepContent}
          apiKeysContent={<ApiKeysTab />}
          whatsappConnected={whatsappConnected}
          canUseWhatsApp={canUseWhatsAppAndNotifications}
          value={validStep}
          onValueChange={handleStepChange}
          openDiagnosticFromInbox={searchParams.get("openDiagnostic") === "1"}
          enabled
        />
      </div>
    </div>
  );
}
