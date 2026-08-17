# Revisão de segurança

**Data da revisão:** 17 de agosto de 2026.

## Identidade e sessão

A aplicação não usa OAuth nem login Manus. O fluxo usa usuário e senha locais, hash `scrypt`, bootstrap condicionado a `DASHBOARD_ADMIN_PASSWORD` e sessões JWT com cookie HTTP-only, SameSite Lax e validade limitada. O segredo dedicado `DASHBOARD_JWT_SECRET` é validado com mínimo de 32 caracteres.

A proteção tRPC verifica a presença de `ctx.user` antes de executar telemetria, logs, atividades e status de infraestrutura. O teste `server/telemetry.protection.test.ts` confirma que chamadas sem sessão retornam `UNAUTHORIZED`, e `server/auth.bootstrap.secret.test.ts` valida o bootstrap e a emissão de cookie usando os secrets do ambiente.

## Segredos e upstreams

`DASHBOARD_API_KEY` é enviado somente pelo servidor no header `X-Api-Key` para `/api/snapshot`, `/api/signals` e `/api/config`. As URLs do bot, do feed de logs e do Easypanel também são lidas somente em `server/_core/env.ts`. O browser acessa apenas `/api/trpc`; não existe chamada cliente direta aos upstreams.

O feed de logs é normalizado e filtrado no servidor. O cache é curto, em memória, e não persiste saldos, posições, mensagens ou credenciais no banco. O endpoint de logs é somente leitura. CORS dos serviços externos não é requisito do caminho normal, pois não há consumo direto pelo navegador.

## Escopo de operações

O cliente não possui mutações de configuração do bot, deploy, alteração de ambiente ou controle de `DRY_RUN`. O modo `DRY_RUN` aparece somente como indicador informativo. O status do Easypanel exposto ao cliente é uma seleção segura de campos de inspeção, sem o bloco completo de ambiente.

## Evidências executadas

| Verificação | Resultado |
|---|---|
| `pnpm check` | Passou sem erros TypeScript |
| `pnpm test -- --run` | 5 arquivos, 6 testes aprovados na última suíte completa antes da validação de segredo; o teste adicional de bootstrap também passou |
| `pnpm build` | Build de produção concluído |
| Endpoint protegido do bot | `/api/config` respondeu 200 com a chave server-side |
| Health do bot | `/health` respondeu `status: ok` após o deploy |
| Login e páginas | Usuário confirmou acesso autenticado às páginas overview, posições, ordens, logs, auditoria e configuração |
| Visual público | Rotas sem sessão redirecionam para o login cyberpunk |

Não há segredos, chaves ou URLs upstream hardcoded no código do cliente. A manutenção de `DASHBOARD_API_KEY`, `DASHBOARD_JWT_SECRET` e demais secrets deve continuar sendo feita pelo gerenciador de secrets do projeto.
