import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectTab } from "./ConnectTab";

vi.hoisted(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

type Props = React.ComponentProps<typeof ConnectTab>;

function props(over: Partial<Props> = {}): Props {
  return {
    loading: false,
    connection: null,
    statusData: null,
    usage: null,
    webhookWarning: "",
    testTo: "",
    setTestTo: () => {},
    testText: "",
    setTestText: () => {},
    whatsappPhone: "",
    setWhatsappPhone: () => {},
    onAssume: () => {},
    onResume: () => {},
    onStart: () => {},
    onDisconnect: () => {},
    onSendTest: () => {},
    portalLoading: false,
    canUseWhatsApp: true,
    assumePending: false,
    resumePending: false,
    startPending: false,
    disconnectPending: false,
    sendTestPending: false,
    formatPhoneBR: (v) => v ?? "",
    parsePhoneBR: (v) => v.replace(/\D/g, ""),
    hasAcceptedPolicy: true,
    barbershopId: "b1",
    connectionTimeoutSeconds: 10,
    ...over,
  } as Props;
}

describe("ConnectTab: escolha do app e campo de número (A12)", () => {
  it("tem a pergunta «Qual app você usa?» e o campo de número com label visível", () => {
    render(<ConnectTab {...props()} />);
    expect(screen.getByText("Qual app você usa no celular?")).toBeTruthy();
    expect(screen.getByLabelText(/Número do WhatsApp \(opcional\)/)).toBeTruthy();
  });

  it("escolher WhatsApp comum troca o texto dos passos sem bloquear a conexão", () => {
    const onStart = vi.fn();
    render(<ConnectTab {...props({ onStart })} />);
    fireEvent.click(screen.getByLabelText("WhatsApp comum (pessoal)"));
    expect(screen.getByText(/Funciona também com o WhatsApp comum/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Conectar WhatsApp/ }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe("ConnectTab: contagem regressiva só depois que o QR aparece", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sem QR a barra não anda; com QR conta; ao zerar avisa e o aviso fica", () => {
    const onExpired = vi.fn();
    const base = props({ pairingActive: true, onPairingExpired: onExpired, connectionTimeoutSeconds: 10 });
    const { rerender } = render(<ConnectTab {...base} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("10s")).toBeTruthy(); // sem QR: tempo cheio
    expect(onExpired).not.toHaveBeenCalled();

    rerender(<ConnectTab {...base} statusData={{ qr: "AAAA" }} />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("10s")).toBeNull();
    expect(onExpired).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(onExpired).toHaveBeenCalledTimes(1);
    // o aviso de tempo esgotado não some em 8 s
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(screen.getByText(/O tempo de pareamento acabou/)).toBeTruthy();
  });
});

describe("ConnectTab: texto de uso com saída de upgrade", () => {
  it("no teto mostra o aviso e o link «Faça upgrade» para os planos", () => {
    render(
      <ConnectTab
        {...props({
          connection: { connected: true },
          usage: { used: 1000, limit: 500, softExceeded: true, hardExceeded: true },
        })}
      />,
    );
    expect(
      screen.getByText(
        /Limite de IA atingido: o atendimento automático parou de responder seus clientes até o próximo ciclo\. Responda manualmente ou faça upgrade\./,
      ),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /Faça upgrade/i });
    expect(link.getAttribute("href")).toBe("/app/planos");
  });

  it("em 80% também oferece «Faça upgrade» para evitar bloqueio", () => {
    render(
      <ConnectTab
        {...props({
          connection: { connected: true },
          usage: {
            used: 400,
            limit: 500,
            softExceeded: false,
            hardExceeded: false,
            thresholdExceeded: true,
            thresholdPct: 80,
          },
        })}
      />,
    );
    expect(screen.getByText(/Uso de IA em 80%/)).toBeTruthy();
    expect(screen.getByText(/para evitar bloqueio/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Faça upgrade/i }).getAttribute("href")).toBe("/app/planos");
  });
});
