import { Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Scissors } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const PAYMENT_LINK = import.meta.env.VITE_STRIPE_PAYMENT_LINK || "#";

export default function Landing() {
  const { profile, loading } = useAuth();
  if (loading) return null;
  if (profile) return <Navigate to="/app" replace />;
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
      <header className="border-b bg-background/80 backdrop-blur px-4 py-4 flex items-center justify-between max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <Scissors className="h-8 w-8 text-primary" />
          <span className="font-bold text-xl text-foreground">BarberFlow</span>
        </div>
        <nav className="flex items-center gap-4">
          <Link to="/login">
            <Button variant="ghost">Entrar</Button>
          </Link>
          <a href={PAYMENT_LINK} target="_blank" rel="noopener noreferrer">
            <Button>Assinar agora</Button>
          </a>
        </nav>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
          Gestão e agendamento para sua barbearia
        </h1>
        <p className="text-lg text-muted-foreground mb-8">
          Painel completo, integração com WhatsApp via n8n e agendamento online. Tudo em um só lugar.
        </p>
        <a href={PAYMENT_LINK} target="_blank" rel="noopener noreferrer">
          <Button size="lg" className="text-base">
            Começar agora
          </Button>
        </a>
        <p className="text-sm text-muted-foreground mt-6">
          Já tem conta? <Link to="/login" className="text-primary font-medium hover:underline">Fazer login</Link>
        </p>
      </main>
    </div>
  );
}
