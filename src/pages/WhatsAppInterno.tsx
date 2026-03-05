import { useQuery } from "@tanstack/react-query";
import { whatsappApi } from "@/lib/api";
import { InboxView } from "@/components/whatsapp/InboxView";

export default function WhatsAppInterno() {
  const { data: connection, isLoading } = useQuery({
    queryKey: ["integrations", "whatsapp"],
    queryFn: () => whatsappApi.get(),
  });
  const whatsappConnected = connection?.status === "connected";

  return (
    <div className="flex flex-col h-[calc(100dvh-5.5rem)] md:h-[calc(100dvh-4rem)] min-h-0 overflow-hidden">
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Carregando...
        </div>
      ) : (
        <InboxView isActive whatsappConnected={whatsappConnected} />
      )}
    </div>
  );
}
