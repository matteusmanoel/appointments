import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/button";

/** Tela de erro amigável (substitui o «Unexpected Application Error» com stack trace do React Router). */
export function RouteError() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error("[RouteError]", error);
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" role="alert">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-xl font-semibold">{notFound ? "Página não encontrada" : "Algo deu errado por aqui"}</h1>
        <p className="text-sm text-muted-foreground">
          {notFound
            ? "O endereço não existe ou mudou."
            : "Não conseguimos carregar esta tela. Tente de novo em instantes; se continuar, fale com a barbearia ou com o suporte."}
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
          <Button asChild variant="outline">
            <Link to="/">Ir para o início</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
