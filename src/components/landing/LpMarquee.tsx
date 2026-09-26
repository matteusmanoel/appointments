// Infinite horizontal marquee with benefit chips — pauses on hover.
// Two identical rows side-by-side; CSS translateX(-50%) creates seamless loop.

const CHIPS: { text: string; accent?: boolean }[] = [
  { text: "✓ Secretária no WhatsApp 24h", accent: true },
  { text: "✓ Cadeiras sempre cheias" },
  { text: "✓ Cliente lembrado antes do horário", accent: true },
  { text: "✓ Quem sumiu recebe uma mensagem" },
  { text: "✓ Pronto em 30 minutos", accent: true },
  { text: "✓ Painel da sua barbearia" },
  { text: "✓ Sem fidelidade", accent: true },
  { text: "✓ Cancele quando quiser" },
  { text: "✓ Horário confirmado antes", accent: true },
  { text: "✓ Agenda organizada sozinha" },
  { text: "✓ Atendimento padronizado", accent: true },
  { text: "✓ Você só aparece para cortar" },
];

// Duplicate for seamless loop
const DOUBLE = [...CHIPS, ...CHIPS];

export function LpMarquee() {
  return (
    <div
      className="relative border-y border-white/5 bg-white/[0.015] py-3.5 overflow-hidden"
      aria-hidden="true"
    >
      {/* Left/right fade masks */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-20 z-10 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-20 z-10 bg-gradient-to-l from-background to-transparent" />

      {/* Marquee track */}
      <div className="animate-marquee flex gap-3 w-max">
        {DOUBLE.map((chip, i) => (
          <span
            key={i}
            className={
              chip.accent
                ? "shrink-0 px-3.5 py-1 rounded-full text-[12.5px] font-medium border border-primary/30 bg-primary/8 text-primary whitespace-nowrap"
                : "shrink-0 px-3.5 py-1 rounded-full text-[12.5px] font-medium border border-white/8 bg-white/[0.03] text-white/50 whitespace-nowrap"
            }
          >
            {chip.text}
          </span>
        ))}
      </div>
    </div>
  );
}
