# n8n — Uso da Product API (substituição do Base44)

Os fluxos originais (`n8n-ia-barbeiro.json`, `n8n-mcp-barbeiro.json`) chamam a API externa **Base44**. Para o produto on-prem, as tools do MCP devem chamar a **Product API** do NavalhIA.

## Credenciais no n8n

1. **API Key das tools**
   - Crie uma credencial do tipo "Header Auth" ou use "Generic Credential" com um header fixo.
   - Nome sugerido: `NavalhIA Tools API`.
   - Header: `X-API-Key` (ou `Authorization: Bearer <key>`).
   - **Multi-tenant (SaaS):** use a API Key da NavalhIA (gerada no painel em Integrações). Cada estabelecimento tem sua própria key; o `barbershop_id` é inferido pela API — não envie em query/body.
   - **Single-tenant (on-prem):** valor pode ser o `TOOLS_API_KEY` do backend ou uma key criada por `npm run tools:create-api-key` no backend.

2. **URL base da API**
   - Em cada nó HTTP Request Tool, use a URL base da instalação, ex.: `https://seu-dominio.com/api` ou `http://api:3000/api` (Docker interno).
   - Variável de ambiente no n8n (se suportado) ou substitua manualmente no template.

## Mapeamento Base44 → Product API

| Tool (nome no agente) | Método Base44 | Product API |
|-----------------------|---------------|-------------|
| Listar serviços | GET entities/Service | `GET /api/tools/list_services?barbershop_id=<id>` |
| Listar barbeiros | GET entities/Barber | `GET /api/tools/list_barbers?barbershop_id=<id>` |
| Listar agendamentos | GET entities/Appointment?date= | `GET /api/tools/list_appointments?date=yyyy-MM-dd&barbershop_id=<id>` |
| Buscar/criar cliente | GET/POST entities/Client | `POST /api/tools/upsert_client` (body: phone, name?, notes?) |
| Atualizar cliente | PUT entities/Client/:id | Usar `upsert_client` (mesmo telefone atualiza) |
| Criar agendamento | POST entities/Appointment | `POST /api/tools/create_appointment` (body: client_id, barber_id, service_id, date, time, notes?, client_phone?, client_name?) |

## Cabeçalhos em todas as requisições

- `X-API-Key`: valor de `TOOLS_API_KEY`
- Ou `Authorization: Bearer <TOOLS_API_KEY>`
- `Content-Type: application/json` para POST.

## Multi-tenant (SaaS) e single-tenant

- **SaaS:** a API identifica o estabelecimento pela API Key. Não envie `barbershop_id` em query ou body; a API ignora e usa o tenant da key.
- **Single-tenant (on-prem):** se `BARBERSHOP_ID` estiver definido no backend, a API usa esse tenant quando a key for a global `TOOLS_API_KEY`. Caso use keys por estabelecimento (tabela `barbershop_api_keys`), o tenant continua inferido pela key.

## Template de fluxo MCP

O arquivo `n8n-mcp-barbeiro-product-api.json` é um template do fluxo MCP com as URLs apontando para `http://api:3000` (nome do serviço no Docker). Ao importar no n8n:

1. **URL**: Se a API não estiver em `http://api:3000`, edite cada nó e altere a URL para a base da sua instalação (ex.: `https://api.seudominio.com`).
2. **API Key**: No template o header está com o valor `REPLACE_WITH_TOOLS_API_KEY`. Crie uma credencial do tipo "Header Auth" no n8n com o nome `X-API-Key` e valor igual ao `TOOLS_API_KEY` do backend; em seguida, atribua essa credencial a cada nó HTTP Request Tool. Ou substitua em todos os nós o texto `REPLACE_WITH_TOOLS_API_KEY` pelo valor real (não recomendado em ambientes compartilhados).

## Fluxo do agente (IA)

O `n8n-ia-barbeiro.json` continua igual: o agente usa o **MCP Client** que aponta para o endpoint MCP do n8n (ex.: `https://n8n.seudominio.com/mcp/mcp-barbeiro`). O MCP Server Trigger expõe as tools; cada tool, por sua vez, chama a Product API (não mais o Base44). Basta substituir o fluxo MCP pelo template que usa a Product API.
