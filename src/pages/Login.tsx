import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const { login, error, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (error) toastError("Falha no login", undefined, error);
  }, [error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      toastSuccess("Bem-vindo!");
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname;
      navigate(from && from.startsWith("/app") ? from : "/app", { replace: true });
    } catch {
      // error set in context → toast via useEffect
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = forgotEmail.trim();
    if (!trimmed) return;
    setForgotLoading(true);
    try {
      await authApi.forgotPassword(trimmed);
      toastSuccess("Se existir uma conta para este e-mail, enviamos uma senha temporária.");
      setForgotOpen(false);
      setForgotEmail("");
    } catch {
      toastError("Não foi possível processar. Tente novamente em alguns minutos.");
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
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email <span className="text-destructive">*</span></Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@navalhia.com.br"
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="password">Senha <span className="text-destructive">*</span></Label>
            <Input
              id="password"
              type="password"
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

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recuperar senha</DialogTitle>
            <DialogDescription>
              Informe o e-mail da sua conta. Se existir, enviaremos uma senha temporária. No próximo login você poderá definir uma nova senha.
            </DialogDescription>
          </DialogHeader>
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
                {forgotLoading ? "Enviando..." : "Enviar senha temporária"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
