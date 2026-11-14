# NavalhIA — anúncio vertical T3 v3.1

Projeto Remotion autônomo (não depende do app). **19,2 s, 576 frames**, 1080×1920, 30 fps, sem narração. A trilha original e os SFX são sintetizados.

## Renderizar

Requisitos: Node 20.19+/22.13+, Python 3 + `numpy` (só para regenerar o áudio).

```bash
cd marketing/videos/t3-v3
npm ci
npm run render        # = bash scripts/render.sh
```

`scripts/render.sh` faz, em ordem:

1. `python3 scripts/generate_audio.py` gera `public/audio/mix.wav`, ou seja, a música com ducking sob os SFX, mais um limiter e o true peak a −2 dBTP. Também gera os stems em `public/audio/stems/` e cada efeito isolado em `public/audio/sfx/`.
2. `out/t3-v3-1.mp4`: H.264 (CRF 16, yuv420p) + AAC 192 kbps 48 kHz.
3. `out/t3-v3-1-sem-audio.mp4`: o mesmo stream de vídeo, sem trilha.
4. `out/t3-v3-1-contact-sheet.png`: um frame de cada cartela.
5. Mede o true peak do AAC final e falha se for ≥ −1 dBTP.

A v3 (15 s) continua em `out/t3-v3*.mp4|png` como histórico.

Para o preview interativo, use `npm run dev` (Remotion Studio). Para revisar a safe area, renderize com o guia:

```bash
npx remotion render T3V3 /tmp/frames --sequence --frames=464-575 --image-format=png \
  --props='{"showSafeArea":true,"muted":true}'
```

## Cadência (v3 → v3.1)

Os cortes caem na grade da música: 112,5 BPM, ou seja, 1 tempo = 16 frames.

| Cartela | v3 (frames) | v3.1 (frames) |
| --- | --- | --- |
| Você é | 0–18 (18) | 0–16 (16) |
| BARBEIRO | 18–42 (24) | 16–56 (**40**) |
| ou | 42–50 (8) | 56–64 (8) |
| ATENDENTE? | 50–75 (25) | 64–96 (32) |
| PARE DE PERDER CLIENTE. | 75–114 (39) | 96–128 (32) |
| Marca. Remarca. Avisa. | 114–150 (36) | 128–168 (40) |
| Prova (chat) | 150–225 (75) | 168–296 (**128**) |
| CADEIRA VAZIA NÃO PAGA CONTA. | 225–265 (40) | 296–336 (40) |
| LEMBRETES + REATIVAÇÕES / OCUPAÇÃO | 265–305 (40) | 336–384 (48) |
| $MAIS FATURAMENTO$ | 305–345 (40) | 384–416 (32) |
| Delegue / Domine | 345–390 (45) | 416–464 (48) |
| Fecho (katana → logo → texto → botão) | 390–450 (60) | 464–576 (**112**) |
| **Total** | **450 (15 s)** | **576 (19,2 s)** |

## Onde mexer

- `src/timeline.json` é a fonte única de tempo: cenas, batidas (o frame de cada letreiro), grade da música e cues de SFX. Vídeo, SFX e música leem o mesmo arquivo, então mudar uma batida move imagem e som juntos. Rode `npm run audio` depois.
- `src/scenes/*` tem uma cena por arquivo: Gancho, Problema, Prova, Valor, Delegue/Domine e Fecho. O golpe de katana e o botão CTA estão em `Close.tsx`.
- `src/components/kit.tsx` traz:
  - `SafeArea` (topo 269, base 384, laterais 90);
  - `Slam` (soco de escala + tremor);
  - `Echoes`, `Quake` e `Burst`.
- `src/theme.ts` define a paleta (#4D4FEF, #FFFFFF, #0B0B0B) e carrega a Montserrat via `@remotion/google-fonts`.
- `scripts/sfx_synth.py` gera os SFX (incluindo `katana_draw` e `katana_slash`).
- `scripts/music_synth.py` gera a trilha original.
- `scripts/generate_audio.py` faz a mixagem: ducking, limiter e true peak.

Para licenças e origem dos assets, ver `LICENSES.md`.
