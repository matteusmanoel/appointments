# NavalhIA — anúncio vertical T3 v3

Projeto Remotion autônomo (não depende do app). 15 s, 450 frames, 1080×1920, 30 fps, sem narração, só SFX sintetizados.

## Renderizar

Requisitos: Node 20.19+/22.13+, Python 3 + `numpy` (só para regenerar os SFX).

```bash
cd marketing/videos/t3-v3
npm ci
npm run render        # = bash scripts/render.sh
```

`scripts/render.sh` faz, em ordem:

1. `python3 scripts/generate_sfx.py` → `public/audio/sfx-mix.wav` (e cada efeito isolado em `public/audio/sfx/`)
2. `out/t3-v3.mp4` — H.264 (CRF 16, yuv420p) + AAC 192 kbps 48 kHz
3. `out/t3-v3-sem-audio.mp4` — mesmo stream de vídeo, sem trilha
4. `out/t3-v3-contact-sheet.png` — um frame de cada cartela
5. Mede o true peak do AAC final e falha se for ≥ −1 dBTP

Preview interativo: `npm run dev` (Remotion Studio). Para revisar a safe area, renderize com o guia:

```bash
npx remotion render T3V3 /tmp/frames --frames=0,34,104 --image-format=png \
  --props='{"showSafeArea":true,"muted":true}'
```

## Onde mexer

- `src/timeline.json` — fonte única de tempo: cenas, batidas (frame de cada letreiro) e cues de SFX. Vídeo e áudio leem o mesmo arquivo, então mudar uma batida move imagem e som juntos (rode `npm run sfx` depois).
- `src/scenes/*` — uma cena por arquivo (Gancho, Problema, Prova, Valor, Delegue/Domine, Fecho).
- `src/components/kit.tsx` — `SafeArea` (topo 269, base 384, laterais 90), `Slam` (soco de escala + tremor), `Echoes`, `Quake`, `Burst`.
- `src/theme.ts` — paleta (#4D4FEF, #FFFFFF, #0B0B0B) e Montserrat via `@remotion/google-fonts`.

Licenças e origem dos assets: ver `LICENSES.md`.
