import { useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { CheckoutModal } from "@/components/CheckoutModal";
import { SiteFooter } from "@/components/SiteFooter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  const [showCheckout, setShowCheckout] = useState(false);
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

  const fieldClass =
    "mt-1 h-14 rounded-xl border-white/15 bg-white/5 px-4 text-base text-white placeholder:text-white/30 focus-visible:ring-primary focus-visible:ring-offset-0 md:text-base";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="absolute inset-0" aria-hidden>
        <img
          src="/lp-hero-bg.jpg"
          alt=""
          className="h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-background/30" />
      </div>

      <div className="relative w-full max-w-sm space-y-8 rounded-2xl border border-white/10 bg-[#101014]/80 p-8 shadow-[0_0_80px_hsl(239_84%_62%/0.18)] backdrop-blur-md">
        <div className="text-center">
          <img
            src="/navalhia-logo-header.png"
            alt="NavalhIA"
            className="mx-auto h-10 w-auto object-contain"
          />
          <p className="mt-3 text-sm text-white/55">Entre com sua conta</p>
        </div>
        {isFirstAccess && (
          <div className="flex gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3 text-left">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm text-white/70">
              <p className="mb-0.5 font-medium text-white">Primeiro acesso após o pagamento?</p>
              <p>Use o <strong>e-mail informado no checkout</strong> e a <strong>senha temporária</strong> enviada para esse e-mail. Confira também a pasta de spam.</p>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-white/80">Email <span className="text-red-400">*</span></Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
              required
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="password" className="text-white/80">Senha <span className="text-red-400">*</span></Label>
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
              className={fieldClass}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="lp-shimmer group relative w-full overflow-hidden rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-[0_0_20px_hsl(239_84%_62%/0.4)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_48px_hsl(239_84%_62%/0.7)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-primary to-violet-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <span className="relative z-10">{loading ? "Entrando..." : "Entrar"}</span>
          </button>
          <div className="text-center">
            <button
              type="button"
              className="text-sm text-white/55 underline decoration-white/20 underline-offset-4 hover:text-white"
              onClick={() => setForgotOpen(true)}
            >
              Esqueci minha senha
            </button>
          </div>
          <p className="text-center text-sm text-white/55">
            Ainda não tem conta?{" "}
            <button
              type="button"
              className="font-semibold text-primary hover:text-primary/80"
              onClick={() => setShowCheckout(true)}
            >
              Cadastrar
            </button>
          </p>
        </form>
      </div>


      <Dialog open={!!resetToken} onOpenChange={(o) => { if (!o) navigate("/login", { replace: true }); }}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border-white/10 bg-[#0e0e0e] p-0 text-white shadow-[0_0_80px_hsl(239_84%_62%/0.22)] sm:max-w-md [&>button]:top-5 [&>button]:flex [&>button]:h-8 [&>button]:w-8 [&>button]:items-center [&>button]:justify-center [&>button]:text-white [&>button]:opacity-80 [&>button]:hover:bg-white/10 [&>button]:hover:opacity-100">
          <form onSubmit={handleResetSubmit} className="px-6 pb-6 pt-6">
            <img src="/navalhia-logo-header.png" alt="" className="mb-5 h-8 w-auto object-contain" aria-hidden />
            <DialogHeader className="mb-5 space-y-2 text-left">
              <DialogTitle className="font-display text-2xl font-bold leading-tight text-white">Definir nova senha</DialogTitle>
              <DialogDescription className="text-sm text-white/55">Escolha uma nova senha (mínimo 8 caracteres). O link só pode ser usado uma vez.</DialogDescription>
            </DialogHeader>
            <Label htmlFor="reset-password" className="text-white/80">Nova senha</Label>
            <PasswordInput id="reset-password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} minLength={8} required className={fieldClass} />
            <button
              type="submit"
              disabled={resetLoading}
              className="lp-shimmer relative mt-6 w-full overflow-hidden rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-[0_0_28px_hsl(239_84%_62%/0.55),0_0_0_1px_hsl(270_80%_72%/0.95)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-primary to-violet-500" />
              <span className="relative z-10">{resetLoading ? "Salvando..." : "Salvar nova senha"}</span>
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border-white/10 bg-[#0e0e0e] p-0 text-white shadow-[0_0_80px_hsl(239_84%_62%/0.22)] sm:max-w-md [&>button]:top-5 [&>button]:flex [&>button]:h-8 [&>button]:w-8 [&>button]:items-center [&>button]:justify-center [&>button]:text-white [&>button]:opacity-80 [&>button]:hover:bg-white/10 [&>button]:hover:opacity-100">
          <form onSubmit={handleForgotSubmit} className="px-6 pb-6 pt-6">
            <img src="/navalhia-logo-header.png" alt="" className="mb-5 h-8 w-auto object-contain" aria-hidden />
            <DialogHeader className="mb-5 space-y-2 text-left">
              <DialogTitle className="font-display text-2xl font-bold leading-tight text-white">Recuperar senha</DialogTitle>
              <DialogDescription className="text-sm text-white/55">
                Informe o e-mail da conta. Se existir, enviamos um link de uso único para você definir uma nova senha.
              </DialogDescription>
            </DialogHeader>
            {isFirstAccess && (
              <div className="mb-5 flex gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3 text-left">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="text-sm text-white/70">
                  <p className="mb-0.5 font-medium text-white">Primeiro acesso após o pagamento?</p>
                  <p>Use o <strong>e-mail informado no checkout</strong> e a <strong>senha temporária</strong> enviada para esse e-mail. Confira também a pasta de spam.</p>
                </div>
              </div>
            )}
            <Label htmlFor="forgot-email" className="sr-only">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              className={fieldClass}
            />
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                className="rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/70 transition-all hover:border-white/30 hover:bg-white/5 hover:text-white"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={forgotLoading}
                className="lp-shimmer relative flex-1 overflow-hidden rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-[0_0_28px_hsl(239_84%_62%/0.55),0_0_0_1px_hsl(270_80%_72%/0.95)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-primary to-violet-500" />
                <span className="relative z-10">{forgotLoading ? "Enviando..." : "Enviar link"}</span>
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <CheckoutModal open={showCheckout} onOpenChange={setShowCheckout} initialPlan="pro" />
      <SiteFooter className="absolute inset-x-0 bottom-0 border-t-0 pb-6 md:pb-6" />
    </div>
  );
}
