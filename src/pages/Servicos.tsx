import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Plus, Clock, DollarSign, Percent } from "lucide-react";
import { servicesApi } from "@/lib/api";
import {
  formatCurrencyDigits,
  numberToCurrencyDigits,
  parseCurrencyDigitsToNumber,
} from "@/lib/input-masks";
import { ConfirmDialog, EntityActionsMenu, EntityFormDialog } from "@/components/shared";
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

const CATEGORIES = ["corte", "combo", "barba", "adicional", "tratamento"] as const;

const serviceSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().optional(),
  price: z.coerce.number().min(0.01, "Preço deve ser maior que zero"),
  duration_minutes: z.coerce.number().min(1, "Duração mínima 1 min"),
  category: z.enum(CATEGORIES).optional().default("corte"),
  is_active: z.boolean().optional().default(true),
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
};

export default function Servicos() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);

  const { data: services = [], isLoading, error } = useQuery({
    queryKey: ["services"],
    queryFn: () => servicesApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (body: ServiceFormValues) => servicesApi.create(body),
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
          },
        }),
        { successMessage: "Serviço atualizado.", errorMessage: "Erro ao atualizar serviço." }
      );
    } else {
      await withToast(
        createMutation.mutateAsync(values),
        { successMessage: "Serviço criado.", errorMessage: "Erro ao criar serviço." }
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
    <MainLayout>
      <div className="animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="page-header mb-0">
            <h1 className="page-title">Serviços</h1>
            <p className="page-subtitle">Gerencie seus serviços e preços</p>
          </div>
          <Button className="btn-accent w-fit" onClick={openCreate} aria-label="Adicionar serviço">
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Serviço
          </Button>
        </div>

        {error && <p className="text-sm text-destructive mb-4">Erro ao carregar serviços.</p>}
        {isLoading && (
          <div className="stat-card space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {!isLoading && !error && (
          <div className="stat-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Serviço</th>
                    <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Categoria</th>
                    <th className="text-right py-4 px-4 text-sm font-medium text-muted-foreground">Preço</th>
                    <th className="text-right py-4 px-4 text-sm font-medium text-muted-foreground">Duração</th>
                    <th className="text-right py-4 px-4 text-sm font-medium text-muted-foreground">Comissão</th>
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
                          <p className="font-medium text-foreground">{service.name}</p>
                          {service.description && (
                            <p className="text-sm text-muted-foreground">{service.description}</p>
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
                          <span className="text-foreground">{service.duration_minutes} min</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Percent className="w-3.5 h-3.5 text-accent" />
                          <span className="text-foreground">{service.commission_percentage ?? 0}%</span>
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
          <p className="text-muted-foreground">Nenhum serviço cadastrado.</p>
        )}
      </div>

      <EntityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingService ? "Editar Serviço" : "Novo Serviço"}
        description={editingService ? "Altere os dados do serviço." : "Preencha os dados do novo serviço."}
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
                  <FormLabel>Nome <span className="text-destructive">*</span></FormLabel>
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
                    <FormLabel>Preço <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3">
                        <span className="text-sm text-muted-foreground">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-2 h-9"
                          value={formatCurrencyDigits(numberToCurrencyDigits(field.value))}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
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
                    <FormLabel>Duração (min) <span className="text-destructive">*</span></FormLabel>
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
                  <FormLabel>Categoria <span className="text-destructive">*</span></FormLabel>
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
            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between">
                  <FormLabel>Ativo <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
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
    </MainLayout>
  );
}
