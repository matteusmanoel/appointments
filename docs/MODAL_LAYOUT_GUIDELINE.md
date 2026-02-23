# Guideline — Layout de modais (Dialog)

Padrão para modais no painel NavalhIA (Radix/shadcn `Dialog`), para evitar conteúdo encostando nas bordas e garantir scroll e footer previsíveis.

## Estrutura recomendada

- **DialogContent**: grid em 3 linhas
  - `grid grid-rows-[auto,1fr,auto]`
  - `max-h-[85vh]` (ou equivalente) e `overflow-hidden`
  - Header e footer fixos; área do meio rolável

- **Header**: `DialogHeader` — título e descrição. Não rola.

- **Body (conteúdo)**:
  - Wrapper com `overflow-y-auto overflow-x-hidden` e `min-w-0`
  - **Padding horizontal**: `px-4 sm:px-6` (evita inputs encostando)
  - **Padding vertical**: `py-4`
  - **Safe area para footer**: quando há `DialogFooter`, adicionar `pb-6` no body para o último campo não ficar escondido atrás do footer

- **Footer**: `DialogFooter` — botões (Cancelar, Salvar, etc.). Sempre visível quando existir.

## Componente base

O `EntityFormDialog` já aplica esse padrão. Para modais customizados (ex.: `DialogContent` com `className` override), replicar:

- Body: `px-4 sm:px-6 py-4` (+ `pb-6` se tiver footer)
- Scroll apenas no body, não no `DialogContent` inteiro

## Responsividade

- Mobile: `p-4` (16px) é o mínimo para não encostar
- Desktop: `sm:px-6` (24px) para conforto

## Referência

- Base UI: `src/components/ui/dialog.tsx`
- Formulários: `src/components/shared/EntityFormDialog.tsx`
