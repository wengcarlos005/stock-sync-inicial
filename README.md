# Stock Sync — ML ↔ Shopee

Seu próprio **gerenciador de estoque** entre Mercado Livre e Shopee. Substituto grátis do Upseller.

- 🖥️ **UI web** completa (tipo Upseller) — produtos, mudanças, conflitos, controle manual
- ☁️ Roda 24/7 no Cloudflare Workers (grátis, sem PC ligado)
- 🗄️ Banco de dados D1 (SQLite gerenciado, grátis)
- ⏱️ Cron sincroniza a cada 5 min
- 🛡️ Modo "shadow" pra validar antes de cancelar o Upseller

## Tela da UI

A UI fica na URL principal do Worker (ex: `https://stock-sync.SEU.workers.dev/`). Você loga 1x com o admin token e tem 5 abas:

| Aba | O que faz |
|---|---|
| 📦 **Produtos** | Lista todos os SKUs sincronizados, estoque atual nos 2 marketplaces, botão de setar estoque manual, pausar sync por SKU. Busca + filtro por "estoques diferentes". |
| 📜 **Mudanças** | Feed das últimas 100 mudanças detectadas, com antes/depois, origem e se foi propagado. Linhas amarelas = shadow (só logado). |
| ⚠️ **Conflitos** | Quando ambos lados mudam entre 2 polls. Mostra os valores e permite override manual. |
| ❓ **Não pareados** | SKUs que existem em só um marketplace. Você ignora ou cria no outro. |
| ⚙️ **Config** | Rodar discovery, ver histórico de execuções cron, instruções pra ativar modo live. |

## Como funciona

1. **Discovery** (1x ou manual): varre seus itens em ML+Shopee, pareia por SKU, popula tabela `mappings`
2. **Polling** (cron 5 min): lê estoque dos 2 lados, compara com último estado, detecta mudanças
3. **Reconcile**: propaga mudança pro outro lado (ou loga em `conflicts` se ambos mudaram)
4. **Audit**: tudo registrado em `changes` (jamais sobrescrito)

## Setup inicial (você precisa fazer 1x)

### 1. Criar conta Cloudflare
- Acesse https://dash.cloudflare.com/sign-up
- Email + senha. Sem cartão de crédito necessário (free tier suficiente).

### 2. Instalar Wrangler (CLI do Cloudflare)
```powershell
cd C:\Users\wengc\Desktop\stock-sync
npm install
npx wrangler login
```
Vai abrir o browser pra autorizar.

### 3. Criar o D1 database
```powershell
npm run db:create
```
Output vai mostrar algo como:
```
✅ Successfully created DB 'stock-sync'
[[d1_databases]]
binding = "DB"
database_name = "stock-sync"
database_id = "abc123-def456-..."
```
**Copie o `database_id`** e cole em `wrangler.toml` na linha `database_id = "<PREENCHER_APOS_CRIAR>"`.

### 4. Rodar migrations (cria as tabelas)
```powershell
npm run db:migrate:prod
```

### 5. Configurar secrets
```powershell
npx wrangler secret put MAC_API_KEY
# Cole: mc_live_81ae21dc00069526c08cad3e564d17eb10d056c4ba6cf92a8d523d5b0b0bf65a

npx wrangler secret put ADMIN_TOKEN
# Cole qualquer senha forte (ex: gerar em https://1password.com/password-generator/)
# Vai ser usada para chamar /discover e /sync manualmente

npx wrangler secret put MELI_USER_ID
# Cole: 1826916479
```

### 6. Deploy
```powershell
npm run deploy
```
Vai te dar uma URL tipo `https://stock-sync.<seu-subdomain>.workers.dev`

### 7. Abrir a UI e rodar discovery
Abre no browser: `https://stock-sync.<seu-subdomain>.workers.dev/`

- Vai abrir tela de login. Cola o **ADMIN_TOKEN** que você definiu.
- Vai pra aba **⚙️ Config** → clica "▶ Rodar discovery agora" (demora 2-5 min na primeira vez).
- Depois disso, **o cron de 5 min vai rodar sozinho** em modo shadow.

Tudo monitorável pela UI a partir daí. Não precisa mais terminal.

## Verificar funcionamento

### Status geral
```powershell
curl -H "x-admin-token: $token" "$url/status" | ConvertFrom-Json
```

### Logs em tempo real
```powershell
npx wrangler tail
```

### Consultar mudanças detectadas (modo shadow)
```powershell
npm run db:console:prod -- "SELECT ts, sku, source, trigger, meli_stock_before, meli_stock_after, shopee_stock_before, shopee_stock_after, delta, shadow FROM changes ORDER BY ts DESC LIMIT 20"
```

### Itens não pareados (alertas)
```powershell
npm run db:console:prod -- "SELECT platform, sku, product_name FROM unmapped WHERE resolved=0 LIMIT 30"
```

## Validação shadow → live (1-2 semanas depois)

1. Compara `changes` (do D1) com o que o Upseller fez. Se as detecções batem em quantidade e SKU:
2. Edite `wrangler.toml`: `SHADOW_MODE = "false"`
3. `npm run deploy`
4. Cancele o Upseller 🎉

## Troubleshooting

**Token MAC expirou (401 nos logs)**: chave MAC tem 6h de vida pra ML. Se quebrar, regerar e atualizar:
```powershell
npx wrangler secret put MAC_API_KEY
```

**Cron não disparou**: ver `runs` table:
```powershell
npm run db:console:prod -- "SELECT * FROM runs ORDER BY started_at DESC LIMIT 5"
```

**Conflict não resolvido**:
```powershell
npm run db:console:prod -- "SELECT * FROM conflicts WHERE resolved_at IS NULL"
```

## Estrutura

```
src/
├── worker.ts       # entrypoint Cloudflare (fetch + scheduled)
├── mac.ts          # wrapper MAC API (ML + Shopee)
├── db.ts           # helpers D1
├── discover.ts     # auto-mapping SKU → IDs
└── sync.ts         # poll + reconcile

migrations/
└── 0001_init.sql   # 6 tabelas: mappings, state, changes, conflicts, unmapped, runs

wrangler.toml       # config Cloudflare
```

## Limites grátis e custo
- Workers: 100.000 req/dia (você usa ~10k/dia)
- D1: 5GB storage, 5M leituras/dia (você usa <1k/dia)
- Cron: ilimitado (1 trigger /5min)
- **Custo: R$ 0/mês**

Se Cloudflare cobrar Cron um dia, mudo pra polling via setInterval externo (Upstash QStash grátis tier ou GitHub Actions).
