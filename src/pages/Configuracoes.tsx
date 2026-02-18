import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import {
  Store,
  Clock,
  Link as LinkIcon,
  Bell,
  CreditCard,
  Shield,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import { authApi, barbershopsApi, getDefaultBusinessHours, type BusinessHours } from "@/lib/api";
import { formatPhoneBR, parsePhoneBR } from "@/lib/input-masks";
import { ConfirmDialog, EntityFormDialog } from "@/components/shared";
import { toastError, toastSuccess, withToast } from "@/lib/toast-helpers";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const settingsSections = [
  { id: "business", title: "Dados da Barbearia", description: "Nome, endereço e informações de contato", icon: Store },
  { id: "hours", title: "Horário de Funcionamento", description: "Configure os dias e horários de atendimento", icon: Clock },
  { id: "booking", title: "Link de Agendamento", description: "Personalize o link público para seus clientes", icon: LinkIcon },
  { id: "notifications", title: "Notificações", description: "Configure lembretes e alertas automáticos", icon: Bell },
  { id: "payments", title: "Pagamentos e Comissões", description: "Métodos de pagamento e regras de comissão", icon: CreditCard },
  { id: "security", title: "Segurança", description: "Altere sua senha e configurações de acesso", icon: Shield },
];

const barbershopSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
});

type BarbershopFormValues = z.infer<typeof barbershopSchema>;

const DAY_LABELS: { key: keyof BusinessHours; label: string }[] = [
  { key: "monday", label: "Segunda" },
  { key: "tuesday", label: "Terça" },
  { key: "wednesday", label: "Quarta" },
  { key: "thursday", label: "Quinta" },
  { key: "friday", label: "Sexta" },
  { key: "saturday", label: "Sábado" },
  { key: "sunday", label: "Domingo" },
];

export default function Configuracoes() {
  const queryClient = useQueryClient();
  const [businessOpen, setBusinessOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [slugEdit, setSlugEdit] = useState("");
  const [deleteAccountConfirmOpen, setDeleteAccountConfirmOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [hoursState, setHoursState] = useState<BusinessHours>(getDefaultBusinessHours());
  const [linkCopied, setLinkCopied] = useState(false);

  const { data: barbershop, isLoading } = useQuery({
    queryKey: ["barbershop"],
    queryFn: () => barbershopsApi.get(),
  });

  const patchMutation = useMutation({
    mutationFn: (body: BarbershopFormValues & { business_hours?: BusinessHours; slug?: string }) => barbershopsApi.patch(body),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["barbershop"] });
      if (variables.business_hours !== undefined) setHoursOpen(false);
      else if (variables.slug !== undefined) setBookingOpen(false);
      else setBusinessOpen(false);
    },
  });

  const form = useForm<BarbershopFormValues>({
    resolver: zodResolver(barbershopSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      address: "",
    },
  });

  useEffect(() => {
    if (businessOpen && barbershop) {
      form.reset({
        name: barbershop.name ?? "",
        phone: parsePhoneBR(barbershop.phone ?? ""),
        email: barbershop.email ?? "",
        address: barbershop.address ?? "",
      });
    }
  }, [businessOpen, barbershop, form]);

  const openBusiness = () => setBusinessOpen(true);

  const onSubmitBusiness = async (values: BarbershopFormValues) => {
    await withToast(
      patchMutation.mutateAsync(values),
      { successMessage: "Dados salvos.", errorMessage: "Erro ao salvar dados." }
    );
  };

  const openHours = () => {
    const h = barbershop?.business_hours ?? getDefaultBusinessHours();
    setHoursState({ ...getDefaultBusinessHours(), ...h });
    setHoursOpen(true);
  };

  const onSubmitHours = async () => {
    await withToast(
      patchMutation.mutateAsync({ business_hours: hoursState }),
      { successMessage: "Horário salvo.", errorMessage: "Erro ao salvar horário." }
    );
  };

  const setDayHours = (key: keyof BusinessHours, value: { start: string; end: string } | null) => {
    setHoursState((prev) => ({ ...prev, [key]: value }));
  };

  const openBooking = () => {
    setSlugEdit(barbershop?.slug ?? "");
    setBookingOpen(true);
  };

  const bookingLink = typeof window !== "undefined" ? `${window.location.origin}/b/${slugEdit || barbershop?.slug || ""}` : "";
  const slugValid = /^[a-z0-9-]{2,80}$/.test(slugEdit);

  const onSubmitBooking = async () => {
    if (!slugValid) return;
    await withToast(
      patchMutation.mutateAsync({ slug: slugEdit }),
      { successMessage: "Link atualizado.", errorMessage: "Erro ao salvar link." }
    );
  };

  const copyBookingLink = () => {
    if (!bookingLink) return;
    navigator.clipboard.writeText(bookingLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const changePasswordSchema = z.object({
    current_password: z.string().min(1, "Senha atual é obrigatória"),
    new_password: z.string().min(8, "Nova senha deve ter no mínimo 8 caracteres"),
    confirm_password: z.string().min(1, "Confirme a nova senha"),
  }).refine((d) => d.new_password === d.confirm_password, { message: "As senhas não coincidem", path: ["confirm_password"] });
  type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
  const passwordForm = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });
  const changePasswordMutation = useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) => authApi.changePassword(body),
    onSuccess: () => {
      toastSuccess("Senha alterada com sucesso.");
      setSecurityOpen(false);
      passwordForm.reset();
    },
    onError: (e) => {
      toastError("Não foi possível alterar a senha.", e, "Verifique a senha atual.");
    },
  });
  const onSubmitPassword = (values: ChangePasswordValues) => {
    changePasswordMutation.mutate({ current_password: values.current_password, new_password: values.new_password });
  };

  return (
    <MainLayout>
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Configurações</h1>
          <p className="page-subtitle">Gerencie as configurações da sua barbearia</p>
        </div>

        <div className="space-y-4 max-w-3xl">
          <button
            type="button"
            className="w-full stat-card flex items-center gap-4 text-left hover:border-accent/50 transition-colors"
            onClick={openBusiness}
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Store className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-foreground">Dados da Barbearia</h3>
              <p className="text-sm text-muted-foreground">Nome, endereço e informações de contato</p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>

          {settingsSections.filter((s) => s.id !== "business").map((section) => (
            <button
              key={section.id}
              type="button"
              className={`w-full stat-card flex items-center gap-4 text-left transition-colors ${section.id === "hours" || section.id === "booking" || section.id === "security" ? "hover:border-accent/50" : "opacity-90"}`}
              onClick={
                section.id === "hours" ? openHours
                  : section.id === "booking" ? openBooking
                  : section.id === "security" ? () => setSecurityOpen(true)
                  : undefined
              }
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <section.icon className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-medium text-foreground">{section.title}</h3>
                <p className="text-sm text-muted-foreground">{section.description}</p>
                {section.id !== "hours" && section.id !== "booking" && section.id !== "security" && <p className="text-xs text-muted-foreground/80 mt-1">Em breve.</p>}
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
          ))}
        </div>

        <div className="mt-12 max-w-3xl">
          <h2 className="text-lg font-semibold text-foreground mb-4">Zona de Perigo</h2>
          <div className="stat-card border-destructive/20">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-foreground">Encerrar Conta</h3>
                <p className="text-sm text-muted-foreground">
                  Esta ação é irreversível e excluirá todos os seus dados.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteAccountConfirmOpen(true)}
              >
                Excluir Conta
              </Button>
            </div>
          </div>
        </div>
      </div>

      <EntityFormDialog
        open={businessOpen}
        onOpenChange={setBusinessOpen}
        title="Dados da Barbearia"
        description="Altere nome, contato e endereço."
        footer={
          <>
            <Button variant="outline" onClick={() => setBusinessOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={form.handleSubmit(onSubmitBusiness)}
              disabled={patchMutation.isPending || isLoading || !barbershop}
            >
              Salvar
            </Button>
          </>
        }
      >
        {isLoading || !barbershop ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </div>
        ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmitBusiness)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="Nome da barbearia" {...field} />
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
                      placeholder="(11) 3333-4444"
                      value={formatPhoneBR(field.value)}
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
                  <FormControl>
                    <Input type="email" placeholder="contato@barbearia.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Endereço</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Endereço completo" className="resize-none" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        )}
      </EntityFormDialog>

      <EntityFormDialog
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        title="Link de Agendamento"
        description="Compartilhe este link para clientes agendarem online."
        footer={
          <>
            <Button variant="outline" onClick={() => setBookingOpen(false)}>
              Fechar
            </Button>
            <Button onClick={onSubmitBooking} disabled={patchMutation.isPending || !slugValid}>
              Salvar slug
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="booking-link" className="text-sm font-medium">Link público</Label>
            <div className="flex gap-2 mt-1">
              <Input id="booking-link" readOnly value={bookingLink} className="font-mono text-sm" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={copyBookingLink}
                    aria-label={linkCopied ? "Copiado" : "Copiar link"}
                  >
                    {linkCopied ? (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-white">
                        <Check className="h-3 w-3" strokeWidth={2.5} />
                      </span>
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="z-[100]">
                  {linkCopied ? "Copiado!" : "Copiar"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div>
            <Label htmlFor="slug-edit" className="text-sm font-medium">Slug (parte do link)</Label>
            <Input
              id="slug-edit"
              value={slugEdit}
              onChange={(e) => setSlugEdit(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="minha-barbearia"
              className="mt-1 font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">Apenas letras minúsculas, números e hífens (2–80 caracteres).</p>
          </div>
        </div>
      </EntityFormDialog>

      <EntityFormDialog
        open={hoursOpen}
        onOpenChange={setHoursOpen}
        title="Horário de Funcionamento"
        description="Configure os dias e horários de atendimento."
        contentClassName="sm:max-w-xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setHoursOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={onSubmitHours} disabled={patchMutation.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-0">
          {DAY_LABELS.map(({ key, label }) => {
            const day = hoursState[key];
            const isOpen = day && typeof day === "object" && day.start != null && day.end != null;
            return (
              <div
                key={key}
                className="flex min-h-[52px] items-center gap-3 border-b border-border py-3 last:border-0"
              >
                <div className="w-24 shrink-0 font-medium text-foreground">{label}</div>
                <Checkbox
                  id={`hours-${key}`}
                  checked={!!isOpen}
                  onCheckedChange={(checked) => {
                    if (checked) setDayHours(key, { start: "09:00", end: "18:00" });
                    else setDayHours(key, null);
                  }}
                  className="border-green-600 data-[state=checked]:bg-green-600 data-[state=checked]:text-white"
                />
                <label htmlFor={`hours-${key}`} className="shrink-0 cursor-pointer text-sm">
                  Aberto
                </label>
                {isOpen && day && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      type="time"
                      value={day.start}
                      onChange={(e) => setDayHours(key, { ...day, start: e.target.value })}
                      className="h-8 w-28 min-w-[7rem]"
                    />
                    <span className="shrink-0 whitespace-nowrap text-muted-foreground">até</span>
                    <Input
                      type="time"
                      value={day.end}
                      onChange={(e) => setDayHours(key, { ...day, end: e.target.value })}
                      className="h-8 w-28 min-w-[7rem]"
                    />
                  </div>
                )}
                {!isOpen && <span className="text-sm text-muted-foreground">Fechado</span>}
              </div>
            );
          })}
        </div>
      </EntityFormDialog>

      <EntityFormDialog
        open={securityOpen}
        onOpenChange={setSecurityOpen}
        title="Alterar senha"
        description="Digite sua senha atual e a nova senha."
        footer={
          <>
            <Button variant="outline" onClick={() => setSecurityOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={passwordForm.handleSubmit(onSubmitPassword)} disabled={changePasswordMutation.isPending}>
              Alterar senha
            </Button>
          </>
        }
      >
        <Form {...passwordForm}>
          <form onSubmit={passwordForm.handleSubmit(onSubmitPassword)} className="space-y-4">
            <FormField
              control={passwordForm.control}
              name="current_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha atual</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={passwordForm.control}
              name="new_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nova senha</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Mínimo 8 caracteres" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={passwordForm.control}
              name="confirm_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirmar nova senha</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Repita a nova senha" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </EntityFormDialog>

      <ConfirmDialog
        open={deleteAccountConfirmOpen}
        onOpenChange={setDeleteAccountConfirmOpen}
        title="Excluir conta"
        description="Esta funcionalidade ainda não está disponível. Entre em contato com o suporte para encerrar sua conta."
        confirmLabel="Entendi"
        cancelLabel="Fechar"
        variant="default"
        onConfirm={() => {
          toastSuccess("Em breve esta opção estará disponível.");
        }}
      />
    </MainLayout>
  );
}
