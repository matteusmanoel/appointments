import { useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authApi } from "@/lib/api";
import { toastSuccess, toastError } from "@/lib/toast-helpers";
import { loginErrorMessage } from "@/lib/auth-errors";
import { Info } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isFirstAccess = searchParams.get("first_access") === "1";
  const resetToken = searchParams.get("reset_token");
  const [resetPassword, setResetPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken) return;
    setResetLoading(true);
    try {
      await authApi.resetPassword(resetToken, resetPassword);
      toastSuccess("Senha redefinida. Entre com a nova senha.");
      setResetPassword("");
      navigate("/login", { replace: true });
    } catch (err) {
      toastError("Não foi possível redefinir a senha", err, "O link expirou ou já foi usado. Peça um novo em «Esqueci minha senha».");
    } finally {
      setResetLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      toastSuccess("Bem-vindo!");
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname;
      navigate(from && from.startsWith("/app") ? from : "/app", { replace: true });
    } catch (err) {
      toastError("Não foi possível entrar", err, loginErrorMessage(err));
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = forgotEmail.trim();
    if (!trimmed) return;
    setForgotLoading(true);
    try {
      await authApi.forgotPassword(trimmed);
      toastSuccess("Se houver uma conta com este e-mail, enviamos um link para redefinir a senha (vale 30 minutos). Confira também o spam.");
      setForgotOpen(false);
      setForgotEmail("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("Nenhuma conta encontrada")) {
        toastError("E-mail não cadastrado", undefined, msg || "Não há conta cadastrada com este e-mail.");
        return;
      }
      toastError("Não foi possível processar. Tente novamente em alguns minutos.", err);
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="w-full max-w-sm space-y-8 p-8 stat-card">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground">NavalhIA</h1>
          <p className="text-sm text-muted-foreground mt-1">Entre com sua conta</p>
        </div>
        {isFirstAccess && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex gap-2 text-left">
            <Info className="w-5 h-5 shrink-0 text-primary mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-0.5">Primeiro acesso após o pagamento?</p>
              <p>Use o <strong>e-mail informado no checkout</strong> e a <strong>senha temporária</strong> enviada para esse e-mail. Confira também a pasta de spam.</p>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email <span className="text-destructive">*</span></Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="password">Senha <span className="text-destructive">*</span></Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              required
              className="mt-1"
            />
          </div>
          <Button type="submit" className="w-full btn-accent" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </Button>
          <div className="text-center">
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground underline"
              onClick={() => setForgotOpen(true)}
            >
              Esqueci minha senha
            </button>
          </div>
        </form>
      </div>

      <Dialog open={!!resetToken} onOpenChange={(o) => { if (!o) navigate("/login", { replace: true }); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Definir nova senha</DialogTitle>
            <DialogDescription>Escolha uma nova senha (mínimo 8 caracteres). O link só pode ser usado uma vez.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleResetSubmit} className="space-y-4">
            <div>
              <Label htmlFor="reset-password">Nova senha</Label>
              <PasswordInput id="reset-password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} minLength={8} required className="mt-1" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={resetLoading}>{resetLoading ? "Salvando..." : "Salvar nova senha"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recuperar senha</DialogTitle>
            <DialogDescription>
              Informe o e-mail da sua conta. Se existir, enviaremos um link de uso único para você definir uma nova senha.
            </DialogDescription>
          </DialogHeader>
          {isFirstAccess && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex gap-2 text-left">
              <Info className="w-5 h-5 shrink-0 text-primary mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-0.5">Primeiro acesso após o pagamento?</p>
                <p>Use o <strong>e-mail informado no checkout</strong> e a <strong>senha temporária</strong> enviada para esse e-mail. Confira também a pasta de spam.</p>
              </div>
            </div>
          )}
          <form onSubmit={handleForgotSubmit} className="space-y-4">
            <div>
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                className="mt-1"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setForgotOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={forgotLoading}>
                {forgotLoading ? "Enviando..." : "Enviar link"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
