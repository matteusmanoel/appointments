import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Store,
  Clock,
  Link as LinkIcon,
  CreditCard,
  Shield,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  MessageCircle,
  CalendarX,
  Plus,
  Pencil,
  Trash2,
  Lock,
  Building2,
} from "lucide-react";
import {
  authApi,
  barbershopsApi,
  billingApi,
  whatsappApi,
  integrationsApi,
  reportsApi,
  getDefaultBusinessHours,
  type BusinessHours,
  type BarbershopClosure,
} from "@/lib/api";
import { formatPhoneBR, parsePhoneBR } from "@/lib/input-masks";
import { ConfirmDialog, EntityFormDialog } from "@/components/shared";
import { LoadingState } from "@/components/LoadingState";
import { WhatsAppSetupStepperModal } from "@/components/whatsapp/WhatsAppSetupStepperModal";
import { ConnectTab } from "@/components/whatsapp/ConnectTab";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { hasPro, hasPremium } from "@/lib/plan";
import { CheckoutModal } from "@/components/CheckoutModal";
import { format, subDays } from "date-fns";

const settingsSections = [
  {
    id: "business",
    title: "Dados da NavalhIA",
    description: "Nome, endereço e informações de contato",
    icon: Store,
  },
  {
    id: "hours",
    title: "Horário de Funcionamento",
    description: "Dias, horários e exceções (feriados, fechamentos)",
    icon: Clock,
  },
  {
    id: "booking",
    title: "Link de Agendamento",
    description: "Personalize o link público para seus clientes",
    icon: LinkIcon,
  },
  {
    id: "whatsapp",
    title: "WhatsApp (IA)",
    description: "Conecte WhatsApp, IA, horários e notificações",
    icon: MessageCircle,
  },
  {
    id: "payments",
    title: "Pagamentos e Comissões",
    description: "Métodos de pagamento e regras de comissão",
    icon: CreditCard,
  },
  {
    id: "security",
    title: "Segurança",
    description: "Altere sua senha e configurações de acesso",
    icon: Shield,
  },
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

function PaymentsCommissionsModal({
  open,
  onOpenChange,
  onGoToBarbeiros,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGoToBarbeiros: () => void;
}) {
  const toDate = new Date();
  const from = format(subDays(toDate, 30), "yyyy-MM-dd");
  const to = format(toDate, "yyyy-MM-dd");
  const { data: commissions = [], isLoading } = useQuery({
    queryKey: ["reports", "commissions_by_barber", from, to],
    queryFn: () => reportsApi.commissionsByBarber({ from, to }),
    enabled: open,
  });
  return (
    <EntityFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Pagamentos e Comissões"
      description="No MVP, o pagamento do atendimento não está integrado; a assinatura NavalhIA é via Stripe."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button onClick={onGoToBarbeiros}>Configurar % por barbeiro</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Configure a porcentagem de comissão de cada barbeiro em Barbeiros. A
          comissão é calculada sobre o valor do agendamento e exibida no
          relatório e no modal do agendamento.
        </p>
        <div>
          <Label className="text-sm font-medium">
            Comissão prevista (últimos 30 dias)
          </Label>
          {isLoading ? (
            <LoadingState />
          ) : commissions.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-1">
              Nenhum agendamento concluído no período.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {commissions.map((c) => (
                <li key={c.barber_id} className="flex justify-between text-sm">
                  <span>{c.barber_name}</span>
                  <span className="font-medium">
                    R$ {c.total_commission.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </EntityFormDialog>
  );
}

export default function Configuracoes() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [businessOpen, setBusinessOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [slugEdit, setSlugEdit] = useState("");
  const [deleteAccountConfirmOpen, setDeleteAccountConfirmOpen] =
    useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [closureFormOpen, setClosureFormOpen] = useState(false);
  const [editingClosure, setEditingClosure] =
    useState<BarbershopClosure | null>(null);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [webhookWarning, setWebhookWarning] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testText, setTestText] = useState("");
  const [hoursState, setHoursState] = useState<BusinessHours>(
    getDefaultBusinessHours(),
  );
  const [linkCopied, setLinkCopied] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [waPolicyAccepted, setWaPolicyAccepted] = useState(false);

  const { profile, refetchProfile, switchBarbershop } = useAuth();

  useEffect(() => {
    if (whatsappOpen && profile?.barbershop_id) {
      try {
        setWaPolicyAccepted(localStorage.getItem(`navalhia_wa_policy_${profile.barbershop_id}_v1`) === "1");
      } catch {
        setWaPolicyAccepted(false);
      }
    } else {
      setWaPolicyAccepted(false);
    }
  }, [whatsappOpen, profile?.barbershop_id]);

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
  const canUseWhatsAppAndNotifications = hasPro(profile);
  const isPremium = hasPremium(profile);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [newUnitModalOpen, setNewUnitModalOpen] = useState(false);

  const { data: barbershop, isLoading } = useQuery({
    queryKey: ["barbershop"],
    queryFn: () => barbershopsApi.get(),
    retry: false,
    staleTime: 2 * 60 * 1000,
  });

  const { data: whatsappConnection, isLoading: whatsappLoading } = useQuery({
    queryKey: ["integrations", "whatsapp"],
    queryFn: () => whatsappApi.get(),
    enabled: whatsappOpen,
    retry: false,
  });

  const whatsappStatusQuery = useQuery({
    queryKey: ["integrations", "whatsapp", "status"],
    queryFn: () => whatsappApi.status(),
    enabled:
      whatsappOpen &&
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
    enabled: whatsappOpen && !!whatsappConnection?.connected,
    retry: false,
  });

  const patchMutation = useMutation({
    mutationFn: (
      body: BarbershopFormValues & {
        business_hours?: BusinessHours;
        slug?: string;
      },
    ) => barbershopsApi.patch(body),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["barbershop"] });
      if (variables.business_hours !== undefined) setHoursOpen(false);
      else if (variables.slug !== undefined) setBookingOpen(false);
      else setBusinessOpen(false);
    },
  });

  useEffect(() => {
    if (searchParams.get("open") === "booking") {
      setBookingOpen(true);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("open");
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

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

  const { data: closuresList = [], isLoading: closuresLoading } = useQuery({
    queryKey: ["barbershops", "closures"],
    queryFn: () => barbershopsApi.closures.list(),
    enabled: hoursOpen,
  });

  const createClosureMutation = useMutation({
    mutationFn: (body: {
      closure_date: string;
      status: "closed" | "open_partial";
      start_time?: string;
      end_time?: string;
      reason?: string;
    }) => barbershopsApi.closures.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["barbershops", "closures"] });
      setClosureFormOpen(false);
      setEditingClosure(null);
      closureForm.reset(closureFormDefault);
      toastSuccess("Exceção adicionada.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao adicionar"),
  });

  const updateClosureMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        status?: "closed" | "open_partial";
        start_time?: string | null;
        end_time?: string | null;
        reason?: string | null;
      };
    }) => barbershopsApi.closures.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["barbershops", "closures"] });
      setClosureFormOpen(false);
      setEditingClosure(null);
      closureForm.reset(closureFormDefault);
      toastSuccess("Exceção atualizada.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao atualizar"),
  });

  const deleteClosureMutation = useMutation({
    mutationFn: (id: string) => barbershopsApi.closures.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["barbershops", "closures"] });
      toastSuccess("Exceção removida.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao remover"),
  });

  const closureFormSchema = z.object({
    closure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data yyyy-MM-dd"),
    status: z.enum(["closed", "open_partial"]),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    reason: z.string().max(500).optional(),
  });
  type ClosureFormValues = z.infer<typeof closureFormSchema>;
  const closureFormDefault: ClosureFormValues = {
    closure_date: new Date().toISOString().slice(0, 10),
    status: "closed",
    start_time: "",
    end_time: "",
    reason: "",
  };
  const closureForm = useForm<ClosureFormValues>({
    resolver: zodResolver(closureFormSchema),
    defaultValues: closureFormDefault,
  });

  useEffect(() => {
    if (closureFormOpen && editingClosure) {
      closureForm.reset({
        closure_date: editingClosure.closure_date,
        status: editingClosure.status,
        start_time: editingClosure.start_time?.slice(0, 5) ?? "",
        end_time: editingClosure.end_time?.slice(0, 5) ?? "",
        reason: editingClosure.reason ?? "",
      });
    } else if (closureFormOpen && !editingClosure) {
      closureForm.reset(closureFormDefault);
    }
  }, [closureFormOpen, editingClosure]);

  const openClosureForm = (closure?: BarbershopClosure) => {
    setEditingClosure(closure ?? null);
    setClosureFormOpen(true);
  };

  const onSubmitClosureForm = (values: ClosureFormValues) => {
    if (editingClosure) {
      updateClosureMutation.mutate({
        id: editingClosure.id,
        body: {
          status: values.status,
          start_time: values.start_time || null,
          end_time: values.end_time || null,
          reason: values.reason || null,
        },
      });
    } else {
      createClosureMutation.mutate({
        closure_date: values.closure_date,
        status: values.status,
        start_time: values.start_time || undefined,
        end_time: values.end_time || undefined,
        reason: values.reason || undefined,
      });
    }
  };

  const newUnitSchema = z.object({
    name: z.string().min(1, "Nome é obrigatório"),
    slug: z
      .string()
      .optional()
      .refine((v) => !v || (v.length >= 2 && v.length <= 80 && /^[a-z0-9-]+$/.test(v)), "Slug: apenas letras minúsculas, números e hífens (2–80 caracteres)"),
  });
  type NewUnitFormValues = z.infer<typeof newUnitSchema>;
  const newUnitForm = useForm<NewUnitFormValues>({
    resolver: zodResolver(newUnitSchema),
    defaultValues: { name: "", slug: "" },
  });
  const createBranchMutation = useMutation({
    mutationFn: (body: { name: string; slug?: string }) => barbershopsApi.createBranch(body),
    onSuccess: async (created) => {
      setNewUnitModalOpen(false);
      setUnitsOpen(false);
      newUnitForm.reset({ name: "", slug: "" });
      await refetchProfile();
      await switchBarbershop(created.id);
      toastSuccess("Nova unidade criada. Você está nela agora.");
    },
    onError: (e) => toastError(e instanceof Error ? e.message : "Erro ao criar unidade"),
  });
  const onSubmitNewUnit = (values: NewUnitFormValues) => {
    createBranchMutation.mutate({
      name: values.name.trim(),
      slug: values.slug?.trim() || undefined,
    });
  };

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
    await withToast(patchMutation.mutateAsync(values), {
      successMessage: "Dados salvos.",
      errorMessage: "Erro ao salvar dados.",
    });
  };

  const openHours = () => {
    const h = barbershop?.business_hours ?? getDefaultBusinessHours();
    setHoursState({ ...getDefaultBusinessHours(), ...h });
    setHoursOpen(true);
  };

  const onSubmitHours = async () => {
    await withToast(patchMutation.mutateAsync({ business_hours: hoursState }), {
      successMessage: "Horário salvo.",
      errorMessage: "Erro ao salvar horário.",
    });
  };

  const setDayHours = (
    key: keyof BusinessHours,
    value: { start: string; end: string } | null,
  ) => {
    setHoursState((prev) => ({ ...prev, [key]: value }));
  };

  const openBooking = () => {
    setSlugEdit(barbershop?.slug ?? "");
    setBookingOpen(true);
  };

  const bookingLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/b/${slugEdit || barbershop?.slug || ""}`
      : "";
  const slugValid = /^[a-z0-9-]{2,80}$/.test(slugEdit);

  const onSubmitBooking = async () => {
    if (!slugValid) return;
    await withToast(patchMutation.mutateAsync({ slug: slugEdit }), {
      successMessage: "Link atualizado.",
      errorMessage: "Erro ao salvar link.",
    });
  };

  const copyBookingLink = () => {
    if (!bookingLink) return;
    navigator.clipboard.writeText(bookingLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const changePasswordSchema = z
    .object({
      current_password: z.string().min(1, "Senha atual é obrigatória"),
      new_password: z
        .string()
        .min(8, "Nova senha deve ter no mínimo 8 caracteres"),
      confirm_password: z.string().min(1, "Confirme a nova senha"),
    })
    .refine((d) => d.new_password === d.confirm_password, {
      message: "As senhas não coincidem",
      path: ["confirm_password"],
    });
  type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
  const passwordForm = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      current_password: "",
      new_password: "",
      confirm_password: "",
    },
  });
  const changePasswordMutation = useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      authApi.changePassword(body),
    onSuccess: () => {
      toastSuccess("Senha alterada com sucesso.");
      setSecurityOpen(false);
      passwordForm.reset();
    },
    onError: (e) => {
      toastError(
        "Não foi possível alterar a senha.",
        e,
        "Verifique a senha atual.",
      );
    },
  });
  const onSubmitPassword = (values: ChangePasswordValues) => {
    changePasswordMutation.mutate({
      current_password: values.current_password,
      new_password: values.new_password,
    });
  };

  return (
    <>
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Configurações</h1>
          <p className="page-subtitle">
            Gerencie as configurações da sua NavalhIA
          </p>
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
              <h3 className="font-medium text-foreground">Dados da NavalhIA</h3>
              <p className="text-sm text-muted-foreground">
                Nome, endereço e informações de contato
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>

          {isPremium && (
            <button
              type="button"
              className="w-full stat-card flex items-center gap-4 text-left transition-colors hover:border-accent/50"
              onClick={() => setUnitsOpen(true)}
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-medium text-foreground">
                  Unidades (filiais)
                </h3>
                <p className="text-sm text-muted-foreground">
                  Gerencie e adicione novas unidades da sua conta.
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
          )}

          {settingsSections
            .filter((s) => s.id !== "business")
            .map((section) => {
              const isProOnly =
                section.id === "whatsapp" && !canUseWhatsAppAndNotifications;
              const handleClick =
                section.id === "hours"
                  ? openHours
                  : section.id === "booking"
                    ? openBooking
                    : section.id === "security"
                      ? () => setSecurityOpen(true)
                      : section.id === "whatsapp"
                        ? canUseWhatsAppAndNotifications
                          ? () => setWhatsappOpen(true)
                          : () => setShowUpgradeModal(true)
                        : section.id === "payments"
                          ? () => setPaymentsOpen(true)
                          : undefined;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`w-full stat-card flex items-center gap-4 text-left transition-colors ${section.id === "hours" || section.id === "booking" || section.id === "security" || section.id === "whatsapp" || section.id === "payments" ? "hover:border-accent/50" : "opacity-90"}`}
                  onClick={handleClick}
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <section.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 text-left">
                    <h3 className="font-medium text-foreground">
                      {section.title}
                      {isProOnly && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-primary">
                          <Lock className="h-3 w-3" />
                          (Plano Profissional)
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {section.description}
                    </p>
                    {section.id !== "hours" &&
                      section.id !== "booking" &&
                      section.id !== "security" &&
                      section.id !== "whatsapp" &&
                      section.id !== "payments" && (
                        <p className="text-xs text-muted-foreground/80 mt-1">
                          Em breve.
                        </p>
                      )}
                  </div>
                  {isProOnly ? (
                    <Lock className="w-5 h-5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>
              );
            })}
        </div>

        <div className="mt-12 max-w-3xl">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Zona de Perigo
          </h2>
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
        title="Dados da NavalhIA"
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
          <LoadingState />
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmitBusiness)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Nome <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Nome da NavalhIA" {...field} />
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
                        placeholder="contato@navalhia.com.br"
                        {...field}
                      />
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
                      <Textarea
                        placeholder="Endereço completo"
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
        )}
      </EntityFormDialog>

      <Dialog open={unitsOpen} onOpenChange={setUnitsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unidades (filiais)</DialogTitle>
            <DialogDescription>
              Suas unidades. Use o seletor no menu para trocar de unidade.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(profile?.barbershops ?? []).map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium text-foreground">
                    {b.name || "Unidade"}
                  </p>
                  {b.slug && (
                    <p className="text-xs text-muted-foreground">
                      /b/{b.slug}
                    </p>
                  )}
                </div>
                {b.id === profile?.barbershop_id && (
                  <span className="text-xs text-muted-foreground">Em uso</span>
                )}
                {b.id !== profile?.barbershop_id && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setUnitsOpen(false);
                      await switchBarbershop(b.id);
                    }}
                  >
                    Usar esta unidade
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              className="w-full"
              onClick={() => setNewUnitModalOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Nova unidade
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <EntityFormDialog
        open={newUnitModalOpen}
        onOpenChange={setNewUnitModalOpen}
        title="Nova unidade"
        description="Crie uma nova filial na sua conta. O slug será usado no link de agendamento (/b/slug)."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setNewUnitModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={newUnitForm.handleSubmit(onSubmitNewUnit)}
              disabled={createBranchMutation.isPending}
            >
              Criar unidade
            </Button>
          </>
        }
      >
        <Form {...newUnitForm}>
          <form
            onSubmit={newUnitForm.handleSubmit(onSubmitNewUnit)}
            className="space-y-4"
          >
            <FormField
              control={newUnitForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Nome <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Unidade Centro" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={newUnitForm.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex: centro (link: /b/centro)"
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
            <Button
              onClick={onSubmitBooking}
              disabled={patchMutation.isPending || !slugValid}
            >
              Salvar slug
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="booking-link" className="text-sm font-medium">
              Link público
            </Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="booking-link"
                readOnly
                value={bookingLink}
                className="font-mono text-sm"
              />
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      bookingLink &&
                      window.open(bookingLink, "_blank", "noopener,noreferrer")
                    }
                    disabled={!bookingLink}
                    aria-label="Abrir link em nova aba"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="z-[100]">
                  Abrir link
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div>
            <Label htmlFor="slug-edit" className="text-sm font-medium">
              Slug (parte do link)
            </Label>
            <Input
              id="slug-edit"
              value={slugEdit}
              onChange={(e) =>
                setSlugEdit(
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                )
              }
              placeholder="minha-navalhia"
              className="mt-1 font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Apenas letras minúsculas, números e hífens (2–80 caracteres).
            </p>
          </div>
        </div>
      </EntityFormDialog>

      <PaymentsCommissionsModal
        open={paymentsOpen}
        onOpenChange={setPaymentsOpen}
        onGoToBarbeiros={() => {
          setPaymentsOpen(false);
          navigate("/app/barbeiros");
        }}
      />

      <EntityFormDialog
        open={hoursOpen}
        onOpenChange={(open) => {
          setHoursOpen(open);
          if (!open) {
            setClosureFormOpen(false);
            setEditingClosure(null);
          }
        }}
        title="Horário de Funcionamento"
        description="Configure os dias, horários e exceções (feriados, fechamentos)."
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
        <div className="space-y-0 min-w-0">
          {DAY_LABELS.map(({ key, label }) => {
            const day = hoursState[key];
            const isOpen =
              day &&
              typeof day === "object" &&
              day.start != null &&
              day.end != null;
            return (
              <div
                key={key}
                className="flex min-h-[52px] flex-wrap items-center gap-3 border-b border-border py-3 last:border-0"
              >
                <div className="w-24 shrink-0 font-medium text-foreground">
                  {label}
                </div>
                <Checkbox
                  id={`hours-${key}`}
                  checked={!!isOpen}
                  onCheckedChange={(checked) => {
                    if (checked)
                      setDayHours(key, { start: "09:00", end: "18:00" });
                    else setDayHours(key, null);
                  }}
                  className="border-green-600 data-[state=checked]:bg-green-600 data-[state=checked]:text-white shrink-0"
                />
                <label
                  htmlFor={`hours-${key}`}
                  className="shrink-0 cursor-pointer text-sm"
                >
                  Aberto
                </label>
                {isOpen && day && (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-0 sm:flex-nowrap">
                    <Input
                      type="time"
                      value={day.start}
                      onChange={(e) =>
                        setDayHours(key, { ...day, start: e.target.value })
                      }
                      className="h-8 min-w-0 flex-1 sm:w-28 sm:flex-none sm:min-w-[7rem]"
                    />
                    <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                      até
                    </span>
                    <Input
                      type="time"
                      value={day.end}
                      onChange={(e) =>
                        setDayHours(key, { ...day, end: e.target.value })
                      }
                      className="h-8 min-w-0 flex-1 sm:w-28 sm:flex-none sm:min-w-[7rem]"
                    />
                  </div>
                )}
                {!isOpen && (
                  <span className="text-sm text-muted-foreground">Fechado</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <CalendarX className="h-4 w-4" />
            Exceções de funcionamento
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Feriados e fechamentos inesperados. O atendente de WhatsApp usa
            essas datas para não sugerir horários.
          </p>
          {closuresLoading ? (
            <LoadingState />
          ) : closuresList.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              Nenhuma exceção. Clique em &quot;Adicionar exceção&quot; para
              feriados ou dias de fechamento.
            </p>
          ) : (
            <ul className="space-y-2 max-h-48 overflow-y-auto mb-3">
              {closuresList.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium">{c.closure_date}</span>
                    <span className="text-muted-foreground ml-2">
                      {c.status === "closed" ? "Fechado" : "Aberto parcial"}
                      {c.reason ? ` · ${c.reason}` : ""}
                    </span>
                    {c.status === "open_partial" &&
                      c.start_time != null &&
                      c.end_time != null && (
                        <span className="text-muted-foreground block text-xs">
                          {String(c.start_time).slice(0, 5)} –{" "}
                          {String(c.end_time).slice(0, 5)}
                        </span>
                      )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openClosureForm(c)}
                      aria-label="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (window.confirm("Remover esta exceção?"))
                          deleteClosureMutation.mutate(c.id);
                      }}
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openClosureForm()}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Adicionar exceção
          </Button>
        </div>
      </EntityFormDialog>

      <EntityFormDialog
        open={closureFormOpen}
        onOpenChange={(open) => {
          setClosureFormOpen(open);
          if (!open) setEditingClosure(null);
        }}
        title={editingClosure ? "Editar exceção" : "Adicionar exceção"}
        description={
          editingClosure
            ? "Altere status, horário ou motivo."
            : "Informe a data e se estará fechado ou com horário reduzido."
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setClosureFormOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={closureForm.handleSubmit(onSubmitClosureForm)}
              disabled={
                createClosureMutation.isPending ||
                updateClosureMutation.isPending
              }
            >
              {editingClosure ? "Salvar" : "Adicionar"}
            </Button>
          </>
        }
      >
        <Form {...closureForm}>
          <form
            onSubmit={closureForm.handleSubmit(onSubmitClosureForm)}
            className="space-y-4"
          >
            {!editingClosure && (
              <FormField
                control={closureForm.control}
                name="closure_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {editingClosure && (
              <div className="text-sm text-muted-foreground">
                Data: <strong>{editingClosure.closure_date}</strong> (não
                editável)
              </div>
            )}
            <FormField
              control={closureForm.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={field.value}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value as "closed" | "open_partial",
                      )
                    }
                  >
                    <option value="closed">Fechado (dia todo)</option>
                    <option value="open_partial">
                      Aberto parcial (informe horário abaixo)
                    </option>
                  </select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {closureForm.watch("status") === "open_partial" && (
              <>
                <FormField
                  control={closureForm.control}
                  name="start_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Das (horário)</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={closureForm.control}
                  name="end_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Até (horário)</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
            <FormField
              control={closureForm.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex: Feriado, reforma"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </EntityFormDialog>

      <WhatsAppSetupStepperModal
        open={whatsappOpen}
        onOpenChange={(open) => {
          setWhatsappOpen(open);
          if (!open) {
            setWebhookWarning("");
            setTestTo("");
            setTestText("");
          }
        }}
        onOpenHours={() => {
          setWhatsappOpen(false);
          setHoursOpen(true);
        }}
        whatsappConnected={!!(whatsappConnection?.connected || whatsappStatusQuery.data?.connected)}
        canUseWhatsApp={canUseWhatsAppAndNotifications}
        connectStepContent={
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
            onOpenBillingPortal={canUseWhatsAppAndNotifications ? handleOpenBillingPortal : undefined}
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
          />
        }
      />

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
            <Button
              onClick={passwordForm.handleSubmit(onSubmitPassword)}
              disabled={changePasswordMutation.isPending}
            >
              Alterar senha
            </Button>
          </>
        }
      >
        <Form {...passwordForm}>
          <form
            onSubmit={passwordForm.handleSubmit(onSubmitPassword)}
            className="space-y-4"
          >
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
                    <Input
                      type="password"
                      placeholder="Mínimo 8 caracteres"
                      autoComplete="new-password"
                      {...field}
                    />
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
                    <Input
                      type="password"
                      placeholder="Repita a nova senha"
                      autoComplete="new-password"
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

      <CheckoutModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        initialPlan="pro"
      />
    </>
  );
}
