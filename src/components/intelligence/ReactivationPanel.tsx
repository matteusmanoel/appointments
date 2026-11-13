import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Users } from "lucide-react";
import { reactivationApi, type ReactivationSuggestion } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/EmptyState";
import { toastError, toastSuccess } from "@/lib/toast-helpers";

const PRESETS = [15, 30, 45, 60] as const;

function reasonLabel(row: Pick<ReactivationSuggestion, "reason" | "detail">): string {
  if (row.reason === "waitlist_missed") return "Fila de espera passou";
  if (row.reason === "no_visit") return `Sem visita há ${row.detail} dias`;
  if (row.reason === "birthday") return "Aniversário hoje";
  if (row.reason === "talked_without_booking") return "Conversou e não marcou há 30 dias";
  return row.reason;
}

function whenLabel(iso: string): string {
  const date = parseISO(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return format(date, "dd/MM 'às' HH:mm", { locale: ptBR });
}

export function ReactivationPanel() {
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<number | "milestones">("milestones");
  const [custom, setCustom] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const customN = Number(custom);
  const customValid = custom.trim() !== "" && Number.isInteger(customN) && customN >= 7 && customN <= 365;
  const windowDays = customValid ? customN : preset === "milestones" ? undefined : preset;

  const suggestions = useQuery({
    queryKey: ["intel-reactivation", windowDays ?? "milestones"],
    queryFn: () => reactivationApi.list(windowDays),
  });
  const queued = useQuery({
    queryKey: ["intel-reactivation-queue"],
    queryFn: () => reactivationApi.queued(),
    refetchInterval: 30_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["intel-reactivation"] });
    queryClient.invalidateQueries({ queryKey: ["intel-reactivation-queue"] });
  };

  const queueMutation = useMutation({
    mutationFn: (ids: string[]) => reactivationApi.queue(ids),
    onSuccess: (res) => {
      setSelected(new Set());
      refresh();
      const when = res.run_after ? whenLabel(res.run_after) : "";
      toastSuccess(
        res.queued > 0
          ? `${res.queued} na fila${when ? `, sai ${when}` : ""}.`
          : "Ninguém novo entrou na fila.",
      );
    },
    onError: (e) => toastError("Não foi possível colocar na fila.", e),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => reactivationApi.remove(id),
    onSuccess: () => {
      refresh();
      toastSuccess("Retirado da fila.");
    },
    onError: (e) => toastError("Não foi possível tirar da fila.", e),
  });

  const rows = suggestions.data ?? [];
  const queuedRows = queued.data ?? [];
  const allChecked = rows.length > 0 && rows.every((row) => selected.has(row.client_id));

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        <button
          type="button"
          className={`rounded-full px-2.5 py-1 text-xs ${
            !customValid && preset === "milestones" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
          onClick={() => {
            setPreset("milestones");
            setCustom("");
          }}
        >
          15, 30, 45 e 60
        </button>
        {PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            className={`rounded-full px-2.5 py-1 text-xs ${
              !customValid && preset === days ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
            onClick={() => {
              setPreset(days);
              setCustom("");
            }}
          >
            {days} dias
          </button>
        ))}
        <input
          type="number"
          min={7}
          max={365}
          inputMode="numeric"
          placeholder="Outro"
          aria-label="Janela de visita em dias"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-7 w-20 rounded-md border bg-background px-2 text-xs"
        />
      </div>

      {suggestions.isLoading && (
        <div className="space-y-2 p-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-10 rounded bg-muted animate-pulse" />
          ))}
        </div>
      )}
      {suggestions.isError && (
        <EmptyState
          className="my-auto min-h-[8rem] flex-1"
          icon={<Users className="h-12 w-12" strokeWidth={1.5} />}
          title="Não foi possível carregar"
          description="A lista de reativação não respondeu. Tente de novo em instantes."
        />
      )}
      {!suggestions.isLoading && !suggestions.isError && rows.length === 0 && (
        <EmptyState
          className="min-h-[8rem]"
          icon={<Users className="h-12 w-12" strokeWidth={1.5} />}
          title="Ninguém para reativar"
          description="Nenhum cliente nesta janela."
        />
      )}

      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-3 border-b px-4 py-2">
            <Checkbox
              checked={allChecked}
              onCheckedChange={(value) => setSelected(value === true ? new Set(rows.map((row) => row.client_id)) : new Set())}
              aria-label="Marcar todos"
            />
            <Button
              size="sm"
              className="ml-auto h-8"
              disabled={selected.size === 0 || queueMutation.isPending}
              onClick={() => queueMutation.mutate([...selected])}
            >
              Colocar na fila
            </Button>
          </div>
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.client_id} className="flex items-center gap-3 px-4 py-2.5">
                <Checkbox
                  checked={selected.has(row.client_id)}
                  onCheckedChange={(value) => toggle(row.client_id, value === true)}
                  aria-label={row.name ?? row.phone}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.name || "Sem nome"}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.phone}</p>
                </div>
                <span className="max-w-[11rem] text-right text-xs text-muted-foreground">{reasonLabel(row)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-auto border-t">
        <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Na fila</p>
        {queued.isLoading && <div className="mx-4 mb-3 h-8 rounded bg-muted animate-pulse" />}
        {!queued.isLoading && queuedRows.length === 0 && (
          <p className="px-4 pb-3 text-xs text-muted-foreground">Ninguém aguardando envio.</p>
        )}
        <ul className="divide-y">
          {queuedRows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name || "Sem nome"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.phone ? `${row.phone} · ` : ""}
                  sai {whenLabel(row.run_after)}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 shrink-0"
                disabled={removeMutation.isPending}
                onClick={() => removeMutation.mutate(row.id)}
              >
                Tirar
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
