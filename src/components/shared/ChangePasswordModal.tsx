import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toastError, toastSuccess } from "@/lib/toast-helpers";
import { markSetupTourTrigger } from "@/lib/setup-tour";

interface ChangePasswordModalProps {
  open: boolean;
}

export function ChangePasswordModal({ open }: ChangePasswordModalProps) {
  const { refetchProfile, profile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toastError("Nova senha e confirmação não conferem.");
      return;
    }
    if (newPassword.length < 8) {
      toastError("Nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    setLoading(true);
    try {
      if (profile?.must_change_password) {
        // First access: user may have logged in via onboarding token and doesn't know the temporary password.
        await authApi.setFirstPassword(newPassword);
        toastSuccess("Senha definida com sucesso.");
      } else {
        await authApi.changePassword({
          current_password: currentPassword,
          new_password: newPassword,
        });
        toastSuccess("Senha alterada. Faça login novamente se necessário.");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // Mark tour trigger BEFORE refetch so the MainLayout useEffect sees it when profile updates
      markSetupTourTrigger();
      // Close modal immediately without waiting for profile cache to propagate
      setDone(true);
      refetchProfile();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Erro ao alterar senha");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open && !done}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Altere sua senha</DialogTitle>
          <DialogDescription>
            Por segurança, defina uma nova senha para sua conta. No primeiro acesso, você pode definir a senha sem precisar da senha temporária.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!profile?.must_change_password && (
            <div className="space-y-2">
              <Label htmlFor="current-password">Senha atual</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-password">Nova senha</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmar nova senha</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Salvando..." : "Alterar senha"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
