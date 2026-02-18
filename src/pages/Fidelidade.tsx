import { MainLayout } from "@/components/layout/MainLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { Trophy, Gift, Users, TrendingUp } from "lucide-react";

export default function Fidelidade() {
  return (
    <MainLayout>
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Programa de Fidelidade</h1>
          <p className="page-subtitle">
            Seu cliente volta mais quando se sente lembrado
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Em breve: programa de fidelidade com pontos e recompensas baseado nos atendimentos da sua barbearia.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Clientes Ativos"
            value="—"
            subtitle="Com pontos acumulados"
            icon={<Users className="w-6 h-6" />}
          />
          <StatCard
            title="Pontos Distribuídos"
            value="—"
            subtitle="Este mês"
            icon={<Trophy className="w-6 h-6" />}
            variant="accent"
          />
          <StatCard
            title="Recompensas Resgatadas"
            value="—"
            subtitle="Este mês"
            icon={<Gift className="w-6 h-6" />}
            variant="success"
          />
          <StatCard
            title="Taxa de Retorno"
            value="—"
            subtitle="Em breve"
            icon={<TrendingUp className="w-6 h-6" />}
          />
        </div>

        <div className="stat-card text-center py-12">
          <p className="text-muted-foreground">
            Esta seção exibirá o ranking de clientes por pontos, recompensas disponíveis e resgates assim que o programa de fidelidade estiver ativo.
          </p>
        </div>
      </div>
    </MainLayout>
  );
}
