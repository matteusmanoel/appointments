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
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
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
import { DatePicker } from "@/components/ui/date-picker";
import { MonthPicker } from "@/components/ui/month-picker";
import { YearPicker } from "@/components/ui/year-picker";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  FiltersBar,
  FiltersBarField,
  BarbersMultiSelect,
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
  const barberParam = searchParams.get("barber_id") ?? "__all__";
  const listBarbersParam = searchParams.get("barbers");
  const statusParam = searchParams.get("status") ?? "__all__";
  const gradeViewParam = searchParams.get("grade_view") ?? "day";
  const gradeDateParam = searchParams.get("date");
  const gradeBarbersParam = searchParams.get("barbers");
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
  const [gradeBarberIds, setGradeBarberIds] = useState<string[]>(() => {
    if (gradeBarbersParam && gradeBarbersParam.trim()) {
      return gradeBarbersParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  });
  const [gradeStatus, setGradeStatus] = useState<string>(
    gradeStatusParam ?? "__all__",
  );
  const [formOpen, setFormOpen] = useState(false);
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
  const [listBarberIds, setListBarberIds] = useState<string[]>(() => {
    if (listBarbersParam && listBarbersParam.trim()) {
      return listBarbersParam.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (barberParam && barberParam !== "__all__") return [barberParam];
    return [];
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
      if (listBarberIds.length === 1) {
        params.set("barber_id", listBarberIds[0]);
      } else if (listBarberIds.length > 1) {
        params.set("barbers", listBarberIds.join(","));
      }
      if (listStatus && listStatus !== "__all__") {
        params.set("status", listStatus);
      }
    } else {
      params.set("grade_view", gradeViewMode);
      params.set("date", format(selectedDate, "yyyy-MM-dd"));
      if (gradeBarberIds.length > 0) {
        params.set("barbers", gradeBarberIds.join(","));
      }
      if (gradeStatus && gradeStatus !== "__all__") {
        params.set("status", gradeStatus);
      }
    }
    setSearchParams(params);
  }, [
    viewMode,
    listFromStr,
    listToStr,
    listBarberIds,
    listStatus,
    gradeViewMode,
    selectedDate,
    gradeBarberIds,
    gradeStatus,
    setSearchParams,
  ]);

  const resetListFilters = () => {
    const today = new Date();
    setListRange({
      from: startOfWeek(today, { weekStartsOn: 0 }),
      to: endOfWeek(today, { weekStartsOn: 0 }),
    });
    setListBarberIds([]);
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
      gradeBarberIds,
      gradeStatus,
    ],
    queryFn: () =>
      appointmentsApi.list({
        date: dateStr,
        barber_id: gradeBarberIds.length === 1 ? gradeBarberIds[0] : undefined,
        status: gradeStatus !== "__all__" ? gradeStatus : undefined,
      }),
    enabled: viewMode === "grade" && gradeViewMode === "day",
  });

  const { data: monthAppointments = [], isLoading: monthLoading } = useQuery({
    queryKey: [
      "appointments",
      "month",
      gradeMonthFrom,
      gradeMonthTo,
      gradeBarberIds,
      gradeStatus,
    ],
    queryFn: () =>
      appointmentsApi.list({
        from: gradeMonthFrom,
        to: gradeMonthTo,
        barber_id: gradeBarberIds.length === 1 ? gradeBarberIds[0] : undefined,
        status: gradeStatus !== "__all__" ? gradeStatus : undefined,
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
      listBarberIds.length === 1 ? listBarberIds[0] : listBarberIds.length > 1 ? "multi" : null,
      listStatus || null,
    ],
    queryFn: () =>
      appointmentsApi.list({
        from: listFromStr,
        to: listToStr,
        barber_id:
          listBarberIds.length === 1 ? listBarberIds[0] : undefined,
        status: listStatus && listStatus !== "__all__" ? listStatus : undefined,
      }),
    enabled: viewMode === "lista" && !!listFromStr && !!listToStr,
  });

  const listAppointments =
    listBarberIds.length >= 2
      ? listAppointmentsRaw.filter((a) =>
          a.barber_id && listBarberIds.includes(a.barber_id),
        )
      : listAppointmentsRaw;

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
    retry: false,
    staleTime: 2 * 60 * 1000,
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
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
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
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
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
      };
    }) => appointmentsApi.update(id, body),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
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
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      setCancelTarget(null);
    },
  });

  const normalizeTime = (t: string) => t.slice(0, 5);

  const gradeDayAppointments = useMemo(() => {
    if (gradeBarberIds.length > 1) {
      return appointments.filter((a) => gradeBarberIds.includes(a.barber_id));
    }
    return appointments;
  }, [appointments, gradeBarberIds]);

  const gradeBarbers = useMemo(() => {
    if (gradeBarberIds.length > 0) {
      return barbers.filter((b) => gradeBarberIds.includes(b.id));
    }
    return barbers;
  }, [barbers, gradeBarberIds]);

  const gradeMonthAppointments = useMemo(() => {
    if (gradeBarberIds.length > 1) {
      return monthAppointments.filter((a) =>
        gradeBarberIds.includes(a.barber_id),
      );
    }
    return monthAppointments;
  }, [monthAppointments, gradeBarberIds]);

  const getAppointmentForSlot = (
    list: AppointmentListItem[],
    time: string,
    barberId: string,
  ) => {
    const t = normalizeTime(time);
    return list.find(
      (apt) =>
        normalizeTime(apt.scheduled_time) === t && apt.barber_id === barberId,
    ) as Appointment | undefined;
  };

  const isSlotOccupiedByAppointment = (
    list: AppointmentListItem[],
    time: string,
    barberId: string,
  ) => {
    const slotMins = (() => {
      const [h, m] = time.split(":").map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    })();
    return list.some((apt) => {
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
    const endMins = startMins + (computedTotals.totalDuration ?? 30);
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
          queryClient.invalidateQueries({ queryKey: ["appointments"] });
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
      <div className="animate-fade-in">
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
          className="w-full"
        >
          <TabsList className="mb-4 w-full grid grid-cols-2">
            <TabsTrigger value="grade" className="gap-2">
              <LayoutGrid className="w-4 h-4" />
              Grade
            </TabsTrigger>
            <TabsTrigger value="lista" className="gap-2">
              <List className="w-4 h-4" />
              Agenda
            </TabsTrigger>
          </TabsList>

          <TabsContent value="grade" className="mt-0">
            <div className="stat-card mb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Tabs
                    value={gradeViewMode}
                    onValueChange={(v) =>
                      setGradeViewMode(v as "day" | "month" | "year")
                    }
                  >
                    <TabsList className="h-10 p-0.5 grid grid-cols-3">
                      <TabsTrigger value="day" className="text-xs">
                        Dia
                      </TabsTrigger>
                      <TabsTrigger value="month" className="text-xs">
                        Mês
                      </TabsTrigger>
                      <TabsTrigger value="year" className="text-xs">
                        Ano
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <div className="flex items-center border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      className="p-3 hover:bg-muted hover:rounded-l-lg transition-colors"
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
                      <ChevronLeft className="w-5 h-5 text-muted-foreground" />
                    </button>
                    <div className="w-[240px] flex items-center justify-center shrink-0 border-x border-border">
                      {gradeViewMode === "day" && (
                        <DatePicker
                          value={selectedDate}
                          onChange={(d) => d && setSelectedDate(d)}
                          triggerVariant="verbose"
                          className="w-full min-w-0 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium border-0 rounded-none"
                        />
                      )}
                      {gradeViewMode === "month" && (
                        <MonthPicker
                          value={selectedDate}
                          onChange={setSelectedDate}
                          className="w-full min-w-0 border-0 rounded-none justify-center"
                        />
                      )}
                      {gradeViewMode === "year" && (
                        <YearPicker
                          value={selectedDate}
                          onChange={setSelectedDate}
                          className="w-full min-w-0 border-0 rounded-none justify-center"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      className="p-3 hover:bg-muted hover:rounded-r-lg transition-colors"
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
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-10"
                      >
                        Barbeiros
                        {gradeBarberIds.length > 0 ? (
                          <span className="text-xs bg-primary/20 text-primary px-1.5 rounded">
                            {gradeBarberIds.length}
                          </span>
                        ) : null}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-56 p-2">
                      <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto">
                        {barbers.map((b) => (
                          <label
                            key={b.id}
                            className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-muted"
                          >
                            <Checkbox
                              checked={
                                gradeBarberIds.length === 0 ||
                                gradeBarberIds.includes(b.id)
                              }
                              onCheckedChange={(checked) => {
                                if (gradeBarberIds.length === 0) {
                                  setGradeBarberIds(
                                    barbers
                                      .filter((x) => x.id !== b.id)
                                      .map((x) => x.id),
                                  );
                                } else if (checked) {
                                  setGradeBarberIds((ids) =>
                                    ids.includes(b.id) ? ids : [...ids, b.id],
                                  );
                                } else {
                                  setGradeBarberIds((ids) =>
                                    ids.filter((id) => id !== b.id),
                                  );
                                }
                              }}
                            />
                            <span className="text-sm">{b.name}</span>
                          </label>
                        ))}
                      </div>
                      {gradeBarberIds.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 w-full"
                          onClick={() => setGradeBarberIds([])}
                        >
                          Limpar filtro
                        </Button>
                      )}
                    </PopoverContent>
                  </Popover>
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

            <div className="min-h-[640px]">
            {gradeViewMode === "day" && (
              <>
                {isLoading && (
                  <div className="stat-card flex min-h-[640px] items-center justify-center">
                    <LoadingState />
                  </div>
                )}
                {!isLoading && timeSlots.length === 0 && (
                  <div className="stat-card flex min-h-[640px] items-center justify-center">
                    <EmptyState
                      icon={
                        <CalendarX className="h-12 w-12" strokeWidth={1.5} />
                      }
                      title="Fechada neste dia"
                      description="Não há horários disponíveis para agendamento."
                    />
                  </div>
                )}
                {!isLoading && timeSlots.length > 0 && (
                  <div className="stat-card overflow-hidden">
                    <div className="overflow-x-auto scrollbar-thin">
                      <div
                        className="grid gap-2 mb-4 pb-4 border-b border-border min-w-[280px]"
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

                      <div className="space-y-1 max-h-[600px] overflow-y-auto scrollbar-thin">
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
                              const appointment = getAppointmentForSlot(
                                gradeDayAppointments,
                                time,
                                barber.id,
                              );
                              const occupied = isSlotOccupiedByAppointment(
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
                                      if (e.key === "Enter" || e.key === " ") {
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
                  </div>
                )}
              </>
            )}

            {gradeViewMode === "month" && (
              <>
                {monthLoading && (
                  <div className="stat-card flex min-h-[640px] items-center justify-center">
                    <LoadingState />
                  </div>
                )}
                {!monthLoading && (
                  <div className="stat-card">
                    <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground mb-2">
                      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(
                        (d) => (
                          <div key={d}>{d}</div>
                        ),
                      )}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
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
                            Record<string, { id: string; name: string; count: number }>
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
                                  {barberBadges.map(({ id: barberId, name, count }) => (
                                    <Badge
                                      key={barberId}
                                      variant="secondary"
                                      className="text-[10px] px-1 py-0 font-normal"
                                    >
                                      {name} · {count}
                                    </Badge>
                                  ))}
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
              <div className="stat-card min-h-[640px]">
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

          <TabsContent value="lista" className="mt-0">
            <div className="space-y-4">
              <FiltersBar
                left={
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
                  <BarbersMultiSelect
                    barbers={barbers.map((b) => ({ id: b.id, name: b.name }))}
                    selectedIds={listBarberIds}
                    onChange={setListBarberIds}
                  />
                }
              />
              {listLoading ? (
                <LoadingState />
              ) : listAppointments.length === 0 ? (
                <div className="stat-card flex flex-col gap-3">
                  <EmptyState
                    icon={<List className="h-12 w-12" strokeWidth={1.5} />}
                    title={
                      listBarberIds.length > 0 || listStatus !== "__all__"
                        ? "Nenhum agendamento para os filtros selecionados"
                        : "Nenhum agendamento no período"
                    }
                    description={
                      listBarberIds.length > 0 || listStatus !== "__all__"
                        ? "Tente outros filtros ou amplie o período."
                        : "Não há agendamentos no intervalo escolhido."
                    }
                  />
                  {(listBarberIds.length > 0 || listStatus !== "__all__") && (
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
                              {formatPhoneBR(apt.client_phone)}
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
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {editingAppointment && appointmentModalMode === "edit" ? (
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
              ) : (
                <Button variant="outline" onClick={() => setFormOpen(false)}>
                  {editingAppointment ? "Fechar" : "Cancelar"}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {editingAppointment && appointmentModalMode === "view" ? (
                <>
                  <Button
                    type="button"
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
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Confirmar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      inlineUpdateMutation
                        .mutateAsync({
                          id: editingAppointment.id,
                          body: { status: "completed" },
                        })
                        .then(() => {
                          toastSuccess("Marcado como concluído.");
                          setFormOpen(false);
                        })
                        .catch((e) =>
                          toastError("Não foi possível concluir.", e),
                        )
                    }
                  >
                    <BadgeCheck className="h-4 w-4 mr-2" />
                    Concluir
                  </Button>
                  <Button
                    type="button"
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
                    <UserX className="h-4 w-4 mr-2" />
                    Faltou
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setCancelTarget(editingAppointment)}
                  >
                    <Ban className="h-4 w-4 mr-2" />
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
          </div>
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
                        {formatPhoneBR(editingAppointment.client_phone)}
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
                            ? serviceLabel(selectedServices.map((s) => s.name))
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="absolute bottom-3 right-3 gap-1.5 border-border"
                  onClick={() => setAppointmentModalMode("edit")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar agendamento
                </Button>
              </div>
            )}
            {(!editingAppointment || appointmentModalMode === "edit") && (
              <div className="grid gap-4 md:grid-cols-2">
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
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
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
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
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
                        Data <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <DatePicker
                          value={
                            field.value &&
                            /^\d{4}-\d{2}-\d{2}$/.test(field.value)
                              ? new Date(field.value + "T12:00:00")
                              : null
                          }
                          onChange={(d) =>
                            d && field.onChange(format(d, "yyyy-MM-dd"))
                          }
                          placeholder="Selecione a data"
                          triggerVariant="verbose"
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
                                    ? (services.find(
                                        (s) => s.id === field.value[0],
                                      )?.name ?? "1 serviço")
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
                                        : field.value.filter(
                                            (id) => id !== s.id,
                                          );
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
                </div>

                {!editingAppointment && (
                  <FormField
                    control={form.control}
                    name="scheduled_time"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Horário <span className="text-destructive">*</span>
                        </FormLabel>
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

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
    </>
  );
}
