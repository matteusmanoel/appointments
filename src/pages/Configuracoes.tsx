import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
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
  BookOpen,
  HelpCircle,
  FileCode2,
} from "lucide-react";
import {
  accountApi,
  authApi,
  barbershopsApi,
  billingApi,
  integrationsApi,
  reportsApi,
  getDefaultBusinessHours,
  type BusinessHours,
  type BarbershopClosure,
} from "@/lib/api";
import { formatPhoneBR, parsePhoneBR } from "@/lib/input-masks";
import { ConfirmDialog, EntityFormDialog } from "@/components/shared";
import { LoadingState } from "@/components/LoadingState";
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
import { ptBR } from "date-fns/locale";
import { DatePicker } from "@/components/ui/date-picker";
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
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  pix_key: z.string().max(150).optional(),
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

/** Safe format for closure_date; avoids "Invalid time value" when date is invalid. */
function formatClosureDateSafe(closureDate: string | null | undefined): string {
  if (closureDate == null || closureDate === "") return "—";
  try {
    const dateOnly = closureDate.includes("T") ? closureDate.slice(0, 10) : closureDate.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return closureDate.slice(0, 10) || "—";
    const d = new Date(dateOnly + "T12:00:00");
    if (Number.isNaN(d.getTime())) return dateOnly;
    return format(d, "d MMM yyyy", { locale: ptBR });
  } catch {
    return closureDate.slice(0, 10) || "—";
  }
}

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
      description="
          Configure a porcentagem de comissão de cada barbeiro em Barbeiros. A
          comissão é calculada sobre o valor do agendamento e exibida no
          relatório e no modal do agendamento."
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
  const [deleteBarbershopConfirmOpen, setDeleteBarbershopConfirmOpen] =
    useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [closureFormOpen, setClosureFormOpen] = useState(false);
  const [editingClosure, setEditingClosure] =
    useState<BarbershopClosure | null>(null);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [hoursState, setHoursState] = useState<BusinessHours>(
    getDefaultBusinessHours(),
  );
  const [linkCopied, setLinkCopied] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showUnitsUpgradeModal, setShowUnitsUpgradeModal] = useState(false);

  const { profile, refetchProfile, switchBarbershop, logout } = useAuth();

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

  type BarbershopPatchPayload = Parameters<typeof barbershopsApi.patch>[0];

  const patchMutation = useMutation({
    mutationFn: (body: BarbershopPatchPayload) => barbershopsApi.patch(body),
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
      unavailability_intervals?: {
        start: string;
        end: string;
        reason?: string;
      }[];
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
        unavailability_intervals?: {
          start: string;
          end: string;
          reason?: string;
        }[];
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

  const unavailabilityIntervalSchema = z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/, "HH:mm"),
    end: z.string().regex(/^\d{2}:\d{2}$/, "HH:mm"),
    reason: z.string().max(200).optional(),
  });
  const closureFormSchema = z.object({
    closure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data yyyy-MM-dd"),
    status: z.enum(["closed", "open_partial"]),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    reason: z.string().max(500).optional(),
    unavailability_intervals: z.array(unavailabilityIntervalSchema).optional(),
  });
  type ClosureFormValues = z.infer<typeof closureFormSchema>;
  const closureFormDefault: ClosureFormValues = {
    closure_date: new Date().toISOString().slice(0, 10),
    status: "closed",
    start_time: "",
    end_time: "",
    reason: "",
    unavailability_intervals: [],
  };
  const closureForm = useForm<ClosureFormValues>({
    resolver: zodResolver(closureFormSchema),
    defaultValues: closureFormDefault,
  });

  const closureIntervals = useFieldArray({
    control: closureForm.control,
    name: "unavailability_intervals",
  });

  useEffect(() => {
    if (closureFormOpen && editingClosure) {
      closureForm.reset({
        closure_date: editingClosure.closure_date,
        status: editingClosure.status,
        start_time: editingClosure.start_time?.slice(0, 5) ?? "",
        end_time: editingClosure.end_time?.slice(0, 5) ?? "",
        reason: editingClosure.reason ?? "",
        unavailability_intervals:
          (editingClosure.unavailability_intervals?.length ?? 0) > 0
            ? editingClosure.unavailability_intervals!.map((i) => ({
                start: i.start?.slice(0, 5) ?? "12:00",
                end: i.end?.slice(0, 5) ?? "13:00",
                reason: i.reason ?? "",
              }))
            : [],
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
    const intervals =
      values.unavailability_intervals
        ?.filter(
          (i) =>
            i.start &&
            i.end &&
            /^\d{2}:\d{2}$/.test(i.start) &&
            /^\d{2}:\d{2}$/.test(i.end),
        )
        .map((i) => ({
          start: i.start,
          end: i.end,
          reason: i.reason || undefined,
        })) ?? [];
    if (editingClosure) {
      updateClosureMutation.mutate({
        id: editingClosure.id,
        body: {
          status: values.status,
          start_time: values.start_time || null,
          end_time: values.end_time || null,
          reason: values.reason || null,
          unavailability_intervals: intervals,
        },
      });
    } else {
      createClosureMutation.mutate({
        closure_date: values.closure_date,
        status: values.status,
        start_time: values.start_time || undefined,
        end_time: values.end_time || undefined,
        reason: values.reason || undefined,
        unavailability_intervals: intervals.length > 0 ? intervals : undefined,
      });
    }
  };

  const newUnitSchema = z.object({
    name: z.string().min(1, "Nome é obrigatório"),
    slug: z
      .string()
      .optional()
      .refine(
        (v) =>
          !v || (v.length >= 2 && v.length <= 80 && /^[a-z0-9-]+$/.test(v)),
        "Slug: apenas letras minúsculas, números e hífens (2–80 caracteres)",
      ),
  });
  type NewUnitFormValues = z.infer<typeof newUnitSchema>;
  const newUnitForm = useForm<NewUnitFormValues>({
    resolver: zodResolver(newUnitSchema),
    defaultValues: { name: "", slug: "" },
  });
  const createBranchMutation = useMutation({
    mutationFn: (body: { name: string; slug?: string }) =>
      barbershopsApi.createBranch(body),
    onSuccess: async (created) => {
      setNewUnitModalOpen(false);
      setUnitsOpen(false);
      newUnitForm.reset({ name: "", slug: "" });
      await refetchProfile();
      await switchBarbershop(created.id);
      toastSuccess("Nova unidade criada. Você está nela agora.");
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao criar unidade"),
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
      latitude: "",
      longitude: "",
    },
  });

  useEffect(() => {
    if (businessOpen && barbershop) {
      form.reset({
        name: barbershop.name ?? "",
        phone: parsePhoneBR(barbershop.phone ?? ""),
        email: barbershop.email ?? "",
        address: barbershop.address ?? "",
        latitude:
          barbershop.latitude != null && !Number.isNaN(barbershop.latitude)
            ? String(barbershop.latitude)
            : "",
        longitude:
          barbershop.longitude != null && !Number.isNaN(barbershop.longitude)
            ? String(barbershop.longitude)
            : "",
        pix_key: (barbershop as Record<string, unknown>).pix_key as string ?? "",
      });
    }
  }, [businessOpen, barbershop, form]);

  const openBusiness = () => setBusinessOpen(true);

  const onSubmitBusiness = async (values: BarbershopFormValues) => {
    const latRaw = values.latitude?.trim().replace(",", ".") ?? "";
    const lngRaw = values.longitude?.trim().replace(",", ".") ?? "";
    if ((latRaw && !lngRaw) || (!latRaw && lngRaw)) {
      toastError("Informe latitude e longitude juntos, ou deixe os dois vazios.");
      return;
    }
    let latitude: number | null | undefined;
    let longitude: number | null | undefined;
    if (latRaw && lngRaw) {
      const lat = parseFloat(latRaw);
      const lng = parseFloat(lngRaw);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        toastError("Latitude inválida (-90 a 90).");
        return;
      }
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        toastError("Longitude inválida (-180 a 180).");
        return;
      }
      latitude = lat;
      longitude = lng;
    } else if (
      barbershop &&
      (barbershop.latitude != null || barbershop.longitude != null)
    ) {
      latitude = null;
      longitude = null;
    }
    const body = {
      name: values.name,
      phone: values.phone,
      email: values.email,
      address: values.address,
      ...(latitude !== undefined ? { latitude, longitude } : {}),
      pix_key: values.pix_key?.trim() || null,
    };
    await withToast(patchMutation.mutateAsync(body), {
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

  const deleteBarbershopMutation = useMutation({
    mutationFn: () => accountApi.deleteBarbershop(),
    onError: (e) => {
      toastError("Não foi possível excluir a unidade.", e);
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: () => accountApi.deleteAccount(),
    onError: (e) => {
      toastError("Não foi possível excluir a conta.", e);
    },
  });

  return (
    <>
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Configurações</h1>
          <p className="page-subtitle">
            Gerencie as configurações da sua NavalhIA
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <button
            type="button"
            className="stat-card flex flex-col items-center gap-3 text-center p-6 hover:border-accent/50 transition-colors"
            onClick={openBusiness}
          >
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Store className="w-8 h-8 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-base text-foreground">
                Dados da NavalhIA
              </h3>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Nome, endereço e informações de contato
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>

          {isPremium ? (
            <button
              type="button"
              className="stat-card flex flex-col items-center gap-3 text-center p-6 transition-colors hover:border-accent/50"
              onClick={() => setUnitsOpen(true)}
            >
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-8 h-8 text-primary" />
              </div>
              <div className="min-w-0 text-center">
                <h3 className="font-semibold text-base text-foreground">
                  Unidades (filiais)
                </h3>
                <p className="text-muted-foreground mt-0.5 text-sm">
                  Gerencie e adicione novas unidades da sua conta.
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
          ) : (
            <button
              type="button"
              className="stat-card flex flex-col items-center gap-3 text-center p-6 transition-colors hover:border-accent/50"
              onClick={() => setShowUnitsUpgradeModal(true)}
            >
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-8 h-8 text-primary" />
              </div>
              <div className="min-w-0 text-center">
                <h3 className="font-semibold text-base text-foreground">
                  Unidades (filiais)
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-primary">
                    <Lock className="h-3 w-3" />
                    (Plano Premium)
                  </span>
                </h3>
                <p className="text-muted-foreground mt-0.5 text-sm">
                  Gerencie e adicione novas unidades da sua conta.
                </p>
              </div>
              <Lock className="w-5 h-5 text-muted-foreground shrink-0" />
            </button>
          )}

          <Link
            to="/app/ajuda/whatsapp"
            className="stat-card flex flex-col items-center gap-3 text-center p-6 hover:border-accent/50 transition-colors no-underline text-foreground"
          >
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <HelpCircle className="w-8 h-8 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-base text-foreground">
                Tutorial WhatsApp
              </h3>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Passo a passo para conectar e configurar o assistente de IA.
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </Link>

          <Link
            to="/docs"
            className="stat-card flex flex-col items-center gap-3 text-center p-6 hover:border-accent/50 transition-colors no-underline text-foreground"
          >
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <FileCode2 className="w-8 h-8 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-base text-foreground">
                Documentação da API
              </h3>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Referência dos endpoints para integrações e desenvolvedores.
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </Link>

          {settingsSections
            .filter((s) => s.id !== "business")
            .map((section) => {
              const isProOnly =
                section.id === "whatsapp" && !canUseWhatsAppAndNotifications;
              const handleClick =
                section.id === "hours"
                  ? () => navigate("/app/integracoes?step=hours")
                  : section.id === "booking"
                    ? openBooking
                    : section.id === "security"
                      ? () => setSecurityOpen(true)
                      : section.id === "whatsapp"
                        ? canUseWhatsAppAndNotifications
                          ? () => navigate("/app/integracoes")
                          : () => setShowUpgradeModal(true)
                        : section.id === "payments"
                          ? () => setPaymentsOpen(true)
                          : undefined;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`stat-card flex flex-col items-center gap-3 text-center p-6 transition-colors ${section.id === "hours" || section.id === "booking" || section.id === "security" || section.id === "whatsapp" || section.id === "payments" ? "hover:border-accent/50" : "opacity-90"}`}
                  onClick={handleClick}
                >
                  <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <section.icon className="w-8 h-8 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0 text-center">
                    <h3 className="font-semibold text-base text-foreground">
                      {section.title}
                      {isProOnly && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-primary">
                          <Lock className="h-3 w-3" />
                          (Plano Profissional)
                        </span>
                      )}
                    </h3>
                    <p className="text-muted-foreground mt-0.5 text-sm">
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

        <div className="mt-12 max-w-3xl space-y-4">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Zona de Perigo
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="stat-card border-destructive/20">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="font-medium text-foreground">
                    Excluir unidade (filial)
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Remove esta barbearia e todos os dados vinculados a ela.
                    Irreversível.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteBarbershopConfirmOpen(true)}
                >
                  Excluir unidade
                </Button>
              </div>
            </div>
            <div className="stat-card border-destructive/20">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="font-medium text-foreground">
                    Excluir conta inteira
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Remove todas as filiais, assinatura e dados da conta. Apenas o
                    dono da conta pode fazer isso.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteAccountConfirmOpen(true)}
                >
                  Excluir conta
                </Button>
              </div>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="latitude"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Latitude</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="-23.5616"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Coordenadas do Google Maps; usadas para enviar o pin da
                        barbearia no WhatsApp.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="longitude"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Longitude</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="-46.6562"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="pix_key"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chave PIX</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground mt-1">
                      Usada para cobranças recorrentes de planos via WhatsApp.
                    </p>
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
                    <p className="text-xs text-muted-foreground">/b/{b.slug}</p>
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
          <p className="text-sm text-muted-foreground mb-4">
            Você também pode configurar horários e exceções na página{" "}
            <Link
              to="/app/integracoes?step=hours"
              className="text-primary font-medium underline underline-offset-2 hover:no-underline"
              onClick={() => setHoursOpen(false)}
            >
              Integrações
            </Link>
            .
          </p>
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
                    <span className="font-medium" title={c.closure_date}>
                      {formatClosureDateSafe(c.closure_date)}
                    </span>
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
                      <DatePicker
                        value={
                          field.value && /^\d{4}-\d{2}-\d{2}$/.test(field.value)
                            ? new Date(field.value + "T12:00:00")
                            : null
                        }
                        onChange={(d) =>
                          d && field.onChange(format(d, "yyyy-MM-dd"))
                        }
                        placeholder="Selecione a data"
                        triggerVariant="compact"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {editingClosure && (
              <div className="text-sm text-muted-foreground">
                Data:{" "}
                <strong title={editingClosure.closure_date}>
                  {formatClosureDateSafe(editingClosure.closure_date)}
                </strong>{" "}
                (não editável)
              </div>
            )}
            <FormField
              control={closureForm.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) =>
                      field.onChange(v as "closed" | "open_partial")
                    }
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="closed">Fechado (dia todo)</SelectItem>
                      <SelectItem value="open_partial">
                        Aberto parcial (informe horário abaixo)
                      </SelectItem>
                    </SelectContent>
                  </Select>
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
            {closureForm.watch("status") === "open_partial" && (
              <div className="space-y-2">
                <Label>Intervalos de indisponibilidade (ex.: almoço)</Label>
                <p className="text-xs text-muted-foreground">
                  Bloqueie horários dentro do expediente em que não há
                  atendimento.
                </p>
                {closureIntervals.fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
                  >
                    <Input
                      type="time"
                      className="w-[100px]"
                      {...closureForm.register(
                        `unavailability_intervals.${index}.start`,
                      )}
                    />
                    <span className="text-muted-foreground">até</span>
                    <Input
                      type="time"
                      className="w-[100px]"
                      {...closureForm.register(
                        `unavailability_intervals.${index}.end`,
                      )}
                    />
                    <Input
                      placeholder="Motivo (opcional)"
                      className="flex-1 min-w-[120px]"
                      {...closureForm.register(
                        `unavailability_intervals.${index}.reason`,
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => closureIntervals.remove(index)}
                      aria-label="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    closureIntervals.append({
                      start: "12:00",
                      end: "13:00",
                      reason: "",
                    })
                  }
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Adicionar intervalo
                </Button>
              </div>
            )}
          </form>
        </Form>
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
        open={deleteBarbershopConfirmOpen}
        onOpenChange={setDeleteBarbershopConfirmOpen}
        title="Excluir unidade (filial)"
        description="Todos os dados desta barbearia (agendamentos, clientes, barbeiros, serviços, configurações) serão apagados de forma permanente. Não é possível desfazer."
        confirmLabel="Excluir unidade"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={async () => {
          try {
            const data = await deleteBarbershopMutation.mutateAsync(undefined);
            setDeleteBarbershopConfirmOpen(false);
            if ("switch_to" in data && data.switch_to) {
              await switchBarbershop(data.switch_to);
              queryClient.invalidateQueries();
              navigate("/app/configuracoes", { replace: true });
            } else {
              logout();
              navigate("/login", { replace: true });
            }
          } catch {
            // Error already handled by mutation onError
          }
        }}
      />
      <ConfirmDialog
        open={deleteAccountConfirmOpen}
        onOpenChange={setDeleteAccountConfirmOpen}
        title="Excluir conta inteira"
        description="Todas as filiais, assinaturas e dados da sua conta serão apagados de forma permanente. Apenas o dono da conta pode fazer isso. Não é possível desfazer."
        confirmLabel="Excluir conta"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={async () => {
          try {
            await deleteAccountMutation.mutateAsync(undefined);
            setDeleteAccountConfirmOpen(false);
            logout();
            navigate("/login", { replace: true });
          } catch {
            // Error already handled by mutation onError
          }
        }}
      />

      <CheckoutModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        initialPlan="pro"
      />
      <CheckoutModal
        open={showUnitsUpgradeModal}
        onOpenChange={setShowUnitsUpgradeModal}
        initialPlan="premium"
      />
    </>
  );
}
