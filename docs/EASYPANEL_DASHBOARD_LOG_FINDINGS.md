# Evidências dos logs do Easypanel — dashboard

Data da consulta: 2026-08-17.

Fonte fornecida pelo usuário: https://logs-do-easypanel-logs.5450wp.easypanel.host/binance/dashboard/all

## Achados

- O endpoint reporta `deploy.status: done`, mas o container `binance_dashboard` possui `linhas: 0` e informa `(container sem saída de log recente)`.
- O bloco de build reporta: `WebSocket de build falhou: Unexpected server response: 200`.
- `ultimo_erro` aparece como `null`, portanto o status `done` não comprova que exista um container ativo.
- O último deploy listado ocorreu em `2026-08-17 16:32:32`, com ação `cmsxgcevl003f07ld4bxverbv`.
- Ações anteriores incluem deploys das correções de binding de porta, CMD direto e atualização de ambiente, todos marcados como `done`, porém sem saída de container.

## Diagnóstico operacional provisório

O problema atual parece ocorrer antes do processo Node iniciar: o serviço está parado e sem stdout/stderr, enquanto a etapa de build/streaming do Easypanel falha com uma resposta WebSocket HTTP 200. Portanto, novas alterações no código de aplicação não devem ser presumidas como causa até que o build realmente produza uma imagem e o container seja iniciado.
