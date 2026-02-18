import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { addDays, subDays, format, startOfWeek, endOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import {
  Calendar as CalendarIcon,
  Plus,
  ChevronLeft,
  ChevronRight,
  Scissors,
  Phone,
  MessageCircle,
} from "lucide-react";
import {
  appointmentsApi,
  barbersApi,
  barbershopsApi,
  clientsApi,
  servicesApi,
  type AppointmentListItem,
  serviceLabel,
} from "@/lib/api";
import { getTimeSlotsForDay } from "@/lib/slots";
import {
  ConfirmDialog,
  EntityActionsMenu,
  EntityFormDialog,
} from "@/components/shared";
import { toastError, toastSuccess } from "@/lib/toast-helpers";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { formatPhoneBR } from "@/lib/input-masks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { List, LayoutGrid } from "lucide-react";

const TIME_SLOTS = [
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
];

const BARBER_COLORS = [
  "bg-accent",
  "bg-info",
  "bg-warning",
  "bg-chart-4",
] as const;

type Appointment = AppointmentListItem;

const appointmentFormSchema = z.object({
  client_id: z.string().min(1, "Selecione o cliente"),
  barber_id: z.string().min(1, "Selecione o barbeiro"),
  service_id: z.string().optional(),
  service_ids: z.array(z.string()).min(1, "Selecione ao menos um serviço"),
  scheduled_date: z.string(),
  scheduled_time: z.string().min(1, "Horário obrigatório"),
  notes: z.string().optional(),
  status: z
    .enum(["pending", "confirmed", "completed", "cancelled", "no_show"])
    .optional(),
  price: z.number().min(0).optional(),
});

type AppointmentFormValues = z.infer<typeof appointmentFormSchema>;

export default function Agendamentos() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
   const [searchParams, setSearchParams] = useSearchParams();
  const initialView = (searchParams.get("view") === "lista" ? "lista" : "grade") as
    | "grade"
    | "lista";
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const barberParam = searchParams.get("barber_id") ?? "__all__";
  const statusParam = searchParams.get("status") ?? "__all__";
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [slotForCreate, setSlotForCreate] = useState<{
    time: string;
    barberId: string;
  } | null>(null);
  const [editingAppointment, setEditingAppointment] =
    useState<Appointment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [viewMode, setViewMode] = useState<"grade" | "lista">(initialView);
  const [listRange, setListRange] = useState<{ from: Date | null; to: Date | null }>(() => {
    if (fromParam && toParam) {
      const fromDate = new Date(fromParam + "T12:00:00");
      const toDate = new Date(toParam + "T12:00:00");
      if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime())) {
        return { from: fromDate, to: toDate };
      }
    }
    const today = new Date();
    return {
      from: startOfWeek(today, { weekStartsOn: 0 }),
      to: endOfWeek(today, { weekStartsOn: 0 }),
    };
  });
  const [listBarberId, setListBarberId] = useState<string>(barberParam || "__all__");
  const [listStatus, setListStatus] = useState<string>(statusParam || "__all__");

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const listFromStr = listRange?.from ? format(listRange.from, "yyyy-MM-dd") : undefined;
  const listToStr = listRange?.to ? format(listRange.to, "yyyy-MM-dd") : undefined;

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("view", viewMode);
    if (listFromStr && listToStr) {
      params.set("from", listFromStr);
      params.set("to", listToStr);
    }
    if (listBarberId && listBarberId !== "__all__") {
      params.set("barber_id", listBarberId);
    }
    if (listStatus && listStatus !== "__all__") {
      params.set("status", listStatus);
    }
    setSearchParams(params);
  }, [viewMode, listFromStr, listToStr, listBarberId, listStatus, setSearchParams]);

  const resetListFilters = () => {
    const today = new Date();
    setListRange({
      from: startOfWeek(today, { weekStartsOn: 0 }),
      to: endOfWeek(today, { weekStartsOn: 0 }),
    });
    setListBarberId("__all__");
    setListStatus("__all__");
  };

  const { data: barbers = [] } = useQuery({
    queryKey: ["barbers"],
    queryFn: () => barbersApi.list(),
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["appointments", dateStr],
    queryFn: () => appointmentsApi.list({ date: dateStr }),
    enabled: viewMode === "grade",
  });

  const { data: listAppointments = [], isLoading: listLoading } = useQuery({
    queryKey: ["appointments", "list", listFromStr, listToStr, listBarberId || null, listStatus || null],
    queryFn: () =>
      appointmentsApi.list({
        from: listFromStr,
        to: listToStr,
        barber_id: listBarberId && listBarberId !== "__all__" ? listBarberId : undefined,
        status: listStatus && listStatus !== "__all__" ? listStatus : undefined,
      }),
    enabled: viewMode === "lista" && !!listFromStr && !!listToStr,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => clientsApi.list(),
  });

  const { data: services = [] } = useQuery({
    queryKey: ["services"],
    queryFn: () => servicesApi.list(),
  });

  const { data: barbershop } = useQuery({
    queryKey: ["barbershop"],
    queryFn: () => barbershopsApi.get(),
  });

  const timeSlots = getTimeSlotsForDay(
    barbershop?.business_hours,
    selectedDate,
  );
  const slotsToShow = timeSlots.length > 0 ? timeSlots : TIME_SLOTS;

  const form = useForm<AppointmentFormValues>({
    resolver: zodResolver(appointmentFormSchema),
    defaultValues: {
      client_id: "",
      barber_id: "",
      service_id: "",
      service_ids: [],
      scheduled_date: dateStr,
      scheduled_time: "",
      notes: "",
      status: "confirmed",
      price: 0,
    },
  });

  const editDateStr = form.watch("scheduled_date");
  const editBarberId = form.watch("barber_id");
  const { data: editDayAppointments = [] } = useQuery({
    queryKey: ["appointments", editDateStr],
    queryFn: () => appointmentsApi.list({ date: editDateStr }),
    enabled: !!editingAppointment && !!editDateStr,
  });

  const createMutation = useMutation({
    mutationFn: async (body: AppointmentFormValues) => {
      const ids = body.service_ids ?? [];
      await appointmentsApi.create({
        client_id: body.client_id,
        barber_id: body.barber_id,
        service_ids: ids,
        scheduled_date: body.scheduled_date,
        scheduled_time: (body.scheduled_time ?? "00:00").slice(0, 5),
        notes: body.notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      setFormOpen(false);
      setSlotForCreate(null);
    },
  });

  const   updateMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        status?: string;
        scheduled_date?: string;
        scheduled_time?: string;
        notes?: string;
        price?: number;
        service_ids?: string[];
      };
    }) => appointmentsApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      setFormOpen(false);
      setEditingAppointment(null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => appointmentsApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      setCancelTarget(null);
    },
  });

  const normalizeTime = (t: string) => t.slice(0, 5);

  const getAppointmentForSlot = (time: string, barberId: string) => {
    const t = normalizeTime(time);
    return appointments.find(
      (apt) =>
        normalizeTime(apt.scheduled_time) === t && apt.barber_id === barberId,
    ) as Appointment | undefined;
  };

  const isSlotOccupiedByAppointment = (time: string, barberId: string) => {
    const slotMins = (() => {
      const [h, m] = time.split(":").map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    })();
    return appointments.some((apt) => {
      if (apt.barber_id !== barberId) return false;
      const [h, m] = apt.scheduled_time.split(":").map(Number);
      const startMins = (h ?? 0) * 60 + (m ?? 0);
      const endMins = startMins + apt.duration_minutes;
      return slotMins >= startMins && slotMins < endMins;
    });
  };

  const editSlotsToShow = (() => {
    if (!editDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(editDateStr))
      return TIME_SLOTS;
    const d = new Date(editDateStr + "T12:00:00");
    const slots = getTimeSlotsForDay(barbershop?.business_hours, d);
    return slots.length > 0 ? slots : TIME_SLOTS;
  })();

  const isEditTimeAvailable = (time: string) => {
    if (!editingAppointment) return true;
    if (!editBarberId) return false;
    const [h, m] = time.split(":").map(Number);
    const startMins = (h ?? 0) * 60 + (m ?? 0);
    const endMins = startMins + (editingAppointment.duration_minutes ?? 30);
    return !editDayAppointments.some((apt) => {
      if (apt.id === editingAppointment.id) return false;
      if (apt.status === "cancelled") return false;
      if (apt.barber_id !== editBarberId) return false;
      const [ah, am] = String(apt.scheduled_time)
        .slice(0, 5)
        .split(":")
        .map(Number);
      const aStart = (ah ?? 0) * 60 + (am ?? 0);
      const aEnd = aStart + (apt.duration_minutes ?? 30);
      return startMins < aEnd && endMins > aStart;
    });
  };

  const openCreate = (time: string, barberId: string) => {
    setEditingAppointment(null);
    setSlotForCreate({ time, barberId });
    form.reset({
      client_id: "",
      barber_id: barberId,
      service_id: "",
      service_ids: [],
      scheduled_date: dateStr,
      scheduled_time: time,
      notes: "",
      status: "confirmed",
      price: 0,
    });
    setFormOpen(true);
  };

  const openCreateFromButton = () => {
    setEditingAppointment(null);
    setSlotForCreate(null);
    form.reset({
      client_id: "",
      barber_id: barbers[0]?.id ?? "",
      service_id: "",
      service_ids: [],
      scheduled_date: dateStr,
      scheduled_time: slotsToShow[0] ?? "",
      notes: "",
      status: "confirmed",
      price: 0,
    });
    setFormOpen(true);
  };

  const normDate = (d: string | undefined) => (d ? String(d).slice(0, 10) : "");
  const normTime = (t: string | undefined) => (t ? String(t).slice(0, 5) : "");

  const getClientWhatsAppUrl = (
    phone: string | undefined,
    message?: string,
  ) => {
    const digits = String(phone ?? "").replace(/\D/g, "");
    if (!digits) return "#";
    const number = digits.startsWith("55") ? digits : `55${digits}`;
    if (!message || !message.trim()) return `https://wa.me/${number}`;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  };

  const openEdit = (apt: Appointment) => {
    setSlotForCreate(null);
    setEditingAppointment(apt);
    const ids = apt.service_ids?.length ? apt.service_ids : (apt.service_id ? [apt.service_id] : []);
    form.reset({
      client_id: apt.client_id,
      barber_id: apt.barber_id,
      service_id: ids[0] ?? "",
      service_ids: ids,
      scheduled_date: normDate(apt.scheduled_date),
      scheduled_time: normTime(apt.scheduled_time),
      notes: "",
      status: (apt.status as AppointmentFormValues["status"]) || "confirmed",
      price: Number(apt.price) || 0,
    });
    setFormOpen(true);
  };

  useEffect(() => {
    const apt = location.state?.editAppointment as Appointment | undefined;
    if (apt) {
      setSlotForCreate(null);
      setEditingAppointment(apt);
      const ids = apt.service_ids?.length ? apt.service_ids : (apt.service_id ? [apt.service_id] : []);
      form.reset({
        client_id: apt.client_id,
        barber_id: apt.barber_id,
        service_id: ids[0] ?? "",
        service_ids: ids,
        scheduled_date: normDate(apt.scheduled_date),
        scheduled_time: normTime(apt.scheduled_time),
        notes: "",
        status: (apt.status as AppointmentFormValues["status"]) || "confirmed",
        price: Number(apt.price) || 0,
      });
      setFormOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, form, navigate]);

  const onSubmit = async (values: AppointmentFormValues) => {
    try {
      if (editingAppointment) {
        const ids = values.service_ids ?? [];
        const origIds = editingAppointment.service_ids?.length
          ? editingAppointment.service_ids
          : editingAppointment.service_id
            ? [editingAppointment.service_id]
            : [];
        const servicesChanged =
          ids.length !== origIds.length || ids.some((id, i) => id !== origIds[i]);
        if (servicesChanged && ids.length > 0) {
          await updateMutation.mutateAsync({
            id: editingAppointment.id,
            body: {
              service_ids: ids,
              status: values.status ?? "confirmed",
              scheduled_date: values.scheduled_date,
              scheduled_time: values.scheduled_time?.slice(0, 5),
              notes: values.notes,
            },
          });
          toastSuccess("Agendamento atualizado.");
        } else {
          await updateMutation.mutateAsync({
            id: editingAppointment.id,
            body: {
              status: values.status ?? "confirmed",
              scheduled_date: values.scheduled_date,
              scheduled_time: values.scheduled_time?.slice(0, 5),
              notes: values.notes,
            },
          });
          toastSuccess("Agendamento atualizado.");
        }
      } else {
        await createMutation.mutateAsync(values);
        toastSuccess("Agendamento criado.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("Horário já ocupado") || msg.includes("já ocupado")) {
        toastError(
          "Horário já ocupado para este barbeiro",
          e,
          "Escolha outro horário ou outro barbeiro.",
        );
      } else {
        toastError(
          editingAppointment
            ? "Erro ao atualizar agendamento."
            : "Erro ao criar agendamento.",
          e,
        );
      }
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync(cancelTarget.id);
    } catch (e) {
      toastError("Erro ao cancelar agendamento.", e);
    }
  };

  const formatDate = (date: Date) =>
    date.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

  return (
    <MainLayout>
      <div className="animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="page-header mb-0">
            <h1 className="page-title">Agendamentos</h1>
            <p className="page-subtitle">Gerencie sua agenda de atendimentos</p>
          </div>
          <Button
            className="btn-accent w-fit"
            onClick={openCreateFromButton}
            aria-label="Novo agendamento"
          >
            <Plus className="w-4 h-4 mr-2" />
            Novo Agendamento
          </Button>
        </div>

        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "grade" | "lista")} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="grade" className="gap-2">
              <LayoutGrid className="w-4 h-4" />
              Grade
            </TabsTrigger>
            <TabsTrigger value="lista" className="gap-2">
              <List className="w-4 h-4" />
              Lista
            </TabsTrigger>
          </TabsList>

          <TabsContent value="grade" className="mt-0">
        <div className="stat-card mb-6 shadow-none hover:shadow-none hover:translate-y-0">
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              onClick={() => setSelectedDate((d) => subDays(d, 1))}
              aria-label="Dia anterior"
            >
              <ChevronLeft className="w-5 h-5 text-muted-foreground" />
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted transition-colors"
                  aria-label="Escolher data"
                >
                  <CalendarIcon className="w-5 h-5 text-accent" />
                  <span className="text-lg font-medium capitalize">
                    {formatDate(selectedDate)}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="center">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(d) => d && setSelectedDate(d)}
                />
              </PopoverContent>
            </Popover>
            <button
              type="button"
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              onClick={() => setSelectedDate((d) => addDays(d, 1))}
              aria-label="Próximo dia"
            >
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {isLoading && (
          <p className="text-sm text-muted-foreground mb-4">
            Carregando agenda...
          </p>
        )}
        {!isLoading && timeSlots.length === 0 && (
          <div className="stat-card shadow-none hover:shadow-none hover:translate-y-0">
            <p className="text-sm text-muted-foreground">
              Barbearia fechada neste dia.
            </p>
          </div>
        )}
        {!isLoading && timeSlots.length > 0 && (
          <div className="stat-card overflow-hidden shadow-none hover:shadow-none hover:translate-y-0">
            <div
              className="grid gap-2 mb-4 pb-4 border-b border-border"
              style={{
                gridTemplateColumns: `80px repeat(${barbers.length}, 1fr)`,
              }}
            >
              <div className="text-sm font-medium text-muted-foreground">
                Horário
              </div>
              {barbers.map((barber, i) => (
                <div key={barber.id} className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${BARBER_COLORS[i % BARBER_COLORS.length]}`}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {barber.name}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-1 max-h-[600px] overflow-y-auto scrollbar-thin">
              {slotsToShow.map((time) => (
                <div
                  key={time}
                  className="grid gap-2"
                  style={{
                    gridTemplateColumns: `80px repeat(${barbers.length}, 1fr)`,
                  }}
                >
                  <div className="text-sm text-muted-foreground py-3 font-medium">
                    {time}
                  </div>
                  {barbers.map((barber, i) => {
                    const appointment = getAppointmentForSlot(time, barber.id);
                    const occupied = isSlotOccupiedByAppointment(
                      time,
                      barber.id,
                    );
                    const colorClass = BARBER_COLORS[i % BARBER_COLORS.length];
                    if (appointment) {
                      return (
                        <button
                          type="button"
                          key={`${time}-${barber.id}`}
                          onClick={() => openEdit(appointment)}
                          className={`w-full text-left ${colorClass}/10 border-l-4 ${colorClass} rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow`}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium text-foreground text-sm">
                                {appointment.client_name}
                              </p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                <Scissors className="w-3 h-3" />
                                {serviceLabel(appointment.service_names, appointment.service_name)}
                              </p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Phone className="w-3 h-3" />
                                {appointment.client_phone}
                              </p>
                            </div>
                            <span onClick={(e) => e.stopPropagation()}>
                              <EntityActionsMenu
                                onEdit={() => openEdit(appointment)}
                                onDelete={() => setCancelTarget(appointment)}
                                aria-label="Menu do agendamento"
                              />
                            </span>
                          </div>
                        </button>
                      );
                    }
                    if (occupied) {
                      return (
                        <div
                          key={`${time}-${barber.id}`}
                          className="min-h-[52px] rounded-lg bg-muted/30"
                        />
                      );
                    }
                    return (
                      <button
                        type="button"
                        key={`${time}-${barber.id}`}
                        className="rounded-lg border border-dashed border-border hover:border-accent hover:bg-accent/5 transition-colors cursor-pointer min-h-[52px] flex items-center justify-center"
                        onClick={() => openCreate(time, barber.id)}
                        aria-label={`Adicionar agendamento ${time} para ${barber.name}`}
                      >
                        <Plus className="w-4 h-4 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
          </TabsContent>

          <TabsContent value="lista" className="mt-0">
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[200px]">
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Período</label>
                  <DateRangePicker value={listRange} onChange={setListRange} />
                </div>
                <div className="min-w-[160px]">
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Barbeiro</label>
                  <Select value={listBarberId} onValueChange={setListBarberId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos</SelectItem>
                      {barbers.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[140px]">
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Status</label>
                  <Select value={listStatus} onValueChange={setListStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos</SelectItem>
                      <SelectItem value="pending">Pendente</SelectItem>
                      <SelectItem value="confirmed">Confirmado</SelectItem>
                      <SelectItem value="completed">Concluído</SelectItem>
                      <SelectItem value="cancelled">Cancelado</SelectItem>
                      <SelectItem value="no_show">Faltou</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {listLoading ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : listAppointments.length === 0 ? (
                <div className="stat-card flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    {listBarberId !== "__all__" || listStatus !== "__all__"
                      ? "Nenhum agendamento para os filtros selecionados."
                      : "Nenhum agendamento no período."}
                  </p>
                  {(listBarberId !== "__all__" || listStatus !== "__all__") && (
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={resetListFilters}
                      >
                        Limpar filtros
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="stat-card overflow-hidden p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data / Hora</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Barbeiro</TableHead>
                          <TableHead>Serviços</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {listAppointments.map((apt) => (
                          <TableRow key={apt.id}>
                            <TableCell className="whitespace-nowrap">
                              {format(new Date(apt.scheduled_date + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })} {String(apt.scheduled_time).slice(0, 5)}
                            </TableCell>
                            <TableCell>
                              <span className="font-medium">{apt.client_name}</span>
                              {apt.client_phone && (
                                <span className="block text-xs text-muted-foreground">{formatPhoneBR(apt.client_phone)}</span>
                              )}
                            </TableCell>
                            <TableCell>{apt.barber_name}</TableCell>
                            <TableCell>{serviceLabel(apt.service_names, apt.service_name)}</TableCell>
                            <TableCell>
                              <span className={
                                apt.status === "completed" ? "text-success" :
                                apt.status === "cancelled" || apt.status === "no_show" ? "text-muted-foreground" :
                                "text-warning"
                              }>
                                {apt.status === "pending" ? "Pendente" : apt.status === "confirmed" ? "Confirmado" : apt.status === "completed" ? "Concluído" : apt.status === "cancelled" ? "Cancelado" : "Faltou"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-medium">R$ {Number(apt.price).toFixed(2)}</TableCell>
                            <TableCell>
                              <EntityActionsMenu
                                onEdit={() => openEdit(apt)}
                                onDelete={() => setCancelTarget(apt)}
                                aria-label="Menu do agendamento"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <EntityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingAppointment ? "Revisar Agendamento" : "Novo Agendamento"}
        description={
          editingAppointment
            ? "Confira os dados e confirme com o cliente."
            : "Preencha os dados do agendamento."
        }
        contentClassName="sm:max-w-lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={form.handleSubmit(onSubmit)}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingAppointment ? "Salvar" : "Criar"}
            </Button>
          </>
        }
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {editingAppointment && (
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Cliente</p>
                    <p className="font-semibold text-foreground truncate">
                      {editingAppointment.client_name}
                    </p>
                    <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                      <Phone className="h-4 w-4" />
                      {formatPhoneBR(editingAppointment.client_phone)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    asChild
                  >
                    <a
                      href={getClientWhatsAppUrl(
                        editingAppointment.client_phone,
                        [
                          `Salve, ${editingAppointment.client_name}!`,
                          `Aqui é da ${barbershop?.name ?? "barbearia"}.`,
                          "",
                          `Sobre seu agendamento em ${String(editingAppointment.scheduled_date).slice(0, 10)} às ${String(editingAppointment.scheduled_time).slice(0, 5)}.`,
                        ].join("\n"),
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp
                    </a>
                  </Button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="min-h-10"
                    onClick={() =>
                      updateMutation.mutateAsync({
                        id: editingAppointment.id,
                        body: { status: "confirmed" },
                      })
                    }
                  >
                    Confirmar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-10"
                    onClick={() =>
                      updateMutation.mutateAsync({
                        id: editingAppointment.id,
                        body: { status: "completed" },
                      })
                    }
                  >
                    Concluir
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-10"
                    onClick={() =>
                      updateMutation.mutateAsync({
                        id: editingAppointment.id,
                        body: { status: "no_show" },
                      })
                    }
                  >
                    Faltou
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-10"
                    onClick={() => setCancelTarget(editingAppointment)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
            {!editingAppointment && (
              <FormField
                control={form.control}
                name="client_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Cliente <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                      <SelectTrigger autoFocus>
                          <SelectValue placeholder="Selecione o cliente" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} – {c.phone}
                          </SelectItem>
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
              name="barber_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Barbeiro <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o barbeiro" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {barbers.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
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
              name="service_ids"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Serviços <span className="text-destructive">*</span>
                  </FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <button
                          type="button"
                          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          {field.value.length === 0
                            ? "Selecione os serviços"
                            : field.value.length === 1
                              ? (services.find((s) => s.id === field.value[0])
                                  ?.name ?? "1 serviço")
                              : `${field.value.length} serviços`}
                          <ChevronRight className="h-4 w-4 rotate-90 opacity-50" />
                        </button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent
                      className="z-[100] w-full min-w-[var(--radix-popover-trigger-width)] p-2"
                      align="start"
                    >
                      <div className="max-h-60 space-y-2 overflow-y-auto p-1">
                        {services.map((s) => (
                          <label
                            key={s.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={field.value.includes(s.id)}
                              onCheckedChange={(checked) => {
                                const next = checked
                                  ? [...field.value, s.id]
                                  : field.value.filter((id) => id !== s.id);
                                field.onChange(next);
                              }}
                            />
                            <span className="flex-1">{s.name}</span>
                            <span className="text-muted-foreground">
                              R$ {Number(s.price).toFixed(2)} ·{" "}
                              {s.duration_minutes} min
                            </span>
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div
              className={
                editingAppointment ? "space-y-4" : "grid grid-cols-2 gap-4"
              }
            >
              <FormField
                control={form.control}
                name="scheduled_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Data <span className="text-destructive">*</span>
                    </FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <button
                            type="button"
                            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            {field.value &&
                            /^\d{4}-\d{2}-\d{2}$/.test(field.value)
                              ? format(
                                  new Date(field.value + "T12:00:00"),
                                  "dd/MM/yyyy",
                                )
                              : "Selecione a data"}
                            <CalendarIcon className="ml-2 h-4 w-4 opacity-50" />
                          </button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent
                        className="z-[100] w-auto p-0"
                        align="start"
                      >
                        <Calendar
                          mode="single"
                          selected={
                            field.value &&
                            /^\d{4}-\d{2}-\d{2}$/.test(field.value)
                              ? new Date(field.value + "T12:00:00")
                              : undefined
                          }
                          onSelect={(d) =>
                            d && field.onChange(format(d, "yyyy-MM-dd"))
                          }
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="scheduled_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Horário <span className="text-destructive">*</span>
                    </FormLabel>
                    {editingAppointment ? (
                      <div className="grid grid-cols-4 gap-2 pt-1">
                        {editSlotsToShow.map((t) => {
                          const available =
                            isEditTimeAvailable(t) || t === field.value;
                          const selected = field.value === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              disabled={!available}
                              onClick={() => field.onChange(t)}
                              className={[
                                "h-10 rounded-md border text-sm font-medium transition-colors",
                                selected
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-background border-input hover:bg-muted",
                                !available &&
                                  "opacity-50 cursor-not-allowed hover:bg-background",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Horário" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TIME_SLOTS.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {editingAppointment && (
              <>
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value ?? "confirmed"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pending">Pendente</SelectItem>
                          <SelectItem value="confirmed">Confirmado</SelectItem>
                          <SelectItem value="completed">Concluído</SelectItem>
                          <SelectItem value="no_show">
                            Não compareceu
                          </SelectItem>
                          <SelectItem value="cancelled">Cancelado</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <input
                      type="text"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Observações"
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

      {cancelTarget && (
        <ConfirmDialog
          open={!!cancelTarget}
          onOpenChange={(open) => !open && setCancelTarget(null)}
          title="Cancelar agendamento"
          description="Tem certeza que deseja cancelar este agendamento?"
          confirmLabel="Cancelar agendamento"
          variant="destructive"
          onConfirm={handleCancel}
        />
      )}
    </MainLayout>
  );
}
