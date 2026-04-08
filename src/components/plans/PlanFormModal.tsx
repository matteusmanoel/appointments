import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { plansApi, servicesApi, type BarbershopPlan } from "@/lib/api";

const planSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(120),
  description: z.string().max(500).optional(),
  service_ids: z.array(z.string().uuid()).optional().default([]),
  price: z.coerce.number().nonnegative("Preço deve ser ≥ 0"),
  billing_cycle: z.enum(["monthly", "quarterly", "yearly"]).default("monthly"),
  max_visits: z.coerce.number().int().positive().nullable().optional(),
});

type PlanFormValues = z.infer<typeof planSchema>;

const CYCLE_OPTIONS = [
  { value: "monthly", label: "Mensal" },
  { value: "quarterly", label: "Trimestral" },
  { value: "yearly", label: "Anual" },
];

interface PlanFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan?: BarbershopPlan | null;
  onSave: () => void;
}

export function PlanFormModal({ open, onOpenChange, plan, onSave }: PlanFormModalProps) {
  const isEditing = Boolean(plan);
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      name: "",
      description: "",
      service_ids: [],
      price: 0,
      billing_cycle: "monthly",
      max_visits: null,
    },
  });

  const { data: services = [] } = useQuery({
    queryKey: ["services"],
    queryFn: () => servicesApi.list(),
    enabled: open,
    select: (data) => data.filter((s) => s.is_active),
  });

  useEffect(() => {
    if (open && plan) {
      form.reset({
        name: plan.name,
        description: plan.description ?? "",
        service_ids: plan.service_ids ?? [],
        price: Number(plan.price),
        billing_cycle: plan.billing_cycle,
        max_visits: plan.max_visits,
      });
    } else if (open && !plan) {
      form.reset({
        name: "",
        description: "",
        service_ids: [],
        price: 0,
        billing_cycle: "monthly",
        max_visits: null,
      });
    }
  }, [open, plan, form]);

  const onSubmit = async (values: PlanFormValues) => {
    try {
      if (isEditing && plan) {
        await plansApi.update(plan.id, {
          name: values.name,
          description: values.description,
          service_ids: values.service_ids,
          price: values.price,
          billing_cycle: values.billing_cycle,
          max_visits: values.max_visits,
        });
      } else {
        await plansApi.create({
          name: values.name,
          description: values.description,
          service_ids: values.service_ids,
          price: values.price,
          billing_cycle: values.billing_cycle,
          max_visits: values.max_visits,
        });
      }
      onSave();
      onOpenChange(false);
    } catch (e) {
      console.error("[PlanFormModal] save error:", e);
    }
  };

  const toggleService = (id: string) => {
    const current = form.getValues("service_ids") ?? [];
    form.setValue(
      "service_ids",
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar plano" : "Novo plano"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do plano</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Plano Mensal Barba" {...field} />
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
                  <FormLabel>Descrição (opcional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Descreva os benefícios do plano..." rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preço (R$)</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" step="0.01" placeholder="89,90" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="billing_cycle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ciclo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CYCLE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="max_visits"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Máx. visitas por ciclo (deixe vazio para ilimitado)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      placeholder="Ex: 4"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="service_ids"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Serviços incluídos</FormLabel>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {services.map((s) => {
                      const selected = (field.value ?? []).includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleService(s.id)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs transition-colors",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                    {services.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nenhum serviço ativo encontrado.</p>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Salvando..." : isEditing ? "Salvar" : "Criar plano"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
