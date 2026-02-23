import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type FakeContact = {
  id: string;
  name: string;
  preview: string;
  time: string;
  unread?: number;
  isOnline?: boolean;
};

const FAKE_CONTACTS: FakeContact[] = [
  { id: "1", name: "Marcos Silva", preview: "Quero remarcar pro sábado", time: "20:04", unread: 2 },
  { id: "2", name: "Ricardo Santos", preview: "Confirmado, valeu!", time: "Ontem" },
  { id: "3", name: "Bruno Costa", preview: "Tem vaga pra corte e barba?", time: "Ontem", unread: 1 },
  { id: "4", name: "João Pedro", preview: "Pode ser às 14h então", time: "Sexta-feira" },
  { id: "5", name: "Carlos Oliveira", preview: "Lembrete: seu horário é amanhã 10h", time: "Sexta-feira", unread: 1 },
  { id: "6", name: "André Lima", preview: "Preciso cancelar o de quinta", time: "Quinta-feira" },
  { id: "7", name: "Felipe Rocha", preview: "Beleza, até amanhã", time: "Quinta-feira", unread: 3 },
  { id: "8", name: "Paulo Mendes", preview: "Só barba hoje", time: "Quarta-feira" },
  { id: "9", name: "Thiago Alves", preview: "Ainda tem 15h disponível?", time: "Terça-feira", unread: 1 },
  { id: "10", name: "Rafael Souza", preview: "Qual o valor do combo?", time: "Segunda-feira" },
  { id: "11", name: "Diego Martins", preview: "Confirmar horário 11h por favor", time: "Domingo", unread: 2 },
  { id: "12", name: "Leonardo Dias", preview: "Vou precisar atrasar 30 min", time: "Sábado" },
  { id: "13", name: "Gustavo Nunes", preview: "Corte + barba amanhã", time: "Sábado", unread: 1 },
  { id: "14", name: "Rodrigo Ferreira", preview: "Tem vaga agora?", time: "Sexta-feira" },
  { id: "15", name: "Fernando Lopes", preview: "Obrigado, ficou top!", time: "Quinta-feira" },
];

function initials(name: string): string {
  const parts = name.replace(/[^a-zA-ZÀ-ÿ\s]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts[0]?.length) return parts[0].slice(0, 2).toUpperCase();
  return "?";
}

type Props = {
  className?: string;
  "aria-hidden"?: boolean;
};

export function FakeWhatsAppInbox({ className, "aria-hidden": ariaHidden }: Props) {
  return (
    <aside
      className={cn("flex flex-col w-full md:w-[320px] shrink-0 border-r bg-muted/30", className)}
      aria-label="Lista de conversas (simulada)"
      aria-hidden={ariaHidden}
    >
      <div className="shrink-0 p-3 border-b bg-muted/50">
        <h2 className="text-sm font-semibold text-foreground mb-2 px-1">
          Mensagens (simulado)
        </h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Pesquisar ou começar nova conversa"
            className="w-full pl-8 pr-3 py-2 rounded-lg border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            readOnly
            tabIndex={-1}
            aria-hidden
          />
        </div>
        <div className="flex gap-1 mt-2 overflow-x-auto">
          {["Tudo", "Não lidas", "Favoritas", "Grupos"].map((label) => (
            <span
              key={label}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                label === "Tudo" ? "bg-primary/15 text-primary" : "text-muted-foreground bg-muted/50"
              )}
              aria-hidden
            >
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0" role="list" aria-label="Conversas ilustrativas">
        <TooltipProvider delayDuration={300}>
          {FAKE_CONTACTS.map((c) => (
            <Tooltip key={c.id}>
              <TooltipTrigger asChild>
                <div
                  role="listitem"
                  tabIndex={-1}
                  aria-disabled="true"
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 border-b border-border/50 cursor-not-allowed",
                    "opacity-90 hover:bg-muted/50"
                  )}
                >
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
                      {initials(c.name)}
                    </div>
                    {c.isOnline && (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-muted/30" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{c.name}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">{c.time}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground truncate">{c.preview}</span>
                      {c.unread != null && c.unread > 0 && (
                        <span className="shrink-0 min-w-[18px] h-[18px] rounded-full bg-green-600 text-white text-[11px] font-medium flex items-center justify-center px-1">
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px]">
                Mensagens meramente ilustrativas
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>
      <p className="shrink-0 px-3 py-2 text-[10px] text-muted-foreground border-t bg-muted/30 text-center">
        Conversas são ilustrativas — a simulação acontece à direita.
      </p>
    </aside>
  );
}
