// UI single-page HTML (servida pelo próprio Worker)
export const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stock Sync — ML ↔ Shopee</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <style>
    [x-cloak] { display: none !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 min-h-screen">

<div x-data="app()" x-init="init()" x-cloak>

  <!-- Login overlay -->
  <div x-show="!token" class="fixed inset-0 bg-slate-900/70 backdrop-blur flex items-center justify-center z-50">
    <div class="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
      <h1 class="text-xl font-bold mb-1">Stock Sync</h1>
      <p class="text-sm text-slate-500 mb-6">Entre com seu admin token</p>
      <form @submit.prevent="login()">
        <input x-model="loginInput" type="password" placeholder="Admin token"
          class="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" autofocus />
        <p x-show="loginError" x-text="loginError" class="text-red-600 text-sm mt-2"></p>
        <button class="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition">Entrar</button>
      </form>
    </div>
  </div>

  <!-- Main layout -->
  <div x-show="token">
    <!-- Header -->
    <header class="bg-white border-b border-slate-200">
      <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-bold">📦 Stock Sync</h1>
          <span x-show="status.shadow_mode" class="px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-800 rounded">SHADOW MODE</span>
          <span x-show="!status.shadow_mode" class="px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded">LIVE</span>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <span class="text-slate-500" x-text="lastRunText"></span>
          <button @click="runSync()" :disabled="loading.sync" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded">
            <span x-show="!loading.sync">↻ Sincronizar agora</span>
            <span x-show="loading.sync">Sincronizando...</span>
          </button>
          <button @click="logout()" class="text-slate-400 hover:text-slate-600 text-sm">sair</button>
        </div>
      </div>

      <!-- Stat cards -->
      <div class="max-w-7xl mx-auto px-6 pb-4 grid grid-cols-4 gap-4">
        <div class="bg-slate-100 rounded-lg p-3">
          <div class="text-2xl font-bold" x-text="status.active_mappings || 0"></div>
          <div class="text-xs text-slate-500">Produtos sincronizados</div>
        </div>
        <div class="bg-slate-100 rounded-lg p-3">
          <div class="text-2xl font-bold" :class="status.unresolved_conflicts ? 'text-red-600' : ''" x-text="status.unresolved_conflicts || 0"></div>
          <div class="text-xs text-slate-500">Conflitos abertos</div>
        </div>
        <div class="bg-slate-100 rounded-lg p-3">
          <div class="text-2xl font-bold" :class="status.unmapped_items ? 'text-amber-600' : ''" x-text="status.unmapped_items || 0"></div>
          <div class="text-xs text-slate-500">SKUs não pareados</div>
        </div>
        <div class="bg-slate-100 rounded-lg p-3">
          <div class="text-2xl font-bold" x-text="(status.last_run?.changes_detected ?? 0)"></div>
          <div class="text-xs text-slate-500">Mudanças (última execução)</div>
        </div>
      </div>

      <!-- Tabs -->
      <nav class="max-w-7xl mx-auto px-6 border-b border-slate-200 flex gap-1">
        <template x-for="t in tabs">
          <button @click="tab = t.id" :class="tab === t.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'"
            class="px-4 py-3 border-b-2 text-sm font-medium transition">
            <span x-text="t.label"></span>
            <span x-show="t.count !== undefined" x-text="'(' + (t.count || 0) + ')'" class="ml-1 text-xs text-slate-400"></span>
          </button>
        </template>
      </nav>
    </header>

    <!-- Tab content -->
    <main class="max-w-7xl mx-auto px-6 py-6">

      <!-- Pedidos -->
      <section x-show="tab === 'orders'" x-cloak>
        <div class="flex gap-3 mb-4 items-center">
          <h2 class="text-sm font-semibold text-slate-700">Pedidos recentes detectados</h2>
          <div class="flex gap-1">
            <button @click="orderPlatform=''; loadOrders()" :class="orderPlatform==='' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'" class="text-xs px-3 py-1.5 rounded-lg">Todos</button>
            <button @click="orderPlatform='meli'; loadOrders()" :class="orderPlatform==='meli' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'" class="text-xs px-3 py-1.5 rounded-lg">🟡 ML</button>
            <button @click="orderPlatform='shopee'; loadOrders()" :class="orderPlatform==='shopee' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'" class="text-xs px-3 py-1.5 rounded-lg">🛒 Shopee</button>
          </div>
          <span class="text-xs text-slate-400 ml-auto">Atualizado a cada 5 min automaticamente</span>
        </div>
        <div class="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th class="text-left px-4 py-3">Plataforma</th>
                <th class="text-left px-4 py-3">Pedido</th>
                <th class="text-left px-4 py-3">Comprador</th>
                <th class="text-left px-4 py-3">Itens</th>
                <th class="text-left px-4 py-3">Status</th>
                <th class="text-left px-4 py-3">Data</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <template x-for="o in orders" :key="o.id">
                <tr class="hover:bg-slate-50">
                  <td class="px-4 py-3">
                    <span x-show="o.platform==='meli'" class="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full font-medium">🟡 ML</span>
                    <span x-show="o.platform==='shopee'" class="text-xs px-2 py-0.5 bg-orange-100 text-orange-800 rounded-full font-medium">🛒 Shopee</span>
                  </td>
                  <td class="px-4 py-3 font-mono text-xs text-slate-500" x-text="o.order_id"></td>
                  <td class="px-4 py-3 text-sm" x-text="o.buyer || '—'"></td>
                  <td class="px-4 py-3 text-xs">
                    <template x-for="(it, idx) in parseItems(o.items_json)" :key="idx">
                      <div class="flex gap-1">
                        <span class="font-semibold" x-text="'×' + it.qty"></span>
                        <span class="text-slate-600 truncate max-w-[200px]" x-text="it.name || it.sku || it.item_id"></span>
                      </div>
                    </template>
                  </td>
                  <td class="px-4 py-3">
                    <span class="text-xs px-2 py-0.5 rounded" :class="orderStatusClass(o.status)" x-text="o.status || '—'"></span>
                  </td>
                  <td class="px-4 py-3 text-xs text-slate-500" x-text="fmtRelative(o.created_at)"></td>
                </tr>
              </template>
              <tr x-show="orders.length === 0">
                <td colspan="6" class="text-center py-10 text-slate-400">
                  <div class="text-2xl mb-2">🛒</div>
                  <div>Nenhum pedido ainda. O sistema detecta pedidos novos a cada 5 minutos.</div>
                  <div class="text-xs mt-1 text-slate-300">Pedidos anteriores aparecem após o próximo ciclo de sync.</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Produtos -->
      <section x-show="tab === 'products'" x-cloak>
        <div class="flex gap-3 mb-4">
          <input x-model="productSearch" @input.debounce.300ms="loadProducts()" placeholder="Buscar por SKU ou nome..."
            class="flex-1 px-4 py-2 border border-slate-300 rounded-lg" />
          <select x-model="productFilter" @change="loadProducts()" class="px-4 py-2 border border-slate-300 rounded-lg bg-white">
            <option value="all">Todos</option>
            <option value="mismatch">Estoques diferentes</option>
            <option value="active">Ativos</option>
            <option value="disabled">Desativados</option>
          </select>
        </div>
        <div class="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th class="text-left px-4 py-3">SKU</th>
                <th class="text-left px-4 py-3">Produto</th>
                <th class="text-center px-4 py-3">🟡 ML</th>
                <th class="text-center px-4 py-3">🛒 Shopee</th>
                <th class="text-right px-4 py-3">Master</th>
                <th class="text-left px-4 py-3">Última mudança</th>
                <th class="text-center px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <template x-for="p in products" :key="p.sku">
                <tr :class="p.active ? '' : 'opacity-50'">
                  <td class="px-4 py-3 font-mono text-xs" x-text="p.sku"></td>
                  <td class="px-4 py-3" x-text="(p.product_name||'').slice(0,60)"></td>
                  <td class="px-4 py-3 text-center">
                    <template x-if="p.meli_item_id">
                      <span class="font-mono text-xs" :class="stockClass(p.meli_stock, p.shopee_stock)" x-text="p.meli_stock ?? '—'"></span>
                    </template>
                    <template x-if="!p.meli_item_id">
                      <button @click="openLinkModal(p, 'meli')" class="text-xs px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded">+ Parear ML</button>
                    </template>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <template x-if="p.shopee_item_id">
                      <span class="font-mono text-xs" :class="stockClass(p.shopee_stock, p.meli_stock)" x-text="p.shopee_stock ?? '—'"></span>
                    </template>
                    <template x-if="!p.shopee_item_id">
                      <button @click="openLinkModal(p, 'shopee')" class="text-xs px-1.5 py-0.5 bg-orange-100 hover:bg-orange-200 text-orange-800 rounded">+ Parear Shopee</button>
                    </template>
                  </td>
                  <td class="px-4 py-3 text-right font-mono font-semibold" x-text="p.master_stock ?? '—'"></td>
                  <td class="px-4 py-3 text-xs text-slate-500" x-text="fmtRelative(p.last_change_at)"></td>
                  <td class="px-4 py-3 text-center flex gap-1 justify-center">
                    <button @click="openSetStock(p)" class="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded">setar</button>
                    <button @click="openLinkModal(p, p.meli_item_id ? 'shopee' : 'meli')" class="text-xs px-2 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded">parear</button>
                    <button @click="toggleMapping(p.sku)" class="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded" x-text="p.active ? 'pausar' : 'ativar'"></button>
                  </td>
                </tr>
              </template>
              <tr x-show="products.length === 0">
                <td colspan="7" class="text-center py-8 text-slate-400">Nenhum produto encontrado. Rode discovery na aba Config.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Mudanças -->
      <section x-show="tab === 'changes'" x-cloak>
        <div class="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th class="text-left px-4 py-3">Quando</th>
                <th class="text-left px-4 py-3">SKU</th>
                <th class="text-left px-4 py-3">Origem</th>
                <th class="text-left px-4 py-3">Trigger</th>
                <th class="text-left px-4 py-3">ML antes → depois</th>
                <th class="text-left px-4 py-3">Shopee antes → depois</th>
                <th class="text-right px-4 py-3">Δ</th>
                <th class="text-left px-4 py-3">Propagou</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <template x-for="c in changes" :key="c.id">
                <tr :class="c.shadow ? 'bg-amber-50/50' : ''">
                  <td class="px-4 py-3 text-xs text-slate-500" x-text="fmtRelative(c.ts)"></td>
                  <td class="px-4 py-3 font-mono text-xs" x-text="c.sku"></td>
                  <td class="px-4 py-3" x-text="c.source"></td>
                  <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded" :class="triggerClass(c.trigger)" x-text="c.trigger"></span></td>
                  <td class="px-4 py-3 font-mono text-xs" x-text="(c.meli_stock_before ?? '—') + ' → ' + (c.meli_stock_after ?? '—')"></td>
                  <td class="px-4 py-3 font-mono text-xs" x-text="(c.shopee_stock_before ?? '—') + ' → ' + (c.shopee_stock_after ?? '—')"></td>
                  <td class="px-4 py-3 text-right font-mono" :class="c.delta < 0 ? 'text-red-600' : c.delta > 0 ? 'text-emerald-600' : ''" x-text="c.delta > 0 ? '+' + c.delta : c.delta"></td>
                  <td class="px-4 py-3 text-xs">
                    <span x-show="c.shadow" class="text-amber-700">shadow</span>
                    <span x-show="!c.shadow && c.propagated_to" x-text="'→ ' + c.propagated_to" class="text-emerald-700"></span>
                    <span x-show="!c.shadow && c.error" x-text="'⚠ ' + c.error" class="text-red-600"></span>
                  </td>
                </tr>
              </template>
              <tr x-show="changes.length === 0">
                <td colspan="8" class="text-center py-8 text-slate-400">Nenhuma mudança detectada ainda.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Conflitos -->
      <section x-show="tab === 'conflicts'" x-cloak>
        <div class="bg-white border border-slate-200 rounded-lg p-4 mb-4 text-sm">
          <p class="text-slate-600">Conflitos acontecem quando ambos os lados mudaram entre 2 polls. Resolução automática usa <code class="bg-slate-100 px-1 rounded">min(ML, Shopee)</code>. Você pode sobrepor manualmente abaixo.</p>
        </div>
        <div class="space-y-3">
          <template x-for="c in conflicts" :key="c.id">
            <div class="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4">
              <div class="flex-1">
                <div class="font-mono text-xs text-slate-500" x-text="c.sku"></div>
                <div class="text-sm mt-1">
                  ML: <span class="font-mono" x-text="c.meli_before + ' → ' + c.meli_after"></span> |
                  Shopee: <span class="font-mono" x-text="c.shopee_before + ' → ' + c.shopee_after"></span>
                </div>
                <div class="text-xs text-slate-500 mt-1" x-text="'Resolvido para ' + c.resolved_to + ' (' + c.resolution + ') — ' + fmtRelative(c.ts)"></div>
              </div>
              <input type="number" x-model="c._override" placeholder="novo valor" class="w-28 px-2 py-1 border border-slate-300 rounded text-sm" />
              <button @click="resolveConflict(c)" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded">Aplicar</button>
            </div>
          </template>
          <p x-show="conflicts.length === 0" class="text-center py-8 text-slate-400">Sem conflitos.</p>
        </div>
      </section>

      <!-- Não pareados -->
      <section x-show="tab === 'unmapped'" x-cloak>
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
          Produtos que existem em apenas um marketplace. Clique <strong>Parear</strong> para conectar manualmente com o equivalente do outro lado.
        </div>
        <div class="grid grid-cols-2 gap-4">
          <!-- Coluna Shopee -->
          <div class="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div class="bg-orange-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
              <span class="text-sm font-semibold text-orange-700">🛒 Shopee</span>
              <input x-model="unmappedSearchShopee" @input.debounce.250ms="loadUnmapped()" placeholder="Buscar..." class="text-xs px-2 py-1 border border-slate-200 rounded w-36" />
            </div>
            <div class="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
              <template x-for="u in unmappedShopee" :key="u.id">
                <div class="px-3 py-2 hover:bg-slate-50 flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-xs font-mono text-slate-500 truncate" x-text="u.sku"></div>
                    <div class="text-sm truncate" x-text="(u.product_name||'—').slice(0,55)"></div>
                    <div class="text-xs text-slate-400" x-text="'ID: ' + u.item_id + (u.variation_id ? '/' + u.variation_id : '')"></div>
                  </div>
                  <div class="flex flex-col gap-1 shrink-0">
                    <button @click="openPairModal(u, 'shopee')" class="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded">Parear</button>
                    <button @click="ignoreUnmapped(u.id)" class="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded">Ignorar</button>
                  </div>
                </div>
              </template>
              <div x-show="unmappedShopee.length === 0" class="p-4 text-center text-sm text-slate-400">Nenhum item Shopee não pareado 🎉</div>
            </div>
          </div>

          <!-- Coluna ML -->
          <div class="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div class="bg-amber-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
              <span class="text-sm font-semibold text-amber-700">🟡 Mercado Livre</span>
              <input x-model="unmappedSearchMeli" @input.debounce.250ms="loadUnmapped()" placeholder="Buscar..." class="text-xs px-2 py-1 border border-slate-200 rounded w-36" />
            </div>
            <div class="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
              <template x-for="u in unmappedMeli" :key="u.id">
                <div class="px-3 py-2 hover:bg-slate-50 flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-xs font-mono text-slate-500 truncate" x-text="u.sku"></div>
                    <div class="text-sm truncate" x-text="(u.product_name||'—').slice(0,55)"></div>
                    <div class="text-xs text-slate-400" x-text="'ID: ' + u.item_id + (u.variation_id ? '/' + u.variation_id : '')"></div>
                  </div>
                  <div class="flex flex-col gap-1 shrink-0">
                    <button @click="openPairModal(u, 'meli')" class="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded">Parear</button>
                    <button @click="ignoreUnmapped(u.id)" class="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded">Ignorar</button>
                  </div>
                </div>
              </template>
              <div x-show="unmappedMeli.length === 0" class="p-4 text-center text-sm text-slate-400">Nenhum item ML não pareado 🎉</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Config -->
      <section x-show="tab === 'config'" x-cloak class="max-w-2xl">
        <div class="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
          <div>
            <h3 class="font-semibold mb-2">Discovery</h3>
            <p class="text-sm text-slate-500 mb-3">Varre todos os produtos em ML e Shopee e pareia por SKU. Roda via <strong>GitHub Actions</strong> (sem limite de produtos). Também roda automaticamente todo dia às 6h.</p>
            <button @click="runDiscover()" :disabled="loading.discover" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded">
              <span x-show="!loading.discover">▶ Disparar discovery agora</span>
              <span x-show="loading.discover">Disparando no GitHub Actions...</span>
            </button>
            <div x-show="discoverResult?.ok" class="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-800">
              ✅ <span x-text="discoverResult?.message"></span>
              <a href="https://github.com/wengcarlos005/stock-sync-inicial/actions" target="_blank" class="underline ml-2">Acompanhar progresso →</a>
            </div>
            <div x-show="discoverResult?.error" class="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800" x-text="discoverResult?.error"></div>
          </div>

          <div class="border-t pt-6">
            <h3 class="font-semibold mb-2">Limpar "Não Pareados"</h3>
            <p class="text-sm text-slate-500 mb-3">Remove da lista de "Não Pareados" todos os itens que já possuem um mapeamento criado (aparecem indevidamente após imports antigos).</p>
            <button @click="cleanupUnmapped()" :disabled="loading.cleanup" class="px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white font-medium rounded text-sm">
              <span x-show="!loading.cleanup">🧹 Limpar já-mapeados</span>
              <span x-show="loading.cleanup">Limpando...</span>
            </button>
          </div>

          <div class="border-t pt-6">
            <h3 class="font-semibold mb-2">Modo Shadow</h3>
            <p class="text-sm text-slate-500 mb-3">No modo shadow, mudanças são <strong>detectadas e logadas</strong> mas <strong>não escritas</strong> nos marketplaces. Use pra validar antes de cancelar o Upseller.</p>
            <div class="bg-slate-50 p-3 rounded text-xs">
              <strong x-text="status.shadow_mode ? 'SHADOW está ATIVO' : 'LIVE — escrevendo de verdade'"></strong>
              <p class="mt-2 text-slate-600">Para alternar: edite <code class="bg-white px-1 rounded">wrangler.toml</code> linha <code class="bg-white px-1 rounded">SHADOW_MODE = "true"|"false"</code> e rode <code class="bg-white px-1 rounded">npm run deploy</code>.</p>
            </div>
          </div>

          <div class="border-t pt-6">
            <h3 class="font-semibold mb-2">Histórico de execuções (cron)</h3>
            <div class="bg-slate-50 rounded text-xs">
              <table class="w-full">
                <thead><tr class="border-b border-slate-200"><th class="text-left p-2">Início</th><th class="text-left p-2">Trigger</th><th class="text-right p-2">Itens</th><th class="text-right p-2">Mudanças</th><th class="text-right p-2">Erros</th></tr></thead>
                <tbody>
                  <template x-for="r in runs">
                    <tr class="border-b border-slate-100">
                      <td class="p-2" x-text="fmtRelative(r.started_at)"></td>
                      <td class="p-2" x-text="r.trigger"></td>
                      <td class="p-2 text-right" x-text="r.items_polled"></td>
                      <td class="p-2 text-right" x-text="r.changes_detected"></td>
                      <td class="p-2 text-right" :class="r.errors > 0 ? 'text-red-600' : ''" x-text="r.errors"></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

    </main>
  </div>

  <!-- Pair modal -->
  <div x-show="pairModal" x-cloak class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-40 p-4" @click.self="pairModal = null">
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]" x-show="pairModal">
      <div class="px-6 py-4 border-b border-slate-200">
        <h3 class="font-semibold">Pareamento manual</h3>
        <p class="text-sm text-slate-500 mt-1">Selecionado: <span class="font-mono text-xs" x-text="pairModal?.source?.product_name?.slice(0,60)"></span></p>
        <p class="text-xs text-slate-400 font-mono" x-text="pairModal?.source?.platform + ' → ' + pairModal?.source?.item_id"></p>
      </div>
      <div class="px-6 py-3 border-b border-slate-200">
        <p class="text-sm font-medium mb-2" x-text="'Buscar no ' + (pairModal?.targetPlatform === 'meli' ? 'Mercado Livre' : 'Shopee') + ':'"></p>
        <input x-model="pairSearch" @input.debounce.300ms="searchPairCatalog()" placeholder="Digite nome ou SKU..." class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" autofocus />
      </div>
      <div class="flex-1 overflow-y-auto divide-y divide-slate-100">
        <template x-for="item in pairCatalog" :key="item.id">
          <div class="px-4 py-3 hover:bg-indigo-50 cursor-pointer flex items-center gap-3" @click="selectPairTarget(item)"
               :class="pairTarget?.id === item.id ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''">
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate" x-text="(item.product_name||'—').slice(0,65)"></div>
              <div class="text-xs text-slate-400 font-mono" x-text="item.sku + ' | ID: ' + item.item_id + (item.variation_id ? '/' + item.variation_id : '')"></div>
            </div>
            <span x-show="pairTarget?.id === item.id" class="text-indigo-600 text-sm">✓</span>
          </div>
        </template>
        <div x-show="pairCatalog.length === 0 && pairSearch" class="p-4 text-center text-sm text-slate-400">Nenhum resultado</div>
        <div x-show="pairCatalog.length === 0 && !pairSearch" class="p-4 text-center text-sm text-slate-400">Digite para buscar</div>
      </div>
      <div class="px-6 py-4 border-t border-slate-200 space-y-3">
        <div class="flex gap-2 items-center">
          <label class="text-sm text-slate-600 shrink-0">SKU final:</label>
          <input x-model="pairSku" placeholder="auto (usa SKU da Shopee)" class="flex-1 px-3 py-1.5 border border-slate-300 rounded text-sm font-mono" />
        </div>
        <div class="flex gap-2">
          <button @click="pairModal = null" class="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm">Cancelar</button>
          <button @click="confirmPair()" :disabled="!pairTarget || loading.pair" class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium rounded text-sm">
            <span x-show="!loading.pair">✓ Confirmar pareamento</span>
            <span x-show="loading.pair">Salvando...</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Link modal (parear produto já mapeado com item não pareado) -->
  <div x-show="linkModal" x-cloak class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-40 p-4" @click.self="linkModal=null">
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]" x-show="linkModal">
      <div class="px-6 py-4 border-b border-slate-200">
        <h3 class="font-semibold">Parear com produto existente</h3>
        <p class="text-sm text-slate-500 mt-1">SKU: <span class="font-mono" x-text="linkModal?.sku"></span></p>
        <p class="text-xs text-slate-400" x-text="'Buscando em: ' + (linkModal?.platform === 'meli' ? '🟡 Mercado Livre' : '🛒 Shopee')"></p>
      </div>
      <div class="px-6 py-3 border-b border-slate-200">
        <input x-model="linkSearch" @input.debounce.300ms="searchLinkCatalog()" placeholder="Digite nome ou SKU para buscar..." class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" autofocus />
      </div>
      <div class="flex-1 overflow-y-auto divide-y divide-slate-100">
        <template x-for="item in linkCatalog" :key="item.id">
          <div class="px-4 py-3 hover:bg-indigo-50 cursor-pointer flex items-center gap-3" @click="linkTarget=item"
               :class="linkTarget?.id === item.id ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''">
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate" x-text="(item.product_name||'—').slice(0,65)"></div>
              <div class="text-xs text-slate-400 font-mono" x-text="item.sku + ' | ID: ' + item.item_id + (item.variation_id ? '/' + item.variation_id : '')"></div>
            </div>
            <span x-show="linkTarget?.id === item.id" class="text-indigo-600">✓</span>
          </div>
        </template>
        <div x-show="linkCatalog.length===0 && linkSearch" class="p-4 text-center text-sm text-slate-400">Nenhum resultado. Tente outro termo.</div>
        <div x-show="linkCatalog.length===0 && !linkSearch" class="p-4 text-center text-sm text-slate-400">Digite para buscar nos produtos não pareados</div>
      </div>
      <div class="px-6 py-4 border-t border-slate-200 flex gap-2">
        <button @click="linkModal=null" class="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm">Cancelar</button>
        <button @click="confirmLink()" :disabled="!linkTarget || loading.link" class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium rounded text-sm">
          <span x-show="!loading.link">✓ Vincular</span>
          <span x-show="loading.link">Salvando...</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Set stock modal -->
  <div x-show="setStockModal" x-cloak class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-40" @click.self="setStockModal = null">
    <div class="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full" x-show="setStockModal">
      <h3 class="font-semibold mb-1">Definir estoque manualmente</h3>
      <p class="text-sm text-slate-500 mb-4" x-text="setStockModal?.sku + ' — ' + (setStockModal?.product_name || '').slice(0, 50)"></p>
      <div class="space-y-2 text-sm mb-4">
        <div>Estoque atual ML: <span class="font-mono" x-text="setStockModal?.meli_stock ?? '—'"></span></div>
        <div>Estoque atual Shopee: <span class="font-mono" x-text="setStockModal?.shopee_stock ?? '—'"></span></div>
      </div>
      <input x-model.number="newStockValue" type="number" min="0" placeholder="Novo estoque" class="w-full px-4 py-3 border border-slate-300 rounded-lg mb-4" />
      <div class="flex gap-2">
        <button @click="setStockModal = null" class="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded">Cancelar</button>
        <button @click="setStock()" :disabled="loading.setStock" class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded">
          <span x-show="!loading.setStock">Aplicar nos 2 marketplaces</span>
          <span x-show="loading.setStock">Aplicando...</span>
        </button>
      </div>
    </div>
  </div>

</div>

<script>
function app() {
  return {
    token: localStorage.getItem('stocksync_token') || '',
    loginInput: '',
    loginError: '',
    tab: 'products',
    tabs: [
      { id: 'orders', label: '🛒 Pedidos' },
      { id: 'products', label: '📦 Produtos' },
      { id: 'changes', label: '📜 Mudanças' },
      { id: 'conflicts', label: '⚠️ Conflitos' },
      { id: 'unmapped', label: '❓ Não pareados' },
      { id: 'config', label: '⚙️ Config' },
    ],
    status: {},
    products: [],
    changes: [],
    conflicts: [],
    unmapped: [],
    runs: [],
    productSearch: '',
    productFilter: 'all',
    loading: { sync: false, discover: false, setStock: false, pair: false, link: false, cleanup: false },
    linkModal: null,
    linkSearch: '',
    linkCatalog: [],
    linkTarget: null,
    orders: [],
    orderPlatform: '',
    discoverResult: null,
    setStockModal: null,
    newStockValue: 0,
    pollTimer: null,
    unmappedShopee: [],
    unmappedMeli: [],
    unmappedSearchShopee: '',
    unmappedSearchMeli: '',
    pairModal: null,
    pairSearch: '',
    pairCatalog: [],
    pairTarget: null,
    pairSku: '',

    async init() {
      if (!this.token) return;
      await this.loadAll();
      this.pollTimer = setInterval(() => this.loadStatus(), 30000);
    },

    async login() {
      this.token = this.loginInput;
      const ok = await this.loadStatus();
      if (!ok) {
        this.loginError = 'Token inválido';
        this.token = '';
        return;
      }
      localStorage.setItem('stocksync_token', this.token);
      this.loadAll();
    },

    logout() {
      this.token = '';
      localStorage.removeItem('stocksync_token');
    },

    async loadAll() {
      await Promise.all([
        this.loadStatus(),
        this.loadOrders(),
        this.loadProducts(),
        this.loadChanges(),
        this.loadConflicts(),
        this.loadUnmapped(),
        this.loadRuns(),
      ]);
    },

    async api(path, opts = {}) {
      const headers = { 'x-admin-token': this.token, 'Content-Type': 'application/json', ...(opts.headers || {}) };
      const res = await fetch(path, { ...opts, headers });
      if (res.status === 401) { this.logout(); return null; }
      return res.json();
    },

    async loadStatus() {
      const d = await this.api('/api/status');
      if (!d) return false;
      this.status = d;
      this.tabs.find(t => t.id === 'conflicts').count = d.unresolved_conflicts;
      this.tabs.find(t => t.id === 'unmapped').count = d.unmapped_items;
      return true;
    },

    async loadProducts() {
      const url = '/api/products?q=' + encodeURIComponent(this.productSearch) + '&filter=' + this.productFilter;
      const d = await this.api(url);
      this.products = d?.items || [];
      this.tabs.find(t => t.id === 'products').count = d?.total || 0;
    },

    async loadOrders() {
      const q = this.orderPlatform ? '&platform=' + this.orderPlatform : '';
      const d = await this.api('/api/orders?limit=100' + q);
      this.orders = d?.items || [];
      this.tabs.find(t => t.id === 'orders').count = this.orders.length;
    },

    async loadChanges() {
      const d = await this.api('/api/changes?limit=100');
      this.changes = d?.items || [];
    },

    async loadConflicts() {
      const d = await this.api('/api/conflicts');
      this.conflicts = (d?.items || []).map(c => ({ ...c, _override: c.resolved_to }));
    },

    async loadUnmapped() {
      const d = await this.api('/api/unmapped');
      const all = d?.items || [];
      this.unmappedShopee = all.filter(u => u.platform === 'shopee')
        .filter(u => !this.unmappedSearchShopee || (u.product_name||'').toLowerCase().includes(this.unmappedSearchShopee.toLowerCase()) || (u.sku||'').toLowerCase().includes(this.unmappedSearchShopee.toLowerCase()));
      this.unmappedMeli = all.filter(u => u.platform === 'meli')
        .filter(u => !this.unmappedSearchMeli || (u.product_name||'').toLowerCase().includes(this.unmappedSearchMeli.toLowerCase()) || (u.sku||'').toLowerCase().includes(this.unmappedSearchMeli.toLowerCase()));
    },

    async loadRuns() {
      const d = await this.api('/api/runs');
      this.runs = d?.items || [];
    },

    async runSync() {
      this.loading.sync = true;
      await this.api('/api/sync', { method: 'POST' });
      await this.loadAll();
      this.loading.sync = false;
    },

    async runDiscover() {
      this.loading.discover = true;
      this.discoverResult = await this.api('/api/discover', { method: 'POST' });
      await this.loadAll();
      this.loading.discover = false;
    },

    async toggleMapping(sku) {
      await this.api('/api/mappings/' + encodeURIComponent(sku) + '/toggle', { method: 'POST' });
      await this.loadProducts();
    },

    async ignoreUnmapped(id) {
      await this.api('/api/unmapped/' + id + '/ignore', { method: 'POST' });
      await this.loadUnmapped();
      await this.loadStatus();
    },

    async openPairModal(item, sourcePlatform) {
      this.pairModal = { source: item, sourcePlatform, targetPlatform: sourcePlatform === 'shopee' ? 'meli' : 'shopee' };
      this.pairSearch = '';
      this.pairCatalog = [];
      this.pairTarget = null;
      this.pairSku = '';
    },

    async searchPairCatalog() {
      if (!this.pairModal) return;
      const d = await this.api('/api/catalog?platform=' + this.pairModal.targetPlatform + '&q=' + encodeURIComponent(this.pairSearch));
      this.pairCatalog = d?.items || [];
    },

    selectPairTarget(item) {
      this.pairTarget = item;
      if (!this.pairSku) this.pairSku = this.pairModal?.source?.platform === 'shopee' ? this.pairModal.source.sku : item.sku;
    },

    async confirmPair() {
      if (!this.pairTarget || !this.pairModal) return;
      this.loading.pair = true;
      const source = this.pairModal.source;
      const target = this.pairTarget;
      const meliItem = source.platform === 'meli' ? source : target;
      const shopeeItem = source.platform === 'shopee' ? source : target;
      await this.api('/api/mappings/manual', { method: 'POST', body: JSON.stringify({
        meli_unmapped_id: meliItem.id,
        shopee_unmapped_id: shopeeItem.id,
        sku: this.pairSku || undefined,
        product_name: shopeeItem.product_name || meliItem.product_name,
      })});
      this.pairModal = null;
      this.loading.pair = false;
      await this.loadAll();
    },

    openLinkModal(product, platform) {
      this.linkModal = { sku: product.sku, platform };
      this.linkSearch = '';
      this.linkCatalog = [];
      this.linkTarget = null;
    },

    async searchLinkCatalog() {
      if (!this.linkModal) return;
      const d = await this.api('/api/catalog?platform=' + this.linkModal.platform + '&q=' + encodeURIComponent(this.linkSearch));
      this.linkCatalog = d?.items || [];
    },

    async confirmLink() {
      if (!this.linkTarget || !this.linkModal) return;
      this.loading.link = true;
      await this.api('/api/mappings/' + encodeURIComponent(this.linkModal.sku) + '/link',
        { method: 'POST', body: JSON.stringify({ unmapped_id: this.linkTarget.id }) });
      this.linkModal = null;
      this.linkTarget = null;
      this.loading.link = false;
      await this.loadAll();
    },

    async cleanupUnmapped() {
      this.loading.cleanup = true;
      const r = await this.api('/api/cleanup-unmapped', { method: 'POST' });
      this.loading.cleanup = false;
      await this.loadAll();
      alert('Limpeza concluída: ' + (r?.meli_resolved||0) + ' ML + ' + (r?.shopee_resolved||0) + ' Shopee removidos dos não pareados.');
    },

    async resolveConflict(c) {
      if (c._override == null || c._override < 0) return;
      await this.api('/api/conflicts/' + c.id + '/resolve', { method: 'POST', body: JSON.stringify({ value: Number(c._override) }) });
      await this.loadConflicts();
    },

    openSetStock(p) {
      this.setStockModal = p;
      this.newStockValue = p.master_stock || 0;
    },

    async setStock() {
      this.loading.setStock = true;
      await this.api('/api/products/' + encodeURIComponent(this.setStockModal.sku) + '/set-stock',
        { method: 'POST', body: JSON.stringify({ stock: Number(this.newStockValue) }) });
      this.setStockModal = null;
      this.loading.setStock = false;
      await this.loadProducts();
      await this.loadChanges();
    },

    get lastRunText() {
      const r = this.status.last_run;
      if (!r) return 'Nunca rodou';
      return 'Última sync: ' + this.fmtRelative(r.started_at);
    },

    fmtRelative(ts) {
      if (!ts) return '—';
      const d = (Date.now() - ts) / 1000;
      if (d < 60) return Math.floor(d) + 's atrás';
      if (d < 3600) return Math.floor(d / 60) + 'm atrás';
      if (d < 86400) return Math.floor(d / 3600) + 'h atrás';
      return Math.floor(d / 86400) + 'd atrás';
    },

    stockClass(a, b) {
      if (a == null || b == null) return '';
      return a !== b ? 'text-red-600 font-semibold' : '';
    },

    parseItems(json) {
      try { return JSON.parse(json || '[]'); } catch { return []; }
    },

    orderStatusClass(s) {
      if (!s) return 'bg-slate-100 text-slate-600';
      s = s.toLowerCase();
      if (s.includes('paid') || s.includes('completed') || s.includes('shipped') || s.includes('ready')) return 'bg-emerald-100 text-emerald-700';
      if (s.includes('cancel')) return 'bg-red-100 text-red-700';
      if (s.includes('pending') || s.includes('process')) return 'bg-amber-100 text-amber-700';
      return 'bg-slate-100 text-slate-600';
    },

    triggerClass(t) {
      if (t === 'sale') return 'bg-red-100 text-red-700';
      if (t === 'restock') return 'bg-emerald-100 text-emerald-700';
      if (t === 'conflict') return 'bg-amber-100 text-amber-700';
      if (t === 'manual_set') return 'bg-purple-100 text-purple-700';
      return 'bg-slate-100 text-slate-700';
    },
  };
}
</script>
</body>
</html>`;
