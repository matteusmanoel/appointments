import { Link } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, MessageCircle, Clock, Brain, Send, Bell, Key, AlertCircle } from "lucide-react";
import { getWhatsAppSupportUrl } from "@/lib/whatsapp-sales";

export default function AjudaWhatsApp() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Tutorial: Configurar o WhatsApp
        </h1>
        <p className="text-muted-foreground mt-1">
          Passo a passo das configurações que você faz na tela <strong>Integrações</strong>, na mesma ordem das abas.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Plano <strong>Essencial</strong> não tem WhatsApp com IA — use o link de agendamento. Se você vê as abas abaixo na tela Integrações, seu plano é Profissional ou Premium.
        </p>
      </div>

      <Accordion type="single" collapsible className="w-full space-y-1" defaultValue={["connect"]}>
        <AccordionItem value="connect" className="rounded-xl border bg-card/50 px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary shrink-0" />
              Conectar
            </span>
          </AccordionTrigger>
          <AccordionContent className="text-muted-foreground text-sm space-y-2 pb-4">
            <p>Marque os dois checkboxes de uso responsável e clique em <strong>Conectar WhatsApp</strong>. Escaneie o QR no celular (WhatsApp → Aparelhos conectados) ou use o código de 8 dígitos. Depois use <strong>Mensagem de teste</strong> para confirmar. Se algo falhar, use <strong>Testar conectividade</strong> (API e Uazapi).</p>
            <p className="text-xs">Aviso de webhook: se aparecer, o endereço que recebe as mensagens pode estar incorreto no servidor — sem isso o sistema não recebe mensagens.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="hours" className="rounded-xl border bg-card/50 px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary shrink-0" />
              Horários
            </span>
          </AccordionTrigger>
          <AccordionContent className="text-muted-foreground text-sm space-y-2 pb-4">
            <p>Configure o <strong>horário semanal</strong> (início e fim por dia) e clique em <strong>Salvar horários</strong>. Use <strong>Adicionar exceção</strong> para feriados ou fechamentos. O agente não sugere horários fora do expediente.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="brain" className="rounded-xl border bg-card/50 px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary shrink-0" />
              Cérebro
            </span>
          </AccordionTrigger>
          <AccordionContent className="text-muted-foreground text-sm space-y-2 pb-4">
            <p>Defina identidade, tom e comportamento. Use <strong>Salvar rascunho</strong> para não perder alterações. O agente só usa as mudanças depois que você <strong>Publicar</strong> na aba Testar e publicar. Plano Premium: pode enviar documentos na <strong>Base de conhecimento</strong> (PDF, Word, texto).</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="preview" className="rounded-xl border bg-card/50 px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <Send className="h-4 w-4 text-primary shrink-0" />
              Testar e publicar
            </span>
          </AccordionTrigger>
          <AccordionContent className="text-muted-foreground text-sm space-y-2 pb-4">
            <p>Simule uma conversa para validar as respostas. Quando estiver satisfeito, clique em <strong>Publicar</strong>. Para voltar atrás, escolha uma versão anterior na lista e use <strong>Reverter</strong>.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="notifications" className="rounded-xl border bg-card/50 px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary shrink-0" />
              Notificações
            </span>
          </AccordionTrigger>
          <AccordionContent className="text-muted-foreground text-sm space-y-2 pb-4">
            <p>Lembretes (24h e 2h antes) e follow-up (ex.: 30 dias sem agendar). Requer número conectado e serviço de mensagens ativo. Acompanhe os créditos de follow-up e a lista de mensagens agendadas (Na fila, Enviado, Falhou).</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="api-keys" className="rounded-xl border bg-card/50 px-4">
          <AccordionTrigger className="hover:no-underline py-4">
            <span className="flex items-center gap-2">
              <Key className="h-4 w-4 text-primary shrink-0" />
              Chaves de API
            </span>
          </AccordionTrigger>
          <AccordionContent className="text-muted-foreground text-sm space-y-2 pb-4">
            <p>Para n8n ou outras integrações: crie uma chave, copie e guarde (ela só aparece uma vez). Use o cabeçalho <code className="rounded bg-muted px-1 text-xs">X-API-Key</code> nas requisições. Revogar invalida a chave.</p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0" />
            <span className="font-medium text-foreground">Se der errado</span>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p><strong>Fica em &quot;Conectando…&quot;</strong> — Celular com internet; feche outras sessões WhatsApp Web; use Testar conectividade.</p>
          <p><strong>IA não responde</strong> — Confirme que está Conectado, que você Publicou na aba Testar e publicar, e que não atingiu o limite de mensagens.</p>
          <p><strong>Falha ao carregar (Notificações)</strong> — Tente &quot;Tentar novamente&quot;; pode ser worker de mensagens parado.</p>
          <p><strong>Base de conhecimento &quot;não configurada&quot;</strong> — Ambiente sem armazenamento de documentos; consulte suporte.</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 pt-4 border-t border-border">
        <div className="flex flex-wrap gap-3">
          <Button variant="default" size="sm" asChild>
            <Link
              to="/app/integracoes?step=connect"
              className="inline-flex items-center gap-2"
            >
              <MessageCircle className="h-4 w-4" />
              Ir para Integrações
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link
              to="/docs"
              className="inline-flex items-center gap-2"
            >
              <BookOpen className="h-4 w-4" />
              Documentação da API (para desenvolvedores)
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="inline-flex items-center gap-2 border-green-600/50 text-green-700 dark:text-green-400 hover:bg-green-500/10 hover:text-green-600 dark:hover:text-green-300"
            asChild
          >
            <a
              href={getWhatsAppSupportUrl()}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="h-4 w-4" />
              Suporte via WhatsApp
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
