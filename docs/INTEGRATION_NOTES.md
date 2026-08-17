# Integração externa — registro de validação

Em 17 de agosto de 2026, foi confirmado que o health público do bot responde em `https://bot.5450wp.easypanel.host/health` quando o serviço está disponível. A resposta esperada contém `status`, `reconciliation_required`, `open_positions`, `blocked_symbols` e `cached_symbols`.

O Easypanel foi validado por API Bearer na rota `GET /api/listProjectsAndServices`. A documentação oficial confirma as rotas `GET /api/inspectAppService`, `POST /api/updateAppSourceGithub` e `POST /api/deployAppService`, com `projectName` e `serviceName` como identificadores principais. A fonte do serviço `binance/bot` foi atualizada, sob autorização do usuário, para `josuerobson/binance-momentum`, branch `main`, caminho `/`.

O CI da origem autorizada concluiu com sucesso, incluindo verificação Rust e build Docker. O log de deploy do Easypanel registrou build e exportação de imagem bem-sucedidos às 13:14:46 UTC, mas a URL pública retornou "Service is not reachable" durante a verificação posterior. O próximo passo é diagnosticar a inicialização do contêiner e validar os endpoints protegidos de telemetria após a recuperação.

Fontes: [documentação de listagem de projetos e serviços](https://easypanel.io/docs/api-reference/projects/listProjectsAndServices), [inspeção de serviço](https://easypanel.io/docs/api-reference/services-/-app/inspectAppService), [troca de origem GitHub](https://easypanel.io/docs/api-reference/services-/-app/updateAppSourceGithub), [deploy de app](https://easypanel.io/docs/api-reference/services-/-app/deployAppService) e [consulta de erro de serviço](https://easypanel.io/docs/api-reference/services-/-common/getServiceError).
