import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { barbershopsApi } from "@/lib/api";
import { withToast } from "@/lib/toast-helpers";
import { LoadingState } from "@/components/LoadingState";

export default function LinkPublico() {
  const queryClient = useQueryClient();
  const [slugEdit, setSlugEdit] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  const { data: barbershop, isLoading } = useQuery({
    queryKey: ["barbershop"],
    queryFn: () => barbershopsApi.get(),
    retry: false,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (barbershop?.slug != null) setSlugEdit(barbershop.slug);
  }, [barbershop?.slug]);

  const patchMutation = useMutation({
    mutationFn: (body: { slug?: string }) => barbershopsApi.patch(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["barbershop"] }),
  });

  const bookingLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/b/${slugEdit || barbershop?.slug || ""}`
      : "";
  const slugValid = /^[a-z0-9-]{2,80}$/.test(slugEdit);

  const onSubmit = async () => {
    if (!slugValid) return;
    await withToast(patchMutation.mutateAsync({ slug: slugEdit }), {
      successMessage: "Link atualizado.",
      errorMessage: "Erro ao salvar link.",
    });
  };

  const copyBookingLink = () => {
    if (!bookingLink) return;
    navigator.clipboard.writeText(bookingLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  if (isLoading) return <LoadingState />;

  return (
    <div className="animate-fade-in">
      <div className="page-header mb-8">
        <h1 className="page-title">Link Público de Agendamento</h1>
        <p className="page-subtitle">
          Compartilhe este link para seus clientes agendarem online
        </p>
      </div>

      <div className="stat-card max-w-2xl space-y-6">
        <div>
          <Label htmlFor="booking-link" className="text-sm font-medium">
            Link público
          </Label>
          <div className="flex gap-2 mt-1">
            <Input
              id="booking-link"
              readOnly
              value={bookingLink}
              className="font-mono text-sm"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyBookingLink}
                  aria-label={linkCopied ? "Copiado" : "Copiar link"}
                >
                  {linkCopied ? (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-white">
                      <Check className="h-3 w-3" strokeWidth={2.5} />
                    </span>
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="z-[100]">
                {linkCopied ? "Copiado!" : "Copiar"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div>
          <Label htmlFor="slug-edit" className="text-sm font-medium">
            Slug (parte do link)
          </Label>
          <Input
            id="slug-edit"
            value={slugEdit}
            onChange={(e) =>
              setSlugEdit(
                e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
              )
            }
            placeholder="minha-navalhia"
            className="mt-1 font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Apenas letras minúsculas, números e hífens (2–80 caracteres).
          </p>
        </div>
        <Button
          onClick={onSubmit}
          disabled={patchMutation.isPending || !slugValid}
        >
          Salvar slug
        </Button>
      </div>
    </div>
  );
}
