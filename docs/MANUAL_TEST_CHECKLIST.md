# Checklist de teste manual – fluxos críticos

Use este checklist após implementações para validar os fluxos principais.

## Agendamentos (área logada)
- [ ] Criar agendamento em slot livre: preencher cliente, barbeiro, serviço, data/hora e salvar; agendamento aparece na grade.
- [ ] **Multi-serviço:** criar agendamento com 2+ serviços (seleção múltipla); preço e duração somados; exibição "Corte + 1" ou equivalente.
- [ ] **Multi-serviço:** editar agendamento e alterar lista de serviços; salvar; totais e exibição atualizam.
- [ ] Tentar criar outro agendamento no mesmo horário/barbeiro: deve exibir toast "Horário já ocupado para este barbeiro" com sugestão.
- [ ] Editar agendamento: alterar data/horário e salvar; grade atualiza.
- [ ] Cancelar agendamento: menu "..." → Excluir; confirmar; agendamento some da grade.
- [ ] **Vista Lista:** abas Grade | Lista; na Lista, filtrar por período, barbeiro e status; tabela com ações.
- [ ] Navegar entre dias (setas): slots respeitam horário de funcionamento; dia fechado mostra "Barbearia fechada neste dia".

## Configurações
- [ ] Dados da Barbearia: abrir modal; loading/skeleton enquanto carrega; editar e salvar; dados persistem.
- [ ] Horário de Funcionamento: abrir modal; marcar/desmarcar dias; alterar início/fim; salvar; em Agendamentos, slots do dia refletem o novo horário.
- [ ] Link de Agendamento: abrir modal; link exibido; "Copiar" copia URL; editar slug (apenas a-z, 0-9, -); salvar; link atualizado.
- [ ] **Segurança – Alterar senha:** clicar em Segurança; modal "Alterar senha"; preencher senha atual, nova (mín. 8) e confirmação; salvar; toast de sucesso; senha incorreta exibe erro.

## Dashboard
- [ ] Faturamento Semanal: gráfico carrega (últimos 7 dias); sem dados mostra "Sem dados no período"; erro mostra mensagem.
- [ ] Serviços Mais Contratados: gráfico carrega (mês atual); sem dados/erro tratados; **multi-serviço:** contagem por serviço no agendamento (cada linha de appointment_services).
- [ ] Taxa de Ocupação: baseada em capacidade real (horário de funcionamento × barbeiros ativos) e minutos agendados (pending/confirmed/completed).

## Agendamento público (/b/:slug)
- [ ] Acessar `/b/{slug}` (slug da barbearia): carrega nome da barbearia.
- [ ] Passo 1: **multi-serviço** – escolher um ou mais serviços; continuar.
- [ ] Passo 2: escolher barbeiro e continuar.
- [ ] Passo 3: escolher data; slots disponíveis (não ocupados); escolher horário e continuar.
- [ ] Passo 4: preencher nome e telefone; confirmar; tela de sucesso; agendamento (com todos os serviços) aparece em Agendamentos (área logada) como pendente.

## Serviços
- [ ] Novo serviço: preço padrão 35; criar e salvar; lista atualiza.
- [ ] Editar/Excluir via menu "..." funciona.

## Testes unitários
- [ ] `npm run test` (Vitest): testes de `getTimeSlotsForDay` e `serviceLabel` passam.
