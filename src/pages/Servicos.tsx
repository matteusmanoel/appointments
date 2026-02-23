import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Plus, Clock, DollarSign, Percent, Package } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { servicesApi } from "@/lib/api";
import {
  formatCurrencyDigits,
  numberToCurrencyDigits,
  parseCurrencyDigitsToNumber,
} from "@/lib/input-masks";
import {
  ConfirmDialog,
  EntityActionsMenu,
  EntityFormDialog,
} from "@/components/shared";
import { toastSuccess, toastError, withToast } from "@/lib/toast-helpers";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
const categoryColors: Record<string, string> = {
  corte: "bg-primary/10 text-primary border-primary/20",
  combo: "bg-accent/10 text-accent border-accent/20",
  barba: "bg-info/10 text-info border-info/20",
  adicional: "bg-warning/10 text-warning border-warning/20",
  tratamento: "bg-chart-4/10 text-chart-4 border-chart-4/20",
};

const CATEGORIES = [
  "corte",
  "combo",
  "barba",
  "adicional",
  "tratamento",
] as const;

const serviceSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().optional(),
  price: z.coerce.number().min(0.01, "Preço deve ser maior que zero"),
  duration_minutes: z.coerce.number().min(1, "Duração mínima 1 min"),
  category: z.enum(CATEGORIES).optional().default("corte"),
  is_active: z.boolean().optional().default(true),
  points_to_earn: z.coerce.number().int().min(0).optional().default(0),
  points_to_redeem: z
    .union([z.coerce.number().int().min(0), z.literal("")])
    .optional(),
});

type ServiceFormValues = z.infer<typeof serviceSchema>;

type Service = {
  id: string;
  name: string;
  description?: string;
  price: number;
  duration_minutes: number;
  commission_percentage?: number;
  category: string;
  is_active: boolean;
  points_to_earn?: number;
  points_to_redeem?: number | null;
};

type CreateServicePayload = Parameters<typeof servicesApi.create>[0];

export default function Servicos() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);

  const {
    data: services = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["services"],
    queryFn: () => servicesApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateServicePayload) => servicesApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setFormOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      servicesApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setFormOpen(false);
      setEditingService(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setDeleteTarget(null);
    },
  });

  const form = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      name: "",
      description: "",
      price: 35,
      duration_minutes: 30,
      category: "corte",
      is_active: true,
      points_to_earn: 0,
      points_to_redeem: "",
    },
  });

  const openCreate = () => {
    setEditingService(null);
    form.reset({
      name: "",
      description: "",
      price: 35,
      duration_minutes: 30,
      category: "corte",
      is_active: true,
      points_to_earn: 0,
      points_to_redeem: "",
    });
    setFormOpen(true);
  };

  const openEdit = (service: Service) => {
    setEditingService(service);
    form.reset({
      name: service.name,
      description: service.description ?? "",
      price: service.price,
      duration_minutes: service.duration_minutes,
      category: (service.category as (typeof CATEGORIES)[number]) ?? "corte",
      is_active: service.is_active ?? true,
      points_to_earn: service.points_to_earn ?? 0,
      points_to_redeem: service.points_to_redeem ?? "",
    });
    setFormOpen(true);
  };

  const onSubmit = async (values: ServiceFormValues) => {
    if (editingService) {
      await withToast(
        updateMutation.mutateAsync({
          id: editingService.id,
          body: {
            name: values.name,
            description: values.description || undefined,
            price: values.price,
            duration_minutes: values.duration_minutes,
            category: values.category,
            is_active: values.is_active,
            points_to_earn: values.points_to_earn ?? 0,
            points_to_redeem:
              values.points_to_redeem === ""
                ? null
                : (values.points_to_redeem ?? null),
          },
        }),
        {
          successMessage: "Serviço atualizado.",
          errorMessage: "Erro ao atualizar serviço.",
        },
      );
    } else {
      await withToast(
        createMutation.mutateAsync({
          name: values.name,
          description: values.description || undefined,
          price: values.price,
          duration_minutes: values.duration_minutes,
          category: values.category,
          is_active: values.is_active,
          points_to_earn: values.points_to_earn ?? 0,
          points_to_redeem:
            values.points_to_redeem === ""
              ? undefined
              : (values.points_to_redeem ?? undefined),
        }),
        {
          successMessage: "Serviço criado.",
          errorMessage: "Erro ao criar serviço.",
        },
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toastSuccess("Serviço excluído.");
    } catch (e) {
      toastError("Erro ao excluir serviço.", e);
    }
  };

  return (
    <>
      <div className="animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="page-header mb-0">
            <h1 className="page-title">Serviços</h1>
            <p className="page-subtitle">Gerencie seus serviços e preços</p>
          </div>
          <Button
            className="btn-accent w-full md:w-fit"
            onClick={openCreate}
            aria-label="Adicionar serviço"
          >
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Serviço
          </Button>
        </div>

        {error && (
          <p className="text-sm text-destructive mb-4">
            Erro ao carregar serviços.
          </p>
        )}
        {isLoading && (
          <div className="stat-card space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {!isLoading && !error && services.length > 0 && (
          <div className="space-y-3 md:hidden">
            {services.map((service) => (
              <div
                key={service.id}
                className="stat-card p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="text-left flex-1 min-w-0"
                    onClick={() => openEdit(service as Service)}
                  >
                    <p className="font-medium text-foreground truncate">
                      {service.name}
                    </p>
                    {service.description ? (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                        {service.description}
                      </p>
                    ) : null}
                  </button>
                  <span
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                  >
                    <EntityActionsMenu
                      onEdit={() => openEdit(service as Service)}
                      onDelete={() => setDeleteTarget(service as Service)}
                      aria-label="Menu do serviço"
                    />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5 text-success" />
                    R$ {Number(service.price).toFixed(2)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {service.duration_minutes} min
                  </span>
                  <span className="flex items-center gap-1">
                    <Percent className="w-3.5 h-3.5 text-accent" />
                    {service.commission_percentage ?? 0}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {!isLoading && !error && (
          <div className="stat-card overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">
                      Serviço
                    </th>
                    <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">
                      Categoria
                    </th>
                    <th className="text-right py-4 px-4 text-sm font-medium text-muted-foreground">
                      Preço
                    </th>
                    <th className="text-right py-4 px-4 text-sm font-medium text-muted-foreground">
                      Duração
                    </th>
                    <th className="text-right py-4 px-4 text-sm font-medium text-muted-foreground">
                      Comissão
                    </th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((service) => (
                    <tr
                      key={service.id}
                      className="table-row cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => openEdit(service as Service)}
                    >
                      <td className="py-4 px-4">
                        <div>
                          <p className="font-medium text-foreground">
                            {service.name}
                          </p>
                          {service.description && (
                            <p className="text-sm text-muted-foreground">
                              {service.description}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border capitalize ${categoryColors[service.category] ?? "bg-muted text-muted-foreground"}`}
                        >
                          {service.category}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <DollarSign className="w-3.5 h-3.5 text-success" />
                          <span className="font-medium text-foreground">
                            R$ {Number(service.price).toFixed(2)}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-foreground">
                            {service.duration_minutes} min
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Percent className="w-3.5 h-3.5 text-accent" />
                          <span className="text-foreground">
                            {service.commission_percentage ?? 0}%
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <EntityActionsMenu
                            onEdit={() => openEdit(service as Service)}
                            onDelete={() => setDeleteTarget(service as Service)}
                            aria-label="Menu do serviço"
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {!isLoading && !error && services.length === 0 && (
          <EmptyState
            icon={<Package className="h-12 w-12" strokeWidth={1.5} />}
            title="Nenhum serviço cadastrado"
            description="Cadastre seu primeiro serviço para começar a oferecer aos clientes."
          />
        )}
      </div>

      <EntityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingService ? "Editar Serviço" : "Novo Serviço"}
        description={
          editingService
            ? "Altere os dados do serviço."
            : "Preencha os dados do novo serviço."
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
              {editingService ? "Salvar" : "Criar"}
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
                    <Input placeholder="Ex: Corte masculino" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Input placeholder="Breve descrição" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Preço <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3">
                        <span className="text-sm text-muted-foreground">
                          R$
                        </span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-2 h-9"
                          value={formatCurrencyDigits(
                            numberToCurrencyDigits(field.value),
                          )}
                          onChange={(e) => {
                            const digits = e.target.value
                              .replace(/\D/g, "")
                              .slice(0, 12);
                            field.onChange(parseCurrencyDigitsToNumber(digits));
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="duration_minutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Duração (min) <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Categoria <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Categoria" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="points_to_earn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pontos ao ganhar</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        placeholder="0"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? 0 : Number(e.target.value),
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
                name="points_to_redeem"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pontos para resgatar</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        placeholder="Não participa"
                        value={field.value === "" ? "" : field.value}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Vazio = não resgatável
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between">
                  <FormLabel>
                    Ativo <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
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
          title="Excluir serviço"
          description="Tem certeza? Esta ação não pode ser desfeita."
          confirmLabel="Excluir"
          variant="destructive"
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}
