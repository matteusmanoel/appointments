import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

const TOUR_DONE_KEY = "navalhia_setup_tour_done";
const TOUR_TRIGGER_KEY = "navalhia_show_setup_tour";

export function markSetupTourTrigger(): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(TOUR_TRIGGER_KEY, "1");
  }
}

export function shouldRunSetupTour(): boolean {
  if (typeof sessionStorage === "undefined" || typeof localStorage === "undefined") return false;
  if (localStorage.getItem(TOUR_DONE_KEY) === "1") return false;
  return sessionStorage.getItem(TOUR_TRIGGER_KEY) === "1";
}

export function runSetupTour(): Driver | null {
  if (typeof document === "undefined") return null;

  const steps = [
    {
      element: "[data-tour='configuracoes']",
      popover: {
        title: "1. Configure sua barbearia",
        description:
          "Comece por aqui. Defina o nome da sua barbearia, o horário de funcionamento e o link de agendamento (slug) que você vai compartilhar com seus clientes.",
        side: "right" as const,
        align: "start" as const,
      },
    },
    {
      element: "[data-tour='servicos']",
      popover: {
        title: "2. Cadastre seus serviços",
        description:
          "Adicione os serviços que você oferece — Corte, Barba, Combo e outros — com preço e duração. A IA usa essas informações para agendar automaticamente pelo WhatsApp.",
        side: "right" as const,
        align: "start" as const,
      },
    },
    {
      element: "[data-tour='barbeiros']",
      popover: {
        title: "3. Adicione seus barbeiros",
        description:
          "Cadastre pelo menos um barbeiro. Eles aparecerão na agenda, no link de agendamento e serão atribuídos automaticamente pela IA conforme a disponibilidade.",
        side: "right" as const,
        align: "start" as const,
      },
    },
    {
      element: "[data-tour='agendamentos']",
      popover: {
        title: "4. Acompanhe sua agenda",
        description:
          "Aqui você visualiza e gerencia todos os agendamentos — em grade diária/mensal ou em lista com filtros. Quando estiver tudo configurado, compartilhe o link e comece a receber agendamentos.",
        side: "right" as const,
        align: "start" as const,
      },
    },
  ];

  const driverObj = driver({
    showProgress: true,
    animate: true,
    allowClose: true,
    overlayOpacity: 0.6,
    stagePadding: 8,
    stageRadius: 8,
    steps,
    nextBtnText: "Próximo →",
    prevBtnText: "← Anterior",
    doneBtnText: "Começar agora",
    progressText: "{{current}} de {{total}}",
    popoverClass: "navalhia-tour-popover",
    onDestroyed: () => {
      if (typeof localStorage !== "undefined") localStorage.setItem(TOUR_DONE_KEY, "1");
      if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(TOUR_TRIGGER_KEY);
    },
  });

  driverObj.drive();
  return driverObj;
}
