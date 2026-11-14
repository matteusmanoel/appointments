import { Link } from "react-router-dom";
import { SiteFooter } from "@/components/SiteFooter";
import { ATTRIBUTION_TTL_MS, CONSENT_NOTICE_VERSION } from "@/lib/tracking";

const RETENTION_DAYS = Math.round(ATTRIBUTION_TTL_MS / (24 * 60 * 60 * 1000));

/** Marcador de campo que o jurídico precisa preencher. NÃO invente dados da empresa aqui. */
function Placeholder({ children }: { children: string }) {
  return <mark className="rounded bg-yellow-300/20 px-1 text-yellow-200">[{children}]</mark>;
}

/**
 * RASCUNHO da Política de Privacidade, pendente de revisão jurídica (Mateus).
 * Cobre o que o código faz hoje com pixels de marketing e atribuição. Não cobre ainda
 * os demais tratamentos (conta, agenda, WhatsApp, pagamentos). Não publicar como definitiva.
 */
export default function Privacidade() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-4 py-10 leading-relaxed">
        <div
          role="note"
          className="mb-8 rounded-xl border border-yellow-300/40 bg-yellow-300/10 p-4 text-sm text-yellow-100"
        >
          <p className="font-semibold">RASCUNHO — pendente de revisão jurídica</p>
          <p className="mt-1">
            Este texto ainda não foi revisado pelo Mateus nem por um advogado e não é a versão final. Os campos em
            destaque precisam ser preenchidos antes da publicação.
          </p>
        </div>

        <p className="text-sm">
          <Link to="/" className="underline underline-offset-4">
            ← Voltar ao início
          </Link>
        </p>
        <h1 className="mt-4 text-3xl font-bold">Política de Privacidade</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Versão do texto: {CONSENT_NOTICE_VERSION} (rascunho). Última atualização: <Placeholder>DATA DE PUBLICAÇÃO</Placeholder>
        </p>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">1. Quem é o controlador</h2>
          <p>
            O NavalhIA é operado por <Placeholder>RAZÃO SOCIAL</Placeholder>, CNPJ <Placeholder>CNPJ</Placeholder>,
            com sede em <Placeholder>ENDEREÇO COMPLETO</Placeholder>. Contato sobre privacidade e encarregado (DPO):{" "}
            <Placeholder>E-MAIL OU CANAL DE CONTATO DO ENCARREGADO</Placeholder>.
          </p>
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">2. Dados de marketing que tratamos</h2>
          <p>Estes dados só são tratados se você aceitar no banner de cookies:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Cookies e identificadores dos pixels da Meta e do TikTok (por exemplo <code>_fbp</code>, <code>_fbc</code>{" "}
              e <code>_ttp</code>) e os eventos que enviamos a eles: visita à página inicial, visualização dos planos,
              início de checkout e compra (com plano e valor).
            </li>
            <li>
              Dados de atribuição: os parâmetros UTM (<code>utm_source</code>, <code>utm_medium</code>,{" "}
              <code>utm_campaign</code>, <code>utm_term</code>, <code>utm_content</code>) e os identificadores de clique
              (<code>fbclid</code>, <code>ttclid</code>, <code>gclid</code>) do link pelo qual você chegou. Ficam
              guardados neste navegador por até {RETENTION_DAYS} dias (primeiro e último acesso).
            </li>
            <li>
              Registro da sua escolha: aceite ou recusa, data e hora e a versão do texto do banner, guardados neste
              navegador e também no checkout, se você chegar a ele.
            </li>
          </ul>
          <p>
            Não enviamos aos pixels páginas de login, redefinição de senha, retorno de pagamento, agendamento,
            reagendamento, cancelamento nem o painel. Nesses endereços nenhum evento é disparado.
          </p>
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">3. Para que usamos e em que base legal</h2>
          <p>
            Medir e melhorar nossos anúncios e entender de onde vêm os clientes. A base legal é o seu consentimento
            (LGPD, art. 7º, I), que você pode revogar a qualquer momento. Sem o consentimento nada disso é coletado e o
            serviço funciona normalmente. <Placeholder>COMPLETAR: demais finalidades e bases legais (conta, contrato, pagamento, obrigações legais)</Placeholder>
          </p>
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">4. Com quem compartilhamos</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Meta Platforms</strong> (Facebook e Instagram): recebe os eventos e identificadores do pixel da Meta.
            </li>
            <li>
              <strong>TikTok</strong>: recebe os eventos e identificadores do pixel do TikTok.
            </li>
            <li>
              <strong>Stripe</strong>: processa os pagamentos. Se você aceitou o banner, recebe também os dados de
              atribuição (UTM e identificadores de clique), a escolha de consentimento e a versão do texto, gravados no
              registro do checkout e da assinatura.
            </li>
          </ul>
          <p>
            <Placeholder>COMPLETAR: razão social, país e contato de cada destinatário, e demais operadores (hospedagem, e-mail, WhatsApp)</Placeholder>
          </p>
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">5. Transferência internacional</h2>
          <p>
            Meta, TikTok e Stripe tratam dados fora do Brasil (por exemplo nos Estados Unidos). A transferência
            acontece com o seu consentimento específico dado no banner e, quando aplicável, com as garantias do art. 33
            da LGPD. <Placeholder>COMPLETAR: mecanismo de transferência de cada destinatário (cláusulas-padrão, decisão de adequação, etc.)</Placeholder>
          </p>
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">6. Por quanto tempo</h2>
          <p>
            A atribuição fica neste navegador por até {RETENTION_DAYS} dias. Os cookies seguem os prazos definidos pela
            Meta e pelo TikTok. O registro da escolha fica até você apagar os dados do navegador ou mudar a escolha.
            Dados já enviados ao Stripe seguem o prazo da conta de pagamento.{" "}
            <Placeholder>COMPLETAR: prazos de retenção dos demais dados</Placeholder>
          </p>
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">7. Como mudar ou revogar sua escolha</h2>
          <p>
            Use o link <strong>Cookies</strong> no rodapé do site para reabrir o banner e escolher Recusar. Ao recusar,
            revogamos o consentimento na Meta e no TikTok, apagamos os cookies <code>_fbp</code>, <code>_fbc</code> e{" "}
            <code>_ttp</code> e a atribuição guardada, e recarregamos a página para descarregar os scripts. Você também
            pode apagar cookies e dados do site pelo navegador. Para voltar a aceitar, use o mesmo link.
          </p>
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">8. Seus direitos</h2>
          <p>
            Pela LGPD (art. 18) você pode pedir confirmação do tratamento, acesso, correção, anonimização, bloqueio ou
            eliminação, portabilidade, informação sobre compartilhamento, e revogar o consentimento. Escreva para{" "}
            <Placeholder>E-MAIL OU CANAL DE CONTATO DO ENCARREGADO</Placeholder>. Você também pode reclamar à
            Autoridade Nacional de Proteção de Dados (ANPD).
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
