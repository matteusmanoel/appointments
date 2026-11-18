# Guideline — Layout mobile do painel

Padrão do chrome das rotas autenticadas (`/app`), abaixo de `md`. O desktop de cada página permanece como está. A referência viva é `src/pages/Agendamentos.tsx`.

Rotas públicas (agendamento `/b`, login, landing) não usam este padrão.

## Header

`MainLayout` mostra, no mobile: menu, logo N e o título que a página registra com `useMobilePageTitle`. Sem registro, o texto continua “NavalhIA”.

O título é curto (“Clientes”, “Início”, “Atendimento”). Não há trilha “Início / Página”.

## Corpo

- O `h1` e o subtítulo da página não se repetem no corpo no mobile. No desktop o bloco (`page-header` ou equivalente) permanece.
- Não reservar `mb-8` para um cabeçalho que o mobile não mostra. Esconder o bloco inteiro (`hidden md:flex` ou `max-md:hidden`).

## Ação de criar

A ação principal de criar vira o botão flutuante `MobileCreateButton`: `+`, canto inferior direito, safe area, `aria-label` da ação (“Adicionar barbeiro”). O botão largo some no mobile. Ações dentro de uma seção (ex.: “Adicionar exceção” em Configurações) continuam no lugar.

## Filtros

Filtro que não é a navegação da tela vai para um `Sheet` `side="bottom"`:

- Aberto por um ícone (`SlidersHorizontal`), `aria-label` “Filtros” ou “Filtros ativos”.
- Ponto no botão quando o filtro não está no padrão (status diferente de “Todos”, busca preenchida, pílula diferente de “Todos”).
- `onOpenAutoFocus` com `preventDefault`, para o teclado do iOS não abrir sozinho.
- “Limpar” e “Ver resultados”.

Busca que é o jeito de varrer a lista fica numa linha só, visível, como a faixa da semana na agenda. Navegação do período (dia, mês, intervalo) também fica visível.

## O que não entra

- Inbox de Atendimento: já ocupa a altura; só ganha o título no header.
- Desktop: título, subtítulo, botão e barras atuais.
