# Segurança e fluxo de dados

O navegador se comunica apenas com os procedimentos tRPC autenticados do dashboard. As URLs do bot, a chave `DASHBOARD_API_KEY` e as credenciais do Easypanel são lidas exclusivamente pelo servidor. Portanto, o navegador não realiza chamadas diretas ao bot, ao Easypanel ou ao endpoint de logs, e CORS desses serviços externos não faz parte do caminho normal de operação.

Os dados de telemetria, posições, sinais e logs são consultados em tempo real e mantidos somente em cache breve de memória no servidor. O banco de dados persiste apenas os usuários locais e seus metadados de sessão; ele não armazena saldos, chaves, snapshots ou mensagens de log.

O dashboard não possui qualquer ação para alterar `DRY_RUN`. O modo é exibido como um indicador informativo obtido da configuração do bot, pois mudanças de ambiente permanecem restritas à infraestrutura autorizada.
