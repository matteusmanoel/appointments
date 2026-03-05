import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { WhatsAppSetupStepper } from "./WhatsAppSetupStepper";

export function WhatsAppSetupStepperModal({
  open,
  onOpenChange,
  connectStepContent,
  onOpenHours,
  whatsappConnected = false,
  canUseWhatsApp = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectStepContent: React.ReactNode;
  onOpenHours?: () => void;
  whatsappConnected?: boolean;
  canUseWhatsApp?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<string>("connect");

  const handleOpenChange = (next: boolean) => {
    if (!next) setActiveTab("connect");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0 overflow-hidden",
          "max-w-[calc(100vw-1.5rem)] sm:max-w-[min(94vw,1000px)]",
          "w-full sm:w-[min(94vw,1000px)]",
          "h-[min(92vh,860px)] sm:h-[min(94vh,880px)]",
          "rounded-2xl border border-border/80 shadow-elevated",
          "bg-background"
        )}
        aria-describedby={undefined}
      >
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <WhatsAppSetupStepper
          connectStepContent={connectStepContent}
          onOpenHours={onOpenHours}
          whatsappConnected={whatsappConnected}
          canUseWhatsApp={canUseWhatsApp}
          showCloseButton
          onClose={() => onOpenChange(false)}
          value={activeTab}
          onValueChange={setActiveTab}
          enabled={open}
        />
            </div>
      </DialogContent>
    </Dialog>
  );
}
