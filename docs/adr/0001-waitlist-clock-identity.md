# ADR 0001 — Fila de espera é um relógio

## Status

Aceito

## Contexto

`appointment_waitlist` existia só por `desired_date`. Um cancelamento às 10h avisava quem pediu 18:30. O contrato do WhatsApp trata a fila como um relógio (dia + hora + serviço), com barbeiro opcional.

## Decisão

Identidade da fila = `desired_date` + `desired_time` + `service_id`. Barbeiro opcional. Disparo avisa o primeiro da fila (não cria). Só envia se faltam ≥ 20 minutos para o slot. Linhas antigas sem hora não disparam.

## Consequências

Migration aditiva (`desired_time`). Notify casa com o horário cancelado, não com qualquer furo do dia. Reverter depois de dados reais espalha avisos errados de novo.
