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
        title: "Configurações",
        description:
          "Comece aqui: defina o nome da sua NavalhIA, horário de funcionamento e o link de agendamento (slug) que seus clientes usarão.",
        side: "right",
        align: "start",
      },
    },
    {
      element: "[data-tour='servicos']",
      popover: {
        title: "Serviços",
        description: "Cadastre os serviços (Corte, Barba, Combo, etc.) com preço e duração. Recomendamos pelo menos 3.",
        side: "right",
        align: "start",
      },
    },
    {
      element: "[data-tour='barbeiros']",
      popover: {
        title: "Barbeiros",
        description: "Cadastre pelo menos um barbeiro. Eles aparecerão na agenda e no link de agendamento.",
        side: "right",
        align: "start",
      },
    },
    {
      element: "[data-tour='agendamentos']",
      popover: {
        title: "Agendamentos",
        description: "Aqui ficam todos os agendamentos. Depois de configurar o link em Configurações, compartilhe com seus clientes.",
        side: "right",
        align: "start",
      },
    },
  ];

  const driverObj = driver({
    showProgress: true,
    steps,
    nextBtnText: "Próximo",
    prevBtnText: "Anterior",
    doneBtnText: "Concluir",
    progressText: "{{current}} de {{total}}",
    onDestroyed: () => {
      if (typeof localStorage !== "undefined") localStorage.setItem(TOUR_DONE_KEY, "1");
      if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(TOUR_TRIGGER_KEY);
    },
  });

  driverObj.drive();
  return driverObj;
}
