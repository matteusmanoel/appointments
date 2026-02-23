import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Search,
  Phone,
  Calendar,
  DollarSign,
  Trophy,
  User,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { clientsApi } from "@/lib/api";
import {
  ConfirmDialog,
  EntityActionsMenu,
  EntityFormDialog,
} from "@/components/shared";
import { toastError, withToast } from "@/lib/toast-helpers";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatPhoneBR, parsePhoneBR } from "@/lib/input-masks";
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
});

type ClientFormValues = z.infer<typeof clientSchema>;

type Client = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  total_visits: number;
  total_spent: number;
  loyalty_points: number;
  updated_at?: string;
};

export default function Clientes() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);

  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  const {
    data: clients = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["clients", search],
    queryFn: () => clientsApi.list(search || undefined),
  });

  const createMutation = useMutation({
    mutationFn: (body: ClientFormValues) =>
      clientsApi.create({
        name: body.name,
        phone: body.phone,
        email: body.email || undefined,
        notes: body.notes || undefined,
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
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      notes: "",
    },
  });

  const openCreate = () => {
    setEditingClient(null);
    form.reset({ name: "", phone: "", email: "", notes: "" });
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
        {
          successMessage: "Cliente atualizado.",
          errorMessage: "Erro ao atualizar cliente.",
        },
      );
    } else {
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    });
  };

  return (
    <>
      <div className="animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="page-header mb-0">
            <h1 className="page-title">Clientes</h1>
            <p className="page-subtitle">
              Histórico e relacionamento com clientes
            </p>
          </div>
          <Button
            className="btn-accent w-full md:w-fit"
            onClick={openCreate}
            aria-label="Adicionar cliente"
          >
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Cliente
          </Button>
        </div>

        <div className="stat-card mb-6">
          <div className="relative">
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
        </div>

        {error && (
          <p className="text-sm text-destructive mb-4">
            Erro ao carregar clientes.
          </p>
        )}
        {isLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        )}
        {!isLoading && !error && (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {clients.map((client) => (
              <div
                key={client.id}
                className="stat-card cursor-pointer"
                onClick={() => openEdit(client as Client)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <User className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {client.name}
                      </h3>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {client.phone}
                      </p>
                    </div>
                  </div>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <EntityActionsMenu
                      onEdit={() => openEdit(client as Client)}
                      onDelete={() => setDeleteTarget(client as Client)}
                      aria-label="Menu do cliente"
                    />
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-4 border-t border-border">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Calendar className="w-3.5 h-3.5 text-info" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">
                      {client.total_visits}
                    </p>
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
                    <p className="text-sm font-semibold text-foreground">
                      {client.loyalty_points}
                    </p>
                    <p className="text-xs text-muted-foreground">Pontos</p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">
                      {client.updated_at ? formatDate(client.updated_at) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">Última</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {!isLoading && !error && clients.length === 0 && (
          <EmptyState
            icon={<User className="h-12 w-12" strokeWidth={1.5} />}
            title="Nenhum cliente encontrado"
            description="Cadastre clientes para agendar atendimentos e acumular pontos de fidelidade."
          />
        )}
      </div>

      <EntityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingClient ? "Editar Cliente" : "Novo Cliente"}
        description={
          editingClient
            ? "Altere os dados do cliente."
            : "Preencha os dados do novo cliente."
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
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
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Nome <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="Nome completo" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Telefone <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      placeholder="(11) 99999-9999"
                      value={formatPhoneBR(field.value)}
                      onChange={(e) =>
                        field.onChange(
                          parsePhoneBR(e.target.value).slice(0, 11),
                        )
                      }
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
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="email@exemplo.com"
                      {...field}
                    />
                  </FormControl>
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
                    <Textarea
                      placeholder="Anotações sobre o cliente"
                      className="resize-none"
                      {...field}
                    />
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
