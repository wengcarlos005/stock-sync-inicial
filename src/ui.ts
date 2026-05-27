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
          <span x-show="status.shadow_mode" class="px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-800 rounded">MODO SOMBRA</span>
          <span x-show="!status.shadow_mode" class="px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded">AO VIVO</span>
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
          <div class="text-2xl font-bold" :class="lowStockCount > 0 ? 'text-amber-600' : ''" x-text="lowStockCount"></div>
          <div class="text-xs text-slate-500">Estoque baixo / zerado</div>
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
        <div class="flex gap-3 mb-3 items-center flex-wrap">
          <h2 class="text-sm font-semibold text-slate-700">Pedidos</h2>
          <div class="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
            <button @click="orderPlatform=''; orderPage=1; loadOrders()" :class="orderPlatform==='' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'" class="text-xs px-3 py-1.5 rounded">Todas plataformas</button>
            <button @click="orderPlatform='meli'; orderPage=1; loadOrders()" :class="orderPlatform==='meli' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'" class="text-xs px-3 py-1.5 rounded">🟡 ML</button>
            <button @click="orderPlatform='shopee'; orderPage=1; loadOrders()" :class="orderPlatform==='shopee' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-100'" class="text-xs px-3 py-1.5 rounded">🛒 Shopee</button>
          </div>
          <span class="text-xs text-slate-400 ml-auto">Atualizado a cada 5 min</span>
        </div>
        <div class="flex gap-3 mb-4 items-center flex-wrap">
          <span class="text-xs text-slate-500">Status:</span>
          <div class="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
            <button @click="orderStatus=''; orderPage=1; loadOrders()" :class="orderStatus==='' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'" class="text-xs px-3 py-1.5 rounded">Todos</button>
            <button @click="orderStatus='to_ship'; orderPage=1; loadOrders()" :class="orderStatus==='to_ship' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'" class="text-xs px-3 py-1.5 rounded">📦 A enviar</button>
            <button @click="orderStatus='completed'; orderPage=1; loadOrders()" :class="orderStatus==='completed' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'" class="text-xs px-3 py-1.5 rounded">✅ Concluídos</button>
            <button @click="orderStatus='cancelled'; orderPage=1; loadOrders()" :class="orderStatus==='cancelled' ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-slate-100'" class="text-xs px-3 py-1.5 rounded">❌ Cancelados</button>
          </div>
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
                  <td class="px-4 py-3 font-mono text-xs text-slate-500">
                    <div x-text="o.display_id || o.order_id"></div>
                    <div x-show="o.grouped_count > 1" class="text-[10px] text-indigo-600 font-sans font-medium mt-0.5" x-text="o.grouped_count + ' itens no pacote'"></div>
                  </td>
                  <td class="px-4 py-3 text-sm" x-text="o.buyer || '—'"></td>
                  <td class="px-4 py-3 text-xs">
                    <template x-for="(it, idx) in parseItems(o.items_json)" :key="idx">
                      <div class="flex items-start gap-2 py-1">
                        <template x-if="it.image">
                          <img :src="it.image" class="w-10 h-10 rounded object-cover border border-slate-200 shrink-0" loading="lazy" />
                        </template>
                        <template x-if="!it.image">
                          <div class="w-10 h-10 rounded bg-slate-100 flex items-center justify-center text-slate-300 shrink-0">📦</div>
                        </template>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-baseline gap-1">
                            <span class="font-semibold text-slate-700" x-text="'×' + it.qty"></span>
                            <span class="text-slate-800 text-xs leading-tight" x-text="it.name || it.sku || it.item_id"></span>
                          </div>
                          <div x-show="it.variation" class="text-[11px] text-indigo-600 font-medium mt-0.5" x-text="it.variation"></div>
                          <div x-show="it.sku" class="text-[10px] text-slate-400 font-mono" x-text="'SKU: ' + it.sku"></div>
                        </div>
                      </div>
                    </template>
                  </td>
                  <td class="px-4 py-3">
                    <span class="text-xs px-2 py-0.5 rounded" :class="orderStatusClass(o.status)" x-text="translateStatus(o.status)"></span>
                  </td>
                  <td class="px-4 py-3 text-xs text-slate-500" x-text="fmtRelative(o.created_at)"></td>
                </tr>
              </template>
              <tr x-show="orders.length === 0">
                <td colspan="6" class="text-center py-10 text-slate-400">
                  <div class="text-2xl mb-2">🛒</div>
                  <div>Nenhum pedido encontrado com esses filtros.</div>
                </td>
              </tr>
            </tbody>
          </table>
          <!-- Paginação -->
          <div x-show="orderTotalPages > 1" class="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50 text-sm">
            <div class="text-slate-500 text-xs">
              <span x-text="'Mostrando '+ ((orderPage-1)*100+1) + '–' + Math.min(orderPage*100, orderTotal) + ' de ' + orderTotal + ' pedidos'"></span>
            </div>
            <div class="flex gap-1 items-center">
              <button @click="orderPage=1; loadOrders()" :disabled="orderPage===1" class="px-2 py-1 text-xs rounded bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40">«</button>
              <button @click="orderPage--; loadOrders()" :disabled="orderPage===1" class="px-2 py-1 text-xs rounded bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40">‹</button>
              <span class="px-3 text-xs text-slate-600" x-text="'Página ' + orderPage + ' de ' + orderTotalPages"></span>
              <button @click="orderPage++; loadOrders()" :disabled="orderPage>=orderTotalPages" class="px-2 py-1 text-xs rounded bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40">›</button>
              <button @click="orderPage=orderTotalPages; loadOrders()" :disabled="orderPage>=orderTotalPages" class="px-2 py-1 text-xs rounded bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40">»</button>
            </div>
          </div>
        </div>
      </section>

      <!-- Estoque (mesma estrutura agrupada da aba Produtos, mas focado em estoque) -->
      <section x-show="tab === 'stock'" x-cloak>
        <div class="flex flex-wrap gap-3 mb-4 items-center">
          <input x-model="masterSearch" @input.debounce.300ms="loadMaster()" placeholder="Buscar por nome, SKU ou variação..."
            class="flex-1 min-w-[260px] px-4 py-2 border border-slate-300 rounded-lg" />
          <div class="flex bg-slate-100 p-1 rounded-lg gap-1">
            <button @click="masterFilter='all'; loadMaster()" :class="masterFilter==='all' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded">Todos</button>
            <button @click="masterFilter='paired'; loadMaster()" :class="masterFilter==='paired' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded">✓ Pareados</button>
            <button @click="masterFilter='unpaired'; loadMaster()" :class="masterFilter==='unpaired' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded">⚠ Faltando</button>
          </div>
          <button @click="loadMaster()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm">↻ Atualizar</button>
        </div>
        <div class="text-xs text-slate-500 mb-3"><span x-text="masterItems.length"></span> anúncios · <span x-text="masterTotalVars"></span> variações</div>

        <div class="space-y-3">
          <template x-for="anuncio in masterItems" :key="anuncio.key">
            <div class="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div class="flex items-start gap-3 p-3 bg-slate-50 border-b border-slate-200">
                <template x-if="anuncio.image">
                  <img :src="anuncio.image" class="w-14 h-14 rounded object-cover border border-slate-200 shrink-0" loading="lazy" />
                </template>
                <template x-if="!anuncio.image">
                  <div class="w-14 h-14 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-300 text-xl shrink-0">📦</div>
                </template>
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-sm leading-snug" x-text="(anuncio.product_name||'Sem nome').slice(0,120)"></div>
                  <div class="text-xs text-slate-500 mt-1 flex flex-wrap gap-2">
                    <span x-show="anuncio.shopee_item_id">🟠 SP: <span class="font-mono" x-text="anuncio.shopee_item_id"></span></span>
                    <span x-show="anuncio.meli_item_id">🔵 ML: <span class="font-mono" x-text="anuncio.meli_item_id"></span></span>
                    <span>· <span x-text="anuncio.variations.length"></span> variações</span>
                    <span x-show="anuncio.fully_paired" class="text-emerald-600">✓ pareado</span>
                  </div>
                </div>
              </div>
              <table class="w-full text-sm">
                <thead class="bg-white text-[11px] uppercase text-slate-400 border-b">
                  <tr>
                    <th class="text-left px-3 py-2 w-36">Variação</th>
                    <th class="text-left px-3 py-2">SKU</th>
                    <th class="text-right px-3 py-2 w-20">ML</th>
                    <th class="text-right px-3 py-2 w-20">SP</th>
                    <th class="text-right px-3 py-2 w-24">Unidades</th>
                    <th class="text-center px-3 py-2 w-32">Ação</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <template x-for="v in anuncio.variations" :key="(v.shopee_model_id||'')+'|'+(v.meli_variation_id||'')+'|'+v.sku">
                    <tr :class="v.paired ? (v.active ? '' : 'opacity-50') : 'bg-amber-50/40'">
                      <td class="px-3 py-2">
                        <span x-show="v.variation" class="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded" x-text="v.variation"></span>
                        <span x-show="!v.variation" class="text-xs text-slate-300">—</span>
                      </td>
                      <td class="px-3 py-2 font-mono text-xs" x-text="v.sku || '(sem SKU)'"></td>
                      <td class="px-3 py-2 text-right font-mono text-xs" :class="unitsClass(v.meli_stock)" x-text="v.meli_stock ?? '—'"></td>
                      <td class="px-3 py-2 text-right font-mono text-xs" :class="unitsClass(v.shopee_stock)" x-text="v.shopee_stock ?? '—'"></td>
                      <td class="px-3 py-2 text-right">
                        <template x-if="v.paired">
                          <span class="text-lg font-bold font-mono" :class="unitsClass(unifiedStock(v))" x-text="unifiedStockDisplay(v)"></span>
                        </template>
                        <template x-if="!v.paired">
                          <span class="text-xs text-slate-300">—</span>
                        </template>
                      </td>
                      <td class="px-3 py-2 text-center">
                        <template x-if="v.paired">
                          <div class="flex gap-1 justify-center">
                            <button @click="openSetStock(v)" class="text-xs px-2 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded">Atualizar</button>
                            <button @click="toggleMapping(v.sku)" class="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded" x-text="v.active ? 'pausar' : 'ativar'"></button>
                          </div>
                        </template>
                        <template x-if="!v.paired">
                          <button @click="openPairFromMaster(v, anuncio)" class="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded">+ Parear</button>
                        </template>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </template>
          <div x-show="masterItems.length === 0" class="text-center py-10 text-slate-400 bg-white border border-slate-200 rounded-lg">
            <div class="text-2xl mb-2">📦</div>
            <div>Nenhum produto encontrado.</div>
          </div>
        </div>
        <!-- placeholder mantém estado legado de products[] -->
        <table class="hidden"><tbody>
          <template x-for="p in products" :key="p.sku"><tr></tr></template>
        </tbody></table>
      </section>

      <!-- Produtos (Stats de vendas) -->
      <section x-show="tab === 'products'" x-cloak>
        <div class="flex flex-wrap gap-3 mb-4 items-center">
          <input x-model="masterSearch" @input.debounce.300ms="loadMaster()" placeholder="Buscar por nome, SKU ou variação..."
            class="flex-1 min-w-[260px] px-4 py-2 border border-slate-300 rounded-lg" />
          <div class="flex bg-slate-100 p-1 rounded-lg gap-1">
            <button @click="masterFilter='all'; loadMaster()" :class="masterFilter==='all' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded">Todos</button>
            <button @click="masterFilter='paired'; loadMaster()" :class="masterFilter==='paired' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded">✓ Pareados</button>
            <button @click="masterFilter='unpaired'; loadMaster()" :class="masterFilter==='unpaired' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded">⚠ Sem ML</button>
          </div>
          <button @click="loadMaster()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm">↻ Atualizar</button>
        </div>
        <div class="text-xs text-slate-500 mb-3"><span x-text="masterItems.length"></span> anúncios Shopee · <span x-text="masterTotalVars"></span> variações</div>

        <div class="space-y-3">
          <template x-for="anuncio in masterItems" :key="anuncio.shopee_item_id">
            <div class="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div class="flex items-start gap-3 p-3 bg-slate-50 border-b border-slate-200">
                <template x-if="anuncio.image">
                  <img :src="anuncio.image" class="w-14 h-14 rounded object-cover border border-slate-200 shrink-0" loading="lazy" />
                </template>
                <template x-if="!anuncio.image">
                  <div class="w-14 h-14 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-300 text-xl shrink-0">📦</div>
                </template>
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-sm leading-snug" x-text="(anuncio.product_name||'Sem nome').slice(0,120)"></div>
                  <div class="text-xs text-slate-500 mt-1 flex flex-wrap gap-2">
                    <span x-show="anuncio.shopee_item_id">🟠 SP: <span class="font-mono" x-text="anuncio.shopee_item_id"></span></span>
                    <span x-show="anuncio.meli_item_id">🔵 ML: <span class="font-mono" x-text="anuncio.meli_item_id"></span></span>
                    <span>· <span x-text="anuncio.variations.length"></span> variações</span>
                    <span x-show="anuncio.fully_paired" class="text-emerald-600">✓ pareado</span>
                  </div>
                </div>
              </div>
              <table class="w-full text-sm">
                <thead class="bg-white text-[11px] uppercase text-slate-400 border-b">
                  <tr>
                    <th class="text-left px-3 py-2 w-36">Variação</th>
                    <th class="text-left px-3 py-2">SKU</th>
                    <th class="text-center px-3 py-2 w-20">7d</th>
                    <th class="text-center px-3 py-2 w-20">30d</th>
                    <th class="text-center px-3 py-2 w-20">Total</th>
                    <th class="text-center px-3 py-2 w-28">Status</th>
                    <th class="text-center px-3 py-2 w-32">Ação</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <template x-for="v in anuncio.variations" :key="(v.shopee_model_id||'')+'|'+(v.meli_variation_id||'')+'|'+v.sku">
                    <tr :class="v.paired ? '' : 'bg-amber-50/40'">
                      <td class="px-3 py-2">
                        <span x-show="v.variation" class="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded" x-text="v.variation"></span>
                        <span x-show="!v.variation" class="text-xs text-slate-300">—</span>
                      </td>
                      <td class="px-3 py-2 font-mono text-xs" x-text="v.sku || '(sem SKU)'"></td>
                      <td class="px-3 py-2 text-center font-mono text-emerald-700 font-semibold" x-text="v.sales_7d || '—'"></td>
                      <td class="px-3 py-2 text-center font-mono text-slate-700" x-text="v.sales_30d || '—'"></td>
                      <td class="px-3 py-2 text-center font-mono font-bold" x-text="v.sales_total || '—'"></td>
                      <td class="px-3 py-2 text-center text-xs">
                        <template x-if="v.paired">
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded">✓ ML+SP</span>
                        </template>
                        <template x-if="!v.paired && v.shopee_item_id">
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded">⚠ Só SP</span>
                        </template>
                        <template x-if="!v.paired && v.meli_item_id">
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded">⚠ Só ML</span>
                        </template>
                      </td>
                      <td class="px-3 py-2 text-center">
                        <template x-if="v.paired">
                          <button @click="openSetStock(v)" class="text-xs px-2 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded">Atualizar</button>
                        </template>
                        <template x-if="!v.paired">
                          <button @click="openPairFromMaster(v, anuncio)" class="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded">+ Parear</button>
                        </template>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </template>
          <div x-show="masterItems.length === 0" class="text-center py-10 text-slate-400 bg-white border border-slate-200 rounded-lg">
            <div class="text-2xl mb-2">🛒</div>
            <div>Nenhum produto Shopee encontrado.</div>
            <div class="text-xs mt-1 text-slate-300">Rode o Discovery em Config pra varrer sua loja.</div>
          </div>
        </div>

        <!-- placeholder pra manter compat com loadSales antigo (em outras telas) -->
        <table class="hidden">
          <tbody>
            <template x-for="s in salesStats" :key="s.sku"><tr></tr></template>
              <tr x-show="salesStats.length === 0">
                <td colspan="7" class="text-center py-10 text-slate-400">
                  <div class="text-2xl mb-2">📊</div>
                  <div>Nenhum dado de venda ainda.</div>
                  <div class="text-xs mt-1 text-slate-300">Pedidos detectados pelo sync vão aparecer aqui.</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Movimentações -->
      <section x-show="tab === 'changes'" x-cloak>
        <div class="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th class="text-left px-4 py-3">Quando</th>
                <th class="text-left px-4 py-3">Produto / SKU</th>
                <th class="text-left px-4 py-3">Origem</th>
                <th class="text-left px-4 py-3">Tipo</th>
                <th class="text-right px-4 py-3">Δ unidades</th>
                <th class="text-left px-4 py-3">Estoque antes → depois</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <template x-for="c in changes" :key="c.id">
                <tr :class="c.shadow ? 'bg-amber-50/50' : ''">
                  <td class="px-4 py-3 text-xs text-slate-500" x-text="fmtRelative(c.ts)"></td>
                  <td class="px-4 py-3">
                    <div class="text-xs leading-tight" x-text="(c.product_name||'').slice(0,55) || c.sku"></div>
                    <div class="text-[10px] text-slate-400 font-mono" x-text="c.sku"></div>
                  </td>
                  <td class="px-4 py-3 text-xs">
                    <span x-show="c.source==='meli'" class="text-amber-700">🟡 ML</span>
                    <span x-show="c.source==='shopee'" class="text-orange-700">🛒 Shopee</span>
                    <span x-show="c.source==='manual'" class="text-purple-700">✋ Manual</span>
                  </td>
                  <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded" :class="triggerClass(c.trigger)" x-text="triggerLabel(c.trigger)"></span></td>
                  <td class="px-4 py-3 text-right font-mono font-bold" :class="c.delta < 0 ? 'text-red-600' : c.delta > 0 ? 'text-emerald-600' : ''" x-text="c.delta > 0 ? '+' + c.delta : c.delta"></td>
                  <td class="px-4 py-3 text-xs font-mono text-slate-500">
                    <template x-if="c.meli_stock_before !== null || c.shopee_stock_before !== null">
                      <div>
                        <div x-show="c.meli_stock_before !== null">ML: <span x-text="c.meli_stock_before + ' → ' + c.meli_stock_after"></span></div>
                        <div x-show="c.shopee_stock_before !== null">Shopee: <span x-text="c.shopee_stock_before + ' → ' + c.shopee_stock_after"></span></div>
                      </div>
                    </template>
                    <template x-if="c.meli_stock_before === null && c.shopee_stock_before === null">
                      <span class="text-slate-300">—</span>
                    </template>
                  </td>
                </tr>
              </template>
              <tr x-show="changes.length === 0">
                <td colspan="6" class="text-center py-8 text-slate-400">Nenhuma movimentação ainda. Use "Reconstruir Movimentações" na aba Config.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>


      <!-- Não pareados -->
      <section x-show="tab === 'unmapped'" x-cloak>
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
          Produtos que existem em apenas um marketplace. Use <strong>Parear lote</strong> para casar todas variações de um anúncio Shopee com um anúncio ML automaticamente (por sufixo numérico do SKU).
        </div>
        <div class="mb-4 bg-white border border-slate-200 rounded-lg p-4">
          <h3 class="text-sm font-semibold mb-2">⚡ Pareamento em lote por anúncio</h3>
          <p class="text-xs text-slate-500 mb-3">Cole o <strong>item_id</strong> do Shopee e do ML que são o "mesmo anúncio" (mesmo produto). O sistema pareia as variações automaticamente.</p>
          <div class="flex gap-2">
            <input id="batch-shopee-input" x-model="batchShopeeId" placeholder="Shopee item_id (ex: 29443482352)" class="flex-1 px-3 py-2 border border-slate-300 rounded text-sm font-mono" />
            <input id="batch-meli-input" x-model="batchMeliId" placeholder="ML item_id (ex: MLB6139127802)" class="flex-1 px-3 py-2 border border-slate-300 rounded text-sm font-mono" />
            <button @click="batchPairDry()" :disabled="loading.batchPair" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm">Pré-visualizar</button>
            <button @click="batchPairApply()" :disabled="loading.batchPair" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm">Aplicar</button>
          </div>
          <div x-show="batchPairResult" class="mt-3 p-3 bg-slate-50 rounded text-xs">
            <div x-show="batchPairResult?.dry_run" class="font-semibold mb-2">Pré-visualização:</div>
            <div>
              <span x-text="batchPairResult?.matched || batchPairResult?.created || 0"></span> pares formados
              · <span x-text="batchPairResult?.unmatched_count || 0"></span> sem match
            </div>
            <template x-if="batchPairResult?.matches?.length">
              <ul class="mt-2 space-y-1 max-h-60 overflow-y-auto">
                <template x-for="m in batchPairResult.matches" :key="m.sku">
                  <li class="text-slate-600 border-b border-slate-100 py-1">
                    <div><span class="font-mono font-semibold" x-text="m.sku"></span> <span class="text-[10px] text-indigo-500" x-text="'· ' + m.reason"></span></div>
                    <div class="text-[11px] text-slate-500">
                      🛒 <span x-text="m.shopee_name || '(sem nome)'"></span>
                      ↔ 🟡 <span x-text="m.meli_name || '(sem nome)'"></span>
                    </div>
                  </li>
                </template>
              </ul>
            </template>
          </div>
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
                    <button @click="batchShopeeId=String(u.item_id)" class="text-[10px] px-2 py-0.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded">usar lote</button>
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
                    <button @click="batchMeliId=String(u.item_id)" class="text-[10px] px-2 py-0.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded">usar lote</button>
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
            <h3 class="font-semibold mb-2">Histórico de pedidos (backfill)</h3>
            <p class="text-sm text-slate-500 mb-3">Importa pedidos antigos das duas plataformas pra alimentar as estatísticas de vendas na aba <strong>Produtos</strong>. Pode demorar alguns segundos.</p>
            <div class="flex gap-2 items-center">
              <select x-model="backfillDays" class="px-3 py-2 border border-slate-300 rounded text-sm bg-white">
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="180">Últimos 6 meses</option>
                <option value="365">Último ano</option>
                <option value="730">Últimos 2 anos</option>
              </select>
              <button @click="runBackfill()" :disabled="loading.backfill" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded text-sm">
                <span x-show="!loading.backfill">⬇ Importar histórico</span>
                <span x-show="loading.backfill">Importando...</span>
              </button>
            </div>
            <div x-show="backfillResult" class="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-800">
              ✅ Importado: <strong x-text="backfillResult?.ml?.inserted || 0"></strong> pedidos ML
              + <strong x-text="backfillResult?.shopee?.inserted || 0"></strong> pedidos Shopee
              <template x-if="(backfillResult?.errors?.length ?? 0) > 0">
                <div class="mt-2 text-amber-700 text-xs">Avisos: <span x-text="backfillResult.errors.join(' | ')"></span></div>
              </template>
            </div>
            <div class="mt-3">
              <button @click="rebuildChanges()" :disabled="loading.rebuild" class="px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white font-medium rounded text-sm">
                <span x-show="!loading.rebuild">🔄 Reconstruir Movimentações</span>
                <span x-show="loading.rebuild">Reconstruindo...</span>
              </button>
              <span class="text-xs text-slate-500 ml-2">Gera o histórico de saídas (vendas) a partir dos pedidos importados.</span>
            </div>
          </div>

          <div class="border-t pt-6">
            <h3 class="font-semibold mb-2">Limpar "Não Pareados"</h3>
            <p class="text-sm text-slate-500 mb-3">Remove da lista de "Não Pareados" todos os itens que já possuem um mapeamento criado (aparecem indevidamente após imports antigos).</p>
            <div class="flex gap-2">
              <button @click="cleanupUnmapped()" :disabled="loading.cleanup" class="px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white font-medium rounded text-sm">
                <span x-show="!loading.cleanup">🧹 Limpar já-mapeados</span>
                <span x-show="loading.cleanup">Limpando...</span>
              </button>
              <button @click="restoreUnmapped()" :disabled="loading.cleanup" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium rounded text-sm">
                <span x-show="!loading.cleanup">↩ Restaurar incorretamente resolvidos</span>
                <span x-show="loading.cleanup">Restaurando...</span>
              </button>
            </div>
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
    tab: 'stock',
    tabs: [
      { id: 'orders', label: '🛒 Pedidos' },
      { id: 'stock', label: '📦 Estoque' },
      { id: 'products', label: '📊 Produtos' },
      { id: 'changes', label: '📜 Movimentações' },
      { id: 'unmapped', label: '❓ Não pareados' },
      { id: 'config', label: '⚙️ Config' },
    ],
    status: {},
    products: [],
    salesStats: [],
    salesSearch: '',
    masterItems: [],
    masterTotalVars: 0,
    masterSearch: '',
    masterFilter: 'all',
    changes: [],
    unmapped: [],
    runs: [],
    productSearch: '',
    productFilter: 'all',
    loading: { sync: false, discover: false, setStock: false, pair: false, link: false, cleanup: false, backfill: false, rebuild: false, batchPair: false },
    batchShopeeId: '',
    batchMeliId: '',
    batchPairResult: null,
    backfillDays: '365',
    backfillResult: null,
    linkModal: null,
    linkSearch: '',
    linkCatalog: [],
    linkTarget: null,
    orders: [],
    orderPlatform: '',
    orderStatus: '',
    orderPage: 1,
    orderTotal: 0,
    orderTotalPages: 1,
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
        this.loadMaster(),
        this.loadChanges(),
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
      const um = this.tabs.find(t => t.id === 'unmapped');
      if (um) um.count = d.unmapped_items;
      return true;
    },

    async loadSales() {
      const d = await this.api('/api/products/sales?q=' + encodeURIComponent(this.salesSearch || ''));
      this.salesStats = d?.items || [];
    },
    async loadMaster() {
      const q = new URLSearchParams({ q: this.masterSearch || '', filter: this.masterFilter || 'all' });
      const d = await this.api('/api/products/master?' + q.toString());
      this.masterItems = d?.items || [];
      this.masterTotalVars = d?.total_variations || 0;
      const t = this.tabs.find(x => x.id === 'products');
      if (t) t.count = d?.total || 0;
      // Aba Estoque também usa esse dado
      const t2 = this.tabs.find(x => x.id === 'stock');
      if (t2) t2.count = d?.total || 0;
    },
    openPairFromMaster(v, anuncio) {
      // Pré-preenche batch pair com IDs do anúncio (lado faltante vazio)
      this.batchShopeeId = String(v.shopee_item_id || anuncio.shopee_item_id || '');
      this.batchMeliId   = String(v.meli_item_id   || anuncio.meli_item_id   || '');
      this.tab = 'unmapped';
      setTimeout(() => {
        const el = document.getElementById(this.batchShopeeId ? 'batch-meli-input' : 'batch-shopee-input');
        if (el) el.focus();
      }, 200);
    },

    async loadProducts() {
      const url = '/api/products?q=' + encodeURIComponent(this.productSearch) + '&filter=' + this.productFilter;
      const d = await this.api(url);
      this.products = d?.items || [];
      const t = this.tabs.find(x => x.id === 'stock');
      if (t) t.count = d?.total || 0;
    },

    async loadOrders() {
      const params = new URLSearchParams();
      params.set('page', String(this.orderPage));
      params.set('page_size', '100');
      if (this.orderPlatform) params.set('platform', this.orderPlatform);
      if (this.orderStatus) params.set('status_group', this.orderStatus);
      const d = await this.api('/api/orders?' + params.toString());
      this.orders = d?.items || [];
      this.orderTotal = d?.total || 0;
      this.orderTotalPages = d?.total_pages || 1;
      this.tabs.find(t => t.id === 'orders').count = this.orderTotal;
    },

    async loadChanges() {
      const d = await this.api('/api/changes?limit=1000');
      this.changes = d?.items || [];
      this.tabs.find(t => t.id === 'changes').count = this.changes.length;
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

    async restoreUnmapped() {
      this.loading.cleanup = true;
      const r = await this.api('/api/restore-unmapped', { method: 'POST' });
      this.loading.cleanup = false;
      await this.loadAll();
      alert('Restaurados: ' + (r?.meli_restored||0) + ' ML + ' + (r?.shopee_restored||0) + ' Shopee voltaram para não pareados.');
    },

    async batchPairDry() {
      if (!this.batchShopeeId || !this.batchMeliId) return;
      this.loading.batchPair = true;
      this.batchPairResult = await this.api('/api/mappings/pair-products', {
        method: 'POST',
        body: JSON.stringify({ shopee_item_id: this.batchShopeeId, meli_item_id: this.batchMeliId, dry_run: true }),
      });
      this.loading.batchPair = false;
    },

    async batchPairApply() {
      if (!this.batchShopeeId || !this.batchMeliId) return;
      if (!confirm('Aplicar pareamento em lote? Vai criar mappings para todas variações que casarem.')) return;
      this.loading.batchPair = true;
      this.batchPairResult = await this.api('/api/mappings/pair-products', {
        method: 'POST',
        body: JSON.stringify({ shopee_item_id: this.batchShopeeId, meli_item_id: this.batchMeliId }),
      });
      this.loading.batchPair = false;
      await this.loadAll();
    },

    async rebuildChanges() {
      this.loading.rebuild = true;
      try {
        const r = await this.api('/api/changes/rebuild', { method: 'POST' });
        await this.loadChanges();
        alert((r?.inserted ?? 0) + ' movimentações geradas.');
      } finally {
        this.loading.rebuild = false;
      }
    },

    async runBackfill() {
      this.loading.backfill = true;
      this.backfillResult = { ml: { inserted: 0 }, shopee: { inserted: 0 }, errors: [] };
      const total = Number(this.backfillDays);
      // Janelas de 30 dias pra não estourar timeout
      const CHUNK = 30;
      try {
        for (let from = 0; from < total; from += CHUNK) {
          const to = Math.min(total, from + CHUNK);
          try {
            const res = await fetch('/api/orders/backfill?days=' + to + '&from_days=' + from, {
              method: 'POST',
              headers: { 'x-admin-token': this.token },
              signal: AbortSignal.timeout(280000),
            });
            const d = await res.json();
            this.backfillResult.ml.inserted += (d.ml?.inserted || 0);
            this.backfillResult.shopee.inserted += (d.shopee?.inserted || 0);
            if (d.errors?.length) this.backfillResult.errors.push(...d.errors);
          } catch (e) {
            // timeout dessa janela — backfill segue rodando server-side, vamos pra próxima
            this.backfillResult.errors.push('Janela ' + from + '-' + to + 'd: timeout (servidor continua processando)');
          }
        }
        await Promise.all([this.loadSales(), this.loadOrders(), this.loadStatus()]);
      } catch (e) {
        this.backfillResult.errors.push(String(e.message || e));
      }
      this.loading.backfill = false;
    },

    async cleanupUnmapped() {
      this.loading.cleanup = true;
      const r = await this.api('/api/cleanup-unmapped', { method: 'POST' });
      this.loading.cleanup = false;
      await this.loadAll();
      alert('Limpeza concluída: ' + (r?.meli_resolved||0) + ' ML + ' + (r?.shopee_resolved||0) + ' Shopee removidos dos não pareados.');
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

    unifiedStock(p) {
      // Estoque "unidades" canônico: master_stock se houver, senão min(meli,shopee)
      if (p.master_stock != null) return p.master_stock;
      const a = p.meli_stock, b = p.shopee_stock;
      if (a == null && b == null) return null;
      if (a == null) return b;
      if (b == null) return a;
      return Math.min(a, b);
    },

    unifiedStockDisplay(p) {
      const s = this.unifiedStock(p);
      if (s == null) return '—';
      // Se ML e Shopee divergem, mostra alerta
      if (p.meli_stock != null && p.shopee_stock != null && p.meli_stock !== p.shopee_stock) {
        return s + ' ⚠';
      }
      return s;
    },

    unitsClass(n) {
      if (n == null) return 'text-slate-400';
      if (n === 0) return 'text-red-600';
      if (n < 3) return 'text-amber-600';
      return 'text-slate-800';
    },

    get lowStockCount() {
      return (this.products || []).filter(p => {
        const s = this.unifiedStock(p);
        return s != null && s < 3;
      }).length;
    },

    parseItems(json) {
      try { return JSON.parse(json || '[]'); } catch { return []; }
    },

    orderStatusClass(s) {
      if (!s) return 'bg-slate-100 text-slate-600';
      s = s.toLowerCase();
      if (s.includes('paid') || s.includes('completed') || s.includes('shipped') || s.includes('ready')) return 'bg-emerald-100 text-emerald-700';
      if (s.includes('cancel')) return 'bg-red-100 text-red-700';
      if (s.includes('pending') || s.includes('process') || s.includes('unpaid')) return 'bg-amber-100 text-amber-700';
      return 'bg-slate-100 text-slate-600';
    },

    translateStatus(s) {
      if (!s) return '—';
      const map = {
        // Mercado Livre
        'paid': 'Pago',
        'confirmed': 'Confirmado',
        'payment_required': 'Aguardando pagamento',
        'payment_in_process': 'Processando pagamento',
        'partially_paid': 'Pago parcialmente',
        'pending_shipment': 'Aguardando envio',
        'shipped': 'Enviado',
        'delivered': 'Entregue',
        'cancelled': 'Cancelado',
        'invalid': 'Inválido',
        // Shopee
        'unpaid': 'Não pago',
        'ready_to_ship': 'Pronto para envio',
        'processed': 'Processado',
        'retry_ship': 'Reenvio',
        'to_confirm_receive': 'Aguardando confirmação',
        'in_cancel': 'Cancelando',
        'to_return': 'A devolver',
        'completed': 'Concluído',
        // Genéricos
        'pending': 'Pendente',
      };
      const k = String(s).toLowerCase();
      return map[k] || s;
    },

    triggerClass(t) {
      if (t === 'sale' || t === 'sale_backfill') return 'bg-red-100 text-red-700';
      if (t === 'restock') return 'bg-emerald-100 text-emerald-700';
      if (t === 'conflict') return 'bg-amber-100 text-amber-700';
      if (t === 'manual_set') return 'bg-purple-100 text-purple-700';
      return 'bg-slate-100 text-slate-700';
    },

    triggerLabel(t) {
      const map = {
        'sale': 'Venda',
        'sale_backfill': 'Venda (hist.)',
        'restock': 'Reposição',
        'conflict': 'Conflito',
        'manual_set': 'Manual',
      };
      return map[t] || t;
    },
  };
}
</script>
</body>
</html>`;
