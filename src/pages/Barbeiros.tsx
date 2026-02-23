import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Plus, Clock, Scissors } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { barbersApi } from "@/lib/api";
import { formatPhoneBR, parsePhoneBR } from "@/lib/input-masks";
import {
  ConfirmDialog,
  EntityActionsMenu,
  EntityFormDialog,
} from "@/components/shared";
import { toastError, withToast } from "@/lib/toast-helpers";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

const DAYS = [
  { key: "monday", label: "Segunda" },
  { key: "tuesday", label: "Terça" },
  { key: "wednesday", label: "Quarta" },
  { key: "thursday", label: "Quinta" },
  { key: "friday", label: "Sexta" },
  { key: "saturday", label: "Sábado" },
  { key: "sunday", label: "Domingo" },
] as const;

const statusMap: Record<string, { label: string; className: string }> = {
  active: { label: "Ativo", className: "badge-success" },
  break: { label: "Intervalo", className: "badge-warning" },
  inactive: {
    label: "Inativo",
    className:
      "bg-muted text-muted-foreground border border-border px-2.5 py-0.5 rounded-full text-xs font-medium",
  },
};

type ScheduleSlot = { start: string; end: string } | null;
type ScheduleRecord = Record<string, ScheduleSlot>;

const defaultSchedule: ScheduleRecord = {
  monday: { start: "09:00", end: "19:00" },
  tuesday: { start: "09:00", end: "19:00" },
  wednesday: { start: "09:00", end: "19:00" },
  thursday: { start: "09:00", end: "19:00" },
  friday: { start: "09:00", end: "19:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

function formatSchedule(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "—";
  const s = schedule as Record<string, { start?: string; end?: string } | null>;
  const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const parts = DAYS.map((d, i) => {
    const slot = s[d.key];
    if (!slot?.start || !slot?.end) return null;
    return `${labels[i]} ${slot.start}-${slot.end}`;
  }).filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

const barberSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  phone: z.string().optional(),
  email: z.string().optional(),
  status: z.enum(["active", "inactive", "break"]),
  commission_percentage: z.coerce.number().min(0).max(100),
  schedule: z.record(
    z.union([z.object({ start: z.string(), end: z.string() }), z.null()]),
  ),
});

type BarberFormValues = z.infer<typeof barberSchema>;

type Barber = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status: string;
  commission_percentage: number;
  schedule?: unknown;
};

export default function Barbeiros() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingBarber, setEditingBarber] = useState<Barber | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Barber | null>(null);

  const {
    data: barbers = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["barbers"],
    queryFn: () => barbersApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (body: BarberFormValues) =>
      barbersApi.create({
        name: body.name,
        phone: body.phone || undefined,
        email: body.email || undefined,
        status: body.status,
        commission_percentage: body.commission_percentage,
        schedule: body.schedule,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["barbers"] });
      setFormOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      barbersApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["barbers"] });
      setFormOpen(false);
      setEditingBarber(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => barbersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["barbers"] });
      setDeleteTarget(null);
    },
  });

  const form = useForm<BarberFormValues>({
    resolver: zodResolver(barberSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      status: "active",
      commission_percentage: 40,
      schedule: { ...defaultSchedule },
    },
  });

  const openCreate = () => {
    setEditingBarber(null);
    form.reset({
      name: "",
      phone: "",
      email: "",
      status: "active",
      commission_percentage: 40,
      schedule: { ...defaultSchedule },
    });
    setFormOpen(true);
  };

  const parseSchedule = (s: unknown): ScheduleRecord => {
    if (!s || typeof s !== "object") return { ...defaultSchedule };
    const out = { ...defaultSchedule };
    DAYS.forEach((d) => {
      const slot = (s as Record<string, unknown>)[d.key];
      if (
        slot &&
        typeof slot === "object" &&
        slot !== null &&
        "start" in slot &&
        "end" in slot
      ) {
        out[d.key] = {
          start: String((slot as { start: string }).start),
          end: String((slot as { end: string }).end),
        };
      } else {
        out[d.key] = null;
      }
    });
    return out;
  };

  const openEdit = (barber: Barber) => {
    setEditingBarber(barber);
    form.reset({
      name: barber.name,
      phone: parsePhoneBR(barber.phone ?? ""),
      email: barber.email ?? "",
      status: (barber.status as "active" | "inactive" | "break") ?? "active",
      commission_percentage: barber.commission_percentage ?? 40,
      schedule: parseSchedule(barber.schedule),
    });
    setFormOpen(true);
  };

  const onSubmit = async (values: BarberFormValues) => {
    if (editingBarber) {
      await withToast(
        updateMutation.mutateAsync({
          id: editingBarber.id,
          body: {
            name: values.name,
            phone: values.phone || undefined,
            email: values.email || undefined,
            status: values.status,
            commission_percentage: values.commission_percentage,
            schedule: values.schedule,
          },
        }),
        {
          successMessage: "Barbeiro atualizado.",
          errorMessage: "Erro ao atualizar barbeiro.",
        },
      );
    } else {
      await withToast(createMutation.mutateAsync(values), {
        successMessage: "Barbeiro criado.",
        errorMessage: "Erro ao criar barbeiro.",
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
    } catch (e) {
      toastError("Erro ao excluir barbeiro.", e);
    }
  };

  const schedule = form.watch("schedule") ?? defaultSchedule;

  return (
    <>
      <div className="animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="page-header mb-0">
            <h1 className="page-title">Barbeiros</h1>
            <p className="page-subtitle">
              Gerencie sua equipe de profissionais
            </p>
          </div>
          <Button
            className="btn-accent w-full md:w-fit"
            onClick={openCreate}
            aria-label="Adicionar barbeiro"
          >
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Barbeiro
          </Button>
        </div>

        {error && (
          <p className="text-sm text-destructive mb-4">
            Erro ao carregar barbeiros.
          </p>
        )}
        {isLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 rounded-lg" />
            ))}
          </div>
        )}
        {!isLoading && !error && (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {barbers.map((barber) => {
              const status = statusMap[barber.status] ?? statusMap.inactive;
              return (
                <div
                  key={barber.id}
                  className="stat-card cursor-pointer"
                  onClick={() => openEdit(barber as Barber)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
                        <span className="text-xl font-semibold text-primary">
                          {barber.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {barber.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {barber.phone ?? "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={status.className}>{status.label}</span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <EntityActionsMenu
                          onEdit={() => openEdit(barber as Barber)}
                          onDelete={() => setDeleteTarget(barber as Barber)}
                          isActive={barber.status === "active"}
                          onDeactivate={async () => {
                            await withToast(
                              updateMutation.mutateAsync({
                                id: barber.id,
                                body: { status: "inactive" },
                              }),
                              {
                                successMessage: "Barbeiro desativado.",
                                errorMessage: "Erro ao desativar barbeiro.",
                              },
                            );
                          }}
                          onActivate={async () => {
                            await withToast(
                              updateMutation.mutateAsync({
                                id: barber.id,
                                body: { status: "active" },
                              }),
                              {
                                successMessage: "Barbeiro ativado.",
                                errorMessage: "Erro ao ativar barbeiro.",
                              },
                            );
                          }}
                          actions={["edit", "delete", "activate", "deactivate"]}
                          aria-label="Menu do barbeiro"
                        />
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                    <div>
                      <p className="text-xs text-muted-foreground">Comissão</p>
                      <p className="text-sm font-medium text-foreground">
                        {barber.commission_percentage}%
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatSchedule(barber.schedule)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!isLoading && !error && barbers.length === 0 && (
          <EmptyState
            icon={<Scissors className="h-12 w-12" strokeWidth={1.5} />}
            title="Nenhum barbeiro cadastrado"
            description="Cadastre os barbeiros da equipe para organizar a agenda."
          />
        )}
      </div>

      <EntityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingBarber ? "Editar Barbeiro" : "Novo Barbeiro"}
        description={
          editingBarber
            ? "Altere os dados do barbeiro."
            : "Preencha os dados do novo barbeiro."
        }
        contentClassName="sm:max-w-xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={form.handleSubmit(onSubmit)}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingBarber ? "Salvar" : "Criar"}
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
                  <FormLabel>Telefone</FormLabel>
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Status <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="inactive">Inativo</SelectItem>
                        <SelectItem value="break">Intervalo</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="commission_percentage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Comissão (%) <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={100} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="space-y-3">
              <FormLabel>
                Horário de trabalho <span className="text-destructive">*</span>
              </FormLabel>
              <div className="space-y-0 rounded-lg border p-3 min-w-0">
                {DAYS.map((d) => (
                  <div
                    key={d.key}
                    className="flex min-h-[52px] flex-wrap items-center gap-2 border-b border-border py-2 last:border-0"
                  >
                    <Checkbox
                      className="border-green-600 data-[state=checked]:bg-green-600 data-[state=checked]:text-white shrink-0"
                      checked={schedule[d.key] !== null}
                      onCheckedChange={(checked) => {
                        form.setValue("schedule", {
                          ...form.getValues("schedule"),
                          [d.key]: checked
                            ? { start: "09:00", end: "18:00" }
                            : null,
                        });
                      }}
                    />
                    <span className="text-sm w-20 shrink-0">{d.label}</span>
                    {schedule[d.key] !== null ? (
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-0 sm:flex-nowrap">
                        <Input
                          type="time"
                          className="h-8 min-w-0 flex-1 sm:w-28 sm:flex-none sm:min-w-[7rem]"
                          value={schedule[d.key]?.start ?? "09:00"}
                          onChange={(e) =>
                            form.setValue("schedule", {
                              ...form.getValues("schedule"),
                              [d.key]: {
                                start: e.target.value,
                                end: schedule[d.key]?.end ?? "18:00",
                              },
                            })
                          }
                        />
                        <span className="shrink-0 text-muted-foreground whitespace-nowrap">
                          até
                        </span>
                        <Input
                          type="time"
                          className="h-8 min-w-0 flex-1 sm:w-28 sm:flex-none sm:min-w-[7rem]"
                          value={schedule[d.key]?.end ?? "18:00"}
                          onChange={(e) =>
                            form.setValue("schedule", {
                              ...form.getValues("schedule"),
                              [d.key]: {
                                start: schedule[d.key]?.start ?? "09:00",
                                end: e.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Fechado
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </form>
        </Form>
      </EntityFormDialog>

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title="Excluir barbeiro"
          description="Tem certeza? Esta ação não pode ser desfeita."
          confirmLabel="Excluir"
          variant="destructive"
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}
