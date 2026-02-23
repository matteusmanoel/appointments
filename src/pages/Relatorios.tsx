import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { FileDown, Columns } from "lucide-react";
import {
  appointmentsApi,
  barbersApi,
  type AppointmentListItem,
  serviceLabel,
} from "@/lib/api";
import { formatPhoneBR } from "@/lib/input-masks";
import { DateRangePicker } from "@/components/ui/date-range-picker";
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
import { Checkbox } from "@/components/ui/checkbox";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { useAuth } from "@/contexts/AuthContext";
import {
  FiltersBar,
  FiltersBarField,
  BarbersMultiSelect,
} from "@/components/appointments/FiltersBar";

const COLUMN_IDS = [
  "data",
  "hora",
  "cliente",
  "telefone",
  "barbeiro",
  "servicos",
  "status",
  "valor",
  "comissao",
] as const;

const COLUMN_LABELS: Record<(typeof COLUMN_IDS)[number], string> = {
  data: "Data",
  hora: "Hora",
  cliente: "Cliente",
  telefone: "Telefone",
  barbeiro: "Barbeiro",
  servicos: "Serviços",
  status: "Status",
  valor: "Valor",
  comissao: "Comissão",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "Faltou",
};

const STORAGE_KEY = "navalhia-reports-columns";

function getStoredColumns(profileId: string | undefined): (typeof COLUMN_IDS)[number][] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...COLUMN_IDS];
    const parsed = JSON.parse(raw) as unknown;
    const byUser = typeof parsed === "object" && parsed !== null && "profileId" in parsed
      ? (parsed as { profileId: string; columns: string[] })
      : null;
    if (byUser && byUser.profileId === profileId && Array.isArray(byUser.columns)) {
      return byUser.columns.filter((c): c is (typeof COLUMN_IDS)[number] =>
        COLUMN_IDS.includes(c as (typeof COLUMN_IDS)[number]),
      );
    }
    if (Array.isArray(parsed)) {
      return parsed.filter((c): c is (typeof COLUMN_IDS)[number] =>
        COLUMN_IDS.includes(c as (typeof COLUMN_IDS)[number]),
      );
    }
  } catch {
    // ignore
  }
  return [...COLUMN_IDS];
}

function setStoredColumns(profileId: string | undefined, columns: (typeof COLUMN_IDS)[number][]) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(profileId ? { profileId, columns } : columns),
    );
  } catch {
    // ignore
  }
}

function getCellValue(apt: AppointmentListItem, colId: (typeof COLUMN_IDS)[number]): string {
  switch (colId) {
    case "data": {
      const raw = apt.scheduled_date;
      const datePart = raw != null ? String(raw).trim().slice(0, 10) : "";
      if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return "—";
      const d = new Date(datePart + "T12:00:00");
      if (Number.isNaN(d.getTime())) return "—";
      return format(d, "dd/MM/yyyy", { locale: ptBR });
    }
    case "hora": {
      const t = apt.scheduled_time;
      if (t == null) return "—";
      const s = String(t);
      if (!/^\d{1,2}:\d{2}/.test(s)) return "—";
      return s.slice(0, 5);
    }
    case "cliente":
      return apt.client_name ?? "—";
    case "telefone":
      return apt.client_phone ? formatPhoneBR(apt.client_phone) : "—";
    case "barbeiro":
      return apt.barber_name ?? "—";
    case "servicos":
      return serviceLabel(apt.service_names, apt.service_name) || "—";
    case "status":
      return STATUS_LABELS[apt.status] ?? apt.status ?? "—";
    case "valor":
      return `R$ ${Number(apt.price).toFixed(2)}`;
    case "comissao":
      return apt.commission_amount != null
        ? `R$ ${Number(apt.commission_amount).toFixed(2)}`
        : "—";
    default:
      return "—";
  }
}

export default function Relatorios() {
  const { profile } = useAuth();
  const profileId = profile?.id;

  const [range, setRange] = useState<{ from: Date; to: Date } | null>(() => {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 1);
    return { from, to };
  });
  const [barberIds, setBarberIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [visibleColumns, setVisibleColumns] = useState<(typeof COLUMN_IDS)[number][]>(() =>
    getStoredColumns(profileId),
  );

  useEffect(() => {
    setStoredColumns(profileId, visibleColumns);
  }, [profileId, visibleColumns]);

  const fromStr = range ? format(range.from, "yyyy-MM-dd") : "";
  const toStr = range ? format(range.to, "yyyy-MM-dd") : "";

  const { data: barbers = [] } = useQuery({
    queryKey: ["barbers"],
    queryFn: () => barbersApi.list(),
  });

  const { data: appointmentsRaw = [], isLoading } = useQuery({
    queryKey: [
      "appointments",
      "reports",
      fromStr,
      toStr,
      barberIds.length === 1 ? barberIds[0] : barberIds.length > 1 ? "multi" : null,
      statusFilter,
    ],
    queryFn: () =>
      appointmentsApi.list({
        from: fromStr,
        to: toStr,
        barber_id: barberIds.length === 1 ? barberIds[0] : undefined,
        status: statusFilter !== "__all__" ? statusFilter : undefined,
      }),
    enabled: !!fromStr && !!toStr,
  });

  const appointments =
    barberIds.length >= 2
      ? appointmentsRaw.filter(
          (a) => a.barber_id && barberIds.includes(a.barber_id),
        )
      : appointmentsRaw;

  const toggleColumn = (colId: (typeof COLUMN_IDS)[number]) => {
    setVisibleColumns((prev) =>
      prev.includes(colId)
        ? prev.filter((c) => c !== colId)
        : [...prev, colId].sort(
            (a, b) => COLUMN_IDS.indexOf(a) - COLUMN_IDS.indexOf(b),
          ),
    );
  };

  const handleExportCsv = () => {
    const header = visibleColumns.map((id) => COLUMN_LABELS[id]);
    const rows = appointments.map((apt) =>
      visibleColumns.map((id) => getCellValue(apt, id)),
    );
    const content = buildCsv(header, rows);
    const filename = `agendamentos_${fromStr}_${toStr}.csv`;
    downloadCsv(content, filename);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
        <p className="text-muted-foreground mt-1">
          Agendamentos por período. Ajuste as colunas e exporte em CSV.
        </p>
      </div>

      <FiltersBar
        left={
          <FiltersBarField label="Status" width="status">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
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
            <DateRangePicker value={range} onChange={setRange} className="w-full" />
          </FiltersBarField>
        }
        right={
          <div className="flex flex-wrap items-end gap-2">
            <BarbersMultiSelect
              barbers={barbers.map((b) => ({ id: b.id, name: b.name }))}
              selectedIds={barberIds}
              onChange={setBarberIds}
            />
            <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Columns className="w-4 h-4" />
              Colunas
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            <div className="text-sm font-medium mb-2">Exibir colunas</div>
            <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto">
              {COLUMN_IDS.map((id) => (
                <label
                  key={id}
                  className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-muted"
                >
                  <Checkbox
                    checked={visibleColumns.includes(id)}
                    onCheckedChange={() => toggleColumn(id)}
                  />
                  <span className="text-sm">{COLUMN_LABELS[id]}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
            <Button
              variant="default"
              size="sm"
              className="gap-2"
              onClick={handleExportCsv}
              disabled={appointments.length === 0}
            >
              <FileDown className="w-4 h-4" />
              Exportar CSV
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <LoadingState />
      ) : appointments.length === 0 ? (
        <div className="stat-card">
          <EmptyState
            icon={<FileDown className="h-12 w-12" strokeWidth={1.5} />}
            title="Nenhum agendamento no período"
            description="Ajuste o período ou os filtros e tente novamente."
          />
        </div>
      ) : (
        <div className="stat-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {visibleColumns.map((id) => (
                    <th
                      key={id}
                      className="text-left font-medium text-foreground px-4 py-3 whitespace-nowrap"
                    >
                      {COLUMN_LABELS[id]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {appointments.map((apt) => (
                  <tr
                    key={apt.id}
                    className="border-b border-border/50 hover:bg-muted/20"
                  >
                    {visibleColumns.map((id) => (
                      <td
                        key={id}
                        className="px-4 py-2 text-muted-foreground whitespace-nowrap"
                      >
                        {getCellValue(apt, id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
