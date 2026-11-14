# Licenças e origem dos assets — T3 v3.1

## Trilha musical

A trilha é uma **composição original** criada para este projeto e **sintetizada do zero** por `scripts/music_synth.py`. Usa osciladores dente-de-serra com banda limitada, filtros, senoides e ruído com seed fixa (numpy). Não há samples, loops, presets de terceiros, melodia citada nem uso de IA generativa de música.

- Estrutura:
  - Lá menor, tensão crescente na dor (filtro abrindo, bumbo 4/4, caixa e hi-hats em semicolcheia no pico);
  - virada em Fá → Sol no posicionamento (Delegue/Domine);
  - pausa para a katana;
  - resolução em Lá maior no fecho.
- Arquivos: `public/audio/stems/music.wav` (stem) e a mixagem em `public/audio/mix.wav`.
- Autoria: material original, gerado para a NavalhIA e **livre para uso comercial** pelo titular do projeto, sem royalties nem atribuição obrigatória.

## Efeitos sonoros (SFX)

Os SFX são **sintetizados do zero** por `scripts/sfx_synth.py`, usando apenas senoides, parciais metálicos e ruído branco com seed fixa (numpy). Inclui whoosh, impactos, beep de confirmação, riser, shimmer e pop, além do `katana_draw` (raspar metálico da lâmina saindo da bainha) e do `katana_slash` (corte + ressonância do aço). Nenhuma amostra, biblioteca de sons ou gravação de terceiros foi usada. Nenhum som do WhatsApp/Meta foi usado ou imitado.

- Arquivos: `public/audio/sfx/*.wav` (isolados), `public/audio/stems/sfx.wav` (bus).
- Autoria: material original, livre para uso comercial pelo titular do projeto.
- Mix: a música passa por ducking de até −9 dB sob os SFX, depois por um limiter com true peak de −2 dBTP no WAV. No AAC final, o true peak medido foi −2,0 dBTP e a loudness integrada −15,9 LUFS (o limite pedido era abaixo de −1 dBTP).

## Fonte

- **Montserrat** (Julieta Ulanovsky et al.): SIL Open Font License 1.1, carregada via `@remotion/google-fonts` (Google Fonts). Uso comercial permitido em vídeo.

## Marca

- Logo NavalhIA: `public/navalhia-logo.png` é um recorte de `public/navalhia-logo-header.png` do próprio repositório (o mesmo do header da landing), **nas cores originais e sem recolorir**: o "N" com a navalha e o "IA" em índigo, «avalh» em branco/cinza-claro. Propriedade da NavalhIA.

## Mockup de celular

- Desenhado em HTML/CSS no próprio projeto (`src/scenes/Proof.tsx`). É genérico, sem logos, ícones, cores ou sons do WhatsApp/Meta. A conversa é fictícia e traz o selo «Exemplo ilustrativo».

## Software

- **Remotion** (`remotion`, `@remotion/*` 4.0.543): licença própria da Remotion. É gratuita para pessoas físicas e empresas com até 3 pessoas; acima disso, exige Company License (https://www.remotion.dev/license). Confirmar o enquadramento da NavalhIA antes do uso comercial.
- React / React DOM: MIT.
