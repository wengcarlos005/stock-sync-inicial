// UI single-page HTML (servida pelo próprio Worker)
export const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>UniHub — ML ↔ Shopee</title>
  <meta name="theme-color" content="#4f46e5" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="UniHub" />
  <meta name="mobile-web-app-capable" content="yes" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/logo.png" />
  <link rel="icon" type="image/png" href="/logo.png" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://unpkg.com/alpinejs@3.13.10/dist/cdn.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    [x-cloak] { display: none !important; }
    html, body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    body { background: #f8fafc; } /* slate-50 */
    /* Sidebar nav */
    .nav-item { transition: all .15s ease; color: #475569; }
    .nav-item:hover { background: rgba(99,102,241,.07); color: #4338ca; }
    .nav-item.active { background: linear-gradient(90deg, rgba(99,102,241,.12), rgba(99,102,241,0)); color: #4f46e5; font-weight: 600; box-shadow: inset 3px 0 0 #4f46e5; }
    /* Custom scrollbar */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
    ::-webkit-scrollbar-track { background: transparent; }
    /* SVG icon size default */
    .ico { width: 18px; height: 18px; stroke-width: 1.75; }
    /* Surfaces: sidebar + topbar */
    .app-surface { background-color: #ffffff; }
    /* Topbar sticky com sombra mais clara quando "stuck" pra separar do conteúdo */
    header.app-surface { box-shadow: 0 2px 4px rgba(15,23,42,.06); background-color: #ffffff !important; }
    /* Body sem scroll horizontal — garante que conteúdo não empurra a página */
    html, body { overflow-x: hidden; max-width: 100vw; }
    /* Layout principal: flex com sidebar fixo + conteúdo flexível */
    .app-layout { display: flex; min-height: 100vh; }
    .content-wrap { flex: 1 1 0%; min-width: 0; display: flex; flex-direction: column; }
    /* Brand logo container */
    .brand-mark { display: flex; align-items: center; justify-content: center; }
    .brand-mark svg { display: block; width: 100%; height: 100%; }
    /* Layout robusto: garante que sections estão em block (sem flex herdado) */
    main > section { display: block; clear: both; }
    /* Stat cards: paleta indigo (azul) */
    .stat-surface { background-color: #eef2ff; }
    .stat-surface .stat-num { color: #4338ca; }
    .stat-surface .stat-label { color: #6366f1; }
    /* Nav count badges: indigo */
    .nav-count { background-color: #e0e7ff; color: #4338ca; }
    .nav-count-active { background-color: #4f46e5; color: #ffffff; }
  </style>
</head>
<body class="text-slate-800 min-h-screen">

<div x-data="app()" x-init="init()" x-cloak>

  <!-- Login overlay -->
  <div x-show="!token" class="fixed inset-0 bg-gradient-to-br from-indigo-50 via-white to-slate-50 flex items-center justify-center z-50 p-4">
    <div class="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full border border-slate-100">
      <div class="flex items-center gap-3 mb-6">
        <img src="/logo.png" alt="UniHub" class="h-12 w-12 shrink-0" />
        <div>
          <h1 class="text-lg font-bold text-slate-900 leading-tight">UniHub</h1>
          <p class="text-[11px] text-slate-400 uppercase tracking-wide leading-tight">Sincronização Integrada</p>
        </div>
      </div>
      <p class="text-sm text-slate-500 mb-5">Entre com seu admin token para continuar.</p>
      <form @submit.prevent="login()">
        <label class="text-xs font-medium text-slate-600 mb-1.5 block">Admin token</label>
        <input x-model="loginInput" type="password" placeholder="••••••••"
          class="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none text-sm" autofocus />
        <p x-show="loginError" x-text="loginError" class="text-red-600 text-xs mt-2"></p>
        <button class="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition text-sm shadow-sm">Entrar</button>
      </form>
    </div>
  </div>

  <!-- Inline SVG icons (Heroicons outline) — reusable via <template> -->
  <template id="ico-brand"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="ub1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0c3a85"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient><linearGradient id="ub2" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#1e40af"/><stop offset="100%" stop-color="#2563eb"/></linearGradient><linearGradient id="ub3" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#60a5fa"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient></defs><g fill="none" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="62" r="22" stroke="url(#ub1)"/><circle cx="68" cy="62" r="22" stroke="url(#ub2)"/><circle cx="50" cy="32" r="22" stroke="url(#ub3)"/></g></svg></template>
  <template id="ico-orders"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"/></svg></template>
  <template id="ico-stock"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg></template>
  <template id="ico-products"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/></svg></template>
  <template id="ico-changes"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg></template>
  <template id="ico-unmapped"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"/></svg></template>
  <template id="ico-config"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg></template>
  <template id="ico-sync"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg></template>
  <template id="ico-logout"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"/></svg></template>
  <template id="ico-menu"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"/></svg></template>
  <template id="ico-x"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg></template>
  <template id="ico-sun"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"/></svg></template>
  <template id="ico-moon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 8.992-5.998Z"/></svg></template>

  <!-- Main layout: sidebar + conteúdo (escondido quando aba Config tá em standalone) -->
  <div x-show="token" class="app-layout relative">

    <!-- Mobile sidebar overlay -->
    <div x-show="sidebarOpen" x-cloak @click="sidebarOpen = false" class="sidebar-mobile-overlay fixed inset-0 bg-slate-900/40 z-40 md:hidden"></div>

    <!-- Sidebar -->
    <aside :class="sidebarOpen ? 'translate-x-0 fixed' : '-translate-x-full fixed'"
      class="app-surface top-0 left-0 z-50 w-64 md:!w-60 md:!translate-x-0 md:!sticky md:!flex shrink-0 border-r border-slate-200 flex flex-col h-screen transition-transform duration-200">
      <!-- Brand -->
      <div class="px-5 py-5 border-b border-slate-100 flex items-center justify-between">
        <div class="flex items-center gap-2.5 min-w-0">
          <img src="/logo.png" alt="UniHub" class="h-10 w-10 shrink-0" />
          <div class="min-w-0">
            <div class="text-[15px] font-bold leading-tight text-slate-900 truncate">UniHub</div>
            <div class="text-[10px] text-slate-400 leading-tight uppercase tracking-wide">Sincronização Integrada</div>
          </div>
        </div>
        <button @click="sidebarOpen = false" class="md:hidden text-slate-400 hover:text-slate-700 p-1" aria-label="Fechar menu">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <!-- Nav -->
      <nav class="flex-1 px-2 py-3 overflow-y-auto">
        <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-3 mb-1.5">Operação</div>
        <template x-for="t in tabs" :key="t.id">
          <button @click="tab = t.id; sidebarOpen = false"
            :class="tab === t.id ? 'nav-item active' : 'nav-item text-slate-600'"
            class="w-full text-left px-3 py-2 mb-0.5 rounded-r-md text-sm flex items-center justify-between">
            <span class="flex items-center gap-2.5">
              <span x-html="getIcon(t.icon)" class="shrink-0"></span>
              <span x-text="t.label"></span>
            </span>
            <span x-show="t.count !== undefined" x-text="t.count || 0"
              :class="tab === t.id ? 'nav-count-active' : 'nav-count'"
              class="text-[10px] font-semibold px-1.5 py-0.5 rounded"></span>
          </button>
        </template>
      </nav>

      <!-- Footer -->
      <div class="px-3 py-3 border-t border-slate-100 space-y-1">
        <div class="text-[10px] text-slate-400 px-2 mb-1.5" x-text="lastRunText"></div>
        <button @click="logout()" class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 rounded transition">
          <span x-html="getIcon('logout')" class="shrink-0"></span> Sair
        </button>
      </div>
    </aside>

    <!-- Content area (grid column 2 via .content-wrap) -->
    <div class="content-wrap overflow-x-hidden">

      <!-- Top bar -->
      <header class="app-surface border-b border-slate-200 sticky top-0 z-30">
        <div class="px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-2 sm:gap-4">
          <button @click="sidebarOpen = true" class="md:hidden text-slate-600 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100" aria-label="Abrir menu">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"/></svg>
          </button>
          <div class="min-w-0 flex-1">
            <h1 class="text-[16px] sm:text-[18px] font-bold text-slate-900 leading-tight truncate" x-text="(tabs.find(t=>t.id===tab)?.label) || 'UniHub'"></h1>
          </div>
          <button @click="runSync()" :disabled="loading.sync"
            class="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition shrink-0">
            <span x-show="!loading.sync" x-html="getIcon('sync')"></span>
            <span x-show="loading.sync" class="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            <span class="hidden sm:inline" x-text="loading.sync ? 'Sincronizando...' : 'Sincronizar'"></span>
          </button>
        </div>

        <!-- Stat cards — só nas abas Estoque + Produtos, paleta indigo (azul) no light -->
        <div x-show="tab === 'stock' || tab === 'products'" class="px-4 sm:px-6 lg:px-8 pb-4 grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <div class="stat-surface rounded-lg p-3 sm:p-3.5 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xl sm:text-2xl font-bold stat-num" x-text="status.active_mappings || 0"></div>
              <div class="text-xs stat-label mt-0.5 truncate font-medium">Produtos sincronizados</div>
            </div>
            <span class="shrink-0 stat-num" x-html="getIcon('stock')"></span>
          </div>
          <div class="stat-surface rounded-lg p-3 sm:p-3.5 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xl sm:text-2xl font-bold" :class="lowStockCount > 0 ? 'text-amber-600' : 'stat-num'" x-text="lowStockCount"></div>
              <div class="text-xs stat-label mt-0.5 truncate font-medium">Estoque baixo / zerado</div>
            </div>
            <span class="shrink-0" :class="lowStockCount > 0 ? 'text-amber-500' : 'text-emerald-500'">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="ico"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.732 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>
            </span>
          </div>
          <div class="stat-surface rounded-lg p-3 sm:p-3.5 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xl sm:text-2xl font-bold" :class="status.unmapped_items ? 'text-orange-600' : 'stat-num'" x-text="status.unmapped_items || 0"></div>
              <div class="text-xs stat-label mt-0.5 truncate font-medium">SKUs não pareados</div>
            </div>
            <span class="shrink-0" :class="status.unmapped_items ? 'text-orange-500' : 'text-emerald-500'" x-html="getIcon('unmapped')"></span>
          </div>
          <div class="stat-surface rounded-lg p-3 sm:p-3.5 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xl sm:text-2xl font-bold stat-num" x-text="(status.last_run?.changes_detected ?? 0)"></div>
              <div class="text-xs stat-label mt-0.5 truncate font-medium">Mudanças (última execução)</div>
            </div>
            <span class="text-emerald-500 shrink-0" x-html="getIcon('changes')"></span>
          </div>
        </div>
      </header>

      <!-- Tab content -->
      <main class="px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-6 sm:pb-10 overflow-x-hidden">

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
            <button @click="orderStatus='unpaid'; orderPage=1; loadOrders()" :class="orderStatus==='unpaid' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-100'" class="text-xs px-3 py-1.5 rounded">💸 Aguardando pagto</button>
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
          <div class="flex bg-slate-100 p-1 rounded-lg gap-1 flex-wrap">
            <button @click="masterFilter='all'; loadMaster()" :class="masterFilter==='all' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded">Todos</button>
            <button @click="masterFilter='paired'; loadMaster()" :class="masterFilter==='paired' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded">✓ Pareados</button>
            <button @click="masterFilter='unpaired'; loadMaster()" :class="masterFilter==='unpaired' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded">⚠ Sem par</button>
            <button @click="setMasterFilter('low_stock')" :class="masterFilter==='low_stock' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded" title="Variações com menos de 3 unidades (inclui zeradas)">⚠ Estoque baixo</button>
            <button @click="setMasterFilter('out_of_stock')" :class="masterFilter==='out_of_stock' ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-slate-200'" class="text-xs px-3 py-1.5 rounded" title="Só variações com 0 unidades">🔴 Zerado</button>
          </div>
          <button @click="loadMaster()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm">↻ Atualizar</button>
        </div>
        <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div class="text-xs text-slate-500">
            <span x-text="displayedMaster().length"></span> anúncios
            <span x-show="accountFilter" class="text-slate-400">(de <span x-text="masterItems.length"></span>)</span>
            · <span x-text="displayedMaster().reduce((s,a)=>s+(a.variations?.length||0),0)"></span> variações
          </div>
          <div class="flex items-center gap-1.5 flex-wrap text-[10px]">
            <span class="text-slate-400 mr-1">Filtrar por loja:</span>
            <button @click="setAccountFilter('')" class="px-1.5 py-0.5 rounded font-medium border" :class="!accountFilter ? 'bg-slate-700 text-white border-slate-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'">Todas</button>
            <template x-for="acc in accounts" :key="acc.external_id">
              <button @click="setAccountFilter(acc.external_id)" class="px-1.5 py-0.5 rounded font-medium border cursor-pointer transition"
                :class="String(accountFilter)===String(acc.external_id)
                  ? (acc.marketplace==='meli' ? 'bg-yellow-400 border-yellow-500 text-yellow-900 ring-1 ring-yellow-500' : 'bg-orange-400 border-orange-500 text-orange-900 ring-1 ring-orange-500')
                  : (acc.marketplace==='meli' ? 'bg-yellow-50 border-yellow-200 text-yellow-800 hover:bg-yellow-100' : 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100')"
                :title="(String(accountFilter)===String(acc.external_id) ? 'Filtro ativo — clica de novo pra limpar. ' : 'Clica pra filtrar só esta loja. ') + acc.external_id + (acc.is_active ? '' : ' (desconectado)')">
                <span x-text="acc.marketplace==='meli' ? '🟡' : '🟠'"></span>
                <span x-text="acc.label || acc.external_id"></span>
                <span x-show="!acc.is_active" class="text-red-500">⚠</span>
              </button>
            </template>
            <span x-show="!accounts.length" class="text-slate-400 italic">(nenhuma — vai em Config → Sincronizar com MAC)</span>
          </div>
        </div>

        <div class="space-y-3">
          <template x-for="anuncio in displayedMaster()" :key="anuncio.key">
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
                  <div class="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                    <template x-if="anuncio.shopee_item_id">
                      <div x-data="{open:false}" @click.outside="open=false" class="relative inline-block">
                        <button @click="open=!open" class="text-[10px] px-1.5 py-0.5 hover:bg-orange-200 text-orange-700 rounded font-medium inline-flex items-center gap-1"
                          :class="(anuncio.shopee_stores?.length||1) > 1 ? 'bg-orange-200 ring-1 ring-orange-300' : 'bg-orange-100'"
                          :title="'SP em ' + (anuncio.shopee_stores?.length||1) + ' loja(s)'">
                          🟠 SP
                          <span x-show="(anuncio.shopee_stores?.length||1) > 1" class="bg-orange-700 text-white rounded-full px-1 text-[9px]" x-text="anuncio.shopee_stores.length"></span>
                          <span x-show="(anuncio.shopee_stores?.length||1) === 1 && anuncio.shopee_account_label" x-text="'· ' + anuncio.shopee_account_label" class="font-normal"></span>
                        </button>
                        <div x-show="open" x-transition.opacity class="absolute z-20 mt-1 left-0 bg-white border border-slate-200 rounded shadow-lg p-2 text-xs min-w-[260px]">
                          <div class="font-semibold mb-1 text-slate-600 px-1" x-text="'Lojas Shopee com este produto (' + (anuncio.shopee_stores?.length||1) + ')'"></div>
                          <template x-for="s in (anuncio.shopee_stores && anuncio.shopee_stores.length ? anuncio.shopee_stores : [{item_id: anuncio.shopee_item_id, account_label: anuncio.shopee_account_label, account_id: anuncio.shopee_account_id}])" :key="s.item_id">
                            <div class="py-1 px-1.5 rounded mb-0.5 bg-orange-50 text-orange-700">
                              <div class="font-semibold flex items-center gap-1.5">
                                <span>●</span>
                                <span x-text="s.account_label || s.account_id || '(sem nome)'"></span>
                              </div>
                              <div class="font-mono text-[10px] text-slate-500 ml-4" x-text="'item: ' + s.item_id"></div>
                            </div>
                          </template>
                        </div>
                      </div>
                    </template>
                    <template x-if="anuncio.meli_item_id">
                      <div x-data="{open:false}" @click.outside="open=false" class="relative inline-block">
                        <button @click="open=!open" class="text-[10px] px-1.5 py-0.5 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded font-medium inline-flex items-center gap-1" :title="'ML: ' + anuncio.meli_item_id">
                          🟡 ML
                        </button>
                        <div x-show="open" x-transition.opacity class="absolute z-20 mt-1 left-0 bg-white border border-slate-200 rounded shadow-lg p-2 text-xs min-w-[220px]">
                          <div class="font-semibold mb-1 text-slate-600 px-1">Conta Mercado Livre</div>
                          <template x-for="acc in accounts.filter(a=>a.marketplace==='meli')" :key="acc.external_id">
                            <div class="flex items-center gap-1.5 py-0.5 px-1 rounded bg-yellow-50 font-semibold text-yellow-800">
                              <span>●</span>
                              <span x-text="acc.label || acc.external_id"></span>
                            </div>
                          </template>
                          <div x-show="!accounts.filter(a=>a.marketplace==='meli').length" class="text-slate-400 px-1">(nenhuma conta ML carregada)</div>
                          <div class="border-t mt-1 pt-1 px-1 font-mono text-[10px] text-slate-400" x-text="'item: ' + anuncio.meli_item_id"></div>
                        </div>
                      </div>
                    </template>
                    <span>· <span x-text="anuncio.variations.length"></span> variações</span>
                  </div>
                </div>
                <div class="flex flex-col gap-1 shrink-0">
                  <button @click="openBulkStock(anuncio)" class="text-xs px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded font-medium" title="Atualiza estoque de várias variações de uma vez (respeita filtros aplicados)">⚡ Atualizar em massa</button>
                  <template x-if="anuncio.shopee_item_id">
                    <button @click="refreshVariations(anuncio.shopee_item_id)" class="text-xs px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded font-medium" title="Busca os modelos atuais na Shopee, limpa variações fantasma e atualiza nomes">↻ Atualizar variações</button>
                  </template>
                </div>
              </div>
              <table class="w-full text-sm">
                <thead class="bg-white text-[11px] uppercase text-slate-400 border-b">
                  <tr>
                    <th class="text-left px-3 py-2 w-28">Variação</th>
                    <th class="text-left px-3 py-2 w-44">SKU</th>
                    <th class="text-center px-3 py-2 w-20">ML</th>
                    <th class="text-center px-3 py-2 w-20">SP</th>
                    <th class="text-center px-3 py-2 w-24">Unidades</th>
                    <th class="text-center px-3 py-2 w-32">Ação</th>
                    <th class="text-center px-3 py-2 w-32">Plataformas</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <template x-for="(v, vi) in (anuncio.variations || [])" :key="vi">
                    <tr :class="v.mapped ? (v.active === 0 ? 'opacity-50' : '') : 'bg-amber-50/40'">
                      <td class="px-3 py-2">
                        <span x-show="cleanVariation(v.variation)" class="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded" x-text="cleanVariation(v.variation)"></span>
                        <span x-show="!v.variation" class="text-xs text-slate-300">—</span>
                      </td>
                      <td class="px-3 py-2 font-mono text-xs">
                        <span x-show="v.sku" x-text="v.sku"></span>
                        <span x-show="!v.sku && cleanVariation(v.variation)" class="text-slate-500 italic font-sans" x-text="cleanVariation(v.variation)"></span>
                        <span x-show="!v.sku && !cleanVariation(v.variation)" class="text-slate-300">(sem SKU)</span>
                      </td>
                      <td class="px-3 py-2 text-center font-mono text-xs" :class="unitsClass(v.meli_stock)" x-text="v.meli_stock ?? '—'"></td>
                      <td class="px-3 py-2 text-center font-mono text-xs" :class="unitsClass(v.shopee_stock)" x-text="v.shopee_stock ?? '—'"></td>
                      <td class="px-3 py-2 text-center">
                        <span class="text-base font-bold font-mono" :class="unitsClass(unifiedStock(v))" x-text="unifiedStockDisplay(v)"></span>
                      </td>
                      <td class="px-3 py-2 text-center">
                        <div class="flex gap-1 justify-center flex-wrap">
                          <template x-if="v.shopee_item_id || v.meli_item_id">
                            <button @click="openSetStock(v)" class="text-xs px-2 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded">Atualizar</button>
                          </template>
                          <template x-if="v.mapped">
                            <button @click="toggleMapping(v.sku)" class="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded" x-text="v.active ? 'pausar' : 'ativar'"></button>
                          </template>
                          <template x-if="v.shopee_item_id || v.meli_item_id">
                            <button @click="openPairFromProduct(v, anuncio)" class="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded" x-text="v.paired ? 'Re-parear' : 'Parear'"></button>
                          </template>
                        </div>
                      </td>
                      <td class="px-3 py-2">
                        <div class="flex items-center justify-center gap-1.5 flex-nowrap">
                          <span x-show="v.shopee_item_id" class="text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap cursor-help inline-flex items-center gap-1"
                            :class="(v.shopee_stores?.length||1) > 1 ? 'bg-orange-200 text-orange-700 ring-1 ring-orange-300' : 'bg-orange-100 text-orange-700'"
                            :title="(v.shopee_stores?.length||1) > 1 ? ('Em ' + v.shopee_stores.length + ' lojas: ' + v.shopee_stores.map(s => (s.account_label || s.account_id || '?') + ' (item ' + s.item_id + ')').join(' | ')) : ('Veio de: ' + (v.shopee_account_label || v.shopee_account_id || '(loja sem nome)') + ' — item ' + v.shopee_item_id + (v.shopee_model_id ? ' / model ' + v.shopee_model_id : ''))">
                            🟠 SP
                            <span x-show="(v.shopee_stores?.length||1) > 1" class="bg-orange-700 text-white rounded-full px-1 text-[9px]" x-text="v.shopee_stores.length"></span>
                          </span>
                          <span x-show="v.meli_item_id" class="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded font-medium whitespace-nowrap cursor-help"
                            :title="'Veio de: Mercado Livre — item ' + v.meli_item_id + (v.meli_variation_id ? ' / var ' + v.meli_variation_id : '')">🟡 ML</span>
                          <span x-show="!v.shopee_item_id && !v.meli_item_id" class="text-[10px] text-slate-300">—</span>
                        </div>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </template>
          <div x-show="displayedMaster().length === 0" class="text-center py-10 text-slate-400 bg-white border border-slate-200 rounded-lg">
            <div class="text-2xl mb-2">📦</div>
            <div x-show="!accountFilter">Nenhum produto encontrado.</div>
            <div x-show="accountFilter">Nenhum produto desta loja com os filtros atuais.</div>
            <div class="text-xs mt-1 text-slate-300" x-show="!accountFilter">Rode o Discovery em Config pra varrer suas lojas.</div>
            <button x-show="accountFilter" @click="setAccountFilter('')" class="mt-2 text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded">Limpar filtro de loja</button>
          </div>
        </div>
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
                  <div class="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                    <template x-if="anuncio.shopee_item_id">
                      <div x-data="{open:false}" @click.outside="open=false" class="relative inline-block">
                        <button @click="open=!open" class="text-[10px] px-1.5 py-0.5 hover:bg-orange-200 text-orange-700 rounded font-medium inline-flex items-center gap-1"
                          :class="(anuncio.shopee_stores?.length||1) > 1 ? 'bg-orange-200 ring-1 ring-orange-300' : 'bg-orange-100'"
                          :title="'SP em ' + (anuncio.shopee_stores?.length||1) + ' loja(s)'">
                          🟠 SP
                          <span x-show="(anuncio.shopee_stores?.length||1) > 1" class="bg-orange-700 text-white rounded-full px-1 text-[9px]" x-text="anuncio.shopee_stores.length"></span>
                          <span x-show="(anuncio.shopee_stores?.length||1) === 1 && anuncio.shopee_account_label" x-text="'· ' + anuncio.shopee_account_label" class="font-normal"></span>
                        </button>
                        <div x-show="open" x-transition.opacity class="absolute z-20 mt-1 left-0 bg-white border border-slate-200 rounded shadow-lg p-2 text-xs min-w-[260px]">
                          <div class="font-semibold mb-1 text-slate-600 px-1" x-text="'Lojas Shopee com este produto (' + (anuncio.shopee_stores?.length||1) + ')'"></div>
                          <template x-for="s in (anuncio.shopee_stores && anuncio.shopee_stores.length ? anuncio.shopee_stores : [{item_id: anuncio.shopee_item_id, account_label: anuncio.shopee_account_label, account_id: anuncio.shopee_account_id}])" :key="s.item_id">
                            <div class="py-1 px-1.5 rounded mb-0.5 bg-orange-50 text-orange-700">
                              <div class="font-semibold flex items-center gap-1.5">
                                <span>●</span>
                                <span x-text="s.account_label || s.account_id || '(sem nome)'"></span>
                              </div>
                              <div class="font-mono text-[10px] text-slate-500 ml-4" x-text="'item: ' + s.item_id"></div>
                            </div>
                          </template>
                        </div>
                      </div>
                    </template>
                    <template x-if="anuncio.meli_item_id">
                      <div x-data="{open:false}" @click.outside="open=false" class="relative inline-block">
                        <button @click="open=!open" class="text-[10px] px-1.5 py-0.5 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded font-medium inline-flex items-center gap-1" :title="'ML: ' + anuncio.meli_item_id">
                          🟡 ML
                        </button>
                        <div x-show="open" x-transition.opacity class="absolute z-20 mt-1 left-0 bg-white border border-slate-200 rounded shadow-lg p-2 text-xs min-w-[220px]">
                          <div class="font-semibold mb-1 text-slate-600 px-1">Conta Mercado Livre</div>
                          <template x-for="acc in accounts.filter(a=>a.marketplace==='meli')" :key="acc.external_id">
                            <div class="flex items-center gap-1.5 py-0.5 px-1 rounded bg-yellow-50 font-semibold text-yellow-800">
                              <span>●</span>
                              <span x-text="acc.label || acc.external_id"></span>
                            </div>
                          </template>
                          <div x-show="!accounts.filter(a=>a.marketplace==='meli').length" class="text-slate-400 px-1">(nenhuma conta ML carregada)</div>
                          <div class="border-t mt-1 pt-1 px-1 font-mono text-[10px] text-slate-400" x-text="'item: ' + anuncio.meli_item_id"></div>
                        </div>
                      </div>
                    </template>
                    <span>· <span x-text="anuncio.variations.length"></span> variações</span>
                  </div>
                </div>
                <div class="flex flex-col gap-1 shrink-0">
                  <button @click="openBulkStock(anuncio)" class="text-xs px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded font-medium" title="Atualiza estoque de várias variações de uma vez (respeita filtros aplicados)">⚡ Atualizar em massa</button>
                  <template x-if="anuncio.shopee_item_id">
                    <button @click="refreshVariations(anuncio.shopee_item_id)" class="text-xs px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded font-medium" title="Busca os modelos atuais na Shopee, limpa variações fantasma e atualiza nomes">↻ Atualizar variações</button>
                  </template>
                </div>
              </div>
              <table class="w-full text-sm">
                <thead class="bg-white text-[11px] uppercase text-slate-400 border-b">
                  <tr>
                    <th rowspan="2" class="text-left px-3 py-2 w-28 align-bottom">Variação</th>
                    <th rowspan="2" class="text-left px-3 py-2 w-44 align-bottom">SKU</th>
                    <th colspan="3" class="text-center px-3 pt-2 pb-0 text-[10px] text-slate-500 font-semibold border-b border-slate-100">Histórico de Vendas</th>
                    <th rowspan="2" class="text-center px-3 py-2 w-20 align-bottom">Ação</th>
                    <th rowspan="2" class="text-center px-3 py-2 w-32 align-bottom">Plataformas</th>
                  </tr>
                  <tr>
                    <th class="text-center px-3 py-2 w-16">7D</th>
                    <th class="text-center px-3 py-2 w-16">30D</th>
                    <th class="text-center px-3 py-2 w-16">Total</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <template x-for="(v, vi) in (anuncio.variations || [])" :key="vi">
                    <tr :class="v.paired ? '' : 'bg-amber-50/40'">
                      <td class="px-3 py-2">
                        <span x-show="cleanVariation(v.variation)" class="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded" x-text="cleanVariation(v.variation)"></span>
                        <span x-show="!v.variation" class="text-xs text-slate-300">—</span>
                      </td>
                      <td class="px-3 py-2 font-mono text-xs">
                        <span x-show="v.sku" x-text="v.sku"></span>
                        <span x-show="!v.sku && cleanVariation(v.variation)" class="text-slate-500 italic font-sans" x-text="cleanVariation(v.variation)"></span>
                        <span x-show="!v.sku && !cleanVariation(v.variation)" class="text-slate-300">(sem SKU)</span>
                      </td>
                      <td class="px-3 py-2 text-center font-mono text-xs text-emerald-700 font-semibold" x-text="v.sales_7d || '—'"></td>
                      <td class="px-3 py-2 text-center font-mono text-xs text-slate-700" x-text="v.sales_30d || '—'"></td>
                      <td class="px-3 py-2 text-center font-mono text-xs font-bold" x-text="v.sales_total || '—'"></td>
                      <td class="px-3 py-2 text-center">
                        <div class="flex gap-1 justify-center flex-wrap">
                          <button @click="editVariationSku(v, anuncio)" class="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded" title="Edita o SKU no marketplace e tenta auto-parear se já existe SKU igual no outro lado">✏ SKU</button>
                          <button @click="openPairFromProduct(v, anuncio)" class="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded">Mapear</button>
                        </div>
                      </td>
                      <td class="px-3 py-2">
                        <div class="flex items-center justify-center gap-1.5 flex-nowrap">
                          <span x-show="v.shopee_item_id" class="text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap cursor-help inline-flex items-center gap-1"
                            :class="(v.shopee_stores?.length||1) > 1 ? 'bg-orange-200 text-orange-700 ring-1 ring-orange-300' : 'bg-orange-100 text-orange-700'"
                            :title="(v.shopee_stores?.length||1) > 1 ? ('Em ' + v.shopee_stores.length + ' lojas: ' + v.shopee_stores.map(s => (s.account_label || s.account_id || '?') + ' (item ' + s.item_id + ')').join(' | ')) : ('Veio de: ' + (v.shopee_account_label || v.shopee_account_id || '(loja sem nome)') + ' — item ' + v.shopee_item_id + (v.shopee_model_id ? ' / model ' + v.shopee_model_id : ''))">
                            🟠 SP
                            <span x-show="(v.shopee_stores?.length||1) > 1" class="bg-orange-700 text-white rounded-full px-1 text-[9px]" x-text="v.shopee_stores.length"></span>
                          </span>
                          <span x-show="v.meli_item_id" class="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded font-medium whitespace-nowrap cursor-help"
                            :title="'Veio de: Mercado Livre — item ' + v.meli_item_id + (v.meli_variation_id ? ' / var ' + v.meli_variation_id : '')">🟡 ML</span>
                          <span x-show="!v.shopee_item_id && !v.meli_item_id" class="text-[10px] text-slate-300">—</span>
                        </div>
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
        <!-- Desktop/tablet: tabela compacta com scroll horizontal interno -->
        <div class="hidden md:block bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div class="overflow-x-auto">
          <table class="w-full text-sm table-fixed">
            <colgroup>
              <col class="w-24" /><col /><col class="w-24" /><col class="w-28" /><col class="w-24" /><col class="w-44" />
            </colgroup>
            <thead class="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th class="text-left px-3 py-3">Quando</th>
                <th class="text-left px-3 py-3">Produto / SKU</th>
                <th class="text-left px-3 py-3">Origem</th>
                <th class="text-left px-3 py-3">Tipo</th>
                <th class="text-right px-3 py-3">Δ</th>
                <th class="text-left px-3 py-3">Estoque</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <template x-for="c in changes" :key="c.id">
                <tr :class="c.shadow ? 'bg-amber-50/50' : ''">
                  <td class="px-3 py-3 text-xs text-slate-500" x-text="fmtRelative(c.ts)"></td>
                  <td class="px-3 py-3">
                    <div class="text-xs leading-tight truncate" :title="c.product_name||c.sku" x-text="(c.product_name||'').slice(0,80) || c.sku"></div>
                    <div class="text-[10px] text-slate-400 font-mono truncate" x-text="c.sku"></div>
                  </td>
                  <td class="px-3 py-3 text-xs">
                    <span x-show="c.source==='meli'" class="text-amber-700">🟡 ML</span>
                    <span x-show="c.source==='shopee'" class="text-orange-700">🛒 SP</span>
                    <span x-show="c.source==='manual'" class="text-purple-700">✋ Manual</span>
                  </td>
                  <td class="px-3 py-3"><span class="text-xs px-2 py-0.5 rounded whitespace-nowrap" :class="triggerClass(c.trigger)" x-text="triggerLabel(c.trigger)"></span></td>
                  <td class="px-3 py-3 text-right font-mono font-bold" :class="c.delta < 0 ? 'text-red-600' : c.delta > 0 ? 'text-emerald-600' : ''" x-text="c.delta > 0 ? '+' + c.delta : c.delta"></td>
                  <td class="px-3 py-3 text-[11px] font-mono text-slate-500">
                    <template x-if="c.meli_stock_before !== null || c.shopee_stock_before !== null">
                      <div>
                        <div x-show="c.meli_stock_before !== null">ML: <span x-text="c.meli_stock_before + ' → ' + c.meli_stock_after"></span></div>
                        <div x-show="c.shopee_stock_before !== null">SP: <span x-text="c.shopee_stock_before + ' → ' + c.shopee_stock_after"></span></div>
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
        </div>
        <!-- Mobile: cards (uma movimentação por card, mais legível que tabela) -->
        <div class="md:hidden space-y-2">
          <template x-for="c in changes" :key="c.id">
            <div class="bg-white border border-slate-200 rounded-lg p-3" :class="c.shadow ? 'bg-amber-50/50' : ''">
              <div class="flex justify-between items-start gap-2 mb-1">
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium truncate" x-text="(c.product_name||'').slice(0,80) || c.sku"></div>
                  <div class="text-[10px] text-slate-400 font-mono truncate" x-text="c.sku"></div>
                </div>
                <span class="font-mono font-bold text-sm shrink-0" :class="c.delta < 0 ? 'text-red-600' : c.delta > 0 ? 'text-emerald-600' : ''" x-text="c.delta > 0 ? '+' + c.delta : c.delta"></span>
              </div>
              <div class="flex flex-wrap gap-1.5 items-center text-[10px]">
                <span class="text-slate-400" x-text="fmtRelative(c.ts)"></span>
                <span x-show="c.source==='meli'" class="text-amber-700">🟡 ML</span>
                <span x-show="c.source==='shopee'" class="text-orange-700">🛒 SP</span>
                <span x-show="c.source==='manual'" class="text-purple-700">✋ Manual</span>
                <span class="px-1.5 py-0.5 rounded" :class="triggerClass(c.trigger)" x-text="triggerLabel(c.trigger)"></span>
              </div>
              <template x-if="c.meli_stock_before !== null || c.shopee_stock_before !== null">
                <div class="mt-1.5 text-[11px] font-mono text-slate-500 border-t border-slate-100 pt-1.5">
                  <span x-show="c.meli_stock_before !== null">ML <span x-text="c.meli_stock_before + '→' + c.meli_stock_after"></span></span>
                  <span x-show="c.meli_stock_before !== null && c.shopee_stock_before !== null" class="mx-1.5 text-slate-300">·</span>
                  <span x-show="c.shopee_stock_before !== null">SP <span x-text="c.shopee_stock_before + '→' + c.shopee_stock_after"></span></span>
                </div>
              </template>
            </div>
          </template>
          <div x-show="changes.length === 0" class="text-center py-8 text-slate-400 bg-white border border-slate-200 rounded-lg">Nenhuma movimentação ainda.</div>
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
          <div class="flex flex-col sm:flex-row flex-wrap gap-2">
            <input id="batch-shopee-input" x-model="batchShopeeId" placeholder="Shopee item_id (ex: 29443482352)" class="flex-1 min-w-[200px] px-3 py-2 border border-slate-300 rounded text-sm font-mono" />
            <input id="batch-meli-input" x-model="batchMeliId" placeholder="ML item_id (ex: MLB6139127802)" class="flex-1 min-w-[200px] px-3 py-2 border border-slate-300 rounded text-sm font-mono" />
            <div class="flex gap-2 shrink-0">
              <button @click="batchPairDry()" :disabled="loading.batchPair" class="flex-1 sm:flex-none px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm">Pré-visualizar</button>
              <button @click="batchPairApply()" :disabled="loading.batchPair" class="flex-1 sm:flex-none px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm">Aplicar</button>
            </div>
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
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
      <section x-show="tab === 'config'" x-cloak>
        <div class="bg-white border border-slate-200 rounded-lg p-4 sm:p-6 space-y-6">
          <!-- Contas conectadas -->
          <div>
            <h3 class="font-semibold mb-2 flex items-center gap-2 flex-wrap">🏬 Contas conectadas
              <button @click="syncAccounts()" :disabled="loading.acctSync" class="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded font-normal">
                <span x-show="!loading.acctSync">↻ Sincronizar com MAC</span>
                <span x-show="loading.acctSync">Sincronizando...</span>
              </button>
              <a href="https://marketplaces.tiops.com.br/skill-claude" target="_blank" class="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 rounded font-normal text-amber-800">+ Conectar nova conta (abre MAC)</a>
              <button @click="backfillAccountIds()" :disabled="loading.acctBackfill" class="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded font-normal">
                <span x-show="!loading.acctBackfill">⚙ Inicializar colunas (migrate)</span>
                <span x-show="loading.acctBackfill">Migrando...</span>
              </button>
            </h3>
            <p class="text-sm text-slate-500 mb-3">Lojas conectadas no MAC. Você pode dar um nome amigável pra cada uma. <strong>Fluxo:</strong> (1) Conecta nova conta no MAC → (2) "Sincronizar com MAC" → (3) nomeia → (4) clica "Inicializar colunas" UMA VEZ pra adicionar shopee_account_id no banco → (5) roda discovery pra puxar items.</p>
            <div class="space-y-2">
              <template x-for="a in accounts" :key="a.external_id">
                <div class="flex flex-wrap items-center gap-2 sm:gap-3 p-3 border border-slate-200 rounded">
                  <span class="text-xs px-2 py-0.5 rounded shrink-0" :class="a.marketplace==='meli' ? 'bg-amber-100 text-amber-800' : 'bg-orange-100 text-orange-800'" x-text="a.marketplace==='meli' ? '🟡 ML' : '🛒 Shopee'"></span>
                  <span class="font-mono text-xs text-slate-500 shrink-0" x-text="a.external_id"></span>
                  <input :value="a.label || ''" @blur="saveAccountLabel(a.external_id, $event.target.value)" placeholder="Nome da loja (ex: Geek Aura)" class="flex-1 min-w-[140px] px-2 py-1 border border-slate-300 rounded text-sm" />
                  <span x-show="a.is_active" class="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded shrink-0">conectado</span>
                  <span x-show="!a.is_active" class="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded shrink-0">desconectado</span>
                </div>
              </template>
              <div x-show="!accounts.length" class="text-sm text-slate-400">Nenhuma conta carregada — clica "Sincronizar com MAC" acima.</div>
            </div>
          </div>

          <div class="border-t pt-6">
            <h3 class="font-semibold mb-2">Corrigir IDs de variação ML</h3>
            <p class="text-sm text-slate-500 mb-3">Discoveries antigas armazenavam o <strong>SKU</strong> no lugar do <strong>variation_id</strong> real do ML. Esse fix busca cada anúncio ML ao vivo, encontra o ID correto via SELLER_SKU, e corrige todos os mappings. Necessário pra atualização de estoque ML funcionar.</p>
            <button @click="fixMeliVariationIds()" :disabled="loading.fixMlVar" class="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white font-medium rounded">
              <span x-show="!loading.fixMlVar">🔧 Corrigir variation_ids do ML</span>
              <span x-show="loading.fixMlVar">Corrigindo...</span>
            </button>
            <div x-show="fixMlVarResult" class="mt-3 p-3 bg-cyan-50 border border-cyan-200 rounded text-sm text-cyan-900">
              ✓ Anúncios consultados: <strong x-text="fixMlVarResult?.items_checked"></strong>.
              Mappings escaneados: <strong x-text="fixMlVarResult?.mappings_scanned"></strong>.
              <span class="text-emerald-700 font-semibold">Corrigidos: <span x-text="fixMlVarResult?.mappings_fixed"></span></span>.
              <span x-show="fixMlVarResult?.errors" class="text-amber-700">Erros: <span x-text="fixMlVarResult?.errors"></span></span>
            </div>
          </div>

          <div class="border-t pt-6">
            <h3 class="font-semibold mb-2">🔥 Parear & Sincronizar Tudo</h3>
            <p class="text-sm text-slate-500 mb-3">Roda em sequência: <strong>(1)</strong> match unmapped × unmapped por padrão de SKU; <strong>(2)</strong> completa mappings parciais (só ML ou só SP) buscando o outro lado; <strong>(3)</strong> pra cada anúncio ML, busca variações ao vivo e pareia com Shopee usando SKU. <em>Use sempre que mexer em SKUs no ML/Shopee.</em></p>
            <button @click="superPair()" :disabled="loading.superPair" class="px-4 py-2 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white font-medium rounded">
              <span x-show="!loading.superPair">🔥 Parear & Sincronizar Tudo</span>
              <span x-show="loading.superPair">Pareando (pode demorar 1-3 min)...</span>
            </button>
            <div x-show="superPairResult" class="mt-3 p-3 bg-pink-50 border border-pink-200 rounded text-sm text-pink-900 space-y-1">
              <div>📌 Match unmapped × unmapped: <strong x-text="superPairResult?.match_sku?.matched||0"></strong> pares</div>
              <div>🔗 Completou parciais (SP only ← ML): <strong x-text="superPairResult?.complete_partial?.shopee_only_filled_with_ml||0"></strong></div>
              <div>🔗 Completou parciais (ML only ← SP): <strong x-text="superPairResult?.complete_partial?.ml_only_filled_with_shopee||0"></strong></div>
              <div>🧹 Duplicados/sujos desativados: <strong x-text="(superPairResult?.complete_partial?.dirty_sku_duplicates_deactivated||0) + (superPairResult?.complete_partial?.partial_mapping_pairs_merged||0)"></strong></div>
              <div>🆕 Variações ML novas pareadas: <strong x-text="superPairResult?.summary?.new_pairings||0"></strong> | atualizadas: <strong x-text="superPairResult?.summary?.updated_pairings||0"></strong> (em <span x-text="superPairResult?.summary?.ml_items_processed||0"></span> anúncios)</div>
              <div>🌐 Duplicatas globais (mesmo modelo SP/ML em 2+ mappings) desativadas: <strong x-text="superPairResult?.summary?.global_duplicates_deactivated||0"></strong></div>
            </div>
          </div>

          <div class="border-t pt-6">
            <h3 class="font-semibold mb-2">Pareamento automático por SKU</h3>
            <p class="text-sm text-slate-500 mb-3">Varre todos os <strong>unmapped</strong> dos 2 lados e cria mappings onde o SKU bate (normalizado: sem acento, case-insensitive, sem caracteres especiais). Roda na hora, sem chamar GitHub Actions.</p>
            <button @click="matchBySkuNow()" :disabled="loading.matchSku" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded">
              <span x-show="!loading.matchSku">🔗 Parear agora por SKU</span>
              <span x-show="loading.matchSku">Pareando...</span>
            </button>
            <div x-show="matchSkuResult" class="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-900">
              <div>✓ <strong x-text="matchSkuResult?.matched||0"></strong> pares criados (de <span x-text="matchSkuResult?.shopee_total||0"></span> Shopee × <span x-text="matchSkuResult?.meli_total||0"></span> ML candidatos)</div>
              <div x-show="matchSkuResult?.errors" class="text-amber-700">⚠ <span x-text="matchSkuResult?.errors"></span> erros</div>
            </div>
          </div>

          <div class="border-t pt-6">
            <h3 class="font-semibold mb-2">Reprocessar status dos pedidos</h3>
            <p class="text-sm text-slate-500 mb-3">Atualiza status de pedidos antigos (que ficaram como <code>paid</code>/<code>ready_to_ship</code> mesmo depois de enviados). Re-consulta ML <strong>e</strong> Shopee ao vivo. Necessário pra "A enviar" filtrar certo.</p>
            <button @click="reprocessAllStatus()" :disabled="loading.reprocessMl" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium rounded">
              <span x-show="!loading.reprocessMl">🔄 Reprocessar status ML + Shopee</span>
              <span x-show="loading.reprocessMl">Processando...</span>
            </button>
            <div x-show="reprocessMlResult" class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
              <div>ML: escaneado <strong x-text="reprocessMlResult?.ml?.scanned||0"></strong>, atualizado <strong x-text="reprocessMlResult?.ml?.status_updates||0"></strong>.</div>
              <div>Shopee: escaneado <strong x-text="reprocessMlResult?.shopee?.scanned||0"></strong>, atualizado <strong x-text="reprocessMlResult?.shopee?.status_updates||0"></strong>.</div>
            </div>
          </div>

          <div class="border-t pt-6">
            <h3 class="font-semibold mb-2">Atualizar variações em massa</h3>
            <p class="text-sm text-slate-500 mb-3">Itera por <strong>cada anúncio Shopee</strong>, busca os modelos ao vivo na API da Shopee, limpa duplicatas e fantasmas, e atualiza nomes de variação. Demora ~1 min pra cada 30 anúncios.</p>
            <button @click="refreshAllVariations()" :disabled="loading.refreshAll" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium rounded">
              <span x-show="!loading.refreshAll">↻ Atualizar variações de TODOS</span>
              <span x-show="loading.refreshAll">Processando...</span>
            </button>
            <div x-show="refreshAllResult" class="mt-3 p-3 bg-purple-50 border border-purple-200 rounded text-sm text-purple-900">
              ✅ <strong x-text="refreshAllResult?.processed"></strong> / <span x-text="refreshAllResult?.total_items"></span> anúncios processados.
              Duplicatas: <strong x-text="refreshAllResult?.duplicates_cleaned||0"></strong>,
              Fantasmas: <strong x-text="refreshAllResult?.phantoms_cleaned||0"></strong>,
              Nomes atualizados: <strong x-text="refreshAllResult?.names_updated||0"></strong>,
              Mappings atualizados: <strong x-text="refreshAllResult?.mappings_updated||0"></strong>.
            </div>
          </div>

          <div class="border-t pt-6">
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
                  <template x-for="(r, ri) in runs" :key="r.id || ri">
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
  </div>

  <!-- Pair modal (vanilla DOM, sem dependencia Alpine reativo) -->
  <div id="pair-modal" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-40 p-4" onclick="if(event.target===this)window.__closePair()" style="display:none">
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
      <div class="px-6 py-4 border-b border-slate-200">
        <h3 class="font-semibold">Pareamento manual</h3>
        <p class="text-sm text-slate-500 mt-1">Selecionado: <span id="pm-source-name" class="font-mono text-xs"></span></p>
        <p id="pm-source-meta" class="text-xs text-slate-400 font-mono"></p>
      </div>
      <div class="px-6 py-3 border-b border-slate-200">
        <p id="pm-target-label" class="text-sm font-medium mb-2"></p>
        <div id="pm-platform-toggle" class="flex gap-1 mb-2 bg-slate-100 p-1 rounded-lg" style="display:none">
          <button id="pm-tab-meli" onclick="window.__setPairPlatform('meli')" type="button" class="flex-1 text-xs px-3 py-1.5 rounded transition">🟡 Mercado Livre</button>
          <button id="pm-tab-shopee" onclick="window.__setPairPlatform('shopee')" type="button" class="flex-1 text-xs px-3 py-1.5 rounded transition">🛒 Shopee</button>
        </div>
        <input id="pm-search" oninput="window.__searchPair()" placeholder="Digite nome ou SKU..." class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" autofocus />
      </div>
      <div id="pm-results" class="flex-1 overflow-y-auto divide-y divide-slate-100">
        <div class="p-4 text-center text-sm text-slate-400">Digite para buscar</div>
      </div>
      <div class="px-6 py-4 border-t border-slate-200 space-y-3">
        <div class="flex gap-2 items-center">
          <label class="text-sm text-slate-600 shrink-0">SKU final:</label>
          <input id="pm-sku" placeholder="auto (usa SKU da Shopee)" class="flex-1 px-3 py-1.5 border border-slate-300 rounded text-sm font-mono" />
        </div>
        <div class="flex gap-2">
          <button onclick="window.__closePair()" class="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm">Cancelar</button>
          <button id="pm-confirm" onclick="window.__confirmPair()" disabled class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium rounded text-sm">✓ Confirmar pareamento</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Link modal (parear produto já mapeado com item não pareado) -->
  <div x-show="linkModal" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-40 p-4" @click.self="linkModal=null" style="display:none">
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
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

  <!-- Set stock modal (vanilla DOM) -->
  <div id="stock-modal" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-40" onclick="if(event.target===this)window.__closeStock()" style="display:none">
    <div class="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full">
      <h3 class="font-semibold mb-1">Definir estoque manualmente</h3>
      <p id="sm-info" class="text-sm text-slate-500 mb-4"></p>
      <div class="space-y-2 text-sm mb-4">
        <div>Estoque atual ML: <span id="sm-meli" class="font-mono">—</span></div>
        <div>Estoque atual Shopee: <span id="sm-shopee" class="font-mono">—</span></div>
      </div>
      <input id="sm-input" type="number" min="0" placeholder="Novo estoque" class="w-full px-4 py-3 border border-slate-300 rounded-lg mb-4" />
      <div class="flex gap-2">
        <button onclick="window.__closeStock()" class="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded">Cancelar</button>
        <button id="sm-apply" onclick="window.__applyStock()" class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded">Aplicar nos 2 marketplaces</button>
      </div>
    </div>
  </div>

  <!-- Bulk stock modal -->
  <div id="bulk-modal" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-40" onclick="if(event.target===this)window.__closeBulk()" style="display:none">
    <div class="bg-white rounded-xl shadow-2xl p-5 max-w-3xl w-full max-h-[90vh] flex flex-col">
      <h3 class="font-semibold mb-1">Atualizar estoque em massa</h3>
      <p id="bm-info" class="text-xs text-slate-500 mb-3"></p>
      <div class="flex gap-2 items-center mb-3 p-3 bg-amber-50 border border-amber-200 rounded">
        <span class="text-xs font-medium text-amber-800">Preencher tudo com:</span>
        <input id="bm-fillall" type="number" min="0" placeholder="ex: 10" class="px-2 py-1 border border-slate-300 rounded text-sm w-24" />
        <button onclick="window.__bulkFillAll()" class="text-xs px-3 py-1 bg-amber-200 hover:bg-amber-300 text-amber-900 rounded font-medium">Aplicar nos inputs</button>
        <span class="text-xs text-slate-500 ml-auto">Deixe em branco pra pular a variação</span>
      </div>
      <div id="bm-list" class="flex-1 overflow-y-auto border border-slate-200 rounded mb-3"></div>
      <div id="bm-progress" class="text-xs text-slate-600 mb-2 hidden"></div>
      <div class="flex gap-2">
        <button onclick="window.__closeBulk()" class="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded">Cancelar</button>
        <button id="bm-apply" onclick="window.__bulkApply()" class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded">Aplicar nas variações preenchidas</button>
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
      { id: 'orders',   label: 'Pedidos',       icon: 'orders' },
      { id: 'stock',    label: 'Estoque',       icon: 'stock' },
      { id: 'products', label: 'Produtos',      icon: 'products' },
      { id: 'changes',  label: 'Movimentações', icon: 'changes' },
      { id: 'unmapped', label: 'Não pareados',  icon: 'unmapped' },
      { id: 'config',   label: 'Configurações', icon: 'config' },
    ],
    sidebarOpen: false,
    status: {},
    products: [],
    salesStats: [],
    salesSearch: '',
    masterItems: [],
    masterTotalVars: 0,
    masterSearch: '',
    masterFilter: 'all',
    accountFilter: '', // '' = todas. Ou external_id da conta (meli ou shopee)
    changes: [],
    unmapped: [],
    runs: [],
    productSearch: '',
    productFilter: 'all',
    loading: { sync: false, discover: false, setStock: false, pair: false, link: false, cleanup: false, backfill: false, rebuild: false, batchPair: false, refreshAll: false, reprocessMl: false, matchSku: false, fixMlVar: false, superPair: false, acctSync: false, acctBackfill: false },
    refreshAllResult: null,
    reprocessMlResult: null,
    matchSkuResult: null,
    fixMlVarResult: null,
    superPairResult: null,
    accounts: [],
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
    pairVarModal: null,
    pairVarSearch: '',
    pairVarCatalog: [],
    pairVarTarget: null,
    pairVarSku: '',
    pairVarSearchSide: 'meli',
    pairVarIncludePaired: false,

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
        this.loadAccounts(),
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
      // Abre modal de pareamento por variação (mesmo se já pareado, permite re-parear)
      this.pairVarModal = {
        anuncio_name: anuncio.product_name || '',
        shopee_item_id: v.shopee_item_id || null,
        shopee_model_id: v.shopee_model_id || null,
        shopee_label: v.shopee_item_id ? (v.variation || v.sku || '') : null,
        meli_item_id: v.meli_item_id || null,
        meli_variation_id: v.meli_variation_id || null,
        meli_label: v.meli_item_id ? (v.variation || v.sku || '') : null,
        original_sku: v.sku,
      };
      // Lado que falta = lado a buscar; se já tem os 2, default Shopee (re-pareamento)
      this.pairVarSearchSide = !v.shopee_item_id ? 'shopee' : (!v.meli_item_id ? 'meli' : 'meli');
      this.pairVarSearch = '';
      this.pairVarCatalog = [];
      this.pairVarTarget = null;
      this.pairVarSku = v.sku || '';
      this.pairVarIncludePaired = false;
    },
    async searchPairVarCatalog() {
      if (!this.pairVarModal) return;
      const params = new URLSearchParams({
        platform: this.pairVarSearchSide,
        q: this.pairVarSearch || '',
      });
      if (this.pairVarIncludePaired) params.set('include_paired', '1');
      const d = await this.api('/api/catalog?' + params.toString());
      const items = (d?.items || []).map(x => ({
        ...x,
        key: x.platform + '|' + x.item_id + '|' + (x.variation_id || ''),
      }));
      this.pairVarCatalog = items;
    },
    selectPairVarTarget(item) {
      this.pairVarTarget = item;
      // Se SKU final vazio, sugere o do target
      if (!this.pairVarSku && item.sku) this.pairVarSku = item.sku;
    },
    canConfirmPairVar() {
      if (!this.pairVarModal || !this.pairVarTarget) return false;
      const m = this.pairVarModal;
      const t = this.pairVarTarget;
      // Tem que ter ML e Shopee nos finais
      const finalShopee = t.platform === 'shopee' ? t.item_id : m.shopee_item_id;
      const finalMeli   = t.platform === 'meli'   ? t.item_id : m.meli_item_id;
      return !!(finalShopee && finalMeli);
    },
    async confirmPairVariation() {
      if (!this.canConfirmPairVar()) return;
      this.loading.pair = true;
      const m = this.pairVarModal;
      const t = this.pairVarTarget;
      const body = {
        shopee_item_id: t.platform === 'shopee' ? t.item_id : m.shopee_item_id,
        shopee_model_id: t.platform === 'shopee' ? (t.variation_id || null) : m.shopee_model_id,
        meli_item_id:   t.platform === 'meli'   ? t.item_id : m.meli_item_id,
        meli_variation_id: t.platform === 'meli' ? (t.variation_id || null) : m.meli_variation_id,
        sku: this.pairVarSku || undefined,
        product_name: t.product_name || m.anuncio_name || undefined,
      };
      try {
        await this.api('/api/mappings/pair-variation', { method: 'POST', body: JSON.stringify(body) });
        this.pairVarModal = null;
        await this.loadMaster();
        await this.loadStatus();
      } catch (e) {
        alert('Erro ao parear: ' + e.message);
      } finally {
        this.loading.pair = false;
      }
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
      const targetPlatform = sourcePlatform === 'shopee' ? 'meli' : 'shopee';
      // Estado guardado no window pra acesso pelos handlers vanilla
      window.__pairState = { source: item, sourcePlatform, targetPlatform, target: null };
      // Popula DOM diretamente
      document.getElementById('pm-source-name').textContent = (item.product_name || '').slice(0, 60);
      document.getElementById('pm-source-meta').textContent = sourcePlatform + ' → ' + item.item_id;
      document.getElementById('pm-target-label').textContent = 'Buscar no ' + (targetPlatform === 'meli' ? 'Mercado Livre' : 'Shopee') + ':';
      document.getElementById('pm-search').value = '';
      document.getElementById('pm-sku').value = '';
      document.getElementById('pm-results').innerHTML = '<div class="p-4 text-center text-sm text-slate-400">Digite para buscar</div>';
      document.getElementById('pm-confirm').disabled = true;
      document.getElementById('pm-platform-toggle').style.display = 'none';
      document.getElementById('pair-modal').style.display = 'flex';
      document.getElementById('pm-search').focus();
      // Configura handlers vanilla com closure pro contexto Alpine
      const self = this;
      window.__closePair = () => { document.getElementById('pair-modal').style.display = 'none'; window.__pairState = null; };
      window.__searchPair = async () => {
        const q = document.getElementById('pm-search').value;
        clearTimeout(window.__pairSearchTimer);
        window.__pairSearchTimer = setTimeout(async () => {
          const d = await self.api('/api/catalog?platform=' + targetPlatform + '&include_paired=1&live=1&q=' + encodeURIComponent(q));
          const items = d?.items || [];
          const results = document.getElementById('pm-results');
          if (items.length === 0) {
            results.innerHTML = '<div class="p-4 text-center text-sm text-slate-400">' + (q ? 'Nenhum resultado' : 'Digite para buscar') + '</div>';
          } else {
            results.innerHTML = items.map(it => {
              const name = (it.product_name || '—').slice(0, 65).replace(/</g, '&lt;');
              const meta = (it.sku + ' | ID: ' + it.item_id + (it.variation_id ? '/' + it.variation_id : '')).replace(/</g, '&lt;');
              return '<div class="pm-item px-4 py-3 hover:bg-indigo-50 cursor-pointer flex items-center gap-3" data-id="' + it.id + '"><div class="flex-1 min-w-0"><div class="text-sm truncate">' + name + '</div><div class="text-xs text-slate-400 font-mono">' + meta + '</div></div></div>';
            }).join('');
            results.querySelectorAll('.pm-item').forEach(el => {
              el.addEventListener('click', () => {
                const id = el.getAttribute('data-id');
                const picked = items.find(x => String(x.id) === String(id));
                window.__pairState.target = picked;
                results.querySelectorAll('.pm-item').forEach(e => e.classList.remove('bg-indigo-50','border-l-2','border-indigo-500'));
                el.classList.add('bg-indigo-50','border-l-2','border-indigo-500');
                document.getElementById('pm-confirm').disabled = false;
                // Auto SKU
                const skuInput = document.getElementById('pm-sku');
                if (!skuInput.value) {
                  const src = window.__pairState.source;
                  skuInput.value = src.platform === 'shopee' ? (src.sku || '') : (picked.sku || '');
                }
              });
            });
          }
        }, 300);
      };
      window.__confirmPair = async () => {
        const st = window.__pairState;
        if (!st || !st.target) return;
        const btn = document.getElementById('pm-confirm');
        btn.disabled = true; btn.textContent = 'Salvando...';
        const source = st.source, target = st.target;
        const meliItem = source.platform === 'meli' ? source : target;
        const shopeeItem = source.platform === 'shopee' ? source : target;
        const sku = document.getElementById('pm-sku').value || undefined;
        await self.api('/api/mappings/manual', { method: 'POST', body: JSON.stringify({
          meli_unmapped_id: meliItem.id,
          shopee_unmapped_id: shopeeItem.id,
          sku,
          product_name: shopeeItem.product_name || meliItem.product_name,
        })});
        window.__closePair();
        btn.textContent = '✓ Confirmar pareamento';
        await self.loadAll();
      };
    },
    closePairModal() { if (window.__closePair) window.__closePair(); },

    // Parear uma variação Shopee da aba Produtos com qualquer anúncio (ML ou outra Shopee não pareada)
    openPairFromProduct(v, anuncio) {
      const source = {
        platform: 'shopee',
        sku: v.sku || '',
        item_id: v.shopee_item_id || anuncio?.shopee_item_id || '',
        variation_id: v.shopee_model_id || null,
        product_name: (anuncio?.product_name || '') + (v.variation ? ' — ' + v.variation : ''),
      };
      window.__pairState = { source, target: null, targetPlatform: 'meli' };

      document.getElementById('pm-source-name').textContent = source.product_name.slice(0, 80);
      document.getElementById('pm-source-meta').textContent = 'shopee → ' + source.item_id + (source.variation_id ? '/' + source.variation_id : '');
      document.getElementById('pm-search').value = '';
      document.getElementById('pm-sku').value = v.sku || '';
      document.getElementById('pm-results').innerHTML = '<div class="p-4 text-center text-sm text-slate-400">Digite para buscar</div>';
      document.getElementById('pm-confirm').disabled = true;
      document.getElementById('pm-platform-toggle').style.display = 'flex';
      document.getElementById('pair-modal').style.display = 'flex';

      const self = this;
      const setActiveTab = (plat) => {
        const meli = document.getElementById('pm-tab-meli');
        const shopee = document.getElementById('pm-tab-shopee');
        const activeCls = ['bg-white','text-indigo-700','shadow-sm','font-semibold'];
        const inactiveCls = ['text-slate-500'];
        if (plat === 'meli') {
          meli.classList.add(...activeCls); meli.classList.remove(...inactiveCls);
          shopee.classList.remove(...activeCls); shopee.classList.add(...inactiveCls);
          document.getElementById('pm-target-label').textContent = 'Buscar no Mercado Livre (inclui já pareados):';
        } else {
          shopee.classList.add(...activeCls); shopee.classList.remove(...inactiveCls);
          meli.classList.remove(...activeCls); meli.classList.add(...inactiveCls);
          document.getElementById('pm-target-label').textContent = 'Buscar na Shopee (inclui já pareados):';
        }
      };
      setActiveTab('meli');

      window.__setPairPlatform = (plat) => {
        window.__pairState.targetPlatform = plat;
        window.__pairState.target = null;
        document.getElementById('pm-confirm').disabled = true;
        setActiveTab(plat);
        window.__searchPair();
      };

      window.__closePair = () => { document.getElementById('pair-modal').style.display = 'none'; window.__pairState = null; };

      window.__searchPair = async () => {
        const q = document.getElementById('pm-search').value;
        const plat = window.__pairState.targetPlatform;
        clearTimeout(window.__pairSearchTimer);
        window.__pairSearchTimer = setTimeout(async () => {
          // Sempre inclui pareados — permite re-mapeamento ou merge de variações duplicadas
          const d = await self.api('/api/catalog?platform=' + plat + '&include_paired=1&live=1&q=' + encodeURIComponent(q));
          let items = d?.items || [];
          // Filtra o próprio item (não pode parear consigo mesmo) — só pra mesma plataforma
          // Usa SKU como desambiguador quando variation_id é null nos dois lados
          if (plat === source.platform) {
            items = items.filter(it => {
              const sameItem = String(it.item_id) === String(source.item_id);
              const sameVar = String(it.variation_id || '') === String(source.variation_id || '');
              const sameSku = String(it.sku || '') === String(source.sku || '');
              return !(sameItem && sameVar && sameSku);
            });
          }
          const results = document.getElementById('pm-results');
          if (items.length === 0) {
            results.innerHTML = '<div class="p-4 text-center text-sm text-slate-400">' + (q ? 'Nenhum resultado' : 'Digite para buscar') + '</div>';
            return;
          }
          results.innerHTML = items.map((it, i) => {
            const name = (it.product_name || '—').slice(0, 65).replace(/</g, '&lt;');
            const meta = ((it.sku || '') + ' | ID: ' + it.item_id + (it.variation_id ? '/' + it.variation_id : '')).replace(/</g, '&lt;');
            const tag = it.paired ? '<span class="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded ml-2">já pareado</span>' : '';
            return '<div class="pm-item px-4 py-3 hover:bg-indigo-50 cursor-pointer flex items-center gap-3" data-idx="' + i + '"><div class="flex-1 min-w-0"><div class="text-sm truncate">' + name + tag + '</div><div class="text-xs text-slate-400 font-mono">' + meta + '</div></div></div>';
          }).join('');
          results.querySelectorAll('.pm-item').forEach(el => {
            el.addEventListener('click', () => {
              const idx = parseInt(el.getAttribute('data-idx'));
              window.__pairState.target = items[idx];
              results.querySelectorAll('.pm-item').forEach(e => e.classList.remove('bg-indigo-50','border-l-2','border-indigo-500'));
              el.classList.add('bg-indigo-50','border-l-2','border-indigo-500');
              document.getElementById('pm-confirm').disabled = false;
            });
          });
        }, 300);
      };

      window.__confirmPair = async () => {
        const st = window.__pairState;
        if (!st || !st.target) return;
        const btn = document.getElementById('pm-confirm');
        btn.disabled = true; btn.textContent = 'Salvando...';
        const sku = document.getElementById('pm-sku').value || st.source.sku || ('sp-' + st.source.item_id + (st.source.variation_id ? '-' + st.source.variation_id : ''));
        const payload = {
          sku,
          shopee_item_id: st.source.item_id,
          shopee_model_id: st.source.variation_id,
          meli_item_id: null,
          meli_variation_id: null,
          product_name: st.source.product_name || st.target.product_name,
        };
        if (st.targetPlatform === 'meli') {
          payload.meli_item_id = st.target.item_id;
          payload.meli_variation_id = st.target.variation_id;
        } else {
          // Pareando com OUTRO item Shopee: cria 2 mappings com mesmo SKU (ou usa mapping mesclando ambos shopee_item_ids — não suportado pela tabela, então criamos 2 entradas distintas que apontam ao mesmo SKU)
          // Estratégia simples: o target Shopee fica como "alias" — atualiza só o mapping desse outro item_id pra usar o mesmo SKU
          await self.api('/api/mappings', { method: 'POST', body: JSON.stringify({
            sku,
            shopee_item_id: st.target.item_id,
            shopee_model_id: st.target.variation_id,
            product_name: st.target.product_name,
          })});
        }
        await self.api('/api/mappings', { method: 'POST', body: JSON.stringify(payload) });
        window.__closePair();
        btn.textContent = '✓ Confirmar pareamento';
        await self.loadAll();
      };
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
      this.closePairModal();
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

    openBulkStock(anuncio) {
      // Pega só variações desse anuncio respeitando filtro de loja atualmente aplicado
      let vars = (anuncio.variations || []).slice();
      if (this.accountFilter) {
        const acc = this.accounts.find(a => String(a.external_id) === String(this.accountFilter));
        if (acc) {
          if (acc.marketplace === 'shopee') {
            vars = vars.filter(v => {
              const ss = v.shopee_stores || (v.shopee_account_id ? [{ account_id: v.shopee_account_id }] : []);
              return ss.some(s => String(s.account_id) === String(this.accountFilter));
            });
          } else {
            vars = vars.filter(v => !!v.meli_item_id);
          }
        }
      }
      // Filtros de estoque também aplicam
      if (this.masterFilter === 'low_stock') {
        vars = vars.filter(v => { const s = this.unifiedStock(v); return s != null && s < 3; });
      }
      if (this.masterFilter === 'out_of_stock') {
        vars = vars.filter(v => this.unifiedStock(v) === 0);
      }
      if (this.masterFilter === 'paired') vars = vars.filter(v => v.paired);
      if (this.masterFilter === 'unpaired') vars = vars.filter(v => !v.paired);

      if (vars.length === 0) { alert('Nenhuma variação corresponde aos filtros atuais.'); return; }

      const cleanVar = (s) => this.cleanVariation(s);
      const rows = vars.map((v, i) => {
        const realSku = v.sku || '';
        const synth = !realSku ? (v.shopee_item_id ? 'SP_' + v.shopee_item_id + (v.shopee_model_id ? '_' + v.shopee_model_id : '') : (v.meli_item_id ? 'ML_' + v.meli_item_id + (v.meli_variation_id ? '_' + v.meli_variation_id : '') : '')) : '';
        const skuToSend = realSku || synth;
        const cur = v.master_stock != null ? v.master_stock : (v.meli_stock != null ? v.meli_stock : (v.shopee_stock != null ? v.shopee_stock : ''));
        const meli = v.meli_stock != null ? v.meli_stock : '—';
        const sp = v.shopee_stock != null ? v.shopee_stock : '—';
        const storesBadge = (v.shopee_stores && v.shopee_stores.length > 1) ? ' <span class="text-[10px] px-1 bg-orange-200 text-orange-800 rounded font-medium">SP×' + v.shopee_stores.length + '</span>' : '';
        return '<tr data-i="' + i + '" class="border-b last:border-0">' +
          '<td class="px-2 py-1.5 text-xs">' + (cleanVar(v.variation) || '<span class="text-slate-300">—</span>') + storesBadge + '</td>' +
          '<td class="px-2 py-1.5 font-mono text-[10px] text-slate-500">' + (realSku || '<span class="italic">' + synth + '</span>') + '</td>' +
          '<td class="px-2 py-1.5 text-center text-xs text-slate-500">ML: ' + meli + ' / SP: ' + sp + '</td>' +
          '<td class="px-2 py-1.5"><input type="number" min="0" data-sku="' + skuToSend + '" data-realsku="' + realSku + '" class="bm-row w-20 px-2 py-1 border border-slate-300 rounded text-sm" placeholder="' + cur + '" /></td>' +
          '</tr>';
      }).join('');

      document.getElementById('bm-info').innerHTML = '<strong>' + (anuncio.product_name || '').slice(0, 80) + '</strong><br>' + vars.length + ' variação(ões) ' + (this.accountFilter ? '(filtro: ' + (this.accounts.find(a => String(a.external_id) === String(this.accountFilter))?.label || '?') + ')' : '(todos)') + ' — preencha só as que quer atualizar';
      document.getElementById('bm-list').innerHTML =
        '<table class="w-full text-sm"><thead class="bg-slate-50 text-[10px] uppercase text-slate-400 sticky top-0"><tr>' +
        '<th class="text-left px-2 py-1.5">Variação</th><th class="text-left px-2 py-1.5">SKU</th><th class="text-center px-2 py-1.5">Atual</th><th class="text-left px-2 py-1.5">Novo</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';

      const btn = document.getElementById('bm-apply');
      btn.disabled = false; btn.textContent = 'Aplicar nas variações preenchidas';
      document.getElementById('bm-progress').style.display = 'none';
      document.getElementById('bm-progress').textContent = '';
      document.getElementById('bulk-modal').style.display = 'flex';

      const self = this;
      window.__closeBulk = () => { document.getElementById('bulk-modal').style.display = 'none'; };
      window.__bulkFillAll = () => {
        const val = document.getElementById('bm-fillall').value;
        if (val === '') return;
        document.querySelectorAll('input.bm-row').forEach(i => { i.value = val; });
      };
      window.__bulkApply = async () => {
        const inputs = Array.from(document.querySelectorAll('input.bm-row')).filter(i => i.value !== '' && !isNaN(Number(i.value)));
        if (inputs.length === 0) { alert('Preencha pelo menos uma variação.'); return; }
        if (!confirm('Atualizar estoque de ' + inputs.length + ' variação(ões) nas plataformas? Esta ação grava ao vivo.')) return;
        btn.disabled = true; btn.textContent = 'Aplicando...';
        const progress = document.getElementById('bm-progress');
        progress.style.display = 'block';
        let ok = 0, fail = 0;
        const errs = [];
        for (let idx = 0; idx < inputs.length; idx++) {
          const inp = inputs[idx];
          const sku = inp.dataset.sku;
          const val = Number(inp.value);
          progress.textContent = 'Atualizando ' + (idx + 1) + '/' + inputs.length + ' (' + sku + ')...';
          const v = vars[Number(inp.closest('tr').dataset.i)];
          try {
            const r = await self.api('/api/products/' + encodeURIComponent(sku) + '/set-stock', {
              method: 'POST', body: JSON.stringify({
                stock: val,
                shopee_item_id: v.shopee_item_id || null,
                shopee_model_id: v.shopee_model_id || null,
                shopee_account_id: v.shopee_account_id || null,
                meli_item_id: v.meli_item_id || null,
                meli_variation_id: v.meli_variation_id || null,
                product_name: v.product_name || v.variation || ''
              })
            });
            if (r?.error) { fail++; errs.push(sku + ': ' + r.error); }
            else { ok++; inp.style.background = '#dcfce7'; }
          } catch (e) {
            fail++; errs.push(sku + ': ' + (e?.message || e));
          }
        }
        progress.textContent = '✓ ' + ok + ' atualizadas, ✗ ' + fail + ' falhas.';
        btn.disabled = false; btn.textContent = 'Fechar';
        btn.onclick = () => window.__closeBulk();
        if (errs.length) alert('Erros:\\n' + errs.slice(0, 10).join('\\n'));
        await self.loadMaster();
      };
    },

    openSetStock(p) {
      // Vanilla DOM (Alpine reativo está quebrado por extensão MetaMask)
      // Quando SKU está vazio (variação sem SKU em Shopee), gera um sintético
      // a partir dos IDs pra a URL não dar 404 e o backend criar mapping.
      const realSku = p.sku || '';
      const synth = !realSku
        ? (p.shopee_item_id ? 'SP_' + p.shopee_item_id + (p.shopee_model_id ? '_' + p.shopee_model_id : '') : (p.meli_item_id ? 'ML_' + p.meli_item_id + (p.meli_variation_id ? '_' + p.meli_variation_id : '') : ''))
        : '';
      const sku = realSku || synth;
      if (!sku) { alert('Sem SKU nem IDs de plataforma. Não consigo atualizar.'); return; }
      const name = p.product_name || p.variation || sku;
      const meli = p.meli_stock ?? '—';
      const shopee = p.shopee_stock ?? '—';
      const cur = p.master_stock ?? p.meli_stock ?? p.shopee_stock ?? 0;
      document.getElementById('sm-info').textContent = sku + ' — ' + String(name).slice(0, 50);
      document.getElementById('sm-meli').textContent = meli;
      document.getElementById('sm-shopee').textContent = shopee;
      document.getElementById('sm-input').value = cur;
      const btn = document.getElementById('sm-apply');
      btn.disabled = false; btn.textContent = 'Aplicar nos 2 marketplaces';
      document.getElementById('stock-modal').style.display = 'flex';
      document.getElementById('sm-input').focus();
      document.getElementById('sm-input').select();

      const self = this;
      window.__closeStock = () => { document.getElementById('stock-modal').style.display = 'none'; };
      window.__applyStock = async () => {
        const val = Number(document.getElementById('sm-input').value);
        if (isNaN(val) || val < 0) { alert('Valor inválido'); return; }
        btn.disabled = true; btn.textContent = 'Aplicando...';
        try {
          const r = await self.api('/api/products/' + encodeURIComponent(sku) + '/set-stock',
            { method: 'POST', body: JSON.stringify({
              stock: val,
              shopee_item_id: p.shopee_item_id || null,
              shopee_model_id: p.shopee_model_id || null,
              shopee_account_id: p.shopee_account_id || null,
              meli_item_id: p.meli_item_id || null,
              meli_variation_id: p.meli_variation_id || null,
              product_name: p.product_name || p.variation || ''
            }) });
          if (r?.error) {
            alert('Erro: ' + r.error + (r.details ? '\\n' + JSON.stringify(r.details, null, 2) : ''));
            btn.disabled = false; btn.textContent = 'Aplicar nos 2 marketplaces';
            return;
          }
          var propagated = (r && r.propagated) || [];
          var errs = (r && r.errors) || [];
          // Só alerta quando há ERRO real OU nada foi propagado.
          // Plataforma não-pareada não é erro (é o esperado pra item single-platform).
          if (errs.length > 0) {
            var msg = '';
            if (propagated.length) msg += '✓ Atualizado: ' + propagated.join(', ') + '\\n\\n';
            msg += '✗ Erros:\\n' + errs.map(function(e){return '  '+e.platform+': '+e.error;}).join('\\n');
            alert(msg);
          } else if (propagated.length === 0) {
            alert('⚠ Nenhuma plataforma foi atualizada (item sem mapeamento).');
          }
          window.__closeStock();
          await self.loadAll();
        } catch (e) {
          alert('Erro ao aplicar: ' + (e?.message || e));
          btn.disabled = false; btn.textContent = 'Aplicar nos 2 marketplaces';
        }
      };
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

    setMasterFilter(f) {
      this.masterFilter = f;
      console.log('[setMasterFilter]', f);
      this.loadMaster();
    },

    setAccountFilter(id) {
      // Toggle: clicar de novo desmarca
      this.accountFilter = (this.accountFilter === id) ? '' : id;
    },

    getIcon(name) {
      // Lê o conteúdo de <template id="ico-<name>"> (SVG inline)
      const tpl = document.getElementById('ico-' + name);
      return tpl ? tpl.innerHTML : '';
    },

    async editVariationSku(v, anuncio) {
      const cur = v.sku || '';
      const side = v.meli_item_id && v.shopee_item_id ? 'ambos os lados (ML + Shopee)' : (v.meli_item_id ? 'Mercado Livre' : 'Shopee');
      const meliLine = v.meli_item_id ? 'ML ' + v.meli_item_id + (v.meli_variation_id ? ' (var ' + v.meli_variation_id + ')' : '') : '';
      const shopeeLine = v.shopee_item_id ? 'SP ' + v.shopee_item_id + (v.shopee_model_id ? ' (model ' + v.shopee_model_id + ')' : '') + (v.shopee_account_label ? ' — ' + v.shopee_account_label : '') : '';
      const linhas = [meliLine, shopeeLine].filter(Boolean).join('\\n      ');
      const promptMsg = 'Editar SKU desta variação\\n\\nLoja: ' + linhas + '\\n\\nVai atualizar SKU em: ' + side + '\\nDepois tenta auto-parear se já existir SKU igual no outro lado.\\n\\nSKU atual: ' + (cur || '(vazio)');
      const novo = prompt(promptMsg, cur);
      if (novo === null) return; // cancelado
      const sku = novo.trim();
      if (!sku) { alert('SKU vazio. Operação cancelada.'); return; }
      if (sku === cur) { alert('SKU não mudou.'); return; }

      try {
        const r = await this.api('/api/variation/set-sku', {
          method: 'POST',
          body: JSON.stringify({
            meli_item_id: v.meli_item_id || null,
            meli_variation_id: v.meli_variation_id || null,
            shopee_item_id: v.shopee_item_id || null,
            shopee_model_id: v.shopee_model_id || null,
            shopee_account_id: v.shopee_account_id || null,
            sku,
          }),
        });
        let msg = '';
        if (r?.action === 'auto_paired') msg = '✅ SKU atualizado e AUTO-PAREADO com o outro lado (SKU=' + r.sku + ')!';
        else if (r?.action === 'mapping_updated') msg = '✅ SKU atualizado no mapping existente.';
        else if (r?.action === 'sku_saved_no_match') msg = '✅ SKU atualizado no marketplace, mas nenhum match encontrado no outro lado.';
        else if (r?.action === 'multiple_candidates_no_pair') msg = '⚠ SKU atualizado, mas há +1 candidato com mesmo SKU no outro lado — pareia manualmente.';
        else msg = 'Resposta: ' + JSON.stringify(r);
        if (r?.errors && Object.keys(r.errors).length) msg += '\\n\\n⚠ Erros nas plataformas:\\n' + Object.entries(r.errors).map(([k,e]) => k + ': ' + e).join('\\n');
        alert(msg);
        await this.loadMaster();
      } catch (e) {
        alert('Erro: ' + (e?.message || e));
      }
    },

    // Filtra masterItems por loja em NÍVEL DE ANÚNCIO:
    // se o anúncio existe nessa loja (qualquer variação dele), aparece COM TODAS as variações.
    // Pra não esconder variações exclusivas de outra loja (ex: Dragão só na Geek).
    displayedMaster() {
      if (!this.accountFilter) return this.masterItems;
      const acc = this.accounts.find(a => String(a.external_id) === String(this.accountFilter));
      if (!acc) return this.masterItems;
      const isShopee = acc.marketplace === 'shopee';
      const targetId = String(this.accountFilter);
      return this.masterItems.filter(a => {
        if (isShopee) {
          // Anúncio tem loja se shopee_stores no header inclui, OU qualquer variação tem.
          const headerStores = a.shopee_stores || [];
          if (headerStores.some(s => String(s.account_id) === targetId)) return true;
          return (a.variations || []).some(v => {
            const vs = v.shopee_stores || (v.shopee_account_id ? [{ account_id: v.shopee_account_id }] : []);
            return vs.some(s => String(s.account_id) === targetId);
          });
        }
        // ML: anuncio tem ML se header.meli_item_id ou qualquer var tem
        if (a.meli_item_id) return true;
        return (a.variations || []).some(v => !!v.meli_item_id);
      });
    },

    async fixMeliVariationIds() {
      this.loading.fixMlVar = true;
      this.fixMlVarResult = null;
      try {
        this.fixMlVarResult = await this.api('/api/fix-meli-variation-ids', { method: 'POST' });
        await this.loadAll();
      } catch (e) {
        alert('Erro: ' + (e?.message || e));
      } finally {
        this.loading.fixMlVar = false;
      }
    },

    async loadAccounts() {
      const d = await this.api('/api/accounts');
      this.accounts = d?.items || [];
    },

    async backfillAccountIds() {
      if (!confirm('Vai adicionar a coluna shopee_account_id nas tabelas e marcar todos os dados existentes como sendo da conta atual. Faz só 1 vez.')) return;
      this.loading.acctBackfill = true;
      try {
        const r = await this.api('/api/accounts/migrate-columns', { method: 'POST' });
        var msg = '✓ Migration concluída\\n';
        if (r.added && r.added.length) msg += 'Colunas adicionadas: ' + r.added.join(', ') + '\\n';
        if (r.skipped && r.skipped.length) msg += 'Já existiam: ' + r.skipped.length + '\\n';
        if (r.backfilled) msg += '\\nBackfill com shop_id ' + r.backfilled.shop_id + ':\\n  mappings: ' + r.backfilled.mappings + '\\n  unmapped: ' + r.backfilled.unmapped + '\\n  orders: ' + r.backfilled.orders;
        alert(msg);
        await this.loadAll();
      } catch (e) {
        alert('Erro: ' + (e?.message || e));
      } finally {
        this.loading.acctBackfill = false;
      }
    },

    async syncAccounts() {
      this.loading.acctSync = true;
      try {
        // Cria tabela se ainda não existe (idempotente)
        await this.api('/api/accounts/migrate', { method: 'POST' });
        await this.api('/api/accounts/sync', { method: 'POST' });
        await this.loadAccounts();
      } catch (e) {
        alert('Erro: ' + (e?.message || e));
      } finally {
        this.loading.acctSync = false;
      }
    },

    async saveAccountLabel(externalId, label) {
      try {
        await this.api('/api/accounts/' + encodeURIComponent(externalId) + '/label',
          { method: 'PUT', body: JSON.stringify({ label }) });
      } catch (e) {
        alert('Erro ao salvar nome: ' + (e?.message || e));
      }
    },

    async superPair() {
      this.loading.superPair = true;
      this.superPairResult = null;
      try {
        this.superPairResult = await this.api('/api/super-pair', { method: 'POST' });
        await this.loadAll();
      } catch (e) {
        alert('Erro: ' + (e?.message || e));
      } finally {
        this.loading.superPair = false;
      }
    },

    async matchBySkuNow() {
      this.loading.matchSku = true;
      this.matchSkuResult = null;
      try {
        this.matchSkuResult = await this.api('/api/match-by-sku-now', { method: 'POST' });
        await this.loadAll();
      } catch (e) {
        alert('Erro: ' + (e?.message || e));
      } finally {
        this.loading.matchSku = false;
      }
    },

    async reprocessAllStatus() {
      this.loading.reprocessMl = true;
      this.reprocessMlResult = null;
      try {
        // ML e Shopee em paralelo
        var ml = await this.api('/api/orders/reprocess-ml-status?pages=20', { method: 'POST' });
        var sp = await this.api('/api/orders/reprocess-shopee-status?days=30', { method: 'POST' });
        this.reprocessMlResult = { ml: ml || {}, shopee: sp || {} };
        await this.loadOrders();
      } catch (e) {
        alert('Erro: ' + (e?.message || e));
      } finally {
        this.loading.reprocessMl = false;
      }
    },

    async refreshAllVariations() {
      if (!confirm('Vai chamar a API da Shopee uma vez por anúncio. Pode demorar uns minutos. Continuar?')) return;
      this.loading.refreshAll = true;
      this.refreshAllResult = null;
      try {
        this.refreshAllResult = await this.api('/api/refresh-all-variations', { method: 'POST' });
        await this.loadMaster();
      } catch (e) {
        alert('Erro: ' + (e?.message || e));
      } finally {
        this.loading.refreshAll = false;
      }
    },

    async refreshVariations(itemId) {
      if (!itemId) return;
      try {
        const r = await this.api('/api/refresh-variations/' + itemId, { method: 'POST' });
        if (r?.error) { alert('Erro: ' + r.error); return; }
        var msg = '✓ ' + (r.item_name || 'Item ' + itemId);
        msg += '\\n  Shopee → has_model: ' + (r.has_model ? 'sim' : 'não') + ' | modelos live: ' + (r.live_models || 0);
        if (r.duplicates_cleaned) msg += '\\n  Duplicatas SP removidas: ' + r.duplicates_cleaned;
        if (r.phantoms_cleaned) msg += '\\n  Fantasmas SP removidos: ' + r.phantoms_cleaned;
        if (r.names_updated) msg += '\\n  Nomes atualizados: ' + r.names_updated;
        if (r.mappings_updated) msg += '\\n  Mappings atualizados: ' + r.mappings_updated;
        if (r.ml_phantoms_cleaned) msg += '\\n  Fantasmas ML removidos: ' + r.ml_phantoms_cleaned;
        if (r.ml_variation_ids_fixed) msg += '\\n  variation_ids ML corrigidos: ' + r.ml_variation_ids_fixed;
        if (r.unmapped_covered_by_mapping) msg += '\\n  Unmapped redundantes (já em mapping): ' + r.unmapped_covered_by_mapping;
        if (r.duplicate_mappings_removed) msg += '\\n  Mappings duplicados removidos: ' + r.duplicate_mappings_removed;
        var changed = (r.duplicates_cleaned || 0) + (r.phantoms_cleaned || 0) + (r.names_updated || 0)
                    + (r.mappings_updated || 0) + (r.ml_phantoms_cleaned || 0) + (r.ml_variation_ids_fixed || 0)
                    + (r.unmapped_covered_by_mapping || 0) + (r.duplicate_mappings_removed || 0);
        if (!changed) msg += '\\n  Já estava em dia.';
        alert(msg);
        await this.loadMaster();
      } catch (e) {
        alert('Erro: ' + (e?.message || e));
      }
    },

    cleanVariation(s) {
      // Limpa variações ML do tipo "Versão do personagem: Charizard | Quantidade de peças: 305"
      // → "Charizard". Remove nomes de atributos e descarta valores puramente numéricos
      // (quantidade de peças, peso, etc).
      if (!s) return '';
      const parts = String(s).split(/\\s*\\|\\s*/);
      const cleaned = parts.map(p => {
        const idx = p.indexOf(':');
        const val = idx >= 0 ? p.slice(idx + 1) : p;
        return val.trim();
      }).filter(v => v && !/^\\d+$/.test(v));
      // Se sobrou nada (tudo era numérico), volta o primeiro valor original sem prefixo
      if (cleaned.length === 0 && parts.length > 0) {
        const first = parts[0];
        const idx = first.indexOf(':');
        return (idx >= 0 ? first.slice(idx + 1) : first).trim();
      }
      return cleaned.join(' / ');
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
