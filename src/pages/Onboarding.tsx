import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Mail, BookOpen, Loader2 } from "lucide-react";
import { billingApi, authApi } from "@/lib/api";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/contexts/AuthContext";
import { toastError, toastSuccess } from "@/lib/toast-helpers";

type SessionState = "loading" | "pending" | "ready" | "consumed" | "error";

function fetchSession(sessionId: string) {
  return billingApi.getSession(sessionId);
}

export default function Onboarding() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  const sessionId = searchParams.get("session_id");
  const [state, setState] = useState<SessionState>("loading");
  const [entering, setEntering] = useState(false);
  const [data, setData] = useState<{
    email: string;
    barbershop_name?: string;
    token?: string;
    message?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoverySending, setRecoverySending] = useState(false);
  const autoLoginStarted = useRef(false);

  const loadSession = useCallback(() => {
    if (!sessionId) {
      setError("Link inválido. Use o link enviado após o pagamento.");
      setState("error");
      return;
    }
    setState("loading");
    setError(null);
    fetchSession(sessionId)
      .then((res) => {
        setData(res);
        setState(res.token ? "ready" : "pending");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Erro ao carregar dados");
        setState("error");
      });
  }, [sessionId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // If provisioning is still happening, poll for a short period.
  useEffect(() => {
    if (state !== "pending" || !sessionId) return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      // Stop after ~45s and show fallback actions.
      if (Date.now() - startedAt > 45_000) {
        setState("consumed");
        setData((d) => d ?? { email: "", message: "Seu acesso está sendo criado. Se não entrar automaticamente, clique em Ir para o painel e use 'Esqueci minha senha'." });
        return;
      }
      try {
        const res = await fetchSession(sessionId);
        if (cancelled) return;
        setData(res);
        if (res.token) setState("ready");
      } catch {
        // Ignore transient errors during provisioning; keep polling
      }
      if (!cancelled) setTimeout(tick, 1500);
    };
    const t = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [state, sessionId]);

  // Must run unconditionally (Rules of Hooks) — used in "consumed" and "ready" UI below.
  const emailForRecovery = useMemo(() => (data?.email || recoveryEmail).trim(), [data?.email, recoveryEmail]);

  // Auto-enter as soon as the API returns a token (best UX after checkout).
  useEffect(() => {
    if (entering) return;
    if (state !== "ready") return;
    if (!data?.token) return;
    if (autoLoginStarted.current) return;
    autoLoginStarted.current = true;
    let cancelled = false;
    setEntering(true);
    (async () => {
      try {
        await loginWithToken(data.token!, { skipRefetch: true });
        if (!cancelled) navigate("/app", { replace: true });
      } catch {
        if (!cancelled) {
          autoLoginStarted.current = false;
          toastError("Não foi possível entrar automaticamente. Abra o painel e use 'Esqueci minha senha'.");
          setEntering(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.token, entering, loginWithToken, navigate, state]);

  if (state === "loading") {
    return <LoadingState fullPage className="bg-muted" />;
  }

  const handleRecoveryPassword = async (email: string) => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setRecoverySending(true);
    try {
      await authApi.forgotPassword(trimmed);
      toastSuccess("Enviamos uma senha temporária. Confira a caixa de entrada e o spam.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("Nenhuma conta encontrada")) {
        toastError("E-mail não cadastrado", undefined, msg || "Não há conta cadastrada com este e-mail.");
        return;
      }
      toastError("Não foi possível enviar. Tente novamente em alguns minutos.", err);
    } finally {
      setRecoverySending(false);
    }
  };

  if (state === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <div className="bg-background rounded-lg shadow-lg p-6 max-w-md w-full text-center">
          <p className="text-destructive font-medium mb-2">{error}</p>
          <p className="text-sm text-muted-foreground mb-2">
            Suas credenciais de acesso podem ter sido enviadas para o <strong>e-mail que você usou no pagamento</strong>. Confira a caixa de entrada e a pasta de spam.
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Não recebeu o e-mail? Informe o e-mail do pagamento abaixo e clique em <strong>Gerar nova senha</strong>. Você receberá uma senha temporária por e-mail (se o envio estiver disponível). Depois use-a na tela de login.
          </p>
          <div className="flex flex-col gap-3 mb-4 text-left">
            <Input
              type="email"
              placeholder="E-mail usado no pagamento"
              value={recoveryEmail}
              onChange={(e) => setRecoveryEmail(e.target.value)}
            />
            <Button
              variant="secondary"
              onClick={() => handleRecoveryPassword(recoveryEmail)}
              disabled={recoverySending || !recoveryEmail.trim()}
            >
              {recoverySending ? "Enviando..." : "Gerar nova senha"}
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button onClick={loadSession} variant="outline">
              Tentar novamente
            </Button>
            <Link to="/login?first_access=1">
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

  if (state === "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <div className="bg-background rounded-lg shadow-lg p-6 max-w-md w-full text-center space-y-4">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <p className="font-medium">Pagamento confirmado</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Aguarde enquanto estamos criando seu usuário e preparando o primeiro acesso.
          </p>
          {data?.message && (
            <p className="text-xs text-muted-foreground">{data.message}</p>
          )}
          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
            <Button onClick={loadSession} variant="outline">
              Atualizar
            </Button>
            <Link to="/login?first_access=1">
              <Button>Ir para o painel</Button>
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

        {state === "ready" && data?.token && (
          <div className="space-y-4 mb-6">
            <p className="text-sm text-muted-foreground">
              Seu acesso foi criado. Vamos entrar no painel e pedir para você definir sua senha.
            </p>
            <div className="rounded-lg bg-muted p-4 space-y-2">
              <div className="flex items-center gap-2 justify-center">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-mono">{data.email}</span>
              </div>
            </div>
          </div>
        )}

        {state === "consumed" && data?.message && (
          <div className="space-y-3 mb-6">
            <p className="text-sm text-muted-foreground">{data.message}</p>
            {emailForRecovery && (
              <p className="text-sm text-muted-foreground">
                Não conseguiu entrar? Clique em <strong>Gerar nova senha</strong> para receber uma senha temporária no e-mail <span className="font-mono">{emailForRecovery}</span> (se o envio estiver disponível).
              </p>
            )}
            {emailForRecovery && (
              <Button
                variant="secondary"
                onClick={() => handleRecoveryPassword(emailForRecovery)}
                disabled={recoverySending}
              >
                {recoverySending ? "Enviando..." : "Gerar nova senha"}
              </Button>
            )}
          </div>
        )}

        <div className="rounded-lg border bg-muted/50 p-4 mb-6">
          <h2 className="font-medium flex items-center gap-2 mb-2">
            <BookOpen className="w-4 h-4" />
            Próximos passos (setup 100% self-serve)
          </h2>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>
              Clique em &quot;Entrar no painel&quot; para ser logado automaticamente. Na primeira tela você definirá uma nova senha.
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
          {state === "ready" && data?.token ? (
            <Button
              className="flex-1 w-full"
              disabled={entering}
              onClick={async () => {
                setEntering(true);
                try {
                  await loginWithToken(data.token!, { skipRefetch: true });
                  navigate("/app", { replace: true });
                } catch (e) {
                  toastError("Não foi possível entrar automaticamente. Abra o painel e use 'Esqueci minha senha'.");
                  setEntering(false);
                }
              }}
            >
              {entering ? "Entrando..." : "Entrar no painel"}
            </Button>
          ) : (
            <Link to="/login?first_access=1" className="flex-1">
              <Button className="w-full">Ir para o painel</Button>
            </Link>
          )}
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
