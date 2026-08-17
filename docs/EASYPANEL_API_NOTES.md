# Easypanel API — notas de integração

Fonte: API autenticada em `${EASYPANEL_BASE_URL}/api/openapi.json`.

A listagem de infraestrutura usa `GET /api/listProjectsAndServices` e retorna um envelope com as chaves `projects` e `services`. O projeto existente é `binance` e possui o serviço `bot`, do tipo `app`, com origem GitHub `josuerobson/binance-momentum`, branch `main` e path `/`.

A API documenta `POST /createAppService` para criar um serviço de aplicação. O payload exige apenas `projectName` e `serviceName` no nível superior; campos opcionais incluem `source`, `build`, `deploy`, `env`, `ports`, `domains`, `resources`, `scripts`, `mounts`, `maintenance` e `basicAuth`.

A origem GitHub documentada exige `type: github`, `autoDeploy`, `owner`, `repo`, `ref` e `path`. O serviço dashboard deverá usar uma origem GitHub dedicada e uma porta de aplicação compatível com o script `start` do projeto.

Após a criação, os endpoints relevantes são `GET /inspectAppService`, `POST /updateAppEnv`, `POST /deployAppService`, `GET /getAction` e `GET /listProjectsAndServices`. O bloco de ambiente deve ser tratado como substituição integral; por isso, qualquer atualização deve preservar todas as variáveis existentes antes de escrever.

## Estado observado em 17 de agosto de 2026

A API `GET /api/listActions` retornou ações recentes do serviço `binance/dashboard` com status `error` e `killed`. A ação mais recente registrada como `Deploy service` foi criada às 15:12:09 e atualizada às 15:12:26 com status `error`. O endpoint de deploy manual anterior permaneceu em `Deploying...` enquanto a ação correspondente já aparecia como erro na lista operacional.

## Diagnóstico dos builders do dashboard

O builder Nixpacks do Easypanel falhou ao baixar `https://github.com/NixOS/nixpkgs/archive/ffeebf0acf3ae8b29f8c7049cd911b9636efd7e7.tar.gz` com HTTP 429 (rate limit). O builder Railpack então reproduziu o texto `429: command not found`, indicando falha do pipeline do builder. O builder Buildpacks com `heroku/builder:24` concluiu a detecção e exportação, mas falhou ao salvar a imagem porque `heroku/heroku:24` não fornecia uma plataforma `linux/amd64`. A configuração foi alterada para `paketobuildpacks/builder-jammy-base`, compatível com amd64; a segunda ação iniciou com as imagens em cache e permanecia `pending` após o download das bases.
