# Checklist comercial e de onboarding — Primeiro cliente

## Antes da venda

- [ ] Definir preço e forma de cobrança (licença única, mensalidade, suporte incluído ou separado).
- [ ] Definir SLA mínimo (ex.: resposta a incidentes em 24h úteis; janela de manutenção).
- [ ] Documentar o que está incluído no MVP (painel, WhatsApp bot, um estabelecimento por instalação) e o que é evolução futura.

## Coleta de requisitos do salão

- [ ] Nome e endereço do estabelecimento; telefone e email de contato.
- [ ] Quantidade de barbeiros e nomes (para cadastro inicial).
- [ ] Lista de serviços com preço e duração aproximada.
- [ ] Horário de funcionamento por dia da semana.
- [ ] Número de telefone WhatsApp Business para o bot (ou confirmação de que o cliente criará/vinculou).
- [ ] Quem fará o primeiro acesso ao painel (email e nome para o perfil admin).

## Entrega técnica (on-prem)

- [ ] Acesso ao servidor ou VPS (SSH ou painel) ou confirmação de que o cliente hospedará em sua própria infra.
- [ ] Domínio ou subdomínio para a aplicação e para o webhook (HTTPS obrigatório para WhatsApp).
- [ ] Execução do deploy conforme o [Runbook](RUNBOOK.md): Docker Compose, env, migrações, seed.
- [ ] Criação da primeiro estabelecimento e do perfil admin com o email acordado.
- [ ] Cadastro inicial de barbeiros e serviços (manual ou via seed customizado).
- [ ] Configuração do WhatsApp (Meta): app, webhook URL, token; teste de envio e recebimento.
- [ ] Importação e ativação dos fluxos n8n (agente + MCP Product API); configuração da API Key.
- [ ] Teste de ponta a ponta: mensagem no WhatsApp → agente → criação de agendamento → confirmação no painel.

## Pós-entrega

- [ ] Envio da documentação de operação (runbook) e dos acessos (painel, n8n, se aplicável).
- [ ] Treinamento rápido: login no painel, como cadastrar cliente/agendamento, onde ver conversas (se houver tela de logs).
- [ ] Definir canal de suporte (email/WhatsApp) e política de atualizações (ex.: aviso com 7 dias para manutenção).
- [ ] Agendar primeiro acompanhamento (ex.: em 1 semana) para dúvidas e ajustes.

## Política de updates (sugestão)

- Correções de segurança: aplicadas em janela combinada ou em até 48h, conforme criticidade.
- Novas funcionalidades: combinadas com o cliente; atualização agendada com backup prévio.
- Versão mínima suportada: informar ao cliente (ex.: "suporte garantido para versão X.Y").
