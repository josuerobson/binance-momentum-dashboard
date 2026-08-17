# Operação do Binance Momentum Dashboard

## Acesso

O dashboard usa autenticação local por usuário e senha. O primeiro usuário é criado sob demanda pelo procedimento de login a partir de `DASHBOARD_ADMIN_PASSWORD`; o nome padrão é `admin`, salvo quando `DASHBOARD_ADMIN_USERNAME` estiver configurado. A senha deve possuir pelo menos 12 caracteres.

As sessões são cookies HTTP-only, SameSite Lax, com validade de oito horas. A assinatura usa `DASHBOARD_JWT_SECRET`, que deve possuir pelo menos 32 caracteres. O `JWT_SECRET` built-in permanece como fallback de compatibilidade, mas a configuração recomendada para este projeto é o segredo dedicado do dashboard.

## Variáveis de ambiente

| Variável | Obrigatória | Uso | Exposição |
|---|---:|---|---|
| `DASHBOARD_ADMIN_PASSWORD` | Sim no primeiro bootstrap | Senha inicial do administrador local | Somente servidor |
| `DASHBOARD_ADMIN_USERNAME` | Não | Sobrescreve o usuário padrão `admin` | Somente servidor |
| `DASHBOARD_JWT_SECRET` | Sim | Assinatura das sessões JWT | Somente servidor |
| `BOT_API_BASE_URL` | Sim | Origem server-side de `/health` e telemetria protegida | Somente servidor |
| `DASHBOARD_API_KEY` | Sim | Header `X-Api-Key` enviado ao bot | Somente servidor |
| `BOT_LOGS_URL` | Sim | Feed público combinado de logs, consultado pelo servidor | Somente servidor |
| `EASYPANEL_BASE_URL` | Para status de infraestrutura | Origem da API Easypanel | Somente servidor |
| `EASYPANEL_API_KEY` | Para status de infraestrutura | Bearer da API Easypanel | Somente servidor |

Nenhuma dessas variáveis deve ser prefixada com `VITE_`. O cliente chama somente `/api/trpc`; URLs upstream e credenciais não são incluídas no bundle do navegador.

## Publicação

Após concluir alterações e executar `pnpm check`, `pnpm test -- --run` e `pnpm build`, deve-se criar um checkpoint no Management UI. A publicação é feita pelo botão **Publish** da interface do projeto. O agente não publica automaticamente.

A URL de preview usada durante a validação foi:

`https://3000-i5dtgj3i5r7ml4iuugra0-4d004697.us1.manus.computer/login`

A URL de preview não deve ser tratada como endereço público permanente. Depois de publicar, use o domínio exibido no painel de gerenciamento.

## Telemetria e atualização

O cliente consulta os procedimentos tRPC autenticados `telemetry.health`, `telemetry.snapshot`, `telemetry.positions`, `telemetry.signals` e `telemetry.config`. Health e snapshot são atualizados a cada três segundos; sinais e logs usam polling curto; configuração usa intervalo mais longo. O servidor aplica cache breve em memória e retorna erros tipados sem repassar detalhes de credenciais.

## Controle operacional

O dashboard é somente leitura. `DRY_RUN` é exibido como indicador informativo e não pode ser modificado pelo navegador. Alterações de ambiente, deploy e controles de segurança permanecem restritos à infraestrutura autorizada.
