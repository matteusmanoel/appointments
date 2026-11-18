# O Fio: prompt do anúncio da NavalhIA

Anúncio de 21,2 s renderizado por código, adaptado da estrutura de "From A to Z" para o produto real.

## Antes de colar

1. Crie uma pasta vazia fora deste repositório e abra o agente de código nela.
2. Tenha Python 3 com numpy, Pillow e OpenCV, além de ffmpeg.
3. Tenha conta paga na ElevenLabs, com direito de uso comercial da voz.
4. Separe uma biblioteca de efeitos sonoros e uma trilha com licença para anúncio.
5. Troque `[CAMINHO_DO_REPO]` e `[CAMINHO_DOS_SFX]` no prompt abaixo.

## O prompt

```text
OBJETIVO
Crie um anúncio da NavalhIA (SaaS de agenda e secretária de IA no WhatsApp para barbearias) inteiramente em código, com um renderizador 2.5D em Python (numpy, Pillow, OpenCV). Duração: 19,2 s + 2 s de cartão final, 60 fps. Entregue 16:9 (1920×1080) e uma remontagem real em 9:16 (1080×1920, sem recorte: celular maior, tipografia refeita). Plano contínuo, zero cortes secos. Público: donos de barbearia, assistindo no celular, muitas vezes sem som.

Trabalhe em fases e pare para minha aprovação ao fim de cada uma (ver PROCESSO).

IDEIA
"O Fio." Fio é o gume da navalha e também uma linha. Uma única linha de luz índigo atravessa toda a jornada do cliente: nasce no gume da navalha, vira o alerta da mensagem, contorna a resposta da IA, traça o caminho até o horário na agenda, sublinha a confirmação, volta à navalha e termina encaixada no filete curvo que existe dentro do "N" do logo. O logo já é uma navalha articulada: a história termina onde a marca começa.

VISUAL
- Palco quase preto #0A0A0A, brilho índigo discreto que respira, granulação fina.
- Superfícies #121212, bordas #2E2E2E, texto #FFFFFF, texto secundário #A6A6A6.
- Linha e destaque: #5935FD, com núcleo quente quase branco. No máximo uma palavra destacada por frase.
- Verde #34B277 aparece só no status "Confirmado". Âmbar #F59E0B só no status "Pendente".
- Títulos em Space Grotesk Bold. Interface e legendas em Montserrat. Ambas têm licença aberta (Google Fonts).
- Fotos em preto e branco, com alto contraste e close em ferramentas.
- Motion blur forte, profundidade de campo curta, câmera sempre à deriva, easings longos.

ROTEIRO (segundos, 60 fps, 100 BPM: tempo = 0,6 s, compasso = 2,4 s)
Todo impacto listado cai exatamente na grade musical.

C1 0,00–2,40 O FIO. O quadro 0 já está em movimento: um risco de luz vem do fundo e, em 0,60, CORTA a tela na diagonal (tremor, estilhaços de luz, sub). A luz corre pelo gume de uma navalha em close, preto e branco.

C2 2,40–4,80 A MENSAGEM. Um celular genérico sobe e pousa em 2,40. A linha vira o brilho da notificação. Em 3,00 surge a bolha: "Fala! Tem horário amanhã às 18h?". Em 3,60 e 4,20 chegam mais duas conversas, e as linhas se abrem em leque 3D. O contador de não lidas sobe a cada entrada.

C3 4,80–7,20 A RESPOSTA. Em 4,80 a linha varre a conversa, surgem três pontos e depois o resumo:
"Rafael, fica assim, então:
✂️ Corte e Barba
💈 Lucas
📅 Amanhã às 18h
💰 R$ 55,00"
Depois: "Posso confirmar?". O cliente responde "Pode!" em 6,00. Em 6,60 chega: "✅ Agendado, Rafael! Seu horário de Corte e Barba está marcado para amanhã às 18h, com o profissional Lucas." A linha contorna o cartão e pousa no ✅.

C4 7,20–9,60 A AGENDA. Queda em 7,20: a câmera atravessa o ✅ e cai numa agenda do dia em perspectiva, com horários nas linhas e barbeiros nas colunas (Lucas, Bruno, Diego). A linha desenha o caminho pela grade até 18:00. Em 8,40 o cartão "Rafael · Corte e Barba" pousa com status "Pendente". Outros cartões entram no compasso até o dia ficar cheio.

C5 9,60–12,00 O LEMBRETE. Volta ao celular, com um selo discreto "Lembrete 24h". Mensagem:
"Fala, Rafael! Passando para confirmar seu agendamento:
✂️ Corte e Barba
💈 Lucas
📅 Amanhã às 18h
Você confirma sua presença ou prefere reagendar?"
O cliente responde "Confirmo". Em 12,00 o status vira "Confirmado" em verde, com impacto.

C6 12,00–14,40 O CORTE. A linha sai do selo e volta à navalha, repetindo o enquadramento de C1, agora em foto P&B de mãos trabalhando, com parallax em camadas. Sem rosto identificável.

C7 14,40–16,50 A PROMESSA. Em 14,40 entra "Menos faltas." Em 15,60 entra "Mais receita.", com "receita" em índigo. A linha sublinha as duas frases em trajetória ascendente.

C8 16,50–19,20 HERÓI. Respiro em 16,50, com a música em suspensão. No impacto de 16,80 a linha entra pelo pivô do "N", percorre o filete curvo e o logo se revela por máscara. A linha esfria e some por completo até 17,40. Em 18,00 entra "Agende. Automatize. Cresça."

C9 19,20–21,20 CARTÃO FINAL. Logo menor, "Pronta em 15 minutos." e "navalhia.com.br". Texto legal pequeno: "Secretária no WhatsApp e lembretes a partir do plano Profissional."

LOCUÇÃO (pt-BR)
ElevenLabs, voz masculina brasileira, grave, calma e segura, sem tom publicitário. Velocidade natural, nunca acelerada. Gere o texto completo numa chamada, faça 2 takes e fique com o mais limpo. Depois separe cada frase e posicione no início indicado. Cada frase precisa terminar antes do limite.

início | limite | fala
0,20 | 2,30 | Você, de navalha na mão.
2,55 | 4,60 | E o cliente, no WhatsApp.
4,90 | 6,90 | A NavalhIA responde.
7,30 | 9,50 | Agenda sem parar o corte.
9,90 | 11,90 | Lembra o cliente e confirma.
12,30 | 14,30 | E você só pensa no corte.
14,50 | 15,50 | Menos faltas.
15,60 | 16,45 | Mais receita.
17,10 | 18,00 | NavalhIA.
19,40 | 21,10 | Pronta em quinze minutos.

A grade de imagem é fixa. Grave a voz antes de animar e meça cada frase. Se alguma passar do limite, me proponha um texto mais curto; não altere a velocidade nem desloque os impactos.

LEGENDAS
Todas as falas aparecem na tela, em Montserrat SemiBold, legíveis sem som. Em C7 e C8 o próprio título substitui a legenda.

MÚSICA
Use a trilha licenciada que eu fornecer, em 100 BPM, ou gere em código apenas uma guia temporária para aprovar o ritmo. Clima: grave, confiante, moderno, com pegada urbana. Base contida até 7,20, bateria completa a partir da queda, elevação em 12,00, respiro em 16,50 e acorde cheio com impacto grave em 16,80, ressoando sob o cartão final.

SOM
Cerca de 60 efeitos de [CAMINHO_DOS_SFX], priorizando os gestos que contam a história: lâmina abrindo no corte de 0,60 (este som é a assinatura e retorna em 16,80), vibração do celular, estalos suaves nas bolhas, whoosh na queda, encaixe dos cartões, sino curto em "Confirmado". Nada além do impacto principal num raio de 60 ms em torno de 16,80. Mixagem: música pelo menos 12 dB abaixo de cada fala, master em -14 LUFS e -1 dBTP.

MARCA E ATIVOS
Copie de [CAMINHO_DO_REPO]/public/:
- navalhia-logo-header.png (1542×400, com transparência): logo principal. Nunca amplie acima de 100%.
- logo-v5.png: referência do símbolo "N" para traçar o caminho do filete.
Regras:
- O logo só pode mover, reduzir, esmaecer ou receber máscara. Não redesenhe nem recolora. Em repouso deve ser idêntico ao arquivo, sem nada desenhado por cima.
- Trace uma única vez o caminho do filete sobre o logo, salve em JSON e use-o como destino da linha.
- Refaça a interface em código. NÃO use lp-painel-agenda.png, lp-painel-feed.png nem lp-painel-lembretes.png: esses mockups não representam a marca atual.
- Use apenas nomes fictícios: Rafael, Lucas, Bruno, Diego.
- Não use logo ou identidade visual do WhatsApp, nem o desenho de um celular de marca real. A conversa usa interface escura neutra. "WhatsApp" aparece só como menção na fala, na legenda e no texto legal.
- Não use estatísticas nem promessas numéricas além de "15 minutos".
- Fotos: licença que permita anúncio pago, sem marcas visíveis. Registre fonte e licença em CREDITOS.md.

ARQUITETURA
- timeline.py é a fonte única dos tempos.
- fio.py contém a ÚNICA função que desenha a linha. Toda cena a chama e entrega posição, direção, intensidade e largura para a cena seguinte.
- Cada cena é um módulo independente, com layouts separados para 16:9 e 9:16.
- Faça cache das camadas estáticas e renderize em paralelo por cena.
- Prévia: 960×540, 30 fps, sem subquadros. Final: subquadros adaptativos (1 em repouso, até 8 em movimento rápido).

PROCESSO (pare e peça aprovação ao fim de cada fase)
1. Briefing: tempos em quadros, lista de ativos e riscos.
2. Ativos: fontes, fotos, caminho do filete e quadros-chave estáticos de cada cena.
3. Voz: takes, medições e timeline travada.
4. Animatic: prévia completa de baixa resolução com voz e guia musical.
5. Render 16:9 final, folha de contatos e uma rodada de ajustes.
6. Remontagem 9:16, respeitando as áreas seguras: 14% no topo, 35% na base e 6% nas laterais livres de texto.
7. Entrega final.

CRITÉRIOS DE ACEITE
- 1.272 quadros exatos por formato.
- Cada impacto no quadro previsto: 36, 144, 288, 432, 576, 720, 1008.
- Nenhum salto de posição ou brilho da linha nas passagens entre cenas.
- Logo em repouso idêntico ao arquivo original a partir de 17,40.
- Nenhum texto cortado em 9:16; título legível num celular a um braço de distância.
- Mensagem compreensível com o som desligado.
- Loudness medido e registrado no relatório final.

ENTREGA
MP4 H.264 High, yuv420p, Rec.709, 60 fps, CRF 16, AAC 48 kHz 320 kbps. Arquivos: NavalhIA_OFio_16x9.mp4, NavalhIA_OFio_9x16.mp4, stems (voz, música, efeitos), versão sem legendas, CREDITOS.md e relatório de verificação.
```
