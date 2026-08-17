# Easypanel API — notas de integração

Fonte: API autenticada em `${EASYPANEL_BASE_URL}/api/openapi.json`.

A listagem de infraestrutura usa `GET /api/listProjectsAndServices` e retorna um envelope com as chaves `projects` e `services`. O projeto existente é `binance` e possui o serviço `bot`, do tipo `app`, com origem GitHub `josuerobson/binance-momentum`, branch `main` e path `/`.

A API documenta `POST /createAppService` para criar um serviço de aplicação. O payload exige apenas `projectName` e `serviceName` no nível superior; campos opcionais incluem `source`, `build`, `deploy`, `env`, `ports`, `domains`, `resources`, `scripts`, `mounts`, `maintenance` e `basicAuth`.

A origem GitHub documentada exige `type: github`, `autoDeploy`, `owner`, `repo`, `ref` e `path`. O serviço dashboard deverá usar uma origem GitHub dedicada e uma porta de aplicação compatível com o script `start` do projeto.

Após a criação, os endpoints relevantes são `GET /inspectAppService`, `POST /updateAppEnv`, `POST /deployAppService`, `GET /getAction` e `GET /listProjectsAndServices`. O bloco de ambiente deve ser tratado como substituição integral; por isso, qualquer atualização deve preservar todas as variáveis existentes antes de escrever.
