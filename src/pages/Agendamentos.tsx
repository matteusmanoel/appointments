import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  addDays,
  subDays,
  addMonths,
  subMonths,
  addYears,
  subYears,
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  isSameMonth,
  isSameDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Calendar as CalendarIcon,
  CalendarX,
  Plus,
  ChevronLeft,
  ChevronRight,
  Scissors,
  Phone,
  MessageCircle,
  Copy,
  PhoneCall,
  CheckCircle2,
  BadgeCheck,
  UserX,
  Ban,
  Clock,
  DollarSign,
  List,
  LayoutGrid,
  Pencil,
  Search,
  Users,
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
  EntitySelectWithCreate,
  EntityMultiSelectWithCreate,
} from "@/components/shared";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Label } from "@/components/ui/label";
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
import { formatPhoneBR, formatPhoneDisplay, parsePhoneBR } from "@/lib/input-masks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DatePicker } from "@/components/ui/date-picker";
import { DateHourPicker } from "@/components/ui/date-hour-picker";
import { MonthPicker } from "@/components/ui/month-picker";
import { YearPicker } from "@/components/ui/year-picker";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  FiltersBar,
  FiltersBarField,
} from "@/components/appointments/FiltersBar";

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

function formatAppointmentDateTime(
  scheduled_date: string | null | undefined,
  scheduled_time: string | null | undefined,
): string {
  const datePart =
    scheduled_date != null ? String(scheduled_date).trim().slice(0, 10) : "";
  const date =
    datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)
      ? new Date(datePart + "T12:00:00")
      : null;
  const dateStr =
    date && !Number.isNaN(date.getTime())
      ? format(date, "dd/MM/yyyy", { locale: ptBR })
      : "—";
  const timeStr =
    scheduled_time != null ? String(scheduled_time).slice(0, 5) : "—";
  return `${dateStr} ${timeStr}`;
}

function formatAppointmentDateTimeVerbose(
  scheduled_date: string | null | undefined,
  scheduled_time: string | null | undefined,
): string {
  const datePart =
    scheduled_date != null ? String(scheduled_date).trim().slice(0, 10) : "";
  const date =
    datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)
      ? new Date(datePart + "T12:00:00")
      : null;
  const dateStr =
    date && !Number.isNaN(date.getTime())
      ? (() => {
          const s = format(date, "EEE, d 'de' MMMM", { locale: ptBR });
          return s.charAt(0).toUpperCase() + s.slice(1);
        })()
      : "—";
  const timeStr =
    scheduled_time != null && /^\d{1,2}:\d{2}/.test(String(scheduled_time))
      ? String(scheduled_time).slice(0, 5)
      : "—";
  return `${dateStr} · ${timeStr}`;
}

function AgendamentosGradeDaySkeleton({ barberCount }: { barberCount: number }) {
  const cols = Math.max(barberCount, 1);
  return (
    <div className="stat-card overflow-hidden flex-1 min-h-0 flex flex-col">
      <div className="overflow-x-auto scrollbar-thin flex-1 min-h-0 flex flex-col p-1 sm:p-0">
        <div
          className="grid gap-2 mb-4 pb-4 border-b border-border min-w-[280px] shrink-0"
          style={{
            gridTemplateColumns: `80px repeat(${cols}, minmax(100px, 1fr))`,
          }}
        >
          <Skeleton className="h-5 w-14" />
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full min-w-[80px]" />
          ))}
        </div>
        <div className="space-y-2 flex-1 min-h-0">
          {Array.from({ length: 10 }).map((_, row) => (
            <div
              key={row}
              className="grid gap-2"
              style={{
                gridTemplateColumns: `80px repeat(${cols}, 1fr)`,
              }}
            >
              <Skeleton className="h-12 w-14 self-center" />
              {Array.from({ length: cols }).map((_, c) => (
                <Skeleton key={c} className="h-[52px] rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgendamentosMonthSkeleton() {
  return (
    <div className="stat-card h-full flex flex-col min-h-0 p-3 sm:p-4">
      <div className="grid grid-cols-7 gap-1 text-center mb-2 shrink-0">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
          <Skeleton key={d} className="h-4 w-10 mx-auto" />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 flex-1 min-h-0 content-start">
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton key={i} className="min-h-[100px] sm:min-h-[120px] rounded-md" />
        ))}
      </div>
    </div>
  );
}

function AgendamentosListSkeleton() {
  return (
    <div className="overflow-y-auto flex-1 min-h-0 -mx-1 px-1 pb-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="stat-card p-4 flex flex-col gap-3 min-h-[140px] border border-border/60"
          >
            <div className="flex justify-between gap-2">
              <div className="space-y-2 flex-1 min-w-0">
                <Skeleton className="h-5 w-[72%] max-w-[14rem]" />
                <Skeleton className="h-3 w-[40%] max-w-[8rem]" />
              </div>
              <Skeleton className="h-8 w-8 rounded-md shrink-0" />
            </div>
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[70%]" />
            <Skeleton className="h-4 w-[55%]" />
            <div className="flex justify-between items-center mt-auto pt-1">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-5 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  barbershop_id: z.union([z.string().uuid(), z.literal("")]).optional(),
});

type AppointmentFormValues = z.infer<typeof appointmentFormSchema>;

const clientCreateSchema = z.object({
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

const barberCreateSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  phone: z.string().optional(),
  email: z.string().optional(),
  status: z.enum(["active", "inactive", "break"]),
  commission_percentage: z.coerce.number().min(0).max(100),
  barbershop_id: z.union([z.string().uuid(), z.literal("")]).optional(),
});

const defaultBarberSchedule: Record<
  string,
  { start: string; end: string } | null
> = {
  monday: { start: "09:00", end: "19:00" },
  tuesday: { start: "09:00", end: "19:00" },
  wednesday: { start: "09:00", end: "19:00" },
  thursday: { start: "09:00", end: "19:00" },
  friday: { start: "09:00", end: "19:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

const serviceCreateSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().optional(),
  price: z.coerce.number().min(0.01, "Preço deve ser maior que zero"),
  duration_minutes: z.coerce.number().min(1, "Duração mínima 1 min"),
  category: z
    .enum(["corte", "combo", "barba", "adicional", "tratamento"])
    .optional()
    .default("corte"),
  barbershop_id: z.union([z.string().uuid(), z.literal("")]).optional(),
});

export default function Agendamentos() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, selectedScope } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const isMobile = useIsMobile();
  const viewParam = searchParams.get("view");
  const initialView = (
    viewParam === "lista"
      ? "lista"
      : viewParam === "grade"
        ? "grade"
        : isMobile
          ? "lista"
          : "grade"
  ) as "grade" | "lista";
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const searchParam = searchParams.get("search") ?? "";
  const statusParam = searchParams.get("status") ?? "__all__";
  const gradeViewParam = searchParams.get("grade_view") ?? "day";
  const gradeDateParam = searchParams.get("date");
  const gradeStatusParam = searchParams.get("status");

  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    if (gradeDateParam && /^\d{4}-\d{2}-\d{2}$/.test(gradeDateParam)) {
      const d = new Date(gradeDateParam + "T12:00:00");
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  });
  const [gradeViewMode, setGradeViewMode] = useState<"day" | "month" | "year">(
    gradeViewParam === "month"
      ? "month"
      : gradeViewParam === "year"
        ? "year"
        : "day",
  );
  const filterSearch = searchParam;
  const setFilterSearch = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v.trim()) next.set("search", v.trim());
      else next.delete("search");
      return next;
    });
  };
  const [gradeStatus, setGradeStatus] = useState<string>(
    gradeStatusParam ?? "__all__",
  );
  const [formOpen, setFormOpen] = useState(false);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [createBarberOpen, setCreateBarberOpen] = useState(false);
  const [createServiceOpen, setCreateServiceOpen] = useState(false);
  const [appointmentModalMode, setAppointmentModalMode] = useState<
    "view" | "edit"
  >("view");
  const editFormSnapshotRef = useRef<AppointmentFormValues | null>(null);
  const [slotForCreate, setSlotForCreate] = useState<{
    time: string;
    barberId: string;
  } | null>(null);
  const [editingAppointment, setEditingAppointment] =
    useState<Appointment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Appointment | null>(null);
  const [completeTime, setCompleteTime] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grade" | "lista">(initialView);
  const [listRange, setListRange] = useState<{
    from: Date | null;
    to: Date | null;
  }>(() => {
    if (fromParam && toParam) {
      const fromDate = new Date(fromParam + "T12:00:00");
      const toDate = new Date(toParam + "T12:00:00");
      if (
        !Number.isNaN(fromDate.getTime()) &&
        !Number.isNaN(toDate.getTime())
      ) {
        return { from: fromDate, to: toDate };
      }
    }
    const today = new Date();
    return {
      from: startOfWeek(today, { weekStartsOn: 0 }),
      to: endOfWeek(today, { weekStartsOn: 0 }),
    };
  });
  const [listStatus, setListStatus] = useState<string>(
    statusParam || "__all__",
  );

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const listFromStr = listRange?.from
    ? format(listRange.from, "yyyy-MM-dd")
    : undefined;
  const listToStr = listRange?.to
    ? format(listRange.to, "yyyy-MM-dd")
    : undefined;

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("view", viewMode);
    if (viewMode === "lista") {
      if (listFromStr && listToStr) {
        params.set("from", listFromStr);
        params.set("to", listToStr);
      }
      if (filterSearch.trim()) params.set("search", filterSearch.trim());
      if (listStatus && listStatus !== "__all__") {
        params.set("status", listStatus);
      }
    } else {
      params.set("grade_view", gradeViewMode);
      params.set("date", format(selectedDate, "yyyy-MM-dd"));
      if (filterSearch.trim()) params.set("search", filterSearch.trim());
      if (gradeStatus && gradeStatus !== "__all__") {
        params.set("status", gradeStatus);
      }
    }
    setSearchParams(params);
  }, [
    viewMode,
    listFromStr,
    listToStr,
    filterSearch,
    listStatus,
    gradeViewMode,
    selectedDate,
    gradeStatus,
    setSearchParams,
  ]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      )
        return;
      const key = e.key.toLowerCase();
      if (key === "d") setGradeViewMode("day");
      else if (key === "m") setGradeViewMode("month");
      else if (key === "a") setGradeViewMode("year");
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const resetListFilters = () => {
    const today = new Date();
    setListRange({
      from: startOfWeek(today, { weekStartsOn: 0 }),
      to: endOfWeek(today, { weekStartsOn: 0 }),
    });
    setFilterSearch("");
    setListStatus("__all__");
  };

  const { data: barbers = [] } = useQuery({
    queryKey: ["barbers"],
    queryFn: () => barbersApi.list(),
  });

  const gradeMonthFrom =
    gradeViewMode === "month"
      ? format(startOfMonth(selectedDate), "yyyy-MM-dd")
      : undefined;
  const gradeMonthTo =
    gradeViewMode === "month"
      ? format(endOfMonth(selectedDate), "yyyy-MM-dd")
      : undefined;

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: [
      "appointments",
      dateStr,
      gradeViewMode,
      filterSearch,
      gradeStatus,
    ],
    queryFn: () =>
      appointmentsApi.list({
        date: dateStr,
        status: gradeStatus !== "__all__" ? gradeStatus : undefined,
        search: filterSearch.trim() || undefined,
      }),
    enabled: viewMode === "grade" && gradeViewMode === "day",
  });

  const { data: monthAppointments = [], isLoading: monthLoading } = useQuery({
    queryKey: [
      "appointments",
      "month",
      gradeMonthFrom,
      gradeMonthTo,
      filterSearch,
      gradeStatus,
    ],
    queryFn: () =>
      appointmentsApi.list({
        from: gradeMonthFrom,
        to: gradeMonthTo,
        status: gradeStatus !== "__all__" ? gradeStatus : undefined,
        search: filterSearch.trim() || undefined,
      }),
    enabled:
      viewMode === "grade" &&
      gradeViewMode === "month" &&
      !!gradeMonthFrom &&
      !!gradeMonthTo,
  });

  const { data: listAppointmentsRaw = [], isLoading: listLoading } = useQuery({
    queryKey: [
      "appointments",
      "list",
      listFromStr,
      listToStr,
      filterSearch,
      listStatus || null,
    ],
    queryFn: () =>
      appointmentsApi.list({
        from: listFromStr,
        to: listToStr,
        status: listStatus && listStatus !== "__all__" ? listStatus : undefined,
        search: filterSearch.trim() || undefined,
      }),
    enabled: viewMode === "lista" && !!listFromStr && !!listToStr,
  });

  const listAppointments = listAppointmentsRaw;

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => clientsApi.list(),
  });

  const { data: services = [] } = useQuery({
    queryKey: ["services"],
    queryFn: () => servicesApi.list(),
  });

  const createClientForm = useForm<z.infer<typeof clientCreateSchema>>({
    resolver: zodResolver(clientCreateSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      notes: "",
      barbershop_id: "",
    },
  });
  const createBarberForm = useForm<z.infer<typeof barberCreateSchema>>({
    resolver: zodResolver(barberCreateSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      status: "active",
      commission_percentage: 40,
      barbershop_id: "",
    },
  });
  const createServiceForm = useForm<z.infer<typeof serviceCreateSchema>>({
    resolver: zodResolver(serviceCreateSchema),
    defaultValues: {
      name: "",
      description: "",
      price: 35,
      duration_minutes: 30,
      category: "corte",
      barbershop_id: "",
    },
  });

  const createClientMutation = useMutation({
    mutationFn: (body: z.infer<typeof clientCreateSchema>) =>
      clientsApi.create({
        name: body.name,
        phone: body.phone,
        email: body.email || undefined,
        notes: body.notes || undefined,
        ...(selectedScope === "__all__" && body.barbershop_id
          ? { barbershop_id: body.barbershop_id }
          : {}),
      }),
    onSuccess: async (data: { id: string }) => {
      await queryClient.refetchQueries({ queryKey: ["clients"] });
      setCreateClientOpen(false);
      createClientForm.reset();
      form.setValue("client_id", data.id, { shouldDirty: true });
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao criar cliente"),
  });
  const createBarberMutation = useMutation({
    mutationFn: (body: z.infer<typeof barberCreateSchema>) =>
      barbersApi.create({
        name: body.name,
        phone: body.phone || undefined,
        email: body.email || undefined,
        status: body.status,
        commission_percentage: body.commission_percentage,
        schedule: defaultBarberSchedule,
        ...(selectedScope === "__all__" && body.barbershop_id
          ? { barbershop_id: body.barbershop_id }
          : {}),
      }),
    onSuccess: async (data: { id: string }) => {
      await queryClient.refetchQueries({ queryKey: ["barbers"] });
      setCreateBarberOpen(false);
      createBarberForm.reset();
      form.setValue("barber_id", data.id, { shouldDirty: true });
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao criar barbeiro"),
  });
  const createServiceMutation = useMutation({
    mutationFn: (body: z.infer<typeof serviceCreateSchema>) =>
      servicesApi.create({
        name: body.name,
        description: body.description || undefined,
        price: body.price,
        duration_minutes: body.duration_minutes,
        category: body.category ?? "corte",
        ...(selectedScope === "__all__" && body.barbershop_id
          ? { barbershop_id: body.barbershop_id }
          : {}),
      }),
    onSuccess: (data: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setCreateServiceOpen(false);
      createServiceForm.reset();
      form.setValue(
        "service_ids",
        [...form.getValues("service_ids"), data.id],
        { shouldDirty: true },
      );
    },
    onError: (e) =>
      toastError(e instanceof Error ? e.message : "Erro ao criar serviço"),
  });

  const { data: barbershop } = useQuery({
    queryKey: ["barbershop"],
    queryFn: () => barbershopsApi.get(),
    retry: false,
    staleTime: 2 * 60 * 1000,
  });

  const { data: closuresList = [] } = useQuery({
    queryKey: ["barbershops", "closures"],
    queryFn: () => barbershopsApi.closures.list(),
  });

  const closureForDate = (d: Date) => {
    const str = format(d, "yyyy-MM-dd");
    return closuresList.find((c) => c.closure_date === str) ?? null;
  };

  const timeSlots = (() => {
    const c = closureForDate(selectedDate);
    if (c?.status === "closed") return [];
    return getTimeSlotsForDay(
      barbershop?.business_hours,
      selectedDate,
      c?.status === "open_partial"
        ? {
            closure: {
              start_time: c.start_time,
              end_time: c.end_time,
              unavailability_intervals: c.unavailability_intervals,
            },
          }
        : undefined,
    );
  })();
  const slotsToShow = timeSlots.length > 0 ? timeSlots : TIME_SLOTS;

  const form = useForm<AppointmentFormValues>({
    resolver: zodResolver(appointmentFormSchema),
    defaultValues: {
      client_id: "",
      barber_id: "",
      service_id: "",
      service_ids: [],
      scheduled_date: dateStr,
      scheduled_time: "09:00",
      notes: "",
      status: "confirmed",
      price: 0,
      barbershop_id: "",
    },
  });

  const editDateStr = form.watch("scheduled_date");
  const editBarberId = form.watch("barber_id");
  const watchedServiceIds = form.watch("service_ids");
  const watchedPrice = form.watch("price");
  const watchedStatus = form.watch("status");
  const watchedTime = form.watch("scheduled_time");

  const selectedServices = useMemo(() => {
    const ids = watchedServiceIds ?? [];
    if (ids.length === 0) return [];
    const byId = new Map(services.map((s) => [s.id, s]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as typeof services;
  }, [services, watchedServiceIds]);

  const computedTotals = useMemo(() => {
    const totalPrice = selectedServices.reduce(
      (sum, s) => sum + Number(s.price ?? 0),
      0,
    );
    const totalDuration = selectedServices.reduce(
      (sum, s) => sum + Number(s.duration_minutes ?? 0),
      0,
    );
    return {
      totalPrice,
      totalDuration:
        totalDuration || (editingAppointment?.duration_minutes ?? 30),
    };
  }, [selectedServices, editingAppointment?.duration_minutes]);

  useEffect(() => {
    if (editingAppointment || priceManuallyEdited) return;
    const next = computedTotals.totalPrice;
    const current = Number(watchedPrice ?? 0);
    if (next > 0 && current === 0) {
      form.setValue("price", next, { shouldDirty: false, shouldTouch: false });
    }
  }, [
    computedTotals.totalPrice,
    editingAppointment,
    form,
    priceManuallyEdited,
    watchedPrice,
  ]);

  const { data: editDayAppointments = [] } = useQuery({
    queryKey: ["appointments", editDateStr],
    queryFn: () => appointmentsApi.list({ date: editDateStr }),
    enabled: !!editingAppointment && !!editDateStr,
  });

  /** Refetch todas as queries de agenda + métricas que dependem dos mesmos dados. */
  const invalidateAppointmentRelatedQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["appointments"] });
    void queryClient.invalidateQueries({ queryKey: ["reports", "mvp-metrics"] });
  };

  const createMutation = useMutation({
    mutationFn: async (body: AppointmentFormValues) => {
      const ids = body.service_ids ?? [];
      const created = await appointmentsApi.create({
        client_id: body.client_id,
        barber_id: body.barber_id,
        service_ids: ids,
        scheduled_date: body.scheduled_date,
        scheduled_time: (body.scheduled_time ?? "00:00").slice(0, 5),
        notes: body.notes,
        ...(selectedScope === "__all__" && body.barbershop_id
          ? { barbershop_id: body.barbershop_id }
          : {}),
      });
      const desiredStatus = body.status ?? "confirmed";
      if (desiredStatus !== "pending") {
        await appointmentsApi.update(created.id, { status: desiredStatus });
      }
      const price = Number(body.price ?? 0);
      if (
        priceManuallyEdited &&
        price > 0 &&
        price !== Number(created.price ?? 0)
      ) {
        await appointmentsApi.update(created.id, { price });
      }
      return created;
    },
    onSuccess: () => {
      invalidateAppointmentRelatedQueries();
      setFormOpen(false);
      setSlotForCreate(null);
      setPriceManuallyEdited(false);
    },
  });

  const updateMutation = useMutation({
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
      invalidateAppointmentRelatedQueries();
      setFormOpen(false);
      setEditingAppointment(null);
      setPriceManuallyEdited(false);
    },
  });

  const inlineUpdateMutation = useMutation({
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
        completed_time?: string;
      };
    }) => appointmentsApi.update(id, body),
    onSuccess: (updated) => {
      invalidateAppointmentRelatedQueries();
      setEditingAppointment((cur) =>
        cur && cur.id === updated.id
          ? ({ ...cur, ...updated } as Appointment)
          : cur,
      );
      form.setValue(
        "status",
        (updated.status as AppointmentFormValues["status"]) ?? "confirmed",
        { shouldDirty: false, shouldTouch: false },
      );
      if (updated.scheduled_date) {
        form.setValue(
          "scheduled_date",
          String(updated.scheduled_date).slice(0, 10),
          {
            shouldDirty: false,
            shouldTouch: false,
          },
        );
      }
      if (updated.scheduled_time) {
        form.setValue(
          "scheduled_time",
          String(updated.scheduled_time).slice(0, 5),
          {
            shouldDirty: false,
            shouldTouch: false,
          },
        );
      }
      const nextIds = (updated as Appointment).service_ids;
      if (Array.isArray(nextIds)) {
        form.setValue("service_ids", nextIds, {
          shouldDirty: false,
          shouldTouch: false,
        });
      }
      if (updated.price != null) {
        form.setValue("price", Number(updated.price) || 0, {
          shouldDirty: false,
          shouldTouch: false,
        });
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => appointmentsApi.cancel(id),
    onSuccess: () => {
      invalidateAppointmentRelatedQueries();
      setCancelTarget(null);
    },
  });

  const normalizeTime = (t: string) => t.slice(0, 5);

  const gradeDayAppointments = appointments;
  const gradeBarbers = barbers;
  const gradeMonthAppointments = monthAppointments;

  /** Agendamento que cobre o slot (início ou continuação de serviço longo). */
  const getAppointmentCoveringSlot = (
    list: AppointmentListItem[],
    time: string,
    barberId: string,
  ): Appointment | undefined => {
    const slotMins = (() => {
      const [h, m] = time.split(":").map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    })();
    for (const apt of list) {
      if (apt.status === "cancelled" || apt.status === "no_show") continue;
      if (apt.barber_id !== barberId) continue;
      const [h, m] = String(apt.scheduled_time).slice(0, 5).split(":").map(Number);
      const startMins = (h ?? 0) * 60 + (m ?? 0);
      const endMins =
        apt.status === "completed" && apt.completed_time != null
          ? (() => {
              const [eh, em] = String(apt.completed_time).slice(0, 5).split(":").map(Number);
              return (eh ?? 0) * 60 + (em ?? 0);
            })()
          : startMins + (apt.duration_minutes ?? 0);
      if (slotMins >= startMins && slotMins < endMins) {
        return apt as Appointment;
      }
    }
    return undefined;
  };

  const editSlotsToShow = (() => {
    if (!editDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(editDateStr))
      return TIME_SLOTS;
    const d = new Date(editDateStr + "T12:00:00");
    const c = closureForDate(d);
    if (c?.status === "closed") return [];
    const options =
      c?.status === "open_partial"
        ? {
            closure: {
              start_time: c.start_time,
              end_time: c.end_time,
              unavailability_intervals: c.unavailability_intervals,
            },
          }
        : undefined;
    const slots = getTimeSlotsForDay(barbershop?.business_hours, d, options);
    return slots.length > 0 ? slots : TIME_SLOTS;
  })();

  const isEditTimeAvailable = (time: string) => {
    if (!editingAppointment) return true;
    if (!editBarberId) return false;
    const [h, m] = time.split(":").map(Number);
    const startMins = (h ?? 0) * 60 + (m ?? 0);
    const endMins = startMins + (computedTotals.totalDuration ?? 30);
    return !editDayAppointments.some((apt) => {
      if (apt.id === editingAppointment.id) return false;
      if (apt.status === "cancelled" || apt.status === "no_show") return false;
      if (apt.barber_id !== editBarberId) return false;
      const [ah, am] = String(apt.scheduled_time)
        .slice(0, 5)
        .split(":")
        .map(Number);
      const aStart = (ah ?? 0) * 60 + (am ?? 0);
      const aEnd =
        apt.status === "completed" && apt.completed_time != null
          ? (() => {
              const [eh, em] = String(apt.completed_time).slice(0, 5).split(":").map(Number);
              return (eh ?? 0) * 60 + (em ?? 0);
            })()
          : aStart + (apt.duration_minutes ?? 30);
      return startMins < aEnd && endMins > aStart;
    });
  };

  const openCreate = (time: string, barberId: string) => {
    setEditingAppointment(null);
    setSlotForCreate({ time, barberId });
    setPriceManuallyEdited(false);
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
      barbershop_id: "",
    });
    setFormOpen(true);
  };

  const openCreateFromButton = () => {
    setEditingAppointment(null);
    setSlotForCreate(null);
    setPriceManuallyEdited(false);
    form.reset({
      client_id: "",
      barber_id: barbers[0]?.id ?? "",
      service_id: "",
      service_ids: [],
      scheduled_date: dateStr,
      scheduled_time: slotsToShow[0] ?? "09:00",
      notes: "",
      status: "confirmed",
      price: 0,
      barbershop_id: "",
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
    setAppointmentModalMode("view");
    setPriceManuallyEdited(false);
    const ids = apt.service_ids?.length
      ? apt.service_ids
      : apt.service_id
        ? [apt.service_id]
        : [];
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
    if (formOpen && editingAppointment) {
      setAppointmentModalMode("view");
      editFormSnapshotRef.current = form.getValues();
    }
  }, [formOpen, editingAppointment, form]);

  useEffect(() => {
    const apt = location.state?.editAppointment as Appointment | undefined;
    if (apt) {
      setSlotForCreate(null);
      setEditingAppointment(apt);
      setPriceManuallyEdited(false);
      const ids = apt.service_ids?.length
        ? apt.service_ids
        : apt.service_id
          ? [apt.service_id]
          : [];
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
      if (
        !editingAppointment &&
        selectedScope === "__all__" &&
        !values.barbershop_id
      ) {
        form.setError("barbershop_id", { message: "Selecione a filial." });
        return;
      }
      if (editingAppointment) {
        const movingToAnotherBarber =
          values.barber_id !== editingAppointment.barber_id;
        const ids = values.service_ids ?? [];
        const origIds = editingAppointment.service_ids?.length
          ? editingAppointment.service_ids
          : editingAppointment.service_id
            ? [editingAppointment.service_id]
            : [];
        const servicesChanged =
          ids.length !== origIds.length ||
          ids.some((id, i) => id !== origIds[i]);
        const desiredPrice = Number(values.price ?? 0);

        if (movingToAnotherBarber) {
          const created = await appointmentsApi.create({
            client_id: editingAppointment.client_id,
            barber_id: values.barber_id,
            service_ids: ids,
            scheduled_date: values.scheduled_date,
            scheduled_time: (values.scheduled_time ?? "00:00").slice(0, 5),
            notes: values.notes,
            ...(selectedScope === "__all__" && values.barbershop_id
              ? { barbershop_id: values.barbershop_id }
              : {}),
          });
          const desiredStatus = values.status ?? "confirmed";
          if (desiredStatus !== "pending") {
            await appointmentsApi.update(created.id, { status: desiredStatus });
          }
          if (
            priceManuallyEdited &&
            desiredPrice > 0 &&
            desiredPrice !== Number(created.price ?? 0)
          ) {
            await appointmentsApi.update(created.id, { price: desiredPrice });
          }
          await appointmentsApi.cancel(editingAppointment.id);
          invalidateAppointmentRelatedQueries();
          toastSuccess("Agendamento movido para outro barbeiro.");
          setFormOpen(false);
          setEditingAppointment(null);
          setCancelTarget(null);
          setPriceManuallyEdited(false);
          return;
        }

        const baseBody = {
          status: values.status ?? "confirmed",
          scheduled_date: values.scheduled_date,
          scheduled_time: values.scheduled_time?.slice(0, 5),
          notes: values.notes,
        };

        if (servicesChanged && ids.length > 0) {
          await updateMutation.mutateAsync({
            id: editingAppointment.id,
            body: { ...baseBody, service_ids: ids },
          });
          // Se o gestor quiser sobrescrever o valor (desconto/ajuste), fazemos um PATCH separado.
          if (
            priceManuallyEdited &&
            desiredPrice > 0 &&
            desiredPrice !== computedTotals.totalPrice
          ) {
            await appointmentsApi.update(editingAppointment.id, {
              price: desiredPrice,
            });
          }
          toastSuccess("Agendamento atualizado.");
        } else {
          await updateMutation.mutateAsync({
            id: editingAppointment.id,
            body: {
              ...baseBody,
              ...(priceManuallyEdited && desiredPrice > 0
                ? { price: desiredPrice }
                : {}),
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
      setFormOpen(false);
      setEditingAppointment(null);
      setCancelTarget(null);
    } catch (e) {
      toastError("Erro ao cancelar agendamento.", e);
    }
  };

  return (
    <>
      <div className="animate-fade-in flex flex-col flex-1 min-h-0">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="page-header mb-0">
            <h1 className="page-title">Agendamentos</h1>
            <p className="page-subtitle">Gerencie sua agenda de atendimentos</p>
          </div>
          <Button
            className="btn-accent w-full md:w-fit"
            onClick={openCreateFromButton}
            aria-label="Novo agendamento"
          >
            <Plus className="w-4 h-4 mr-2" />
            Novo Agendamento
          </Button>
        </div>

        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(v as "grade" | "lista")}
          className="w-full flex flex-col flex-1 min-h-0"
        >
          <TabsList className="mb-0 w-full grid grid-cols-2">
            <TabsTrigger value="grade" className="gap-2">
              <LayoutGrid className="w-4 h-4" />
              Grade
            </TabsTrigger>
            <TabsTrigger value="lista" className="gap-2">
              <List className="w-4 h-4" />
              Agenda
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="grade"
            className="mt-0 pt-4 flex flex-col flex-1 min-h-0"
          >
            <div className="stat-card mb-4 shrink-0">
              <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-3 items-center">
                <div className="flex flex-wrap items-center justify-start gap-2 min-w-0">
                  <Tabs
                    value={gradeViewMode}
                    onValueChange={(v) =>
                      setGradeViewMode(v as "day" | "month" | "year")
                    }
                  >
                    <TabsList className="h-12 p-1 grid grid-cols-3">
                      <TabsTrigger
                        value="day"
                        className="text-sm font-medium px-4"
                      >
                        Dia
                      </TabsTrigger>
                      <TabsTrigger
                        value="month"
                        className="text-sm font-medium px-4"
                      >
                        Mês
                      </TabsTrigger>
                      <TabsTrigger
                        value="year"
                        className="text-sm font-medium px-4"
                      >
                        Ano
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="flex flex-1 min-w-0 justify-center">
                  <div className="flex items-center border rounded-xl overflow-hidden bg-muted/30">
                    <button
                      type="button"
                      className="p-4 hover:bg-muted transition-colors h-14 flex items-center justify-center"
                      onClick={() =>
                        setSelectedDate((d) =>
                          gradeViewMode === "day"
                            ? subDays(d, 1)
                            : gradeViewMode === "month"
                              ? subMonths(d, 1)
                              : subYears(d, 1),
                        )
                      }
                      aria-label={
                        gradeViewMode === "day"
                          ? "Dia anterior"
                          : gradeViewMode === "month"
                            ? "Mês anterior"
                            : "Ano anterior"
                      }
                    >
                      <ChevronLeft className="w-6 h-6 text-muted-foreground" />
                    </button>
                    <div className="w-[320px] min-h-[3.5rem] h-full flex items-center justify-center shrink-0 border-x border-border">
                      {gradeViewMode === "day" && (
                        <DatePicker
                          value={selectedDate}
                          onChange={(d) => d && setSelectedDate(d)}
                          triggerVariant="verbose"
                          className="w-full min-w-0 flex items-center justify-center gap-2 text-base font-medium border-0 rounded-none h-full"
                        />
                      )}
                      {gradeViewMode === "month" && (
                        <MonthPicker
                          value={selectedDate}
                          onChange={setSelectedDate}
                          className="w-full min-w-0 border-0 rounded-none justify-center text-base font-medium h-full"
                        />
                      )}
                      {gradeViewMode === "year" && (
                        <YearPicker
                          value={selectedDate}
                          onChange={setSelectedDate}
                          className="w-full min-w-0 border-0 rounded-none justify-center text-base font-medium h-full"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      className="p-4 hover:bg-muted transition-colors h-14 flex items-center justify-center"
                      onClick={() =>
                        setSelectedDate((d) =>
                          gradeViewMode === "day"
                            ? addDays(d, 1)
                            : gradeViewMode === "month"
                              ? addMonths(d, 1)
                              : addYears(d, 1),
                        )
                      }
                      aria-label={
                        gradeViewMode === "day"
                          ? "Próximo dia"
                          : gradeViewMode === "month"
                            ? "Próximo mês"
                            : "Próximo ano"
                      }
                    >
                      <ChevronRight className="w-6 h-6 text-muted-foreground" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <div className="relative min-w-[180px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Cliente, barbeiro ou serviço"
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      className="pl-8 h-10 w-full"
                    />
                  </div>
                  <Select value={gradeStatus} onValueChange={setGradeStatus}>
                    <SelectTrigger className="w-[130px]">
                      <SelectValue placeholder="Status" />
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
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              {gradeViewMode === "day" && (
                <>
                  {isLoading && (
                    <AgendamentosGradeDaySkeleton
                      barberCount={Math.max(barbers.length, 3)}
                    />
                  )}
                  {!isLoading && timeSlots.length === 0 && (
                    <div className="stat-card flex flex-1 min-h-0 items-center justify-center">
                      <EmptyState
                        icon={
                          <CalendarX className="h-12 w-12" strokeWidth={1.5} />
                        }
                        title="Fechada neste dia"
                        description="Não há horários disponíveis para agendamento."
                      />
                    </div>
                  )}
                  {!isLoading && timeSlots.length > 0 && barbers.length === 0 && (
                    <div className="stat-card flex flex-1 min-h-0 items-center justify-center p-8">
                      <EmptyState
                        icon={<Users className="h-12 w-12" strokeWidth={1.5} />}
                        title="Cadastre um barbeiro para ver a grade"
                        description="Os horários são organizados por profissional. Adicione pelo menos um barbeiro em Barbeiros para visualizar os slots e criar agendamentos na grade."
                        action={
                          <Button
                            type="button"
                            className="mt-2"
                            onClick={() => navigate("/app/barbeiros")}
                          >
                            Ir para Barbeiros
                          </Button>
                        }
                      />
                    </div>
                  )}
                  {!isLoading && timeSlots.length > 0 && barbers.length > 0 && (
                    <div className="stat-card overflow-hidden flex-1 min-h-0 flex flex-col">
                      <div className="overflow-x-auto scrollbar-thin flex-1 min-h-0 flex flex-col">
                        <div
                          className="grid gap-2 mb-4 pb-4 border-b border-border min-w-[280px] shrink-0"
                          style={{
                            gridTemplateColumns: `80px repeat(${gradeBarbers.length}, minmax(100px, 1fr))`,
                          }}
                        >
                          <div className="text-sm font-medium text-muted-foreground">
                            Horário
                          </div>
                          {gradeBarbers.map((barber, i) => (
                            <div
                              key={barber.id}
                              className="flex items-center gap-2"
                            >
                              <div
                                className={`w-3 h-3 rounded-full shrink-0 ${BARBER_COLORS[i % BARBER_COLORS.length]}`}
                              />
                              <span className="text-sm font-medium text-foreground truncate">
                                {barber.name}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-1 flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                          {slotsToShow.map((time) => (
                            <div
                              key={time}
                              className="grid gap-2"
                              style={{
                                gridTemplateColumns: `80px repeat(${gradeBarbers.length}, 1fr)`,
                              }}
                            >
                              <div className="text-sm text-muted-foreground py-3 font-medium">
                                {time}
                              </div>
                              {gradeBarbers.map((barber, i) => {
                                const appointment = getAppointmentCoveringSlot(
                                  gradeDayAppointments,
                                  time,
                                  barber.id,
                                );
                                const colorClass =
                                  BARBER_COLORS[i % BARBER_COLORS.length];
                                if (appointment) {
                                  return (
                                    <div
                                      key={`${time}-${barber.id}`}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => openEdit(appointment)}
                                      onKeyDown={(e) => {
                                        if (
                                          e.key === "Enter" ||
                                          e.key === " "
                                        ) {
                                          e.preventDefault();
                                          openEdit(appointment);
                                        }
                                      }}
                                      className={`w-full text-left ${colorClass}/10 border-l-4 ${colorClass} rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow`}
                                    >
                                      <div className="flex items-start justify-between">
                                        <div>
                                          <p className="font-medium text-foreground text-sm">
                                            {appointment.client_name}
                                          </p>
                                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                            <Scissors className="w-3 h-3" />
                                            {serviceLabel(
                                              appointment.service_names,
                                              appointment.service_name,
                                            )}
                                          </p>
                                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                            <Phone className="w-3 h-3" />
                                            {appointment.client_phone}
                                          </p>
                                        </div>
                                        <span
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <EntityActionsMenu
                                            onEdit={() => openEdit(appointment)}
                                            onDelete={() =>
                                              setCancelTarget(appointment)
                                            }
                                            aria-label="Menu do agendamento"
                                          />
                                        </span>
                                      </div>
                                    </div>
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
                    </div>
                  )}
                </>
              )}

              {gradeViewMode === "month" && (
                <>
                  {monthLoading && <AgendamentosMonthSkeleton />}
                  {!monthLoading && (
                    <div className="stat-card h-full flex flex-col min-h-0">
                      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground mb-2 shrink-0">
                        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(
                          (d) => (
                            <div key={d}>{d}</div>
                          ),
                        )}
                      </div>
                      <div className="grid grid-cols-7 gap-1 flex-1 min-h-0 overflow-auto content-start">
                        {(() => {
                          const start = startOfMonth(selectedDate);
                          const end = endOfMonth(selectedDate);
                          const startPad = start.getDay();
                          const lastDay = end.getDate();
                          const days: (Date | null)[] = [];
                          for (let i = 0; i < startPad; i++) days.push(null);
                          for (let dayNum = 1; dayNum <= lastDay; dayNum++) {
                            days.push(
                              new Date(
                                selectedDate.getFullYear(),
                                selectedDate.getMonth(),
                                dayNum,
                              ),
                            );
                          }
                          return days.map((day, i) => {
                            if (!day)
                              return (
                                <div
                                  key={`pad-${i}`}
                                  className="min-h-[120px] rounded bg-muted/20"
                                />
                              );
                            const dayStr = format(day, "yyyy-MM-dd");
                            const dayApts = gradeMonthAppointments.filter(
                              (a) => a.scheduled_date === dayStr,
                            );
                            const byBarber = dayApts.reduce<
                              Record<
                                string,
                                { id: string; name: string; count: number }
                              >
                            >((acc, a) => {
                              const id = a.barber_id ?? "__unknown__";
                              const name = a.barber_name ?? "Barbeiro";
                              if (!acc[id]) acc[id] = { id, name, count: 0 };
                              acc[id].count += 1;
                              return acc;
                            }, {});
                            const barberBadges = Object.values(byBarber);
                            return (
                              <button
                                type="button"
                                key={dayStr}
                                className="min-h-[120px] rounded border border-border p-1.5 overflow-hidden text-left flex flex-col hover:bg-muted/30 transition-colors"
                                onClick={() => {
                                  setSelectedDate(day);
                                  setGradeViewMode("day");
                                }}
                              >
                                <div className="text-xs font-medium text-muted-foreground mb-1">
                                  {format(day, "d")}
                                </div>
                                {barberBadges.length > 0 && (
                                  <div className="flex flex-wrap gap-0.5">
                                    {barberBadges.map(
                                      ({ id: barberId, name, count }) => (
                                        <Badge
                                          key={barberId}
                                          variant="secondary"
                                          className="text-[10px] px-1 py-0 font-normal"
                                        >
                                          {name} · {count}
                                        </Badge>
                                      ),
                                    )}
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1 py-0 font-normal"
                                    >
                                      Total: {dayApts.length}
                                    </Badge>
                                  </div>
                                )}
                              </button>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                </>
              )}

              {gradeViewMode === "year" && (
                <div className="stat-card h-full flex flex-col min-h-0">
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-2 gap-3 items-center justify-center">
                    {Array.from({ length: 12 }, (_, i) => {
                      const monthDate = new Date(
                        selectedDate.getFullYear(),
                        i,
                        1,
                      );
                      const monthLabel = format(monthDate, "MMM", {
                        locale: ptBR,
                      });
                      return (
                        <Button
                          key={i}
                          variant="outline"
                          className="h-auto flex flex-col items-center gap-1 py-8"
                          onClick={() => {
                            setSelectedDate(monthDate);
                            setGradeViewMode("month");
                          }}
                        >
                          <span className="capitalize">{monthLabel}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent
            value="lista"
            className="mt-0 flex flex-col flex-1 min-h-0 overflow-hidden"
          >
            <div className="flex flex-col flex-1 min-h-0 gap-4">
              <FiltersBar
                left={
                  <FiltersBarField label="Buscar" width="barber">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Cliente, barbeiro ou serviço"
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                        className="pl-8 h-10 w-full min-w-[160px]"
                      />
                    </div>
                  </FiltersBarField>
                }
                center={
                  <FiltersBarField label="Período" width="date">
                    <DateRangePicker
                      value={listRange}
                      onChange={setListRange}
                      className="w-full"
                    />
                  </FiltersBarField>
                }
                right={
                  <FiltersBarField label="Status" width="status">
                    <Select value={listStatus} onValueChange={setListStatus}>
                      <SelectTrigger className="w-full">
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
                  </FiltersBarField>
                }
              />
              {listLoading ? (
                <AgendamentosListSkeleton />
              ) : listAppointments.length === 0 ? (
                <div className="stat-card flex flex-1 min-h-0 flex-col gap-3 items-center justify-center py-12">
                  <EmptyState
                    icon={<List className="h-12 w-12" strokeWidth={1.5} />}
                    title={
                      filterSearch.trim() || listStatus !== "__all__"
                        ? "Nenhum agendamento para os filtros selecionados"
                        : "Nenhum agendamento no período"
                    }
                    description={
                      filterSearch.trim() || listStatus !== "__all__"
                        ? "Tente outros filtros ou amplie o período."
                        : "Não há agendamentos no intervalo escolhido."
                    }
                  />
                  {(filterSearch.trim() || listStatus !== "__all__") && (
                    <div className="flex justify-center">
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
                <div className="overflow-y-auto flex-1 min-h-0 -mx-1 px-1 pb-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {listAppointments.map((apt) => (
                    <div
                      key={apt.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEdit(apt)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openEdit(apt);
                        }
                      }}
                      aria-label={`Agendamento de ${apt.client_name}, ${formatAppointmentDateTimeVerbose(apt.scheduled_date, apt.scheduled_time)}`}
                      className="stat-card p-4 flex flex-col gap-2 min-h-[140px] cursor-pointer hover:ring-2 hover:ring-primary/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-shadow rounded-lg"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {apt.client_name}
                          </p>
                          {apt.client_phone && (
                            <p className="text-xs text-muted-foreground">
                              {formatPhoneDisplay(apt.client_phone)}
                            </p>
                          )}
                        </div>
                        <span onClick={(e) => e.stopPropagation()}>
                          <EntityActionsMenu
                            onEdit={() => openEdit(apt)}
                            onDelete={() => setCancelTarget(apt)}
                            aria-label="Menu do agendamento"
                          />
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {formatAppointmentDateTimeVerbose(
                          apt.scheduled_date,
                          apt.scheduled_time,
                        )}
                      </p>
                      <p className="text-sm">
                        <span className="text-muted-foreground">
                          Barbeiro:{" "}
                        </span>
                        <span className="font-medium">{apt.barber_name}</span>
                      </p>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Serviço: </span>
                        {serviceLabel(apt.service_names, apt.service_name)}
                      </p>
                      <div className="flex items-center justify-between mt-1">
                        <span
                          className={
                            apt.status === "completed"
                              ? "text-success text-sm font-medium"
                              : apt.status === "cancelled" ||
                                  apt.status === "no_show"
                                ? "text-muted-foreground text-sm"
                                : "text-warning text-sm font-medium"
                          }
                        >
                          {apt.status === "pending"
                            ? "Pendente"
                            : apt.status === "confirmed"
                              ? "Confirmado"
                              : apt.status === "completed"
                                ? "Concluído"
                                : apt.status === "cancelled"
                                  ? "Cancelado"
                                  : "Faltou"}
                        </span>
                        <span className="font-medium text-foreground">
                          R$ {Number(apt.price).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
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
        contentClassName={editingAppointment ? "sm:max-w-4xl" : "sm:max-w-2xl"}
        footer={
          <>
            {(editingAppointment && appointmentModalMode === "edit") ||
            !editingAppointment ? (
              <div className="flex items-center gap-2">
                {editingAppointment && appointmentModalMode === "edit" ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const snap = editFormSnapshotRef.current;
                        if (snap) form.reset(snap);
                        setAppointmentModalMode("view");
                      }}
                    >
                      Cancelar edição
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setFormOpen(false)}
                    >
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setFormOpen(false)}>
                    Cancelar
                  </Button>
                )}
              </div>
            ) : null}
            <div
              className={
                editingAppointment && appointmentModalMode === "view"
                  ? "col-span-2 flex flex-nowrap items-center gap-2 overflow-x-auto"
                  : "flex flex-nowrap items-center justify-end gap-2 overflow-x-auto"
              }
            >
              {editingAppointment && appointmentModalMode === "view" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-border"
                    onClick={() => setAppointmentModalMode("edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Editar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      inlineUpdateMutation
                        .mutateAsync({
                          id: editingAppointment.id,
                          body: { status: "confirmed" },
                        })
                        .then(() => {
                          toastSuccess("Marcado como confirmado.");
                          setFormOpen(false);
                        })
                        .catch((e) =>
                          toastError("Não foi possível confirmar.", e),
                        )
                    }
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1 sm:mr-2" />
                    Confirmar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const now = new Date();
                      setCompleteTime(
                        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
                      );
                      setCompleteTarget(editingAppointment);
                    }}
                  >
                    <BadgeCheck className="h-4 w-4 mr-1 sm:mr-2" />
                    Concluir
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      inlineUpdateMutation
                        .mutateAsync({
                          id: editingAppointment.id,
                          body: { status: "no_show" },
                        })
                        .then(() => {
                          toastSuccess("Marcado como faltou.");
                          setFormOpen(false);
                        })
                        .catch((e) =>
                          toastError("Não foi possível marcar falta.", e),
                        )
                    }
                  >
                    <UserX className="h-4 w-4 mr-1 sm:mr-2" />
                    Faltou
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => setCancelTarget(editingAppointment)}
                  >
                    <Ban className="h-4 w-4 mr-1 sm:mr-2" />
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button
                  onClick={form.handleSubmit(onSubmit)}
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                >
                  {editingAppointment ? "Salvar alterações" : "Criar"}
                </Button>
              )}
            </div>
          </>
        }
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {editingAppointment && appointmentModalMode === "view" && (
              <div className="rounded-lg border border-border bg-card p-4 relative">
                <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-semibold text-foreground truncate">
                        {editingAppointment.client_name}
                      </p>
                      <span
                        className={[
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border",
                          watchedStatus === "completed"
                            ? "bg-success/10 text-success border-success/20"
                            : watchedStatus === "confirmed"
                              ? "bg-accent/10 text-accent border-accent/20"
                              : watchedStatus === "pending"
                                ? "bg-warning/10 text-warning border-warning/20"
                                : watchedStatus === "no_show"
                                  ? "bg-muted text-muted-foreground border-border"
                                  : "bg-destructive/10 text-destructive border-destructive/20",
                        ].join(" ")}
                      >
                        {watchedStatus === "pending"
                          ? "Pendente"
                          : watchedStatus === "confirmed"
                            ? "Confirmado"
                            : watchedStatus === "completed"
                              ? "Concluído"
                              : watchedStatus === "cancelled"
                                ? "Cancelado"
                                : "Faltou"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        {formatPhoneDisplay(editingAppointment.client_phone)}
                      </span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted transition-colors"
                        onClick={() => {
                          const digits = String(
                            editingAppointment.client_phone ?? "",
                          ).replace(/\D/g, "");
                          if (!digits) return;
                          navigator.clipboard.writeText(digits);
                          toastSuccess("Telefone copiado.");
                        }}
                        aria-label="Copiar telefone"
                      >
                        <Copy className="h-4 w-4" />
                        Copiar
                      </button>
                      <a
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted transition-colors"
                        href={`tel:${String(editingAppointment.client_phone ?? "").replace(/\D/g, "")}`}
                      >
                        <PhoneCall className="h-4 w-4" />
                        Ligar
                      </a>
                    </div>

                    <div className="mt-4 grid gap-3 grid-cols-1 md:grid-cols-3">
                      <div className="rounded-lg bg-muted/40 px-4 py-3 min-h-[72px] flex flex-col justify-center">
                        <p className="text-sm text-muted-foreground">
                          Agendamento
                        </p>
                        <p className="text-base font-medium text-foreground flex items-center gap-2 mt-0.5">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {formatAppointmentDateTime(
                            editDateStr,
                            watchedTime ?? editingAppointment.scheduled_time,
                          )}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/40 px-4 py-3 min-h-[72px] flex flex-col justify-center">
                        <p className="text-sm text-muted-foreground">
                          Barbeiro
                        </p>
                        <p className="text-base font-medium text-foreground truncate mt-0.5">
                          {(barbers.find((b) => b.id === editBarberId)?.name ??
                            editingAppointment.barber_name) ||
                            "—"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/40 px-4 py-3 min-h-[72px] flex flex-col justify-center">
                        <p className="text-sm text-muted-foreground">Duração</p>
                        <p className="text-base font-medium text-foreground mt-0.5">
                          {computedTotals.totalDuration} min
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/40 px-4 py-3 min-h-[72px] flex flex-col justify-center">
                        <p className="text-sm text-muted-foreground">Valor</p>
                        <p className="text-base font-medium text-foreground flex items-center gap-2 mt-0.5">
                          <DollarSign className="h-4 w-4 text-muted-foreground" />
                          R${" "}
                          {Number(
                            watchedPrice ?? editingAppointment.price ?? 0,
                          ).toFixed(2)}
                        </p>
                      </div>
                      {editingAppointment.commission_amount != null && (
                        <div className="rounded-lg bg-muted/40 px-4 py-3 min-h-[72px] flex flex-col justify-center">
                          <p className="text-sm text-muted-foreground">
                            Comissão
                          </p>
                          <p className="text-base font-medium text-foreground mt-0.5">
                            R${" "}
                            {Number(
                              editingAppointment.commission_amount,
                            ).toFixed(2)}
                          </p>
                        </div>
                      )}
                      <div className="rounded-lg bg-muted/40 px-4 py-3 min-h-[72px] md:col-span-2 flex flex-col justify-center">
                        <p className="text-sm text-muted-foreground">
                          Serviços
                        </p>
                        <p className="text-base font-medium text-foreground mt-0.5">
                          {selectedServices.length > 0
                            ? serviceLabel(
                                selectedServices.map((s) => s.name),
                              )
                            : serviceLabel(
                                editingAppointment.service_names,
                                editingAppointment.service_name,
                              )}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 md:items-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full md:w-auto hover:bg-green-600/10 hover:text-green-600 hover:border-green-600/30"
                      asChild
                    >
                      <a
                        href={getClientWhatsAppUrl(
                          editingAppointment.client_phone,
                          [
                            `Salve, ${editingAppointment.client_name}!`,
                            `Aqui é da ${barbershop?.name ?? "NavalhIA"}.`,
                            "",
                            `Sobre seu agendamento em ${String(editDateStr ?? editingAppointment.scheduled_date).slice(0, 10)} às ${String(watchedTime ?? editingAppointment.scheduled_time).slice(0, 5)}.`,
                            `Serviço(s): ${
                              selectedServices.length > 0
                                ? selectedServices.map((s) => s.name).join(", ")
                                : serviceLabel(
                                    editingAppointment.service_names,
                                    editingAppointment.service_name,
                                  )
                            }`,
                            `Valor: R$ ${Number(watchedPrice ?? editingAppointment.price ?? 0).toFixed(2)}`,
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
                </div>
              </div>
            )}
            {(!editingAppointment || appointmentModalMode === "edit") && (
              <div className="grid gap-4 md:grid-cols-2">
                {selectedScope === "__all__" &&
                  profile?.barbershops &&
                  profile.barbershops.length > 0 &&
                  !editingAppointment && (
                    <div className="md:col-span-2">
                      <FormField
                        control={form.control}
                        name="barbershop_id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Filial <span className="text-destructive">*</span>
                            </FormLabel>
                            <Select
                              value={field.value || ""}
                              onValueChange={field.onChange}
                              required
                            >
                              <FormControl>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Selecione a filial" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {profile.barbershops.map((b) => (
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
                    </div>
                  )}
                {!editingAppointment && (
                  <div className="md:col-span-2">
                    <FormField
                      control={form.control}
                      name="client_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Cliente <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <EntitySelectWithCreate
                              value={field.value}
                              onValueChange={field.onChange}
                              options={clients.map((c) => ({
                                value: c.id,
                                label: `${c.name} – ${c.phone}`,
                              }))}
                              placeholder="Selecione o cliente"
                              createLabel="Criar novo cliente"
                              onSelectCreate={() => setCreateClientOpen(true)}
                              emptyTitle="Nenhum cliente cadastrado"
                              emptyDescription="Cadastre um cliente para agendar."
                              emptyActionLabel="Cadastrar cliente"
                              onEmptyAction={() => setCreateClientOpen(true)}
                              triggerClassName="w-full"
                              autoFocus
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="barber_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {editingAppointment ? "Barbeiro (mover)" : "Barbeiro"}{" "}
                        <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <EntitySelectWithCreate
                          value={field.value}
                          onValueChange={field.onChange}
                          options={barbers.map((b) => ({
                            value: b.id,
                            label: b.name,
                          }))}
                          placeholder="Selecione o barbeiro"
                          createLabel="Criar novo barbeiro"
                          onSelectCreate={() => setCreateBarberOpen(true)}
                          emptyTitle="Nenhum barbeiro cadastrado"
                          emptyDescription="Cadastre um barbeiro para agendar."
                          emptyActionLabel="Cadastrar barbeiro"
                          onEmptyAction={() => setCreateBarberOpen(true)}
                          triggerClassName="w-full"
                        />
                      </FormControl>
                      {editingAppointment &&
                        field.value !== editingAppointment.barber_id && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Ao salvar, este agendamento será cancelado e um novo
                            será criado para o barbeiro escolhido.
                          </p>
                        )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="scheduled_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Data e horário{" "}
                        <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <DateHourPicker
                          value={{
                            date:
                              field.value &&
                              /^\d{4}-\d{2}-\d{2}$/.test(field.value)
                                ? new Date(field.value + "T12:00:00")
                                : null,
                            time:
                              form.watch("scheduled_time")?.slice(0, 5) ||
                              "09:00",
                          }}
                          onChange={({ date, time }) => {
                            if (date)
                              field.onChange(format(date, "yyyy-MM-dd"));
                            form.setValue(
                              "scheduled_time",
                              time?.slice(0, 5) || "09:00",
                              { shouldValidate: true },
                            );
                          }}
                          placeholder="Selecione data e hora"
                          timeStep={30}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {editingAppointment ? (
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
                            <SelectItem value="confirmed">
                              Confirmado
                            </SelectItem>
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
                ) : null}

                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor (R$)</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.5"
                            min={0}
                            value={Number(field.value ?? 0)}
                            onChange={(e) => {
                              setPriceManuallyEdited(true);
                              field.onChange(Number(e.target.value));
                            }}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => {
                            setPriceManuallyEdited(false);
                            form.setValue("price", computedTotals.totalPrice, {
                              shouldDirty: true,
                              shouldTouch: true,
                            });
                          }}
                          disabled={computedTotals.totalPrice <= 0}
                        >
                          Usar total
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Total dos serviços:{" "}
                        <span className="font-medium">
                          R$ {computedTotals.totalPrice.toFixed(2)}
                        </span>
                        {" · "}
                        Duração:{" "}
                        <span className="font-medium">
                          {computedTotals.totalDuration} min
                        </span>
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="md:col-span-2">
                  <FormField
                    control={form.control}
                    name="service_ids"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Serviços <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <EntityMultiSelectWithCreate
                            value={field.value}
                            onChange={field.onChange}
                            options={services.map((s) => ({
                              value: s.id,
                              label: s.name,
                              subtitle: `R$ ${Number(s.price).toFixed(2)} · ${s.duration_minutes} min`,
                            }))}
                            placeholder="Selecione os serviços"
                            createLabel="Criar novo serviço"
                            onSelectCreate={() => setCreateServiceOpen(true)}
                            emptyTitle="Nenhum serviço cadastrado"
                            emptyDescription="Cadastre um serviço para agendar."
                            emptyActionLabel="Cadastrar serviço"
                            onEmptyAction={() => setCreateServiceOpen(true)}
                            trigger={
                              <button
                                type="button"
                                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                              >
                                {field.value.length === 0
                                  ? "Selecione os serviços"
                                  : field.value.length === 1
                                    ? (services.find(
                                        (s) => s.id === field.value[0],
                                      )?.name ?? "1 serviço")
                                    : `${field.value.length} serviços`}
                                <ChevronRight className="h-4 w-4 rotate-90 opacity-50" />
                              </button>
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {editingAppointment && (
                  <div className="md:col-span-2">
                    <FormField
                      control={form.control}
                      name="scheduled_time"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Horário <span className="text-destructive">*</span>
                          </FormLabel>
                          <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-input bg-background p-2 scrollbar-thin">
                            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
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
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                <div className="md:col-span-2">
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
                </div>
              </div>
            )}
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

      <Dialog
        open={!!completeTarget}
        onOpenChange={(open) => {
          if (!open) setCompleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Concluir agendamento</DialogTitle>
            <DialogDescription>
              Informe o horário em que o serviço foi finalizado. O restante do
              período ficará disponível para novos agendamentos.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="complete-time">Horário de término</Label>
              <Input
                id="complete-time"
                type="time"
                value={completeTime}
                onChange={(e) => setCompleteTime(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCompleteTarget(null)}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!completeTarget) return;
                const time = completeTime.trim().slice(0, 5);
                if (!/^\d{2}:\d{2}$/.test(time)) {
                  toastError("Informe um horário válido (HH:mm).");
                  return;
                }
                inlineUpdateMutation
                  .mutateAsync({
                    id: completeTarget.id,
                    body: { status: "completed", completed_time: time },
                  })
                  .then(() => {
                    toastSuccess("Marcado como concluído.");
                    setCompleteTarget(null);
                    setFormOpen(false);
                  })
                  .catch((e) =>
                    toastError("Não foi possível concluir.", e),
                  );
              }}
              disabled={inlineUpdateMutation.isPending}
            >
              Concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EntityFormDialog
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        title="Novo cliente"
        description="Preencha os dados do cliente para usar no agendamento."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCreateClientOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={createClientForm.handleSubmit((v) => {
                if (selectedScope === "__all__" && !v.barbershop_id) {
                  createClientForm.setError("barbershop_id", {
                    message: "Selecione a filial.",
                  });
                  return;
                }
                createClientMutation.mutate(v);
              })}
              disabled={createClientMutation.isPending}
            >
              Criar
            </Button>
          </>
        }
      >
        <Form {...createClientForm}>
          <form
            onSubmit={createClientForm.handleSubmit((v) => {
              if (selectedScope === "__all__" && !v.barbershop_id) {
                createClientForm.setError("barbershop_id", {
                  message: "Selecione a filial.",
                });
                return;
              }
              createClientMutation.mutate(v);
            })}
            className="space-y-4"
          >
            {selectedScope === "__all__" &&
              profile?.barbershops &&
              profile.barbershops.length > 0 && (
                <FormField
                  control={createClientForm.control}
                  name="barbershop_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Filial <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        required
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Selecione a filial" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {profile.barbershops.map((b) => (
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
              )}
            <FormField
              control={createClientForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome *</FormLabel>
                  <FormControl>
                    <Input placeholder="Nome completo" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createClientForm.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone *</FormLabel>
                  <FormControl>
                    <Input
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
              control={createClientForm.control}
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
              control={createClientForm.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <Input placeholder="Observações" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </EntityFormDialog>

      <EntityFormDialog
        open={createBarberOpen}
        onOpenChange={setCreateBarberOpen}
        title="Novo barbeiro"
        description="Preencha os dados do barbeiro para usar no agendamento."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCreateBarberOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={createBarberForm.handleSubmit((v) => {
                if (selectedScope === "__all__" && !v.barbershop_id) {
                  createBarberForm.setError("barbershop_id", {
                    message: "Selecione a filial.",
                  });
                  return;
                }
                createBarberMutation.mutate(v);
              })}
              disabled={createBarberMutation.isPending}
            >
              Criar
            </Button>
          </>
        }
      >
        <Form {...createBarberForm}>
          <form
            onSubmit={createBarberForm.handleSubmit((v) => {
              if (selectedScope === "__all__" && !v.barbershop_id) {
                createBarberForm.setError("barbershop_id", {
                  message: "Selecione a filial.",
                });
                return;
              }
              createBarberMutation.mutate(v);
            })}
            className="space-y-4"
          >
            {selectedScope === "__all__" &&
              profile?.barbershops &&
              profile.barbershops.length > 0 && (
                <FormField
                  control={createBarberForm.control}
                  name="barbershop_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Filial <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        required
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Selecione a filial" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {profile.barbershops.map((b) => (
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
              )}
            <FormField
              control={createBarberForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome *</FormLabel>
                  <FormControl>
                    <Input placeholder="Nome do barbeiro" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createBarberForm.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone</FormLabel>
                  <FormControl>
                    <Input placeholder="Telefone" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createBarberForm.control}
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
              control={createBarberForm.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="break">Intervalo</SelectItem>
                      <SelectItem value="inactive">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createBarberForm.control}
              name="commission_percentage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comissão (%)</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} max={100} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </EntityFormDialog>

      <EntityFormDialog
        open={createServiceOpen}
        onOpenChange={setCreateServiceOpen}
        title="Novo serviço"
        description="Preencha os dados do serviço para usar no agendamento."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCreateServiceOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={createServiceForm.handleSubmit((v) => {
                if (selectedScope === "__all__" && !v.barbershop_id) {
                  createServiceForm.setError("barbershop_id", {
                    message: "Selecione a filial.",
                  });
                  return;
                }
                createServiceMutation.mutate(v);
              })}
              disabled={createServiceMutation.isPending}
            >
              Criar
            </Button>
          </>
        }
      >
        <Form {...createServiceForm}>
          <form
            onSubmit={createServiceForm.handleSubmit((v) => {
              if (selectedScope === "__all__" && !v.barbershop_id) {
                createServiceForm.setError("barbershop_id", {
                  message: "Selecione a filial.",
                });
                return;
              }
              createServiceMutation.mutate(v);
            })}
            className="space-y-4"
          >
            {selectedScope === "__all__" &&
              profile?.barbershops &&
              profile.barbershops.length > 0 && (
                <FormField
                  control={createServiceForm.control}
                  name="barbershop_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Filial <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        required
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Selecione a filial" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {profile.barbershops.map((b) => (
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
              )}
            <FormField
              control={createServiceForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome *</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Corte masculino" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createServiceForm.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Input placeholder="Descrição" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createServiceForm.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Preço (R$) *</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min={0} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createServiceForm.control}
              name="duration_minutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Duração (min) *</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createServiceForm.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoria</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="corte">Corte</SelectItem>
                      <SelectItem value="combo">Combo</SelectItem>
                      <SelectItem value="barba">Barba</SelectItem>
                      <SelectItem value="adicional">Adicional</SelectItem>
                      <SelectItem value="tratamento">Tratamento</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </EntityFormDialog>
    </>
  );
}
