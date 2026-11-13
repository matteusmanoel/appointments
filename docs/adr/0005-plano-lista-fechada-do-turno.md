# ADR 0005 — O Plano é a lista fechada do que o turno executa

Na suíte ao vivo de 30/09/2026 o orquestrador marcava o turno como sem gravação e o modelo gravava mesmo assim. Fila sem serviço, “fica sim” e “por gentileza” saíram daí. Quando a consulta falhava, o turno virava handoff e a conversa pausava por horas.

O Plano do turno é a lista fechada do que pode executar. O loop do modelo continua, mas tool de gravação que não está no Plano não executa e não vira handoff. Consulta só roda se o Plano pediu. Falha de consulta pergunta o que falta. Pausa com handoff fica no que o glossário já define: dois turnos seguidos abaixo de 0,35, ou a pessoa pediu alguém.

Ficaram de fora reforçar só o prompt de “não grave”, que a suíte mostrou que não segura, e tirar o loop de tools de uma vez, que é o ADR 0002 inteiro e maior do que esta leva.
