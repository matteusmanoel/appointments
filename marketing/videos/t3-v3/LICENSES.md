# Licenças e origem dos assets — T3 v3

## Efeitos sonoros (SFX)

Todos os sons (whooshes, impactos, snaps, ticks, pops, riser, shimmer e o beep de confirmação) são **sintetizados do zero** por `scripts/generate_sfx.py`, usando apenas senoides e ruído branco com seed fixa (numpy). Nenhuma amostra, biblioteca de sons ou gravação de terceiros foi usada; nenhum som do WhatsApp/Meta foi usado ou imitado.

- Arquivos: `public/audio/sfx-mix.wav`, `public/audio/sfx/*.wav`
- Autoria: gerados para este projeto (NavalhIA); material original, livre para uso comercial pelo titular do projeto.
- Mix: true peak −3 dBTP no WAV; no AAC final medido em −3,7 dBTP (limite pedido: abaixo de −1 dBTP).

## Fonte

- **Montserrat** (Julieta Ulanovsky et al.) — SIL Open Font License 1.1, carregada via `@remotion/google-fonts` (Google Fonts). Uso comercial permitido em vídeo.

## Marca

- Logo NavalhIA: `public/navalhia-logo-white.png`, derivado de `public/navalhia-logo-header.png` do próprio repositório (o mesmo usado no header da landing). Recolorido para branco, preservando o alfa e o recorte da navalha no "N". Propriedade da NavalhIA.

## Mockup de celular

- Desenhado em HTML/CSS no próprio projeto (`src/scenes/Proof.tsx`). Genérico, sem logos, ícones, cores ou sons do WhatsApp/Meta. Conversa fictícia, com selo «Exemplo ilustrativo».

## Software

- **Remotion** (`remotion`, `@remotion/*` 4.0.543) — licença própria da Remotion: gratuita para pessoas físicas e empresas com até 3 pessoas; acima disso exige Company License (https://www.remotion.dev/license). Confirmar o enquadramento da NavalhIA antes de usar comercialmente.
- React / React DOM — MIT.
