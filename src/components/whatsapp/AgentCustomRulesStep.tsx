import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Pencil, Trash2, GripVertical, Download } from "lucide-react";
import type { AgentProfile, CustomRule } from "@/lib/api";
import { cn } from "@/lib/utils";

const RULE_PACKS: { id: string; name: string; rules: Omit<CustomRule, "id">[] }[] = [
  {
    id: "mais-direto",
    name: "Mais direto",
    rules: [
      { title: "Respostas objetivas", enabled: true, priority: 4, do: ["Seja direto; evite rodeios.", "Responda em uma ou duas frases quando possível."], dont: ["Não repita a pergunta do cliente."] },
    ],
  },
  {
    id: "politica-atrasos",
    name: "Política de atrasos",
    rules: [
      { title: "Atraso do cliente", enabled: true, priority: 4, do: ["Se o cliente atrasar mais de 15 min, avise que o horário pode ser remarcado.", "Ofereça reagendar para outro dia/hora."], dont: ["Não cobrar multa ou taxa sem política explícita da barbearia."] },
    ],
  },
  {
    id: "foco-conversao",
    name: "Foco em conversão",
    rules: [
      { title: "Sugerir agendamento", enabled: true, priority: 5, do: ["Sempre que listar serviços, sugira agendar um horário.", "Se o cliente demonstrar interesse, ofereça os próximos horários disponíveis."], dont: [] },
    ],
  },
];

const MAX_RULES = 30;
const PRIORITIES = [1, 2, 3, 4, 5] as const;

function parseLines(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function formatDoDont(lines: string[]): string {
  return lines.join("\n");
}

export function AgentCustomRulesStep({
  profile,
  onChange,
}: {
  profile: AgentProfile | Record<string, unknown>;
  onChange: (updates: Partial<AgentProfile>) => void;
}) {
  const p = profile as AgentProfile;
  const customRules = (p.customRules ?? []) as CustomRule[];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formPriority, setFormPriority] = useState<number>(3);
  const [formDo, setFormDo] = useState("");
  const [formDont, setFormDont] = useState("");
  const [search, setSearch] = useState("");

  const sortedRules = useMemo(() => {
    const list = [...customRules];
    list.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (a.title || "").localeCompare(b.title || "");
    });
    return list;
  }, [customRules]);

  const filteredRules = useMemo(() => {
    if (!search.trim()) return sortedRules;
    const q = search.trim().toLowerCase();
    return sortedRules.filter(
      (r) =>
        r.title?.toLowerCase().includes(q) ||
        r.do?.some((d) => d.toLowerCase().includes(q)) ||
        (r.dont ?? []).some((d) => d.toLowerCase().includes(q))
    );
  }, [sortedRules, search]);

  const openCreate = () => {
    setEditingId(null);
    setFormTitle("");
    setFormPriority(3);
    setFormDo("");
    setFormDont("");
    setDialogOpen(true);
  };

  const openEdit = (rule: CustomRule) => {
    setEditingId(rule.id);
    setFormTitle(rule.title);
    setFormPriority(Math.min(5, Math.max(1, rule.priority)) || 3);
    setFormDo(formatDoDont(rule.do ?? []));
    setFormDont(formatDoDont(rule.dont ?? []));
    setDialogOpen(true);
  };

  const handleSave = () => {
    const doLines = parseLines(formDo);
    if (!formTitle.trim() || doLines.length === 0) return;
    const dontLines = parseLines(formDont);
    const newRule: CustomRule = {
      id: editingId ?? crypto.randomUUID(),
      title: formTitle.trim(),
      enabled: true,
      priority: formPriority,
      do: doLines,
      dont: dontLines.length > 0 ? dontLines : undefined,
    };
    let next: CustomRule[];
    if (editingId) {
      next = customRules.map((r) => (r.id === editingId ? newRule : r));
    } else {
      if (customRules.length >= MAX_RULES) return;
      next = [...customRules, newRule];
    }
    onChange({ customRules: next });
    setDialogOpen(false);
  };

  const setEnabled = (id: string, enabled: boolean) => {
    onChange({
      customRules: customRules.map((r) =>
        r.id === id ? { ...r, enabled } : r
      ),
    });
  };

  const setPriority = (id: string, priority: number) => {
    onChange({
      customRules: customRules.map((r) =>
        r.id === id ? { ...r, priority } : r
      ),
    });
  };

  const remove = (id: string) => {
    onChange({ customRules: customRules.filter((r) => r.id !== id) });
  };

  const canSave = formTitle.trim().length > 0 && parseLines(formDo).length > 0;

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <Label className="text-sm font-medium">Regras customizadas</Label>
            <p className="text-xs text-muted-foreground font-normal mt-0.5">
              Instruções específicas da sua barbearia. Ordenadas por prioridade (maior = mais importante).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={customRules.length >= MAX_RULES}>
                  <Download className="h-4 w-4 mr-1.5" />
                  Importar pack
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {RULE_PACKS.map((pack) => (
                  <DropdownMenuItem
                    key={pack.id}
                    onClick={() => {
                      const existing = customRules.length;
                      if (existing + pack.rules.length > MAX_RULES) return;
                      const newRules: CustomRule[] = pack.rules.map((r) => ({
                        ...r,
                        id: crypto.randomUUID(),
                        do: r.do ?? [],
                        dont: r.dont,
                      }));
                      onChange({ customRules: [...customRules, ...newRules] });
                    }}
                  >
                    {pack.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openCreate}
              disabled={customRules.length >= MAX_RULES}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Adicionar regra
            </Button>
          </div>
        </div>
        {customRules.length > 0 && (
          <Input
            placeholder="Buscar por título ou texto da regra..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mt-2 max-w-sm"
          />
        )}
      </CardHeader>
      <CardContent className="pt-0 px-4 pb-4">
        {customRules.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Nenhuma regra customizada. Clique em &quot;Adicionar regra&quot; para criar.
          </p>
        ) : (
          <ScrollArea className="h-[280px] pr-2">
            <ul className="space-y-2">
              {filteredRules.map((rule) => (
                <li
                  key={rule.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-2.5 transition-colors",
                    rule.enabled ? "bg-background" : "bg-muted/30 opacity-75"
                  )}
                >
                  <Checkbox
                    checked={rule.enabled}
                    onCheckedChange={(c) => setEnabled(rule.id, c === true)}
                    aria-label={`Ativar ou desativar regra: ${rule.title}`}
                  />
                  <span className="text-muted-foreground shrink-0" aria-hidden>
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{rule.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {rule.do?.slice(0, 2).join(" · ") ?? "—"}
                    </p>
                  </div>
                  <Select
                    value={String(rule.priority)}
                    onValueChange={(v) => setPriority(rule.id, parseInt(v, 10))}
                  >
                    <SelectTrigger className="w-12 h-8 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => openEdit(rule)}
                    aria-label={`Editar regra: ${rule.title}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => remove(rule.id)}
                    aria-label={`Remover regra: ${rule.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar regra" : "Nova regra"}
            </DialogTitle>
            <DialogDescription>
              Defina o que o agente deve fazer (ou evitar) em situações específicas.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="rule-title">Título</Label>
              <Input
                id="rule-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Ex.: Política de atrasos"
                maxLength={120}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rule-priority">Prioridade (1–5, maior = mais importante)</Label>
              <Select
                value={String(formPriority)}
                onValueChange={(v) => setFormPriority(parseInt(v, 10))}
              >
                <SelectTrigger id="rule-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rule-do">O que fazer (uma instrução por linha, obrigatório)</Label>
              <Textarea
                id="rule-do"
                value={formDo}
                onChange={(e) => setFormDo(e.target.value)}
                placeholder="Ex.: Se o cliente atrasar mais de 15 min, avise que o horário pode ser remarcado."
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rule-dont">O que evitar (opcional, uma por linha)</Label>
              <Textarea
                id="rule-dont"
                value={formDont}
                onChange={(e) => setFormDont(e.target.value)}
                placeholder="Ex.: Não oferecer desconto por atraso."
                rows={2}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave} disabled={!canSave}>
              {editingId ? "Salvar" : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
