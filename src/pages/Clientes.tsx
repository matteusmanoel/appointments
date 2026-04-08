import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Search,
  Phone,
  Calendar,
  DollarSign,
  Trophy,
  User,
  LayoutGrid,
  LayoutList,
  AlertTriangle,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { clientsApi, type Client } from "@/lib/api";
import {
  ConfirmDialog,
  EntityActionsMenu,
  EntityFormDialog,
} from "@/components/shared";
import { toastError, withToast } from "@/lib/toast-helpers";
import { useAuth } from "@/contexts/AuthContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatPhoneDisplay, parsePhoneBR } from "@/lib/input-masks";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ClientDrawer } from "@/components/clients/ClientDrawer";

const clientSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  phone: z
    .string()
    .min(10, "Telefone deve ter pelo menos 10 dígitos")
    .refine((v) => /^\d+$/.test(v), "Use apenas números"),
  email: z
    .string()
    .optional()
    .refine(
      (v) => !v || v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "E-mail inválido",
    ),
  notes: z.string().optional(),
  barbershop_id: z.union([z.string().uuid(), z.literal("")]).optional(),
});

type ClientFormValues = z.infer<typeof clientSchema>;

type ReactivationStatus = "active" | "at_risk" | "churned" | "returning" | "unknown";

const REACTIVATION_LABELS: Record<ReactivationStatus, string> = {
  active: "Ativo",
  at_risk: "Em risco",
  churned: "Perdido",
  returning: "Retornando",
  unknown: "Desconhecido",
};

const REACTIVATION_VARIANTS: Record<ReactivationStatus, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  at_risk: "secondary",
  churned: "destructive",
  returning: "outline",
  unknown: "outline",
};

function ReactivationBadge({ status }: { status?: string | null }) {
  if (!status || status === "unknown") return null;
  const s = status as ReactivationStatus;
  return (
    <Badge variant={REACTIVATION_VARIANTS[s] ?? "outline"} className="text-xs shrink-0">
      {REACTIVATION_LABELS[s] ?? s}
    </Badge>
  );
}

function formatDate(dateString: string | null | undefined) {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export default function Clientes() {
  const queryClient = useQueryClient();
  const { profile, selectedScope } = useAuth();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [reactivationFilter, setReactivationFilter] = useState<string>("");
  const [drawerClient, setDrawerClient] = useState<Client | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  const {
    data: clients = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["clients", search, reactivationFilter],
    queryFn: () =>
      clientsApi.list({
        search: search || undefined,
        reactivation_status: reactivationFilter || undefined,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (body: ClientFormValues) =>
      clientsApi.create({
        name: body.name,
        phone: body.phone,
        email: body.email || undefined,
        notes: body.notes || undefined,
        ...(selectedScope === "__all__" && body.barbershop_id
          ? { barbershop_id: body.barbershop_id }
          : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setFormOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      clientsApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setFormOpen(false);
      setEditingClient(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setDeleteTarget(null);
    },
  });

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: { name: "", phone: "", email: "", notes: "", barbershop_id: "" },
  });

  const openCreate = () => {
    setEditingClient(null);
    form.reset({ name: "", phone: "", email: "", notes: "", barbershop_id: "" });
    setFormOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    form.reset({
      name: client.name,
      phone: parsePhoneBR(client.phone ?? ""),
      email: client.email ?? "",
      notes: client.notes ?? "",
    });
    setFormOpen(true);
  };

  const openDrawer = (client: Client) => {
    setDrawerClient(client);
  };

  const onSubmit = async (values: ClientFormValues) => {
    if (editingClient) {
      await withToast(
        updateMutation.mutateAsync({
          id: editingClient.id,
          body: {
            name: values.name,
            phone: values.phone,
            email: values.email || undefined,
            notes: values.notes || undefined,
          },
        }),
        { successMessage: "Cliente atualizado.", errorMessage: "Erro ao atualizar cliente." },
      );
    } else {
      if (selectedScope === "__all__" && !values.barbershop_id) {
        form.setError("barbershop_id", { message: "Selecione a filial." });
        return;
      }
      await withToast(createMutation.mutateAsync(values), {
        successMessage: "Cliente criado.",
        errorMessage: "Erro ao criar cliente.",
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
    } catch (e) {
      toastError("Erro ao excluir cliente.", e);
    }
  };

  const FILTER_PILLS: { value: string; label: string }[] = [
    { value: "", label: "Todos" },
    { value: "at_risk", label: "Em risco" },
    { value: "churned", label: "Perdidos" },
    { value: "returning", label: "Retornando" },
    { value: "active", label: "Ativos" },
  ];

  return (
    <>
      <div className="animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="page-header mb-0">
            <h1 className="page-title">Clientes</h1>
            <p className="page-subtitle">Histórico e relacionamento com clientes</p>
          </div>
          <Button className="btn-accent w-full md:w-fit" onClick={openCreate} aria-label="Adicionar cliente">
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Cliente
          </Button>
        </div>

        {/* Search + View Toggle */}
        <div className="stat-card mb-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por nome ou telefone..."
                className="input-field pl-12"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Buscar por nome ou telefone"
              />
            </div>
            <div className="flex items-center border border-border rounded-lg overflow-hidden shrink-0">
              <button
                type="button"
                aria-label="Modo cards"
                onClick={() => setViewMode("cards")}
                className={cn(
                  "p-2 transition-colors",
                  viewMode === "cards"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Modo tabela"
                onClick={() => setViewMode("table")}
                className={cn(
                  "p-2 transition-colors",
                  viewMode === "table"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                <LayoutList className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Reactivation filter pills */}
        <div className="flex flex-wrap gap-2 mb-6">
          {FILTER_PILLS.map((pill) => (
            <button
              key={pill.value}
              type="button"
              onClick={() => setReactivationFilter(pill.value)}
              className={cn(
                "px-3 py-1 rounded-full text-sm font-medium transition-colors border",
                reactivationFilter === pill.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive mb-4">Erro ao carregar clientes.</p>
        )}

        {isLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        )}

        {/* Cards view */}
        {!isLoading && !error && viewMode === "cards" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {clients.map((client) => (
              <div
                key={client.id}
                className="stat-card cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => openDrawer(client)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="w-6 h-6 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground truncate">{client.name}</h3>
                        <ReactivationBadge status={client.reactivation_status} />
                      </div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3 shrink-0" />
                        {client.phone}
                      </p>
                    </div>
                  </div>
                  <span onClick={(e) => e.stopPropagation()}>
                    <EntityActionsMenu
                      onEdit={() => openEdit(client)}
                      onDelete={() => setDeleteTarget(client)}
                      aria-label="Menu do cliente"
                    />
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-4 border-t border-border">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Calendar className="w-3.5 h-3.5 text-info" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">{client.total_visits}</p>
                    <p className="text-xs text-muted-foreground">Visitas</p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <DollarSign className="w-3.5 h-3.5 text-success" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">
                      R$ {Number(client.total_spent).toLocaleString("pt-BR")}
                    </p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Trophy className="w-3.5 h-3.5 text-warning" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">{client.loyalty_points}</p>
                    <p className="text-xs text-muted-foreground">Pontos</p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">
                      {formatDate(client.last_appointment_at)}
                    </p>
                    <p className="text-xs text-muted-foreground">Última</p>
                  </div>
                </div>
                {(client.no_show_count ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {client.no_show_count} no-show{(client.no_show_count ?? 0) > 1 ? "s" : ""}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Table view */}
        {!isLoading && !error && viewMode === "table" && clients.length > 0 && (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead className="text-right">Visitas</TableHead>
                  <TableHead className="text-right">Total gasto</TableHead>
                  <TableHead>Última visita</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow
                    key={client.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openDrawer(client)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {client.name}
                        {(client.no_show_count ?? 0) > 0 && (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{client.phone}</TableCell>
                    <TableCell className="text-right">{client.total_visits}</TableCell>
                    <TableCell className="text-right">
                      R$ {Number(client.total_spent).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>{formatDate(client.last_appointment_at)}</TableCell>
                    <TableCell>
                      <ReactivationBadge status={client.reactivation_status} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <EntityActionsMenu
                        onEdit={() => openEdit(client)}
                        onDelete={() => setDeleteTarget(client)}
                        aria-label="Menu do cliente"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && !error && clients.length === 0 && (
          <EmptyState
            icon={<User className="h-12 w-12" strokeWidth={1.5} />}
            title="Nenhum cliente encontrado"
            description="Cadastre clientes para agendar atendimentos e acumular pontos de fidelidade."
            action={
              <Button onClick={openCreate} className="mt-2">
                <Plus className="h-4 w-4 mr-2" />
                Cadastrar cliente
              </Button>
            }
          />
        )}
      </div>

      {/* Client Detail Drawer */}
      <ClientDrawer
        client={drawerClient}
        onClose={() => setDrawerClient(null)}
        onEdit={(c) => {
          setDrawerClient(null);
          openEdit(c);
        }}
      />

      <EntityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingClient ? "Editar Cliente" : "Novo Cliente"}
        description={editingClient ? "Altere os dados do cliente." : "Preencha os dados do novo cliente."}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button
              onClick={form.handleSubmit(onSubmit)}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingClient ? "Salvar" : "Criar"}
            </Button>
          </>
        }
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {selectedScope === "__all__" && profile?.barbershops && profile.barbershops.length > 0 && !editingClient && (
              <FormField
                control={form.control}
                name="barbershop_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Filial <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange} required>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione a filial" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {profile.barbershops.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input placeholder="Nome completo" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      placeholder="(11) 99999-9999"
                      value={formatPhoneDisplay(field.value)}
                      onChange={(e) => field.onChange(parsePhoneBR(e.target.value).slice(0, 11))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl><Input type="email" placeholder="email@exemplo.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Anotações sobre o cliente" className="resize-none" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </EntityFormDialog>

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title="Excluir cliente"
          description="Tem certeza? Esta ação não pode ser desfeita."
          confirmLabel="Excluir"
          variant="destructive"
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}
