import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Key, Mail, BookOpen } from "lucide-react";
import { billingApi } from "@/lib/api";
import { LoadingState } from "@/components/LoadingState";

type SessionState = "loading" | "ready" | "consumed" | "error";

export default function Onboarding() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [state, setState] = useState<SessionState>("loading");
  const [data, setData] = useState<{
    email: string;
    barbershop_name?: string;
    temporary_password?: string;
    message?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError("Link inválido. Use o link enviado após o pagamento.");
      setState("error");
      return;
    }
    billingApi
      .getSession(sessionId)
      .then((res) => {
        setData(res);
        setState(res.temporary_password ? "ready" : "consumed");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Erro ao carregar dados");
        setState("error");
      });
  }, [sessionId]);

  if (state === "loading") {
    return <LoadingState fullPage className="bg-muted" />;
  }

  if (state === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <div className="bg-background rounded-lg shadow-lg p-6 max-w-md w-full text-center">
          <p className="text-destructive mb-2">{error}</p>
          <p className="text-sm text-muted-foreground mb-4">
            Próximo passo: tente novamente com o link do e-mail ou acesse o painel para configurar manualmente.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Link to="/login">
              <Button>Ir para o painel</Button>
            </Link>
            <Link to="/">
              <Button variant="outline">Voltar ao início</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-lg border max-w-lg w-full p-6 md:p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Pagamento confirmado</h1>
            <p className="text-sm text-muted-foreground">
              Sua NavalhIA foi criada
            </p>
          </div>
        </div>

        {state === "ready" && data?.temporary_password && (
          <div className="space-y-4 mb-6">
            <p className="text-sm text-muted-foreground">
              Use as credenciais abaixo para acessar o painel. Você precisará
              alterar a senha no primeiro login.
            </p>
            <div className="rounded-lg bg-muted p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">E-mail:</span>
                <span className="text-sm font-mono">{data.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Senha temporária:</span>
                <span className="text-sm font-mono select-all bg-background px-2 py-1 rounded">
                  {data.temporary_password}
                </span>
              </div>
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Guarde essa senha; ela não será exibida novamente. No primeiro
              acesso o sistema pedirá que você defina uma nova senha.
            </p>
          </div>
        )}

        {state === "consumed" && data?.message && (
          <p className="text-sm text-muted-foreground mb-6">{data.message}</p>
        )}

        <div className="rounded-lg border bg-muted/50 p-4 mb-6">
          <h2 className="font-medium flex items-center gap-2 mb-2">
            <BookOpen className="w-4 h-4" />
            Próximos passos (setup 100% self-serve)
          </h2>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>
              Faça login com o e-mail e a senha (temporária ou a que você já
              alterou) e altere a senha quando o sistema solicitar.
            </li>
            <li>
              Em <strong>Configurações</strong>, preencha o nome da NavalhIA,
              horário de funcionamento e escolha o <strong>Link de Agendamento</strong> (slug).
            </li>
            <li>
              Em <strong>Serviços</strong>, cadastre pelo menos 3 serviços (ex.: Corte, Barba, Combo).
            </li>
            <li>
              Em <strong>Barbeiros</strong>, cadastre pelo menos 1 barbeiro.
            </li>
            <li>
              Copie o link de agendamento em Configurações e compartilhe com seus clientes.
            </li>
            <li>
              <strong>Plano Profissional:</strong> em Configurações, abra &quot;WhatsApp (IA)&quot; e conecte seu número para ativar a recepcionista 24h.
            </li>
          </ol>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Link to="/login" className="flex-1">
            <Button className="w-full">Ir para o painel</Button>
          </Link>
          <Link to="/" className="flex-1">
            <Button variant="outline" className="w-full">
              Voltar ao início
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
