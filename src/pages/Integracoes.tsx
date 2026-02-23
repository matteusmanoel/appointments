import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { integrationsApi, type ApiKeyItem } from "@/lib/api";
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

export default function Integracoes() {
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
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Integrações
          </h1>
          <p className="text-muted-foreground mt-1">
            API Keys para conectar n8n, WhatsApp e outros serviços. Use o header{" "}
            <code className="text-xs bg-muted px-1 rounded">X-API-Key</code> nas
            requisições.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-medium text-foreground">Chaves de API</h2>
          <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Nova chave
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : (
          <ul className="space-y-2">
            {(keys ?? []).map((k: ApiKeyItem) => (
              <li
                key={k.id}
                className="flex items-center justify-between p-4 rounded-lg border bg-card text-card-foreground"
              >
                <div className="flex items-center gap-3">
                  <Key className="h-5 w-5 text-muted-foreground" />
                  <div>
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
                  <span className="text-sm text-muted-foreground">
                    Revogada
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRevokeId(k.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
            {keys?.length === 0 && (
              <li className="list-none">
                <EmptyState
                  icon={<Key className="h-12 w-12" strokeWidth={1.5} />}
                  title="Nenhuma chave de API"
                  description="Crie uma chave para usar no n8n ou outras integrações."
                />
              </li>
            )}
          </ul>
        )}
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
