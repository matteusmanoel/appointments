# ADR 0004 — A vaga que abre fura o teto; avulsa e campanha não

O ADR 0003 protege o número com 50 disparos por dia e 3 minutos entre eles. A vaga que abre compete com essa proteção: se o aviso espera, o horário passa. Mensagem avulsa e campanha, escritas pelo operador, ficavam fora da conta.

A ordem de quem ocupa o próximo intervalo é lembrete, fila de espera, cobrança de plano, reativação, mensagem avulsa, campanha. Avulsa e campanha entram nas 50 e esperam os 3 minutos.

A única exceção é o aviso automático da fila quando a vaga abre. Sai na hora, mesmo depois dos 50, e entra na soma. Continua valendo o piso de 20 minutos antes do horário. Nenhum outro disparo fura o intervalo nem o teto.

O dia pode passar de 50 só por vagas que abriram. Uma campanha não passa na frente de um lembrete. Reabrir essa exceção para campanha desfaz a proteção do número.
