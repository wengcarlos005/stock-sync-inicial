// Endpoints HTTP da UI (JSON)
import type { Env } from './worker';
import { runDiscovery } from './discover';
import { runSync } from './sync';

type RouteHandler = (req: Request, env: Env, params: Record<string, string>) => Promise<Response>;

const routes: Array<{ method: string; pattern: RegExp; handler: RouteHandler; keys: string[] }> = [];

function add(method: string, path: string, handler: RouteHandler) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:([a-zA-Z_]+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '$');
  routes.push({ method, pattern, handler, keys });
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============= Dashboard summary =============
add('GET', '/api/status', async (_req, env) => {
  const [mappings, conflicts, unmapped, lastRun, orders] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as n FROM mappings WHERE active=1').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) as n FROM conflicts WHERE resolved_at IS NULL').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) as n FROM unmapped WHERE resolved=0').first<{ n: number }>(),
    env.DB.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 1').first(),
    env.DB.prepare('SELECT COUNT(*) as n FROM orders').first<{ n: number }>().catch(() => ({ n: 0 })),
  ]);
  return json({
    shadow_mode: env.SHADOW_MODE === 'true',
    active_mappings: mappings?.n ?? 0,
    unresolved_conflicts: conflicts?.n ?? 0,
    unmapped_items: unmapped?.n ?? 0,
    total_orders: orders?.n ?? 0,
    last_run: lastRun,
  });
});

// ============= Products (mappings + current state) =============
add('GET', '/api/products', async (req, env) => {
  const url = new URL(req.url);
  const search = url.searchParams.get('q')?.toLowerCase().trim() || '';
  const filter = url.searchParams.get('filter') || 'all';   // all | mismatch | active | disabled
  const r = await env.DB.prepare(`
    SELECT m.sku, m.product_name, m.active, m.notes, m.image_url,
           m.meli_item_id, m.meli_variation_id, m.shopee_item_id, m.shopee_model_id,
           s.meli_stock, s.shopee_stock, s.master_stock, s.last_poll_at, s.last_change_at,
           m.updated_at
    FROM mappings m
    LEFT JOIN state s ON s.sku = m.sku
    ORDER BY COALESCE(s.last_change_at, m.updated_at) DESC
  `).all();

  let rows = r.results as any[];

  // Enriquece com image+variation extraídos de orders recentes (busca por SKU)
  // Usa os pedidos mais recentes — o último visto pra cada SKU "ganha".
  const ordersR = await env.DB.prepare(
    `SELECT items_json FROM orders ORDER BY created_at DESC LIMIT 2000`
  ).all();
  const skuMeta = new Map<string, { image: string | null; variation: string | null; name: string | null }>();
  for (const o of ordersR.results as any[]) {
    let items: any[] = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch {}
    for (const it of items) {
      const sku = (it.sku || '').trim();
      if (!sku || skuMeta.has(sku)) continue; // primeiro visto = mais recente
      skuMeta.set(sku, {
        image: it.image || null,
        variation: it.variation || null,
        name: it.name || null,
      });
    }
  }
  for (const x of rows) {
    const meta = skuMeta.get(x.sku);
    // image_url da tabela mappings tem prioridade; fallback pra imagem do último pedido
    x.image = x.image_url || meta?.image || null;
    x.variation = meta?.variation || null;
    if (!x.product_name && meta?.name) x.product_name = meta.name;
  }

  if (search) {
    rows = rows.filter(x =>
      x.sku.toLowerCase().includes(search) ||
      (x.product_name || '').toLowerCase().includes(search)
    );
  }
  if (filter === 'mismatch') {
    rows = rows.filter(x => x.meli_stock !== x.shopee_stock && x.meli_stock != null && x.shopee_stock != null);
  } else if (filter === 'active') {
    rows = rows.filter(x => x.active === 1);
  } else if (filter === 'disabled') {
    rows = rows.filter(x => x.active === 0);
  } else if (filter === 'out_of_stock') {
    rows = rows.filter(x => {
      const s = x.master_stock ?? Math.min(x.meli_stock ?? Infinity, x.shopee_stock ?? Infinity);
      return s === 0;
    });
  } else if (filter === 'low_stock') {
    rows = rows.filter(x => {
      const s = x.master_stock ?? Math.min(x.meli_stock ?? Infinity, x.shopee_stock ?? Infinity);
      return s !== Infinity && s > 0 && s < 3;
    });
  }
  return json({ total: rows.length, items: rows });
});

// ============= Produtos: Master unificado (ML + Shopee agrupados por anúncio) =============
// Cada anúncio = 1 card com TODAS as variações (paired+unpaired dos 2 lados).
// Anúncios pareados são fundidos. Inclui vendas (7d, 30d, total).
add('GET', '/api/products/master', async (req, env) => {
  const url = new URL(req.url);
  const search = url.searchParams.get('q')?.toLowerCase().trim() || '';
  const filter = url.searchParams.get('filter') || 'all'; // all | paired | unpaired

  // ── 1. Mappings (paired) ───────────────────────────────────
  // Filtra active=1: inativos são duplicatas/desabilitados que não devem aparecer
  const paired = (await env.DB.prepare(`
    SELECT m.sku, m.product_name, m.image_url, m.active,
           m.meli_item_id, m.meli_variation_id, m.shopee_item_id, m.shopee_model_id, m.shopee_account_id,
           m.extra_shopee_stores,
           s.master_stock, s.meli_stock, s.shopee_stock
    FROM mappings m
    LEFT JOIN state s ON s.sku = m.sku
    WHERE m.active = 1
  `).all()).results as any[];

  // ── 2. Unmapped ────────────────────────────────────────────
  const unmapped = (await env.DB.prepare(`
    SELECT sku, platform, item_id, variation_id, product_name, shopee_account_id FROM unmapped WHERE resolved=0
  `).all()).results as any[];

  // ── 2c. Labels das contas (pra mostrar nome amigável na UI) ──
  const accountLabels = new Map<string, string>();
  try {
    const accts = (await env.DB.prepare(`SELECT external_id, label FROM marketplace_accounts`).all()).results as any[];
    for (const a of accts) accountLabels.set(String(a.external_id), a.label || a.external_id);
  } catch { /* tabela ainda não existe */ }

  // ── 2b. Unmapped (resolvido OU não) — usa o product_name sufixo como fallback do nome de variação
  // A discovery preserva "ItemName <sep> VariationName" no unmapped. Vários separadores possíveis:
  //  " - " (hyphen)  " — " (em-dash UTF-8)  " – " (en-dash)  " â " (em-dash mojibake Latin-1)
  const unmappedAll = (await env.DB.prepare(`
    SELECT platform, item_id, variation_id, product_name FROM unmapped WHERE variation_id IS NOT NULL
  `).all()).results as any[];

  // Conserta mojibake UTF-8 lido como Latin-1 (ex: "â" → "—", "Ã§" → "ç")
  const fixMojibake = (s: string) => {
    if (!s) return '';
    try {
      const fixed = decodeURIComponent(escape(s));
      return fixed.includes(String.fromCharCode(0xFFFD)) ? s : fixed;
    } catch { return s; }
  };
  // Pega o sufixo após o ÚLTIMO separador (qualquer entre - – — ou seus mojibakes)
  const extractSuffix = (raw: string): string | null => {
    const fixed = fixMojibake(raw);
    // Match: espaço + (-, –, — ou â mojibake) + espaço; pega o último
    const re = / [-–—] /g;
    let lastIdx = -1, lastLen = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fixed)) !== null) { lastIdx = m.index; lastLen = m[0].length; }
    if (lastIdx <= 0) return null;
    const suffix = fixed.slice(lastIdx + lastLen).trim();
    return suffix || null;
  };

  // Map: "platform|item_id|variation_id" → variação
  const variationFromUnmapped = new Map<string, string>();
  for (const u of unmappedAll) {
    const suffix = extractSuffix(String(u.product_name || ''));
    if (!suffix) continue;
    const key = `${u.platform}|${u.item_id}|${u.variation_id}`;
    if (!variationFromUnmapped.has(key)) variationFromUnmapped.set(key, suffix);
  }

  // ── 3. Sales stats (a partir de orders) ────────────────────
  const now = Date.now();
  const cutoff7 = now - 7 * 86400 * 1000;
  const cutoff30 = now - 30 * 86400 * 1000;
  const ordersR = (await env.DB.prepare(`SELECT created_at, items_json FROM orders ORDER BY created_at DESC LIMIT 5000`).all()).results as any[];
  type Sales = { total: number; d30: number; d7: number; image: string | null; name: string | null; variation: string | null };
  const salesBySku = new Map<string, Sales>();
  const salesByMeliVar = new Map<string, Sales>();   // key meli_item|variation
  const salesByShopeeVar = new Map<string, Sales>(); // key shopee_item|model
  const ensure = (map: Map<string, Sales>, key: string) => {
    let s = map.get(key);
    if (!s) { s = { total: 0, d30: 0, d7: 0, image: null, name: null, variation: null }; map.set(key, s); }
    return s;
  };
  for (const o of ordersR) {
    let items: any[] = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch {}
    for (const it of items) {
      const qty = Number(it.qty || 1);
      const bump = (s: Sales) => {
        s.total += qty;
        if (o.created_at >= cutoff30) s.d30 += qty;
        if (o.created_at >= cutoff7)  s.d7  += qty;
        if (!s.image && it.image) s.image = it.image;
        if (!s.name && it.name) s.name = it.name;
        if (!s.variation && it.variation) s.variation = it.variation;
      };
      if (it.sku) bump(ensure(salesBySku, it.sku));
      if (it.item_id) {
        // sem distinguir plataforma — tenta os dois mapas
        bump(ensure(salesByMeliVar, `${it.item_id}|${it.variation_id||''}`));
        bump(ensure(salesByShopeeVar, `${it.item_id}|${it.variation_id||''}`));
      }
    }
  }
  const lookupSales = (sku: string, meliKey: string, shopeeKey: string): Sales | null => {
    return salesBySku.get(sku) || salesByMeliVar.get(meliKey) || salesByShopeeVar.get(shopeeKey) || null;
  };

  // ── 4. Constrói anúncios ───────────────────────────────────
  // chave do anúncio: prefere shopee_item_id (master), senão meli_item_id
  type Variation = {
    sku: string;
    variation: string | null;
    image: string | null;
    meli_item_id: string | null;
    meli_variation_id: string | null;
    shopee_item_id: string | null;
    shopee_model_id: string | null;
    paired: boolean;
    meli_stock: number | null;
    shopee_stock: number | null;
    master_stock: number | null;
    sales_total: number;
    sales_30d: number;
    sales_7d: number;
    active: number;
  };
  type Anuncio = {
    key: string;             // "sp:ID" ou "ml:ID"
    shopee_item_id: string | null;
    meli_item_id: string | null;
    product_name: string;
    image: string | null;
    variations: Variation[];
    fully_paired: boolean;
  };
  const anuncios = new Map<string, Anuncio>();
  // Índices reversos: id de cada lado → key do anuncio que já o contém
  const shopeeIdToKey = new Map<string, string>();
  const meliIdToKey = new Map<string, string>();
  const ensureAnuncio = (shopeeId: string | null, meliId: string | null, name: string, image: string | null, shopeeAccountId?: string | null) => {
    // Procura por anúncio existente que já tenha qualquer um dos IDs
    let key = '';
    if (shopeeId && shopeeIdToKey.has(shopeeId)) key = shopeeIdToKey.get(shopeeId)!;
    else if (meliId && meliIdToKey.has(meliId))  key = meliIdToKey.get(meliId)!;
    else if (shopeeId) key = 'sp:' + shopeeId;
    else if (meliId) key = 'ml:' + meliId;
    if (!key) return null;
    let a: any = anuncios.get(key);
    if (!a) {
      a = {
        key, shopee_item_id: shopeeId, meli_item_id: meliId,
        shopee_account_id: shopeeAccountId || null,
        shopee_account_label: shopeeAccountId ? (accountLabels.get(shopeeAccountId) || shopeeAccountId) : null,
        product_name: name, image, variations: [], fully_paired: true, all_names: new Set<string>(),
      };
      anuncios.set(key, a);
    } else {
      if (!a.shopee_item_id && shopeeId) a.shopee_item_id = shopeeId;
      if (!a.meli_item_id && meliId) a.meli_item_id = meliId;
      if (!a.shopee_account_id && shopeeAccountId) {
        a.shopee_account_id = shopeeAccountId;
        a.shopee_account_label = accountLabels.get(shopeeAccountId) || shopeeAccountId;
      }
      if (!a.image && image) a.image = image;
      if (name && name.length > (a.product_name?.length || 0)) a.product_name = name;
    }
    if (name) a.all_names.add(name);
    if (shopeeId) shopeeIdToKey.set(shopeeId, key);
    if (meliId) meliIdToKey.set(meliId, key);
    return a;
  };

  // a) Pareados primeiro (estabelece o "anúncio" duplo)
  for (const m of paired) {
    const a = ensureAnuncio(m.shopee_item_id || null, m.meli_item_id || null, m.product_name || '', m.image_url, m.shopee_account_id);
    if (!a) continue;
    const sales = lookupSales(m.sku, `${m.meli_item_id}|${m.meli_variation_id||''}`, `${m.shopee_item_id}|${m.shopee_model_id||''}`);
    // Preferência de nome de variação: Shopee > SKU > ML > sufixo do unmapped > sufixo do próprio mapping
    const shopeeSales = salesByShopeeVar.get(`${m.shopee_item_id}|${m.shopee_model_id||''}`);
    const skuSales = salesBySku.get(m.sku);
    const meliSales = salesByMeliVar.get(`${m.meli_item_id}|${m.meli_variation_id||''}`);
    const fromUnmapped = variationFromUnmapped.get(`shopee|${m.shopee_item_id}|${m.shopee_model_id||''}`)
                      || variationFromUnmapped.get(`meli|${m.meli_item_id}|${m.meli_variation_id||''}`);
    // Último fallback: sufixo no próprio product_name do mapping (refresh-variations atualiza com nome da Shopee live)
    const fromMappingName = extractSuffix(String(m.product_name || ''));
    const preferredVariation = shopeeSales?.variation || skuSales?.variation || meliSales?.variation || fromUnmapped || fromMappingName || null;
    const meta = skuSales || sales;
    // Parse extra_shopee_stores (lojas Shopee adicionais que compartilham este SKU)
    const extras: any[] = m.extra_shopee_stores ? (() => { try { return JSON.parse(m.extra_shopee_stores); } catch { return []; } })() : [];
    const shopee_stores: any[] = [];
    if (m.shopee_item_id) {
      shopee_stores.push({
        item_id: m.shopee_item_id,
        model_id: m.shopee_model_id || null,
        account_id: m.shopee_account_id || null,
        account_label: m.shopee_account_id ? (accountLabels.get(m.shopee_account_id) || m.shopee_account_id) : null,
      });
    }
    for (const ex of extras) {
      if (shopee_stores.some(s => String(s.item_id) === String(ex.item_id) && String(s.model_id||'') === String(ex.model_id||''))) continue;
      shopee_stores.push({
        item_id: ex.item_id,
        model_id: ex.model_id || null,
        account_id: ex.account_id || null,
        account_label: ex.account_id ? (accountLabels.get(ex.account_id) || ex.account_id) : null,
      });
    }
    a.variations.push({
      sku: m.sku,
      variation: preferredVariation,
      image: m.image_url || meta?.image || null,
      meli_item_id: m.meli_item_id || null,
      meli_variation_id: m.meli_variation_id || null,
      shopee_item_id: m.shopee_item_id || null,
      shopee_model_id: m.shopee_model_id || null,
      shopee_account_id: m.shopee_account_id || null,
      shopee_account_label: m.shopee_account_id ? (accountLabels.get(m.shopee_account_id) || m.shopee_account_id) : null,
      shopee_stores, // primary + extras já populados (pra UI mostrar contador "2" quando >1)
      paired: !!(m.meli_item_id && m.shopee_item_id),
      meli_stock: m.meli_stock ?? null,
      shopee_stock: m.shopee_stock ?? null,
      master_stock: m.master_stock ?? null,
      sales_total: sales?.total || 0,
      sales_30d: sales?.d30 || 0,
      sales_7d: sales?.d7 || 0,
      active: m.active ?? 1,
    });
  }

  // b) Unpaired — cada lado adiciona à anuncio correspondente
  for (const u of unmapped) {
    if (u.platform === 'shopee') {
      const a = ensureAnuncio(u.item_id, null, u.product_name || '', null, u.shopee_account_id);
      if (!a) continue;
      const sales = salesByShopeeVar.get(`${u.item_id}|${u.variation_id||''}`) || (u.sku ? salesBySku.get(u.sku) : null) || null;
      const fromSuffix = extractSuffix(String(u.product_name || ''));
      a.variations.push({
        sku: u.sku || '',
        variation: sales?.variation || fromSuffix || null,
        image: sales?.image || null,
        meli_item_id: null,
        meli_variation_id: null,
        shopee_item_id: u.item_id,
        shopee_model_id: u.variation_id || null,
        shopee_account_id: u.shopee_account_id || null,
        shopee_account_label: u.shopee_account_id ? (accountLabels.get(u.shopee_account_id) || u.shopee_account_id) : null,
        paired: false,
        meli_stock: null, shopee_stock: null, master_stock: null,
        sales_total: sales?.total || 0, sales_30d: sales?.d30 || 0, sales_7d: sales?.d7 || 0,
        active: 0,
      });
      a.fully_paired = false;
    } else if (u.platform === 'meli') {
      const a = ensureAnuncio(null, u.item_id, u.product_name || '', null);
      if (!a) continue;
      const sales = salesByMeliVar.get(`${u.item_id}|${u.variation_id||''}`) || (u.sku ? salesBySku.get(u.sku) : null) || null;
      const fromSuffix = extractSuffix(String(u.product_name || ''));
      a.variations.push({
        sku: u.sku || '',
        variation: sales?.variation || fromSuffix || null,
        image: sales?.image || null,
        meli_item_id: u.item_id,
        meli_variation_id: u.variation_id || null,
        shopee_item_id: null,
        shopee_model_id: null,
        paired: false,
        meli_stock: null, shopee_stock: null, master_stock: null,
        sales_total: sales?.total || 0, sales_30d: sales?.d30 || 0, sales_7d: sales?.d7 || 0,
        active: 0,
      });
      a.fully_paired = false;
    }
  }

  // ── 4.5. Merge anúncios que compartilham SKU (mesmo produto em 2+ lojas Shopee) ──
  // Ex: Geek Aura SP item 111 + Magic Aura SP item 222, ambos com SKU TET-BLK-001
  //     → vira 1 card com badge SP mostrando 2 lojas
  const normSku = (s: any) => (String(s ?? '')).trim().toLowerCase();
  const skuToKey = new Map<string, string>();
  const parent = new Map<string, string>();
  for (const a of anuncios.values()) parent.set(a.key, a.key);
  const find = (k: string): string => { const p = parent.get(k); if (!p || p === k) return p || k; const r = find(p); parent.set(k, r); return r; };
  const union = (x: string, y: string) => { const rx = find(x), ry = find(y); if (rx !== ry) parent.set(rx, ry); };
  for (const a of anuncios.values()) {
    for (const v of a.variations) {
      const ns = normSku(v.sku);
      if (!ns || ns.length < 3) continue; // ignora SKUs vazios/curtos pra evitar falso match
      if (skuToKey.has(ns)) union(a.key, skuToKey.get(ns)!);
      else skuToKey.set(ns, a.key);
    }
  }
  const mergedAnuncios = new Map<string, any>();
  for (const a of anuncios.values()) {
    const root = find(a.key);
    const initStore = a.shopee_item_id ? [{
      item_id: a.shopee_item_id,
      account_id: (a as any).shopee_account_id || null,
      account_label: (a as any).shopee_account_label || null,
    }] : [];
    if (root === a.key) {
      mergedAnuncios.set(root, { ...a, shopee_stores: initStore });
    } else {
      const dest = mergedAnuncios.get(root);
      if (!dest) { mergedAnuncios.set(root, { ...a, shopee_stores: initStore }); continue; }
      // Adiciona loja Shopee extra (se não já presente)
      for (const s of initStore) {
        if (!dest.shopee_stores.some((x: any) => String(x.item_id) === String(s.item_id))) {
          dest.shopee_stores.push(s);
        }
      }
      // Merge variações: dedup por SKU normalizado, mantendo a melhor row.
      // "Melhor" = pareada > não pareada > tem ML stock > tem SP stock.
      // Quando SKU é vazio/curto, usa fallback (sku+shopee_item_id+meli_var) pra evitar fundir lixo.
      // Acumula shopee_stores em CADA variação — pra UI mostrar contador "2" no badge SP per row.
      const rowScore = (v: any) => (v.paired ? 100 : 0) + (v.meli_stock != null ? 10 : 0) + (v.shopee_stock != null ? 5 : 0) + (v.sales_total || 0);
      const rowKey = (v: any) => {
        const ns = normSku(v.sku);
        return (ns && ns.length >= 3) ? ('sku:' + ns) : ('id:' + (v.shopee_item_id||'') + '|' + (v.shopee_model_id||'') + '|' + (v.meli_variation_id||''));
      };
      const addStore = (winner: any, loser: any) => {
        if (!winner.shopee_stores) winner.shopee_stores = [];
        for (const cand of [winner, loser]) {
          if (cand.shopee_item_id && !winner.shopee_stores.some((s: any) => String(s.item_id) === String(cand.shopee_item_id) && String(s.model_id||'') === String(cand.shopee_model_id||''))) {
            winner.shopee_stores.push({
              item_id: cand.shopee_item_id,
              model_id: cand.shopee_model_id || null,
              account_id: cand.shopee_account_id || null,
              account_label: cand.shopee_account_label || null,
            });
          }
        }
      };
      const byKey = new Map<string, any>();
      for (const v of dest.variations) {
        const k = rowKey(v);
        const cur = byKey.get(k);
        if (!cur) { addStore(v, v); byKey.set(k, v); }
        else if (rowScore(v) > rowScore(cur)) { addStore(v, cur); byKey.set(k, v); }
        else { addStore(cur, v); }
      }
      for (const v of a.variations) {
        const k = rowKey(v);
        const cur = byKey.get(k);
        if (!cur) { addStore(v, v); byKey.set(k, v); }
        else if (rowScore(v) > rowScore(cur)) {
          if (v.meli_stock == null && cur.meli_stock != null) v.meli_stock = cur.meli_stock;
          if (v.shopee_stock == null && cur.shopee_stock != null) v.shopee_stock = cur.shopee_stock;
          if (v.master_stock == null && cur.master_stock != null) v.master_stock = cur.master_stock;
          if (!v.variation && cur.variation) v.variation = cur.variation;
          if (!v.image && cur.image) v.image = cur.image;
          addStore(v, cur);
          byKey.set(k, v);
        } else {
          addStore(cur, v);
        }
      }
      dest.variations = [...byKey.values()];
      for (const n of ((a as any).all_names || [])) (dest as any).all_names?.add?.(n);
      if (!dest.image && a.image) dest.image = a.image;
      if ((a.product_name || '').length > (dest.product_name || '').length) dest.product_name = a.product_name;
      if (!dest.meli_item_id && a.meli_item_id) dest.meli_item_id = a.meli_item_id;
      dest.fully_paired = dest.fully_paired && a.fully_paired;
    }
  }
  anuncios.clear();
  for (const [k, a] of mergedAnuncios) anuncios.set(k, a);

  // Garante que TODA variação tenha shopee_stores (mesmo anúncio sem merge): 1 entrada com a loja própria
  for (const a of anuncios.values()) {
    for (const v of a.variations) {
      if (!v.shopee_stores && v.shopee_item_id) {
        v.shopee_stores = [{
          item_id: v.shopee_item_id,
          model_id: v.shopee_model_id || null,
          account_id: v.shopee_account_id || null,
          account_label: v.shopee_account_label || null,
        }];
      }
    }
  }

  // ── 5. Filtros e busca (nível do anúncio) ──────────────────
  let list = [...anuncios.values()];
  if (filter === 'paired')   list = list.filter(a => a.fully_paired);
  if (filter === 'unpaired') list = list.filter(a => !a.fully_paired);
  // Filtros de estoque: anúncio entra se TEM ao menos 1 variação que bate o critério
  const stockOf = (v: any) => {
    if (v.master_stock != null) return v.master_stock;
    const a = v.meli_stock, b = v.shopee_stock;
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return Math.min(a, b);
  };
  if (filter === 'out_of_stock') {
    list = list.map(a => ({ ...a, variations: a.variations.filter((v: any) => stockOf(v) === 0) }))
               .filter(a => a.variations.length > 0);
  }
  if (filter === 'low_stock') {
    // Estoque baixo inclui zerados (< 3, incluindo 0)
    list = list.map(a => ({ ...a, variations: a.variations.filter((v: any) => { const s = stockOf(v); return s != null && s < 3; }) }))
               .filter(a => a.variations.length > 0);
  }
  if (search) {
    // Conserta mojibake (UTF-8 lido como Latin-1) + remove acentos
    const fixMojibake = (s: string) => { if (!s) return ''; try { const fixed = decodeURIComponent(escape(s)); return fixed.includes(String.fromCharCode(0xFFFD)) ? s : fixed; } catch { return s; } };
    const norm = (s: string) => fixMojibake(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const q = norm(search);
    list = list.filter((a: any) => {
      // Busca em TODOS os nomes acumulados do anúncio (não só o "principal")
      for (const n of (a.all_names || [])) if (norm(n).includes(q)) return true;
      if (norm(a.product_name).includes(q)) return true;
      if (a.shopee_item_id?.includes(q)) return true;
      if ((a.meli_item_id || '').toLowerCase().includes(q)) return true;
      return a.variations.some((v: any) =>
        norm(v.sku).includes(q) || norm(v.variation || '').includes(q)
      );
    });
  }

  // Ordena: pareados primeiro com mais vendas, depois unpaired
  list.sort((a, b) => {
    const sa = a.variations.reduce((s, v) => s + v.sales_total, 0);
    const sb = b.variations.reduce((s, v) => s + v.sales_total, 0);
    return sb - sa;
  });

  // Corrige mojibake nos textos de exibição (UTF-8 que veio do MAC lido como Latin-1)
  const fixDisp = (s: string | null): string | null => { if (!s) return s; try { const fixed = decodeURIComponent(escape(s)); if (!fixed.includes(String.fromCharCode(0xFFFD))) return fixed; } catch {} return s; };
  for (const a of list) {
    a.product_name = fixDisp(a.product_name) || '';
    for (const v of a.variations) {
      v.variation = fixDisp(v.variation);
    }
    delete (a as any).all_names; // Set não serializa em JSON
  }

  const totalVars = list.reduce((s, a) => s + a.variations.length, 0);
  return json({ total: list.length, total_variations: totalVars, items: list });
});

// ============= Produtos: Shopee como master (LEGACY, mantido pra compat) =============
add('GET', '/api/products/shopee-master', async (req, env) => {
  const url = new URL(req.url);
  const search = url.searchParams.get('q')?.toLowerCase().trim() || '';
  const filter = url.searchParams.get('filter') || 'all'; // all | paired | unpaired

  // 1. Mappings (pareados — Shopee + ML, ou só um dos lados)
  const mappingsR = await env.DB.prepare(`
    SELECT m.sku, m.product_name, m.image_url, m.active,
           m.meli_item_id, m.meli_variation_id, m.shopee_item_id, m.shopee_model_id,
           s.master_stock, s.meli_stock, s.shopee_stock
    FROM mappings m
    LEFT JOIN state s ON s.sku = m.sku
  `).all();

  // 2. Unmapped Shopee
  const unmappedShopeeR = await env.DB.prepare(`
    SELECT sku, product_name, item_id AS shopee_item_id, variation_id AS shopee_model_id
    FROM unmapped WHERE platform='shopee' AND resolved=0
  `).all();

  // 3. Unmapped ML
  const unmappedMeliR = await env.DB.prepare(`
    SELECT sku, product_name, item_id AS meli_item_id, variation_id AS meli_variation_id
    FROM unmapped WHERE platform='meli' AND resolved=0
  `).all();

  // 4. Enriquecimento via orders (imagem, variation, vendas)
  const nowTs = Date.now();
  const cutoff7d = nowTs - 7 * 24 * 60 * 60 * 1000;
  const cutoff30d = nowTs - 30 * 24 * 60 * 60 * 1000;
  const ordersR = await env.DB.prepare(`SELECT items_json, created_at FROM orders ORDER BY created_at DESC LIMIT 5000`).all();
  const meta = new Map<string, { image: string | null; variation: string | null; name: string | null }>();
  const salesBySku = new Map<string, { d7: number; d30: number; total: number }>();
  const addSale = (key: string, qty: number, ts: number) => {
    if (!key) return;
    let s = salesBySku.get(key);
    if (!s) { s = { d7: 0, d30: 0, total: 0 }; salesBySku.set(key, s); }
    s.total += qty;
    if (ts >= cutoff30d) s.d30 += qty;
    if (ts >= cutoff7d) s.d7 += qty;
  };
  for (const o of ordersR.results as any[]) {
    let items: any[] = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch {}
    for (const it of items) {
      const k = `${it.item_id}|${it.variation_id || ''}`;
      if (!meta.has(k)) meta.set(k, { image: it.image || null, variation: it.variation || null, name: it.name || null });
      if (it.sku && !meta.has(it.sku)) meta.set(it.sku, { image: it.image || null, variation: it.variation || null, name: it.name || null });
      const qty = Number(it.qty || 1);
      const ts = Number(o.created_at || 0);
      if (it.sku) addSale(String(it.sku).trim(), qty, ts);
    }
  }

  const enrich = (row: any) => {
    const kSp = row.shopee_item_id ? `${row.shopee_item_id}|${row.shopee_model_id || ''}` : null;
    const kMl = row.meli_item_id ? `${row.meli_item_id}|${row.meli_variation_id || ''}` : null;
    const m = (kSp && meta.get(kSp)) || (kMl && meta.get(kMl)) || (row.sku && meta.get(row.sku)) || null;
    const s = row.sku ? salesBySku.get(String(row.sku).trim()) : null;
    return {
      ...row,
      image: row.image_url || m?.image || null,
      variation: m?.variation || null,
      product_name: row.product_name || m?.name || '',
      sales_7d: s?.d7 || 0,
      sales_30d: s?.d30 || 0,
      sales_total: s?.total || 0,
      paired: !!(row.shopee_item_id && row.meli_item_id),
    };
  };

  // Constrói lista combinada de variações com DEDUP
  // Chave única por (shopee_item_id, shopee_model_id) OU (meli_item_id, meli_variation_id) OU sku
  const dedupMap = new Map<string, any>();
  const addOrMerge = (row: any) => {
    // Chaves possíveis de identificação
    const keys: string[] = [];
    if (row.shopee_item_id) keys.push(`sp:${row.shopee_item_id}|${row.shopee_model_id || ''}`);
    if (row.meli_item_id) keys.push(`ml:${row.meli_item_id}|${row.meli_variation_id || ''}`);
    if (row.sku) keys.push(`sku:${row.sku}`);
    if (keys.length === 0) return;

    // Procura entrada existente por qualquer chave
    let existing: any = null;
    for (const k of keys) { if (dedupMap.has(k)) { existing = dedupMap.get(k); break; } }

    if (existing) {
      // Merge: preserva campos preenchidos do existente, completa com row
      if (row.shopee_item_id && !existing.shopee_item_id) existing.shopee_item_id = row.shopee_item_id;
      if (row.shopee_model_id && !existing.shopee_model_id) existing.shopee_model_id = row.shopee_model_id;
      if (row.meli_item_id && !existing.meli_item_id) existing.meli_item_id = row.meli_item_id;
      if (row.meli_variation_id && !existing.meli_variation_id) existing.meli_variation_id = row.meli_variation_id;
      if (row.sku && !existing.sku) existing.sku = row.sku;
      if (row.product_name && !existing.product_name) existing.product_name = row.product_name;
      if (row.image && !existing.image) existing.image = row.image;
      if (row.variation && !existing.variation) existing.variation = row.variation;
      if (row.sales_total > (existing.sales_total || 0)) {
        existing.sales_7d = row.sales_7d; existing.sales_30d = row.sales_30d; existing.sales_total = row.sales_total;
      }
      existing.paired = !!(existing.shopee_item_id && existing.meli_item_id);
      if (row.mapped) existing.mapped = true; // qualquer fonte mappings vence
      // Atualiza todas as chaves para apontar pra esta entrada
      for (const k of keys) dedupMap.set(k, existing);
    } else {
      for (const k of keys) dedupMap.set(k, row);
    }
  };

  // mapped=true marca rows que existem na tabela mappings (permite Atualizar mesmo se 1 lado só)
  for (const r of (mappingsR.results as any[])) addOrMerge(enrich({ ...r, mapped: true }));
  for (const r of (unmappedShopeeR.results as any[])) addOrMerge(enrich({ ...r, active: 0, mapped: false }));
  for (const r of (unmappedMeliR.results as any[])) addOrMerge(enrich({ ...r, active: 0, mapped: false }));

  // Pega entradas únicas (Set por identidade do objeto)
  const uniqueRows = Array.from(new Set(dedupMap.values()));
  let rows = uniqueRows;
  if (filter === 'paired')   rows = rows.filter(r => r.paired);
  if (filter === 'unpaired') rows = rows.filter(r => !r.paired);
  // Filtros de estoque — usa unidades (master_stock, ou min(ml,sp) se faltar)
  const stockOf = (r: any) => {
    if (r.master_stock != null) return r.master_stock;
    const a = r.meli_stock, b = r.shopee_stock;
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return Math.min(a, b);
  };
  if (filter === 'out_of_stock') rows = rows.filter(r => stockOf(r) === 0);
  if (filter === 'low_stock')    rows = rows.filter(r => { const s = stockOf(r); return s != null && s < 3; });
  if (search) {
    rows = rows.filter(r =>
      (r.sku || '').toLowerCase().includes(search) ||
      (r.product_name || '').toLowerCase().includes(search) ||
      (r.variation || '').toLowerCase().includes(search) ||
      String(r.shopee_item_id || '').includes(search) ||
      String(r.meli_item_id || '').includes(search)
    );
  }

  // ===== Agrupamento por "anúncio" =====
  // Shopee é mestre quando disponível. Rows ML-only são absorvidas pelo grupo SP
  // que já contém o mesmo meli_item_id — evita duplicação.
  // Trim em IDs garante consistência (espaço extra acidental no DB).
  const norm = (v: any) => v == null ? null : String(v).trim() || null;
  const grouped = new Map<string, any>();
  const meliToGKey = new Map<string, string>();

  const ensureGroup = (gKey: string, sId: string | null, mId: string | null, img: string | null) => {
    if (!grouped.has(gKey)) {
      grouped.set(gKey, {
        key: gKey,
        shopee_item_id: sId,
        meli_item_id: mId,
        product_name: '',
        image: img,
        platforms: new Set<string>(),
        variations: [] as any[],
      });
    }
    return grouped.get(gKey)!;
  };

  // 1ª passada: rows com shopee_item_id → grupo sp:
  for (const r of rows) {
    const sId = norm(r.shopee_item_id);
    if (!sId) continue;
    const mId = norm(r.meli_item_id);
    const gKey = `sp:${sId}`;
    const g = ensureGroup(gKey, sId, mId, r.image || null);
    g.platforms.add('shopee');
    if (mId) {
      g.platforms.add('meli');
      if (!g.meli_item_id) g.meli_item_id = mId;
      meliToGKey.set(mId, gKey);
    }
    if (!g.image && r.image) g.image = r.image;
    g.variations.push(r);
  }

  // 2ª passada: rows sem shopee_item_id (só ML)
  for (const r of rows) {
    if (norm(r.shopee_item_id)) continue;
    const mId = norm(r.meli_item_id);
    if (!mId) continue;
    const existingGKey = meliToGKey.get(mId);
    if (existingGKey) {
      const g = grouped.get(existingGKey)!;
      g.platforms.add('meli');
      if (!g.image && r.image) g.image = r.image;
      g.variations.push(r);
    } else {
      const gKey = `ml:${mId}`;
      const g = ensureGroup(gKey, null, mId, r.image || null);
      g.platforms.add('meli');
      if (!g.product_name && r.product_name) g.product_name = r.product_name;
      g.variations.push(r);
      meliToGKey.set(mId, gKey);
    }
  }

  // Para cada grupo: define nome (Shopee dominante) + extrai variação dos product_names
  for (const [, g] of grouped) {
    // Nome do grupo: pega o item_name puro de uma variação Shopee
    // (product_name é "ItemName - VariationName"; usa lastIndexOf pra preservar item_name com hifens)
    const spVarsWithName = (g.variations as any[]).filter((v: any) =>
      norm(v.shopee_item_id) && v.product_name
    );
    if (spVarsWithName.length > 0) {
      const raw = String(spVarsWithName[0].product_name);
      const dashIdx = raw.lastIndexOf(' - ');
      g.product_name = (dashIdx > 0 ? raw.slice(0, dashIdx) : raw).trim();
    } else if (!g.product_name) {
      const anyVar = (g.variations as any[]).find((v: any) => v.product_name);
      if (anyVar) g.product_name = anyVar.product_name;
    }
    // Para cada variação, preenche variation se faltar (extrai do product_name)
    for (const v of g.variations as any[]) {
      if (!v.variation && v.product_name) {
        const raw = String(v.product_name);
        const dashIdx = raw.lastIndexOf(' - ');
        if (dashIdx > 0) {
          const suffix = raw.slice(dashIdx + 3).trim();
          if (suffix) v.variation = suffix;
        }
      }
    }
  }

  // Serializa Set → array
  const items = [...grouped.values()].map(g => ({ ...g, platforms: [...g.platforms] }));
  return json({ total: items.length, total_variations: rows.length, items });
});

// ============= Sales stats per SKU (a partir da tabela orders) =============
add('GET', '/api/products/sales', async (req, env) => {
  const url = new URL(req.url);
  const search = url.searchParams.get('q')?.toLowerCase().trim() || '';
  const now = Date.now();
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;
  const cutoff30d = now - 30 * 24 * 60 * 60 * 1000;

  // Mês corrente
  const monthStart = (() => {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  })();

  // Busca todos os pedidos com items_json (limita 5000 — janela razoável)
  const ordersRes = await env.DB.prepare(`
    SELECT platform, order_id, pack_id, created_at, items_json FROM orders ORDER BY created_at DESC LIMIT 5000
  `).all();

  // Mapeia SKU → {name, total, last30, last7, last_sale_at}
  const stats = new Map<string, any>();

  for (const o of ordersRes.results as any[]) {
    let items: any[] = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch {}
    for (const it of items) {
      const sku = (it.sku || it.variation_id || it.item_id || '').trim();
      if (!sku) continue;
      const qty = Number(it.qty || 1);
      let s = stats.get(sku);
      if (!s) {
        s = {
          sku,
          name: it.name || '',
          variation: it.variation || null,
          image: it.image || null,
          total: 0,
          month: 0,
          last30: 0,
          last7: 0,
          last_sale_at: null as number | null,
        };
        stats.set(sku, s);
      }
      s.total += qty;
      if (o.created_at >= monthStart) s.month += qty;
      if (o.created_at >= cutoff30d) s.last30 += qty;
      if (o.created_at >= cutoff7d) s.last7 += qty;
      if (!s.last_sale_at || o.created_at > s.last_sale_at) s.last_sale_at = o.created_at;
      // Atualiza name/image se vazio
      if (!s.name && it.name) s.name = it.name;
      if (!s.image && it.image) s.image = it.image;
      if (!s.variation && it.variation) s.variation = it.variation;
    }
  }

  // Enriquece com dados do mapping (estoque atual) — chunked pra evitar limite SQL D1 (~100 vars)
  const skus = Array.from(stats.keys());
  const CHUNK = 80;
  for (let i = 0; i < skus.length; i += CHUNK) {
    const chunk = skus.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const mapRes = await env.DB.prepare(
      `SELECT m.sku, m.product_name, s.master_stock, s.meli_stock, s.shopee_stock
       FROM mappings m LEFT JOIN state s ON s.sku=m.sku
       WHERE m.sku IN (${placeholders})`
    ).bind(...chunk).all();
    for (const row of mapRes.results as any[]) {
      const s = stats.get(row.sku);
      if (s) {
        s.name = row.product_name || s.name;
        s.current_stock = row.master_stock ?? row.meli_stock ?? row.shopee_stock ?? null;
      }
    }
  }

  let items = Array.from(stats.values()).sort((a, b) => b.total - a.total);
  if (search) {
    items = items.filter(x =>
      (x.sku || '').toLowerCase().includes(search) ||
      (x.name || '').toLowerCase().includes(search)
    );
  }
  return json({ items, total: items.length });
});

// ============= Changes feed =============
add('GET', '/api/changes', async (req, env) => {
  const url = new URL(req.url);
  const limit = Math.min(2000, Number(url.searchParams.get('limit') || 500));
  const sku = url.searchParams.get('sku');
  const q = sku
    ? env.DB.prepare(`
        SELECT c.*, m.product_name FROM changes c
        LEFT JOIN mappings m ON m.sku = c.sku
        WHERE c.sku = ? ORDER BY c.ts DESC LIMIT ?`).bind(sku, limit)
    : env.DB.prepare(`
        SELECT c.*, m.product_name FROM changes c
        LEFT JOIN mappings m ON m.sku = c.sku
        ORDER BY c.ts DESC LIMIT ?`).bind(limit);
  const r = await q.all();
  return json({ items: r.results });
});

// ============= Conflicts =============
add('GET', '/api/conflicts', async (req, env) => {
  const url = new URL(req.url);
  const onlyOpen = url.searchParams.get('open') !== 'false';
  const r = await env.DB.prepare(
    onlyOpen
      ? `SELECT * FROM conflicts WHERE resolved_at IS NULL OR resolution = 'auto_min' ORDER BY ts DESC LIMIT 100`
      : `SELECT * FROM conflicts ORDER BY ts DESC LIMIT 100`
  ).all();
  return json({ items: r.results });
});

add('POST', '/api/conflicts/:id/resolve', async (req, env, params) => {
  const body = await req.json() as { value: number };
  if (typeof body.value !== 'number') return json({ error: 'value required' }, 400);
  const id = Number(params.id);
  const conflict = await env.DB.prepare(`SELECT * FROM conflicts WHERE id = ?`).bind(id).first<any>();
  if (!conflict) return json({ error: 'not found' }, 404);
  await env.DB.prepare(`UPDATE conflicts SET resolved_to = ?, resolution = 'manual', resolved_at = ?, resolved_by = 'user' WHERE id = ?`)
    .bind(body.value, Date.now(), id).run();
  return json({ ok: true });
});

// ============= Unmapped =============
add('GET', '/api/unmapped', async (_req, env) => {
  // Top 250 de cada plataforma (não 200 misturado, que pode dar 200% Shopee)
  const [meli, shopee] = await Promise.all([
    env.DB.prepare(`SELECT * FROM unmapped WHERE resolved=0 AND platform='meli'   ORDER BY last_seen_at DESC LIMIT 250`).all(),
    env.DB.prepare(`SELECT * FROM unmapped WHERE resolved=0 AND platform='shopee' ORDER BY last_seen_at DESC LIMIT 250`).all(),
  ]);
  return json({ items: [...(meli.results || []), ...(shopee.results || [])] });
});

add('POST', '/api/unmapped/:id/ignore', async (_req, env, params) => {
  await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(Number(params.id)).run();
  return json({ ok: true });
});

// ============= Mappings (CRUD manual) =============
add('POST', '/api/mappings', async (req, env) => {
  const m = await req.json() as any;
  if (!m.sku) return json({ error: 'sku required' }, 400);
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, shopee_account_id, product_name, active, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(sku) DO UPDATE SET
      meli_item_id = excluded.meli_item_id,
      meli_variation_id = excluded.meli_variation_id,
      shopee_item_id = excluded.shopee_item_id,
      shopee_model_id = excluded.shopee_model_id,
      shopee_account_id = COALESCE(excluded.shopee_account_id, mappings.shopee_account_id),
      product_name = COALESCE(excluded.product_name, mappings.product_name),
      notes = COALESCE(excluded.notes, mappings.notes),
      updated_at = excluded.updated_at
  `).bind(m.sku, m.meli_item_id ?? null, m.meli_variation_id ?? null, m.shopee_item_id ?? null, m.shopee_model_id ?? null, m.shopee_account_id ?? null, m.product_name ?? null, m.notes ?? null, now, now).run();

  // Auto-resolve: só marca a variação EXATA — nunca outras variações do mesmo item
  if (m.meli_item_id) {
    if (m.meli_variation_id) {
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE platform='meli' AND item_id=? AND variation_id=?`)
        .bind(m.meli_item_id, m.meli_variation_id).run();
    } else {
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE platform='meli' AND item_id=? AND (variation_id IS NULL OR variation_id='')`)
        .bind(m.meli_item_id).run();
    }
  }
  if (m.shopee_item_id) {
    if (m.shopee_model_id) {
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE platform='shopee' AND item_id=? AND variation_id=?`)
        .bind(m.shopee_item_id, m.shopee_model_id).run();
    } else {
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE platform='shopee' AND item_id=? AND (variation_id IS NULL OR variation_id='')`)
        .bind(m.shopee_item_id).run();
    }
  }

  return json({ ok: true });
});

// Restaura itens ML incorretamente marcados como resolvidos (sem mapping exato)
add('POST', '/api/restore-unmapped', async (_req, env) => {
  const r = await env.DB.prepare(`
    UPDATE unmapped SET resolved=0
    WHERE resolved=1 AND platform='meli'
    AND NOT EXISTS (
      SELECT 1 FROM mappings
      WHERE meli_item_id = unmapped.item_id
        AND (
          (meli_variation_id = unmapped.variation_id)
          OR (meli_variation_id IS NULL AND (unmapped.variation_id IS NULL OR unmapped.variation_id = ''))
        )
    )
  `).run();
  const r2 = await env.DB.prepare(`
    UPDATE unmapped SET resolved=0
    WHERE resolved=1 AND platform='shopee'
    AND NOT EXISTS (
      SELECT 1 FROM mappings
      WHERE shopee_item_id = unmapped.item_id
        AND (
          (shopee_model_id = unmapped.variation_id)
          OR (shopee_model_id IS NULL AND (unmapped.variation_id IS NULL OR unmapped.variation_id = ''))
        )
    )
  `).run();
  return json({ ok: true, meli_restored: r.meta.changes, shopee_restored: r2.meta.changes });
});

// Limpa unmapped entries que já foram mapeadas (one-shot cleanup)
add('POST', '/api/cleanup-unmapped', async (_req, env) => {
  // Marca como resolvidos todos os unmapped cujo item_id+variation_id já está em mappings
  const r1 = await env.DB.prepare(`
    UPDATE unmapped SET resolved=1
    WHERE platform='meli' AND EXISTS (
      SELECT 1 FROM mappings WHERE meli_item_id=unmapped.item_id
        AND (meli_variation_id=unmapped.variation_id OR (meli_variation_id IS NULL AND unmapped.variation_id IS NULL))
    )
  `).run();
  const r2 = await env.DB.prepare(`
    UPDATE unmapped SET resolved=1
    WHERE platform='shopee' AND EXISTS (
      SELECT 1 FROM mappings WHERE shopee_item_id=unmapped.item_id
        AND (shopee_model_id=unmapped.variation_id OR (shopee_model_id IS NULL AND unmapped.variation_id IS NULL))
    )
  `).run();
  return json({ ok: true, meli_resolved: r1.meta.changes, shopee_resolved: r2.meta.changes });
});

// Linka um item unmapped a um mapping existente (extend)
add('POST', '/api/mappings/:sku/link', async (req, env, params) => {
  const body = await req.json() as any;
  const { unmapped_id } = body;
  if (!unmapped_id) return json({ error: 'unmapped_id obrigatório' }, 400);

  const row = await env.DB.prepare(`SELECT * FROM unmapped WHERE id=?`).bind(unmapped_id).first<any>();
  if (!row) return json({ error: 'unmapped não encontrado' }, 404);

  const now = Date.now();
  if (row.platform === 'meli') {
    await env.DB.prepare(`UPDATE mappings SET meli_item_id=?, meli_variation_id=?, updated_at=? WHERE sku=?`)
      .bind(row.item_id, row.variation_id || null, now, params.sku).run();
  } else {
    await env.DB.prepare(`UPDATE mappings SET shopee_item_id=?, shopee_model_id=?, updated_at=? WHERE sku=?`)
      .bind(row.item_id, row.variation_id || null, now, params.sku).run();
  }
  await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(unmapped_id).run();
  return json({ ok: true });
});

add('POST', '/api/mappings/:sku/toggle', async (_req, env, params) => {
  const sku = params.sku;
  const row = await env.DB.prepare(`SELECT active FROM mappings WHERE sku=?`).bind(sku).first<{ active: number }>();
  if (!row) return json({ error: 'not found' }, 404);
  const newActive = row.active ? 0 : 1;
  await env.DB.prepare(`UPDATE mappings SET active=?, updated_at=? WHERE sku=?`).bind(newActive, Date.now(), sku).run();
  return json({ ok: true, active: newActive });
});

add('DELETE', '/api/mappings/:sku', async (_req, env, params) => {
  await env.DB.prepare(`DELETE FROM mappings WHERE sku=?`).bind(params.sku).run();
  await env.DB.prepare(`DELETE FROM state WHERE sku=?`).bind(params.sku).run();
  return json({ ok: true });
});

// ============= Runs (cron history) =============
add('GET', '/api/runs', async (_req, env) => {
  const r = await env.DB.prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT 50`).all();
  return json({ items: r.results });
});

// ============= Actions =============
add('POST', '/api/discover', async (_req, env) => {
  const token = (env as any).GITHUB_TOKEN;
  const repo  = (env as any).GITHUB_REPO || 'wengcarlos005/stock-sync-inicial';

  if (!token) {
    return json({ error: 'GITHUB_TOKEN não configurado. Rode: npx wrangler secret put GITHUB_TOKEN' }, 500);
  }

  // Dispara workflow_dispatch no GitHub Actions
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/282879355/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'stock-sync-worker',
      },
      body: JSON.stringify({ ref: 'main', inputs: {} }),
    }
  );

  const responseText = await res.text();
  if (!res.ok) {
    return json({ error: `GitHub API ${res.status}: ${responseText.slice(0, 500)}` }, 500);
  }

  return json({ ok: true, message: 'Discovery disparado no GitHub Actions! Aguarde ~5 minutos para concluir.' });
});

add('POST', '/api/sync', async (_req, env) => json(await runSync(env, 'manual')));

// Extrai mensagem legível de erros HTTP brutos do MAC/ML/Shopee
function cleanApiError(msg: string, platform: string): string {
  if (!msg) return 'erro desconhecido';
  const jsonStart = msg.indexOf('{');
  if (jsonStart < 0) return msg.slice(0, 300);
  const jsonPart = msg.slice(jsonStart);

  // Tenta JSON.parse "limpo"
  try {
    const parsed = JSON.parse(jsonPart);
    const cause = parsed?.data?.cause?.[0] || parsed?.cause?.[0];
    if (cause?.message) {
      const code = cause.code ? ` [${cause.code}]` : '';
      const type = cause.type ? ` (${cause.type})` : '';
      return `${cause.message}${code}${type}`;
    }
    if (parsed?.message) return parsed.message + (parsed.error ? ` (${parsed.error})` : '');
    if (parsed?.error || parsed?.message) {
      return [parsed.error, parsed.message].filter(Boolean).join(': ');
    }
  } catch { /* JSON inválido (newlines reais em strings, etc) — cai no regex abaixo */ }

  // FALLBACK: extrai message/code via regex mesmo se o JSON estiver "feio"
  // Aceita newlines reais e mesmo strings truncadas (sem aspas de fechamento)
  const flat = jsonPart.replace(/[\r\n]+/g, ' ');
  // Match com aspas de fechamento OU fim de string (truncado)
  const msgMatch = flat.match(/"message"\s*:\s*"([^"]*?)(?:"|$)/);
  const codeMatch = flat.match(/"code"\s*:\s*"([^"]+)"/);
  const typeMatch = flat.match(/"type"\s*:\s*"([^"]+)"/);
  if (msgMatch && msgMatch[1]) {
    const code = codeMatch ? ` [${codeMatch[1]}]` : '';
    const type = typeMatch ? ` (${typeMatch[1]})` : '';
    return `${msgMatch[1]}${code}${type}`;
  }
  // Sem message: pelo menos retorna o code se achou
  if (codeMatch) {
    return `Erro ${codeMatch[1]}` + (typeMatch ? ` (${typeMatch[1]})` : '');
  }
  return msg.slice(0, 300);
}

// ============= Manual stock override =============
add('POST', '/api/products/:sku/set-stock', async (req, env, params) => {
  const body = await req.json() as {
    stock: number;
    shopee_item_id?: string | null;
    shopee_model_id?: string | null;
    shopee_account_id?: string | null;
    meli_item_id?: string | null;
    meli_variation_id?: string | null;
    product_name?: string | null;
  };
  if (typeof body.stock !== 'number') return json({ error: 'stock required' }, 400);
  // Set master and trigger sync via change log
  let map = await env.DB.prepare(`SELECT * FROM mappings WHERE sku=?`).bind(params.sku).first<any>();
  // Se não há mapping mas o body tem IDs de plataforma, cria mapping na hora
  // (permite Atualizar pra variações ainda em unmapped)
  if (!map && (body.shopee_item_id || body.meli_item_id)) {
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, shopee_account_id, product_name, active, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'auto: criado ao atualizar estoque', ?, ?)
      ON CONFLICT(sku) DO UPDATE SET
        shopee_account_id = COALESCE(excluded.shopee_account_id, mappings.shopee_account_id)
    `).bind(
      params.sku,
      body.meli_item_id || null,
      body.meli_variation_id || null,
      body.shopee_item_id || null,
      body.shopee_model_id || null,
      body.shopee_account_id || null,
      body.product_name || null,
      now, now
    ).run();
    // Resolve entries em unmapped que correspondem
    if (body.shopee_item_id) {
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE platform='shopee' AND item_id=? AND COALESCE(variation_id,'')=COALESCE(?,'')`)
        .bind(body.shopee_item_id, body.shopee_model_id || '').run();
    }
    if (body.meli_item_id) {
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE platform='meli' AND item_id=? AND COALESCE(variation_id,'')=COALESCE(?,'')`)
        .bind(body.meli_item_id, body.meli_variation_id || '').run();
    }
    map = await env.DB.prepare(`SELECT * FROM mappings WHERE sku=?`).bind(params.sku).first<any>();
  }
  if (!map) return json({ error: 'mapping not found' }, 404);

  // AUTO-PAIR ao vivo: se mapping tem só Shopee mas o SKU parece MLB,
  // tenta buscar ML direto e adiciona meli_item_id se SKU bater.
  // Cobre o caso clássico de anúncios "Inativo sem estoque" que a discovery
  // ainda não pegou.
  if (map.shopee_item_id && !map.meli_item_id && (/^MLB\d+/i.test(params.sku) || /^\d{8,}$/.test(params.sku))) {
    try {
      const mac = await import('./mac');
      const tryItemId = /^MLB\d+/i.test(params.sku) ? params.sku.toUpperCase() : 'MLB' + params.sku;
      const liveItem: any = await mac.meliGetItem(env, tryItemId);
      if (liveItem) {
        const norm = (s: any) => String(s || '').trim().toLowerCase();
        const itemSku = mac.getMeliSku(liveItem);
        // Item-level: SKU bate direto?
        if (itemSku && norm(itemSku) === norm(params.sku)) {
          await env.DB.prepare(`UPDATE mappings SET meli_item_id=?, meli_variation_id=NULL, updated_at=? WHERE sku=?`)
            .bind(liveItem.id, Date.now(), params.sku).run();
          map.meli_item_id = liveItem.id;
          map.meli_variation_id = null;
        } else if (liveItem.variations && liveItem.variations.length > 0) {
          // Variação que tem SKU igual?
          const matched = liveItem.variations.find((v: any) => norm(mac.getMeliVariationSku(v)) === norm(params.sku));
          if (matched) {
            await env.DB.prepare(`UPDATE mappings SET meli_item_id=?, meli_variation_id=?, updated_at=? WHERE sku=?`)
              .bind(liveItem.id, String(matched.id), Date.now(), params.sku).run();
            map.meli_item_id = liveItem.id;
            map.meli_variation_id = String(matched.id);
          }
        }
      }
    } catch { /* live pair falhou — segue só com Shopee */ }
  }

  const shadow = env.SHADOW_MODE === 'true';
  // Get current values
  const prev = await env.DB.prepare(`SELECT * FROM state WHERE sku=?`).bind(params.sku).first<any>();
  const meliBefore = prev?.meli_stock ?? null;
  const shopeeBefore = prev?.shopee_stock ?? null;

  // Apply to both (if not shadow)
  let propagated: string[] = [];
  const errors: any[] = [];
  if (!shadow) {
    const mac = await import('./mac');
    // ML
    if (map.meli_item_id) {
      try {
        let meliVarId = map.meli_variation_id ? Number(map.meli_variation_id) : undefined;
        // FALLBACK: se variation_id está faltando, busca live no ML e tenta achar a variação pelo SKU
        if (!meliVarId) {
          try {
            const item = await mac.meliGetItem(env, map.meli_item_id);
            const vars = item?.variations || [];
            if (vars.length > 0) {
              const matchBySku = vars.find((v: any) => mac.getMeliVariationSku(v)?.trim() === params.sku);
              if (matchBySku) {
                meliVarId = Number(matchBySku.id);
                // Persiste no mapping pra evitar lookup futuro
                await env.DB.prepare(`UPDATE mappings SET meli_variation_id=? WHERE sku=?`).bind(String(meliVarId), params.sku).run();
              } else {
                errors.push({ platform: 'meli', error: `Item ${map.meli_item_id} tem ${vars.length} variações mas nenhuma com SKU=${params.sku}. Re-pareie manualmente.` });
              }
            }
          } catch (e: any) {
            errors.push({ platform: 'meli', error: 'lookup falhou: ' + String(e.message) });
          }
        }
        if (meliVarId || !map.meli_variation_id) {
          await mac.meliUpdateStock(env, map.meli_item_id, body.stock, meliVarId);
          propagated.push('meli');
        }
      } catch (e: any) {
        errors.push({ platform: 'meli', error: cleanApiError(e.message, 'meli') });
      }
    }
    // Shopee — rota pra conta correta via shopee_account_id se setado
    if (map.shopee_item_id) {
      try {
        await mac.shopeeUpdateStock(
          env,
          Number(map.shopee_item_id),
          body.stock,
          map.shopee_model_id ? Number(map.shopee_model_id) : undefined,
          map.shopee_account_id || undefined,
        );
        propagated.push('shopee');
      } catch (e: any) {
        errors.push({ platform: 'shopee', error: cleanApiError(e.message, 'shopee') });
      }
    }
    // Extras: outras lojas Shopee que compartilham este SKU
    if (map.extra_shopee_stores) {
      let extras: any[] = [];
      try { extras = JSON.parse(map.extra_shopee_stores); } catch {}
      for (const ex of extras) {
        try {
          await mac.shopeeUpdateStock(
            env,
            Number(ex.item_id),
            body.stock,
            ex.model_id ? Number(ex.model_id) : undefined,
            ex.account_id || undefined,
          );
          propagated.push('shopee:' + (ex.account_id || ex.item_id));
        } catch (e: any) {
          errors.push({ platform: 'shopee_extra:' + (ex.account_id || ex.item_id), error: cleanApiError(e.message, 'shopee') });
        }
      }
    }
    if (propagated.length === 0 && errors.length > 0) {
      return json({ error: 'Falhou em todas as plataformas', details: errors }, 500);
    }
  }

  await env.DB.prepare(`
    INSERT INTO changes (ts, sku, source, trigger, meli_stock_before, meli_stock_after, shopee_stock_before, shopee_stock_after, delta, propagated_to, shadow)
    VALUES (?, ?, 'manual', 'manual_set', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    Date.now(), params.sku,
    meliBefore, shadow ? meliBefore : body.stock,
    shopeeBefore, shadow ? shopeeBefore : body.stock,
    body.stock - (prev?.master_stock ?? 0),
    propagated.join(','),
    shadow ? 1 : 0
  ).run();

  // State só reflete o que realmente foi atualizado.
  // Se ML não foi propagado (sem meli_item_id, ou erro), mantém o valor anterior.
  // Idem pra Shopee. Evita "mentir" mostrando 2 unidades onde nem chamou a API.
  const newMeliStock = shadow ? meliBefore : (propagated.includes('meli') ? body.stock : meliBefore);
  const newShopeeStock = shadow ? shopeeBefore : (propagated.includes('shopee') ? body.stock : shopeeBefore);
  await env.DB.prepare(`
    INSERT INTO state (sku, meli_stock, shopee_stock, master_stock, last_poll_at, last_change_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(sku) DO UPDATE SET
      meli_stock = excluded.meli_stock,
      shopee_stock = excluded.shopee_stock,
      master_stock = excluded.master_stock,
      last_poll_at = excluded.last_poll_at,
      last_change_at = excluded.last_change_at
  `).bind(
    params.sku,
    newMeliStock,
    newShopeeStock,
    body.stock, Date.now(), Date.now()
  ).run();

  // Lista plataformas vinculadas mas não propagadas (ex: meli_item_id existe mas update falhou silencioso)
  const linked: string[] = [];
  if (map.meli_item_id) linked.push('meli');
  if (map.shopee_item_id) linked.push('shopee');
  const notUpdated = linked.filter(p => !propagated.includes(p) && !errors.find(e => e.platform === p));

  return json({ ok: true, shadow, propagated, linked, not_attempted: notUpdated, errors: errors.length ? errors : undefined });
});

// ============= Catalog bulk upsert (usado pelo discovery remoto) =============
add('POST', '/api/catalog/bulk', async (req, env) => {
  const body = await req.json() as any;
  const items: any[] = body.items || [];
  if (!Array.isArray(items) || items.length === 0) return json({ error: 'items[] obrigatório' }, 400);
  const now = Date.now();
  let inserted = 0, errors = 0;
  for (const it of items) {
    try {
      await env.DB.prepare(`INSERT INTO unmapped (platform, sku, item_id, variation_id, shopee_account_id, product_name, first_seen_at, last_seen_at, resolved) VALUES (?,?,?,?,?,?,?,?,0) ON CONFLICT(sku, platform, item_id, variation_id) DO UPDATE SET last_seen_at=?, product_name=COALESCE(excluded.product_name, unmapped.product_name), shopee_account_id=COALESCE(excluded.shopee_account_id, unmapped.shopee_account_id)`)
        .bind(it.platform, it.sku, it.item_id, it.variation_id || null, it.shopee_account_id || null, it.product_name || null, now, now, now).run();
      inserted++;
    } catch { errors++; }
  }
  return json({ ok: true, inserted, errors });
});

// ============= Catalog: todos os itens não pareados para busca manual =============
add('GET', '/api/catalog', async (req, env) => {
  const url = new URL(req.url);
  const platform = url.searchParams.get('platform') || '';
  const q = url.searchParams.get('q')?.toLowerCase().trim() || '';
  const includePaired = url.searchParams.get('include_paired') === '1';
  const live = url.searchParams.get('live') === '1';
  const plat = platform === 'meli' ? 'meli' : 'shopee';
  const like = q ? `%${q}%` : null;

  // 1. Unmapped items — filtro em SQL (não em memória!) pra varrer DB inteiro, não só primeiros 300
  let unmQuery = `SELECT id, platform, sku, item_id, variation_id, product_name FROM unmapped WHERE resolved=0`;
  const unmParams: any[] = [];
  if (platform) { unmQuery += ` AND platform=?`; unmParams.push(plat); }
  if (like) {
    unmQuery += ` AND (LOWER(product_name) LIKE ? OR LOWER(sku) LIKE ? OR LOWER(CAST(item_id AS TEXT)) LIKE ?)`;
    unmParams.push(like, like, like);
  }
  unmQuery += ` ORDER BY product_name ASC LIMIT 300`;
  const r = await env.DB.prepare(unmQuery).bind(...unmParams).all();
  let items = (r.results as any[]).map(x => ({ ...x, paired: false }));

  // 2. Mapped items — também com filtro em SQL
  if (includePaired && platform) {
    const col = plat === 'meli' ? 'meli_item_id' : 'shopee_item_id';
    const varCol = plat === 'meli' ? 'meli_variation_id' : 'shopee_model_id';
    let mapQuery = `SELECT sku, ${col} as item_id, ${varCol} as variation_id, product_name FROM mappings WHERE ${col} IS NOT NULL`;
    const mapParams: any[] = [];
    if (like) {
      mapQuery += ` AND (LOWER(product_name) LIKE ? OR LOWER(sku) LIKE ? OR LOWER(CAST(${col} AS TEXT)) LIKE ?)`;
      mapParams.push(like, like, like);
    }
    mapQuery += ` ORDER BY product_name ASC LIMIT 300`;
    const m = await env.DB.prepare(mapQuery).bind(...mapParams).all();
    const mapped = (m.results as any[]).map(x => ({
      id: 'paired:' + plat + ':' + x.item_id + ':' + (x.variation_id || ''),
      platform: plat,
      sku: x.sku,
      item_id: x.item_id,
      variation_id: x.variation_id,
      product_name: x.product_name,
      paired: true,
    }));
    items = items.concat(mapped);
  }

  // 3. Live lookup — se nenhum resultado E query parece um item_id, busca direto na API
  // (cobre anúncios inativos/sem estoque que não vieram via discovery)
  if (live && items.length === 0 && q && platform) {
    try {
      const mac = await import('./mac');
      let mlItemId: string | null = null;
      if (plat === 'meli') {
        if (/^mlb\d+$/i.test(q)) mlItemId = q.toUpperCase();
        else if (/^\d{8,}$/.test(q)) mlItemId = 'MLB' + q; // só número → assume prefixo BR
      }
      if (plat === 'meli' && mlItemId) {
        const itemId = mlItemId;
        const item: any = await mac.meliGetItem(env, itemId);
        if (item) {
          if (item.variations && item.variations.length > 0) {
            for (const v of item.variations) {
              const combo = (v.attribute_combinations || []).map((c: any) => c.value_name).filter(Boolean).join('/');
              items.push({
                id: 'live:meli:' + item.id + ':' + v.id,
                platform: 'meli',
                sku: mac.getMeliVariationSku(v) || '',
                item_id: item.id,
                variation_id: String(v.id),
                product_name: (item.title || '') + (combo ? ' - ' + combo : ''),
                paired: false,
                live: true,
              });
            }
          } else {
            items.push({
              id: 'live:meli:' + item.id,
              platform: 'meli',
              sku: mac.getMeliSku(item) || '',
              item_id: item.id,
              variation_id: null,
              product_name: item.title || '',
              paired: false,
              live: true,
            });
          }
        }
      } else if (plat === 'shopee' && /^\d{8,}$/.test(q)) {
        const itemId = Number(q);
        const item: any = await mac.shopeeGetItem(env, itemId);
        if (item) {
          if (item.has_model) {
            const models = await mac.shopeeGetModels(env, itemId);
            for (const m2 of models) {
              items.push({
                id: 'live:shopee:' + itemId + ':' + m2.model_id,
                platform: 'shopee',
                sku: m2.model_sku || '',
                item_id: String(itemId),
                variation_id: String(m2.model_id),
                product_name: (item.item_name || '') + ' - ' + (m2.model_name || ''),
                paired: false,
                live: true,
              });
            }
          } else {
            items.push({
              id: 'live:shopee:' + itemId,
              platform: 'shopee',
              sku: item.item_sku || '',
              item_id: String(itemId),
              variation_id: null,
              product_name: item.item_name || '',
              paired: false,
              live: true,
            });
          }
        }
      }
    } catch (e) { /* falha silenciosa de live lookup */ }
  }

  return json({ items });
});

// ============= Pareamento em lote por anúncio (variações por nome) =============
// Recebe shopee_item_id + meli_item_id e pareia as variações pelo nome
add('POST', '/api/mappings/pair-products', async (req, env) => {
  const body = await req.json() as { shopee_item_id: string; meli_item_id: string; dry_run?: boolean };
  const { shopee_item_id, meli_item_id } = body;
  const dryRun = !!body.dry_run;
  if (!shopee_item_id || !meli_item_id) return json({ error: 'shopee_item_id e meli_item_id obrigatórios' }, 400);

  // 1. Pegar todas as variações Shopee desse item via DB (já temos via discovery)
  const sp = await env.DB.prepare(
    `SELECT id, item_id, variation_id, sku, product_name FROM unmapped WHERE platform='shopee' AND item_id=? AND resolved=0`
  ).bind(shopee_item_id).all();
  const ml = await env.DB.prepare(
    `SELECT id, item_id, variation_id, sku, product_name FROM unmapped WHERE platform='meli' AND item_id=? AND resolved=0`
  ).bind(meli_item_id).all();

  const spItems = (sp.results || []) as any[];
  const mlItems = (ml.results || []) as any[];

  if (!spItems.length || !mlItems.length) {
    return json({ error: 'Nenhuma variação não-pareada encontrada para um dos itens', shopee_count: spItems.length, meli_count: mlItems.length }, 404);
  }

  // Normaliza nome (lowercase, trim, sem acentos)
  const norm = (s: string) => String(s || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  // Busca via API: nomes reais das variações de cada lado
  const spNames = new Map<string, string>(); // variation_id → model_name
  const mlNames = new Map<string, string>(); // variation_id → "attr1 attr2 ..." (value_names concat)
  try {
    const md: any = await macRaw(env, 'shopee_get_models', { item_id: Number(shopee_item_id) });
    const models = md?.data?.response?.model || md?.response?.model || [];
    for (const m of models) spNames.set(String(m.model_id), m.model_name || '');
  } catch {}
  try {
    const it: any = await macRaw(env, 'raw', { method: 'GET', path: `/items/${meli_item_id}` });
    const item = it?.data || it;
    for (const v of (item.variations || [])) {
      const combo = (v.attribute_combinations || v.attributes || [])
        .map((a: any) => a.value_name).filter(Boolean).join(' ');
      mlNames.set(String(v.id), combo);
    }
  } catch {}

  const matches: Array<{ shopee: any; meli: any; reason: string; shopee_name?: string; meli_name?: string }> = [];
  const unmatched: any[] = [];

  // Estratégia 1: por nome de variação (fuzzy)
  for (const s of spItems) {
    const spName = norm(spNames.get(String(s.variation_id)) || '');
    if (spName) {
      // procura ML com nome igual ou contido
      const found = mlItems.find(m => {
        if (matches.find(x => x.meli.id === m.id)) return false;
        const mlName = norm(mlNames.get(String(m.variation_id)) || '');
        if (!mlName) return false;
        return mlName === spName || mlName.includes(spName) || spName.includes(mlName);
      });
      if (found) {
        matches.push({
          shopee: s, meli: found, reason: 'nome variação',
          shopee_name: spNames.get(String(s.variation_id)),
          meli_name: mlNames.get(String(found.variation_id)),
        });
        continue;
      }
    }
    // Fallback: sufixo numérico do SKU
    const m = String(s.sku || '').match(/(\d+)\s*$/);
    if (m) {
      const num = parseInt(m[1], 10);
      const found = mlItems.find(x => {
        if (matches.find(mm => mm.meli.id === x.id)) return false;
        const xm = String(x.sku || '').match(/(\d+)\s*$/);
        return xm && parseInt(xm[1], 10) === num;
      });
      if (found) {
        matches.push({ shopee: s, meli: found, reason: 'sufixo numérico do SKU' });
        continue;
      }
    }
    unmatched.push({ shopee: s, reason: 'sem match por nome nem por SKU' });
  }

  if (dryRun) {
    return json({
      dry_run: true,
      shopee_count: spItems.length,
      meli_count: mlItems.length,
      matched: matches.length,
      unmatched_count: unmatched.length,
      matches: matches.map(m => ({
        sku: m.shopee.sku, name: m.shopee.product_name,
        shopee_var: m.shopee.variation_id, meli_var: m.meli.variation_id,
        shopee_name: m.shopee_name, meli_name: m.meli_name,
        reason: m.reason,
      })),
      unmatched,
    });
  }

  // 4. Cria mappings
  const now = Date.now();
  let created = 0;
  for (const m of matches) {
    try {
      await env.DB.prepare(`
        INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, product_name, active, notes, created_at, updated_at)
        VALUES (?,?,?,?,?,?,1,'pareamento em lote',?,?)
        ON CONFLICT(sku) DO UPDATE SET
          meli_item_id=excluded.meli_item_id, meli_variation_id=excluded.meli_variation_id,
          shopee_item_id=excluded.shopee_item_id, shopee_model_id=excluded.shopee_model_id,
          updated_at=excluded.updated_at
      `).bind(
        m.shopee.sku,
        meli_item_id, m.meli.variation_id || null,
        shopee_item_id, m.shopee.variation_id || null,
        m.shopee.product_name || m.meli.product_name || '',
        now, now,
      ).run();
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id IN (?,?)`)
        .bind(m.shopee.id, m.meli.id).run();
      created++;
    } catch {}
  }

  return json({
    ok: true,
    matched: matches.length,
    unmatched_count: unmatched.length,
    created,
    unmatched,
  });
});

// ============= Pareamento manual =============
// ============= Parear variação direto via item_id (não exige unmapped.id) =============
// Body: { shopee_item_id, shopee_model_id?, meli_item_id, meli_variation_id?, sku?, product_name? }
add('POST', '/api/mappings/pair-variation', async (req, env) => {
  const body = await req.json() as any;
  const sp_item = String(body.shopee_item_id || '').trim();
  const sp_model = body.shopee_model_id ? String(body.shopee_model_id) : null;
  const ml_item = String(body.meli_item_id || '').trim();
  const ml_var = body.meli_variation_id ? String(body.meli_variation_id) : null;
  if (!sp_item || !ml_item) return json({ error: 'shopee_item_id e meli_item_id obrigatórios' }, 400);

  const sku = (body.sku || '').trim() || `MANUAL_${sp_item}_${ml_item}${sp_model ? '_' + sp_model : ''}`;
  const name = (body.product_name || '').trim() || null;
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, product_name, active, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'pareamento manual', ?, ?)
    ON CONFLICT(sku) DO UPDATE SET
      meli_item_id=excluded.meli_item_id, meli_variation_id=excluded.meli_variation_id,
      shopee_item_id=excluded.shopee_item_id, shopee_model_id=excluded.shopee_model_id,
      product_name=COALESCE(excluded.product_name, mappings.product_name),
      updated_at=excluded.updated_at
  `).bind(sku, ml_item, ml_var, sp_item, sp_model, name, now, now).run();

  // Marca como resolvido nos unmapped relacionados (se existirem)
  await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE (platform='shopee' AND item_id=? AND (variation_id=? OR (? IS NULL AND variation_id IS NULL))) OR (platform='meli' AND item_id=? AND (variation_id=? OR (? IS NULL AND variation_id IS NULL)))`)
    .bind(sp_item, sp_model, sp_model, ml_item, ml_var, ml_var).run();

  return json({ ok: true, sku });
});

// ============= Atualizar SKU de uma variação na própria plataforma =============
// Body: { meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, shopee_account_id, sku }
// Atualiza SKU no marketplace (ML ou Shopee — qualquer lado presente), refleta no DB,
// e tenta auto-parear se já existe outro lado com mesmo SKU.
add('POST', '/api/variation/set-sku', async (req, env) => {
  const body = await req.json() as any;
  const newSku = String(body.sku || '').trim();
  if (!newSku) return json({ error: 'sku obrigatório' }, 400);

  const meliItem = body.meli_item_id ? String(body.meli_item_id) : null;
  const meliVar  = body.meli_variation_id ? String(body.meli_variation_id) : null;
  const spItem   = body.shopee_item_id ? String(body.shopee_item_id) : null;
  const spModel  = body.shopee_model_id ? String(body.shopee_model_id) : null;
  const spAcc    = body.shopee_account_id ? String(body.shopee_account_id) : null;

  if (!meliItem && !spItem) return json({ error: 'precisa pelo menos um lado (meli_item_id ou shopee_item_id)' }, 400);

  const updates: Record<string, any> = {};
  const errors: Record<string, string> = {};
  const mac = await import('./mac');

  // 1) Atualiza SKU no marketplace
  if (meliItem) {
    try {
      const r = await mac.meliSetSku(env, meliItem, newSku, meliVar ? Number(meliVar) : undefined);
      updates.meli = r ? 'ok' : 'sent';
    } catch (e: any) {
      errors.meli = e.message || String(e);
    }
  }
  if (spItem) {
    try {
      const r = await mac.shopeeSetSku(env, Number(spItem), newSku, spModel ? Number(spModel) : undefined, spAcc || undefined);
      updates.shopee = r ? 'ok' : 'sent';
    } catch (e: any) {
      errors.shopee = e.message || String(e);
    }
  }

  // 2) Atualiza/cria registro local (mappings ou unmapped)
  const now = Date.now();
  // Verifica se já existe mapping
  const existingMap = await env.DB.prepare(
    `SELECT sku FROM mappings WHERE
      (meli_item_id IS ? AND (meli_variation_id IS ? OR (? IS NULL AND meli_variation_id IS NULL)))
      OR (shopee_item_id IS ? AND (shopee_model_id IS ? OR (? IS NULL AND shopee_model_id IS NULL)))
     LIMIT 1`
  ).bind(meliItem, meliVar, meliVar, spItem, spModel, spModel).first<any>();

  let action = 'none';
  let pairedSku: string | null = null;

  if (existingMap) {
    // Já tem mapping — tenta renomear sku
    const targetExists = await env.DB.prepare(`SELECT sku FROM mappings WHERE sku=? AND sku!=?`).bind(newSku, existingMap.sku).first<any>();
    if (targetExists) {
      // CONFLITO: outro mapping já usa o newSku. Mescla o synth dentro do existente como extra_shopee_store.
      // Mantém o mapping principal (que tem pareamento ML), e adiciona Magic Aura como loja extra.
      if (spItem) {
        const target = await env.DB.prepare(`SELECT * FROM mappings WHERE sku=?`).bind(newSku).first<any>();
        const extras: any[] = target?.extra_shopee_stores ? JSON.parse(target.extra_shopee_stores) : [];
        // Não duplica se já está no principal
        const isPrimary = String(target?.shopee_item_id||'') === spItem && String(target?.shopee_model_id||'') === String(spModel||'');
        if (!isPrimary && !extras.some(e => String(e.item_id) === spItem && String(e.model_id||'') === String(spModel||''))) {
          extras.push({ item_id: spItem, model_id: spModel, account_id: spAcc });
          await env.DB.prepare(`UPDATE mappings SET extra_shopee_stores=?, updated_at=? WHERE sku=?`).bind(JSON.stringify(extras), now, newSku).run();
        }
      }
      // Antes de deletar: re-atribui changes que apontam pro synth (FK RESTRICT)
      await env.DB.prepare(`UPDATE changes SET sku=? WHERE sku=?`).bind(newSku, existingMap.sku).run();
      // state tem ON DELETE CASCADE, então deleta junto com o mapping
      // Remove o synth mapping (Magic agora vive como extra dentro do mapping principal)
      await env.DB.prepare(`DELETE FROM mappings WHERE sku=?`).bind(existingMap.sku).run();
      // Marca unmapped da Magic como resolvido
      if (spItem) {
        await env.DB.prepare(`UPDATE unmapped SET resolved=1, sku=?, last_seen_at=? WHERE platform='shopee' AND item_id=? AND (variation_id=? OR (? IS NULL AND variation_id IS NULL))`)
          .bind(newSku, now, spItem, spModel, spModel).run();
      }
      action = 'merged_into_existing_sku';
      pairedSku = newSku;
    } else {
      await env.DB.prepare(`UPDATE mappings SET sku=?, updated_at=? WHERE sku=?`).bind(newSku, now, existingMap.sku).run();
      action = 'mapping_updated';
      pairedSku = newSku;
    }
  } else {
    // Sem mapping. Procura unmapped do OUTRO lado com SKU igual → AUTO-PAIR
    const oppositePlatform = meliItem ? 'shopee' : 'meli';
    const oppositeRows = (await env.DB.prepare(
      `SELECT * FROM unmapped WHERE resolved=0 AND platform=? AND LOWER(TRIM(COALESCE(sku,'')))=LOWER(?)`
    ).bind(oppositePlatform, newSku).all()).results as any[];

    if (oppositeRows.length === 1) {
      const o = oppositeRows[0];
      const m_item = meliItem || o.item_id;
      const m_var  = meliItem ? meliVar : (o.variation_id || null);
      const s_item = spItem || o.item_id;
      const s_model = spItem ? spModel : (o.variation_id || null);
      const s_acc = spItem ? spAcc : (o.shopee_account_id || null);
      await env.DB.prepare(`
        INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, shopee_account_id, product_name, active, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 1, 'auto-pareado via set-sku', ?, ?)
        ON CONFLICT(sku) DO UPDATE SET
          meli_item_id=excluded.meli_item_id, meli_variation_id=excluded.meli_variation_id,
          shopee_item_id=excluded.shopee_item_id, shopee_model_id=excluded.shopee_model_id,
          shopee_account_id=COALESCE(excluded.shopee_account_id, mappings.shopee_account_id),
          updated_at=excluded.updated_at
      `).bind(newSku, m_item, m_var, s_item, s_model, s_acc, now, now).run();
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE platform=? AND item_id=? AND (variation_id=? OR (? IS NULL AND variation_id IS NULL))`)
        .bind(oppositePlatform, o.item_id, o.variation_id, o.variation_id).run();
      action = 'auto_paired';
      pairedSku = newSku;
    } else {
      // Sem match. Só cria/atualiza o unmapped do lado atualizado com novo SKU
      const platform = meliItem ? 'meli' : 'shopee';
      const itm = meliItem || spItem!;
      const variation = meliItem ? meliVar : spModel;
      await env.DB.prepare(`UPDATE unmapped SET sku=?, last_seen_at=? WHERE platform=? AND item_id=? AND (variation_id=? OR (? IS NULL AND variation_id IS NULL))`)
        .bind(newSku, now, platform, itm, variation, variation).run();
      action = oppositeRows.length > 1 ? 'multiple_candidates_no_pair' : 'sku_saved_no_match';
    }
  }

  return json({ ok: Object.keys(errors).length === 0, updates, errors, action, sku: pairedSku });
});

add('POST', '/api/mappings/manual', async (req, env) => {
  const body = await req.json() as any;
  const { meli_unmapped_id, shopee_unmapped_id, sku, product_name } = body;
  if (!meli_unmapped_id || !shopee_unmapped_id) return json({ error: 'meli_unmapped_id e shopee_unmapped_id obrigatórios' }, 400);

  const meliRow = await env.DB.prepare(`SELECT * FROM unmapped WHERE id=?`).bind(meli_unmapped_id).first<any>();
  const shopeeRow = await env.DB.prepare(`SELECT * FROM unmapped WHERE id=?`).bind(shopee_unmapped_id).first<any>();
  if (!meliRow || !shopeeRow) return json({ error: 'Item não encontrado' }, 404);

  const canonicalSku = sku?.trim() || shopeeRow.sku || meliRow.sku || `MANUAL_${Date.now()}`;
  const name = product_name?.trim() || shopeeRow.product_name || meliRow.product_name || '';
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, product_name, active, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'pareamento manual', ?, ?)
    ON CONFLICT(sku) DO UPDATE SET meli_item_id=excluded.meli_item_id, meli_variation_id=excluded.meli_variation_id,
      shopee_item_id=excluded.shopee_item_id, shopee_model_id=excluded.shopee_model_id,
      product_name=COALESCE(excluded.product_name, mappings.product_name), updated_at=excluded.updated_at
  `).bind(canonicalSku, meliRow.item_id, meliRow.variation_id || null, shopeeRow.item_id, shopeeRow.variation_id || null, name, now, now).run();

  // Marcar ambos como resolvidos
  await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id IN (?,?)`).bind(meli_unmapped_id, shopee_unmapped_id).run();

  return json({ ok: true, sku: canonicalSku });
});

// ============= Diagnóstico GitHub Actions =============
add('GET', '/api/test-github', async (_req, env) => {
  const token = (env as any).GITHUB_TOKEN;
  const repo  = (env as any).GITHUB_REPO || 'wengcarlos005/stock-sync-inicial';
  if (!token) return json({ error: 'GITHUB_TOKEN não configurado' }, 500);

  // 1. Testa autenticação
  const meRes = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'stock-sync-worker' },
  });
  const meText = await meRes.text();

  // 2. Testa acesso ao workflow específico
  const wfRes = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/282879355`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'stock-sync-worker' },
  });
  const wfText = await wfRes.text();

  return json({
    token_prefix: token.slice(0, 10) + '...',
    me_status: meRes.status,
    me_body: meText.slice(0, 200),
    workflow_status: wfRes.status,
    workflow_body: wfText.slice(0, 300),
  });
});

// ============= Diagnóstico MAC API =============
add('GET', '/api/test-mac', async (_req, env) => {
  const url = env.MAC_URL;
  const key = env.MAC_API_KEY;
  const body = JSON.stringify({ action: 'shopee_list_items', params: { page_size: 5, offset: 0 } });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body,
    });
    const text = await res.text();
    return json({
      status: res.status,
      ok: res.ok,
      headers: Object.fromEntries(res.headers.entries()),
      body: text.slice(0, 500),
      key_prefix: key ? key.slice(0, 12) + '...' : 'MISSING',
      url,
    });
  } catch (e: any) {
    return json({ error: String(e.message), key_prefix: key ? key.slice(0, 12) + '...' : 'MISSING' }, 500);
  }
});

// ============= Refresh variations: sincroniza unmapped/mappings com Shopee real =============
// Deleta variações "fantasma" (existem no DB mas não no Shopee) e atualiza nomes.
add('POST', '/api/refresh-variations/:item_id', async (_req, env, params) => {
  const itemId = Number(params.item_id);
  if (!itemId) return json({ error: 'invalid item_id' }, 400);

  // Descobre qual Shopee account é dono desse item (via mapping ou unmapped)
  // SQLite exige LIMIT só DEPOIS do UNION inteiro, não em cada SELECT
  const accountRow = await env.DB.prepare(
    `SELECT shopee_account_id FROM (
       SELECT shopee_account_id FROM mappings WHERE shopee_item_id=? AND shopee_account_id IS NOT NULL
       UNION
       SELECT shopee_account_id FROM unmapped WHERE platform='shopee' AND item_id=? AND shopee_account_id IS NOT NULL
     ) LIMIT 1`
  ).bind(String(itemId), String(itemId)).first<any>();
  const shopId = accountRow?.shopee_account_id || undefined;

  const mac = await import('./mac');
  const item: any = await mac.shopeeGetItem(env, itemId, shopId);
  if (!item) return json({ error: 'item not found on Shopee' }, 404);

  const itemName = String(item.item_name || '');
  const liveModelIds = new Set<string>();
  const modelNameById = new Map<string, string>();

  if (item.has_model) {
    const { models, tierVariation } = await mac.shopeeGetModelsFull(env, itemId, shopId);
    for (const m of models) {
      liveModelIds.add(String(m.model_id));
      const name = mac.buildShopeeModelName(m, tierVariation);
      if (name) modelNameById.set(String(m.model_id), name);
    }
  }

  // 1. Limpa unmapped — dedup, fantasmas, nomes
  let phantomsCleaned = 0, duplicatesCleaned = 0, namesUpdated = 0;
  const unmappedRows = await env.DB.prepare(`SELECT * FROM unmapped WHERE platform='shopee' AND item_id=? AND resolved=0 ORDER BY id ASC`).bind(String(itemId)).all();
  // Agrupa por variation_id pra detectar duplicatas
  const byVariation = new Map<string, any[]>();
  for (const row of unmappedRows.results as any[]) {
    const k = String(row.variation_id || '');
    if (!byVariation.has(k)) byVariation.set(k, []);
    byVariation.get(k)!.push(row);
  }
  for (const [modelId, rows] of byVariation) {
    // Mantém só o primeiro (menor id) — resto vira duplicata
    const [keep, ...dupes] = rows;
    for (const dup of dupes) {
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(dup.id).run();
      duplicatesCleaned++;
    }
    // Agora decide se o "keep" é válido
    let isPhantom = false;
    if (item.has_model) {
      // Tem variações na Shopee: variation_id precisa estar na lista live
      if (!modelId || !liveModelIds.has(modelId)) isPhantom = true;
    } else {
      // Sem variações na Shopee: só variation_id null é válido
      if (modelId) isPhantom = true;
    }
    if (isPhantom) {
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(keep.id).run();
      phantomsCleaned++;
    } else {
      // Atualiza nome com dado live
      const modelName = modelId ? modelNameById.get(modelId) : null;
      const newName = item.has_model
        ? (modelName ? itemName + ' - ' + modelName : keep.product_name)
        : itemName;
      if (newName && newName !== keep.product_name) {
        await env.DB.prepare(`UPDATE unmapped SET product_name=? WHERE id=?`).bind(newName, keep.id).run();
        namesUpdated++;
      }
    }
  }

  // 2. Atualiza nomes em mappings (não deleta — pode ter ML pareado válido)
  let mappingsUpdated = 0;
  const mappingRows = await env.DB.prepare(`SELECT * FROM mappings WHERE shopee_item_id=?`).bind(String(itemId)).all();
  for (const row of mappingRows.results as any[]) {
    const modelId = String(row.shopee_model_id || '');
    let newName: string | null = null;
    if (item.has_model && modelId) {
      const modelName = modelNameById.get(modelId);
      if (modelName) newName = itemName + ' - ' + modelName;
    } else if (!item.has_model) {
      newName = itemName;
    }
    if (newName && newName !== row.product_name) {
      await env.DB.prepare(`UPDATE mappings SET product_name=? WHERE sku=?`).bind(newName, row.sku).run();
      mappingsUpdated++;
    }
  }

  // ===== 3b. Dedup unmapped vs mappings: se já existe um mapping com mesmo
  // (shopee_item_id, shopee_model_id), a unmapped row é redundante → resolved=1
  let unmappedCoveredByMapping = 0;
  const mappingModelIds = new Set<string>();
  for (const m of mappingRows.results as any[]) {
    if (m.shopee_model_id) mappingModelIds.add(String(m.shopee_model_id));
  }
  // Pega unmapped resolved=0 ainda restantes e checa contra mappings
  const stillUnmapped = await env.DB.prepare(`SELECT id, variation_id FROM unmapped WHERE platform='shopee' AND item_id=? AND resolved=0`).bind(String(itemId)).all();
  for (const u of stillUnmapped.results as any[]) {
    if (u.variation_id && mappingModelIds.has(String(u.variation_id))) {
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(u.id).run();
      unmappedCoveredByMapping++;
    }
  }

  // ===== 3c. Dedupe mappings duplicados — quando 2+ mappings apontam pra mesma
  // (shopee_item_id, shopee_model_id) variação, mantém o que tem SKU "limpo"
  // (matching SELLER_SKU do ML, ou só dígitos), deleta os demais.
  let duplicateMappingsRemoved = 0;
  const byModel = new Map<string, any[]>();
  for (const m of mappingRows.results as any[]) {
    const k = m.shopee_model_id ? String(m.shopee_model_id) : null;
    if (!k) continue;
    if (!byModel.has(k)) byModel.set(k, []);
    byModel.get(k)!.push(m);
  }
  for (const [, rows] of byModel) {
    if (rows.length < 2) continue;
    // Score: penaliza phantoms/sujos, prioriza fully paired
    const score = (m: any) => {
      let s = 50;
      const sku = String(m.sku || '');
      const notes = String(m.notes || '').toLowerCase();
      // Bônus: paired (tem ambos lados) é o mais valioso
      if (m.meli_item_id && m.shopee_item_id) s += 200;
      // Bônus: SKU limpo
      if (/^\d+$/.test(sku)) s += 50;
      else if (/^MLB\d+$/i.test(sku)) s += 40;
      // Penalidade: SKU sintético (_, MLKIT, Gerar...)
      if (sku.includes('_') || notes.includes('mlkit') || sku.toLowerCase().includes('gerar')) s -= 100;
      // Penalidade: criado por backfill (phantom histórico)
      if (notes.includes('backfill') || notes.includes('órfão') || notes.includes('orfao')) s -= 150;
      return s;
    };
    rows.sort((a, b) => score(b) - score(a)); // melhor primeiro
    const [keep, ...trash] = rows;
    for (const t of trash) {
      // NÃO deletar mais — só desativar pra ficar invisível mas recuperável
      await env.DB.prepare(`UPDATE mappings SET active=0, notes=COALESCE(notes,'') || ' [auto-disabled: duplicate]' WHERE sku=?`).bind(t.sku).run();
      duplicateMappingsRemoved++;
    }
  }

  // Recarrega mappingRows depois das deleções
  const refreshedMappings = await env.DB.prepare(`SELECT * FROM mappings WHERE shopee_item_id=?`).bind(String(itemId)).all();
  (mappingRows as any).results = refreshedMappings.results;

  // ===== 4. Também limpa fantasmas do lado ML pareado a esse anúncio =====
  // Pra cada meli_item_id distinto nos mappings desse shopee, busca ML live,
  // identifica variações que existem de verdade, e marca unmapped/mappings fantasmas como resolved/inativos
  let mlPhantomsCleaned = 0, mlVarFixed = 0;
  const mlItemIds = new Set<string>();
  for (const r of mappingRows.results as any[]) {
    if (r.meli_item_id) mlItemIds.add(r.meli_item_id);
  }

  for (const mlItemId of mlItemIds) {
    try {
      const mlItem: any = await mac.meliGetItem(env, mlItemId);
      if (!mlItem) continue;
      const liveMlVarIds = new Set<string>();
      const skuToRealVarId = new Map<string, string>();
      for (const v of (mlItem.variations || [])) {
        liveMlVarIds.add(String(v.id));
        const sku = (mac.getMeliVariationSku(v) || '').trim().toLowerCase();
        if (sku) skuToRealVarId.set(sku, String(v.id));
      }

      // 4a. Marca unmapped ML fantasmas como resolved (não existem mais na ML)
      const unmappedMlRows = await env.DB.prepare(
        `SELECT id, variation_id, sku FROM unmapped WHERE platform='meli' AND item_id=? AND resolved=0`
      ).bind(mlItemId).all();
      for (const u of unmappedMlRows.results as any[]) {
        const vid = String(u.variation_id || '');
        if (mlItem.variations && mlItem.variations.length > 0) {
          if (!vid || !liveMlVarIds.has(vid)) {
            await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(u.id).run();
            mlPhantomsCleaned++;
          }
        } else {
          if (vid) {
            await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(u.id).run();
            mlPhantomsCleaned++;
          }
        }
      }

      // 4b. Conserta meli_variation_id em mappings (caso esteja SKU em vez do id real)
      for (const m of mappingRows.results as any[]) {
        if (m.meli_item_id !== mlItemId) continue;
        const correctId = skuToRealVarId.get(String(m.sku).toLowerCase());
        if (!correctId) continue;
        if (String(m.meli_variation_id || '') === correctId) continue;
        await env.DB.prepare(`UPDATE mappings SET meli_variation_id=? WHERE sku=?`).bind(correctId, m.sku).run();
        mlVarFixed++;
      }

      // 4c. Marca mappings com meli_item_id+meli_variation_id que NÃO existe mais na ML como inativos
      // (e tira o vínculo ML pra ficar só Shopee — não deleta o mapping em si)
      for (const m of mappingRows.results as any[]) {
        if (m.meli_item_id !== mlItemId) continue;
        if (!mlItem.variations || mlItem.variations.length === 0) continue;
        const vid = String(m.meli_variation_id || '');
        const correctId = skuToRealVarId.get(String(m.sku).toLowerCase());
        // Se variation_id atual não existe E não tem mapeamento por SKU → mapping ML é fantasma
        if (vid && !liveMlVarIds.has(vid) && !correctId) {
          await env.DB.prepare(`UPDATE mappings SET meli_item_id=NULL, meli_variation_id=NULL WHERE sku=?`).bind(m.sku).run();
          mlPhantomsCleaned++;
        }
      }
    } catch { /* ignore ML item errors */ }
  }

  return json({
    ok: true,
    item_id: itemId,
    item_name: itemName,
    has_model: item.has_model,
    live_models: liveModelIds.size,
    duplicates_cleaned: duplicatesCleaned,
    phantoms_cleaned: phantomsCleaned,
    names_updated: namesUpdated,
    mappings_updated: mappingsUpdated,
    ml_phantoms_cleaned: mlPhantomsCleaned,
    ml_variation_ids_fixed: mlVarFixed,
    unmapped_covered_by_mapping: unmappedCoveredByMapping,
    duplicate_mappings_removed: duplicateMappingsRemoved,
  });
});

// ============= Recria variações ML que foram apagadas (usa o template da 1ª variação) =============
add('POST', '/api/recreate-ml-variations/:item_id', async (req, env, params) => {
  const itemId = params.item_id;
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';

  const mac = await import('./mac');
  const item: any = await mac.meliGetItem(env, itemId);
  if (!item) return json({ error: 'item not found on ML' }, 404);

  const existing: any[] = item.variations || [];
  // Se o item virou single-variation (sem variations array), reconstrói a partir dos atributos do item
  // Pega o template direto do item se não tem variations
  let template: any;
  if (existing.length === 0) {
    // Item vem como single-variation. Constrói template do próprio item.
    const itemAttrs = (item.attributes || []);
    const findAttr = (id: string) => itemAttrs.find((a: any) => a.id === id);
    const pieces = findAttr('PIECES_NUMBER');
    const charVer = findAttr('CHARACTER_VERSION');
    if (!pieces || !charVer) {
      return json({ error: 'item não tem PIECES_NUMBER + CHARACTER_VERSION — não dá pra inferir template' }, 400);
    }
    template = {
      attribute_combinations: [
        { id: 'PIECES_NUMBER', name: pieces.name, value_id: pieces.value_id, value_name: pieces.value_name, values: pieces.values, value_type: pieces.value_type },
        { id: 'CHARACTER_VERSION', name: charVer.name, value_id: charVer.value_id, value_name: charVer.value_name, values: charVer.values, value_type: charVer.value_type },
      ],
      price: item.price,
      picture_ids: (item.pictures || []).map((p: any) => p.id).filter(Boolean).slice(0, 1),
    };
    // SKU "existente" é o do próprio item (atributo SELLER_SKU)
    const skuAttr = findAttr('SELLER_SKU');
    const existingSku = skuAttr?.value_name || '';
    // No caso single-variation, "existing" é tratado como a 1ª variação a ser recriada
    existing.push({
      __synthetic: true,
      attribute_combinations: template.attribute_combinations,
      price: template.price,
      picture_ids: template.picture_ids,
      sku: existingSku,
      char_version: charVer.value_name,
    });
  }
  const finalTemplate = template || existing[0];
  const existingSkus = new Set(
    existing.filter((v: any) => !v.__synthetic).map((v: any) => (mac.getMeliVariationSku(v) || '').trim()).filter(Boolean)
  );
  // Inclui o SKU "synthetic" (item single-variation) como existente
  const synthVar = existing.find((v: any) => v.__synthetic);
  if (synthVar?.sku) existingSkus.add(synthVar.sku);

  // Pega mappings desse ML item — só SKUs "limpos" (numéricos puros, exclui artificiais)
  const allMaps = await env.DB.prepare(
    `SELECT sku, product_name FROM mappings WHERE meli_item_id=? AND active=1`
  ).bind(itemId).all();
  const cleanRows = (allMaps.results as any[]).filter(m => {
    const sku = String(m.sku || '');
    if (!sku) return false;
    if (sku.includes('_')) return false; // tipo MLB5369934126_183494095728
    if (sku.toLowerCase().includes('mlkit')) return false;
    if (sku.toLowerCase().includes('gerar')) return false;
    if (sku.startsWith('INB-MC')) return false; // SP-only sem ML real
    return true;
  });
  const mapsR = { results: cleanRows };

  // Helper pra desfazer mojibake
  const fixMojibake = (s: string) => { try { return decodeURIComponent(escape(s)); } catch { return s; } };
  const extractVarName = (raw: string): string => {
    const fixed = fixMojibake(raw);
    const m = [...fixed.matchAll(/ [-–—] /g)].pop();
    if (!m) return '';
    return fixed.slice(m.index! + m[0].length).trim();
  };

  // IDs de fotos a usar (pega TODAS as fotos do item, ML reutiliza referencia)
  const itemPicIds: string[] = (item.pictures || []).map((p: any) => p.id).filter(Boolean);
  // Usa só 1 foto por nova variação (categoria limita total)
  const picForNew = itemPicIds.length > 0 ? [itemPicIds[0]] : (template.picture_ids || []).slice(0, 1);

  const newVariations: any[] = [];
  const skipped: any[] = [];
  for (const m of mapsR.results as any[]) {
    const sku = String(m.sku).trim();
    if (existingSkus.has(sku)) { skipped.push({ sku, reason: 'já existe na ML' }); continue; }
    const variationName = extractVarName(String(m.product_name || ''));
    if (!variationName) { skipped.push({ sku, reason: 'sem nome de variação extraível' }); continue; }

    // Constrói attribute_combinations copiando do template, trocando só CHARACTER_VERSION
    const newAttrCombos = JSON.parse(JSON.stringify(template.attribute_combinations || []));
    let charVerFound = false;
    for (const c of newAttrCombos) {
      if (c.id === 'CHARACTER_VERSION') {
        c.value_id = null;
        c.value_name = variationName;
        if (c.values) c.values = [{ id: null, name: variationName, struct: null }];
        charVerFound = true;
      }
    }
    if (!charVerFound) {
      skipped.push({ sku, reason: 'template sem CHARACTER_VERSION' });
      continue;
    }

    newVariations.push({
      attribute_combinations: newAttrCombos,
      price: template.price,
      picture_ids: picForNew,
      attributes: [{ id: 'SELLER_SKU', value_name: sku }],
      available_quantity: 0,
    });
  }

  if (newVariations.length === 0) {
    return json({ ok: true, message: 'nada pra criar', existing: existing.length, skipped });
  }

  // Payload: mantém existentes (só id pra preservar) + adiciona novas
  // Pra single-variation (sem variations array), também cria a 1ª como nova (synthetic)
  const existingPart = existing
    .filter((v: any) => !v.__synthetic && v.id)
    .map((v: any) => ({ id: v.id }));
  // Se tem synthetic, adiciona ele como nova variação tb (pra item virar variation-based)
  const syntheticAsNew = existing
    .filter((v: any) => v.__synthetic)
    .map((v: any) => ({
      attribute_combinations: v.attribute_combinations,
      price: v.price,
      picture_ids: v.picture_ids,
      attributes: [{ id: 'SELLER_SKU', value_name: v.sku }],
      available_quantity: 0,
    }));
  const fullPayload = {
    variations: [
      ...existingPart,
      ...syntheticAsNew,
      ...newVariations,
    ],
  };

  if (dryRun) {
    return json({
      dry_run: true,
      existing_count: existing.length,
      to_create: newVariations.length,
      skipped,
      payload_preview: fullPayload,
    });
  }

  try {
    const result = await mac.meliRaw(env, 'PUT', `/items/${itemId}`, fullPayload);
    return json({
      ok: true,
      created: newVariations.length,
      skipped,
      ml_response_variations_count: (result?.variations || []).length,
    });
  } catch (e: any) {
    return json({ error: cleanApiError(e.message, 'meli'), attempted: newVariations.length, payload: fullPayload }, 500);
  }
});

// ============= Conserta meli_variation_id armazenado errado em mappings =============
// Discovery antiga gravava o próprio SKU no lugar do variation_id real do ML.
// Esse endpoint busca cada ML item ao vivo, mapeia SELLER_SKU → variation.id real,
// e corrige os mappings.
add('POST', '/api/fix-meli-variation-ids', async (_req, env) => {
  const mac = await import('./mac');
  // Pega mappings com meli_item_id + sku e variation_id "suspeito" (não numérico de até 10 dígitos)
  const rows = await env.DB.prepare(`
    SELECT sku, meli_item_id, meli_variation_id FROM mappings
    WHERE meli_item_id IS NOT NULL AND sku IS NOT NULL AND active=1
  `).all();

  // Agrupa por meli_item_id pra fazer 1 fetch só por item
  const byItem = new Map<string, any[]>();
  for (const r of rows.results as any[]) {
    if (!byItem.has(r.meli_item_id)) byItem.set(r.meli_item_id, []);
    byItem.get(r.meli_item_id)!.push(r);
  }

  let scanned = 0, fixed = 0, errors = 0;
  const errorList: any[] = [];

  for (const [itemId, mappingRows] of byItem) {
    try {
      const item: any = await mac.meliGetItem(env, itemId);
      if (!item) { errors++; continue; }
      // Mapa: SKU normalizado → real ML variation id (numeric string)
      const skuToVarId = new Map<string, string>();
      for (const v of (item.variations || [])) {
        const sku = (mac.getMeliVariationSku(v) || '').trim();
        if (sku && v.id) skuToVarId.set(sku.toLowerCase(), String(v.id));
      }
      // Item sem variações: meli_variation_id deve ser null
      if (!item.variations || item.variations.length === 0) {
        for (const m of mappingRows) {
          if (m.meli_variation_id) {
            await env.DB.prepare(`UPDATE mappings SET meli_variation_id=NULL WHERE sku=?`).bind(m.sku).run();
            fixed++;
          }
          scanned++;
        }
        continue;
      }
      // Procura SKU bate
      for (const m of mappingRows) {
        scanned++;
        const correctId = skuToVarId.get(String(m.sku).toLowerCase());
        if (!correctId) continue; // SKU não encontrado nas variações ML
        if (String(m.meli_variation_id || '') === correctId) continue; // já tá certo
        await env.DB.prepare(`UPDATE mappings SET meli_variation_id=? WHERE sku=?`).bind(correctId, m.sku).run();
        fixed++;
      }
    } catch (e: any) {
      errors++;
      if (errorList.length < 10) errorList.push({ item_id: itemId, error: String(e.message) });
    }
  }

  return json({
    ok: true,
    items_checked: byItem.size,
    mappings_scanned: scanned,
    mappings_fixed: fixed,
    errors,
    error_sample: errorList,
  });
});

// ============= Completa mappings parciais (só ML ou só Shopee) usando unmapped do outro lado =============
add('POST', '/api/complete-partial-mappings', async (_req, env) => {
  const [spUnm, mlUnm, partialMaps] = await Promise.all([
    env.DB.prepare(`SELECT id, sku, item_id, variation_id, product_name FROM unmapped WHERE platform='shopee' AND resolved=0 AND sku IS NOT NULL AND sku != ''`).all(),
    env.DB.prepare(`SELECT id, sku, item_id, variation_id, product_name FROM unmapped WHERE platform='meli' AND resolved=0 AND sku IS NOT NULL AND sku != ''`).all(),
    env.DB.prepare(`SELECT sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, product_name FROM mappings WHERE active=1 AND (shopee_item_id IS NULL OR meli_item_id IS NULL)`).all(),
  ]);

  const norm = (s: any) => String(s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const candidateKeys = (s: any): string[] => {
    const keys = new Set<string>();
    const raw = String(s || '').trim();
    if (!raw) return [];
    keys.add(norm(raw));
    const lastUnd = raw.lastIndexOf('_');
    if (lastUnd >= 0 && lastUnd < raw.length - 1) keys.add(norm(raw.slice(lastUnd + 1)));
    const firstUnd = raw.indexOf('_');
    if (firstUnd > 0) keys.add(norm(raw.slice(0, firstUnd)));
    for (const seg of raw.split(/[_\-\s]+/)) {
      const n = norm(seg);
      if (n && n.length >= 6) keys.add(n);
    }
    return Array.from(keys).filter(Boolean);
  };

  // Para mappings só com ML → procura Shopee unmapped que case via padrão
  let mlOnlyFilled = 0;
  for (const m of partialMaps.results as any[]) {
    if (!m.meli_item_id || m.shopee_item_id) continue;
    const mapKeys = candidateKeys(m.sku);
    if (mapKeys.length === 0) continue;
    // Procura Shopee unmapped com SKU candidato igual
    let found: any = null;
    for (const s of spUnm.results as any[]) {
      const spKeys = candidateKeys(s.sku);
      if (spKeys.some(k => mapKeys.includes(k))) { found = s; break; }
    }
    if (!found) continue;
    await env.DB.prepare(`UPDATE mappings SET shopee_item_id=?, shopee_model_id=?, updated_at=? WHERE sku=?`)
      .bind(found.item_id, found.variation_id || null, Date.now(), m.sku).run();
    await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(found.id).run();
    mlOnlyFilled++;
  }

  // Para mappings só com Shopee → procura ML unmapped que case
  let spOnlyFilled = 0;
  for (const m of partialMaps.results as any[]) {
    if (!m.shopee_item_id || m.meli_item_id) continue;
    const mapKeys = candidateKeys(m.sku);
    if (mapKeys.length === 0) continue;
    let found: any = null;
    for (const u of mlUnm.results as any[]) {
      const uKeys = candidateKeys(u.sku);
      if (uKeys.some(k => mapKeys.includes(k))) { found = u; break; }
    }
    if (!found) continue;
    await env.DB.prepare(`UPDATE mappings SET meli_item_id=?, meli_variation_id=?, updated_at=? WHERE sku=?`)
      .bind(found.item_id, found.variation_id || null, Date.now(), m.sku).run();
    await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(found.id).run();
    spOnlyFilled++;
  }

  // === 3. Merge entre 2 mappings parciais com SKU candidato overlap ===
  // Caso clássico: mapping A = só ML com sku synth "MLB123_ABC"; mapping B = só Shopee com sku "ABC".
  // Move dados Shopee de B pra A (ou vice-versa) e desativa o duplicado.
  const onlyMl = (partialMaps.results as any[]).filter(m => m.meli_item_id && !m.shopee_item_id);
  const onlySp = (partialMaps.results as any[]).filter(m => m.shopee_item_id && !m.meli_item_id);
  let mappingPairsMerged = 0;
  const usedSpSkus = new Set<string>();
  for (const ml of onlyMl) {
    const mlKeys = candidateKeys(ml.sku);
    if (mlKeys.length === 0) continue;
    let match: any = null;
    for (const sp of onlySp) {
      if (usedSpSkus.has(sp.sku)) continue;
      const spKeys = candidateKeys(sp.sku);
      if (spKeys.some(k => mlKeys.includes(k))) { match = sp; break; }
    }
    if (!match) continue;
    // Decide SKU "vencedor": mais limpo (numérico puro vence)
    const isClean = (s: string) => /^\d+$/.test(s);
    const winnerSku = isClean(String(match.sku)) ? match.sku : (isClean(String(ml.sku)) ? ml.sku : ml.sku);
    const loserSku = winnerSku === match.sku ? ml.sku : match.sku;
    // Completa o "winner" com dados do outro lado
    if (winnerSku === ml.sku) {
      // ML é winner — adiciona Shopee
      await env.DB.prepare(`UPDATE mappings SET shopee_item_id=?, shopee_model_id=?, updated_at=? WHERE sku=?`)
        .bind(match.shopee_item_id, match.shopee_model_id || null, Date.now(), ml.sku).run();
    } else {
      // Shopee (winnerSku=match.sku) — adiciona ML
      await env.DB.prepare(`UPDATE mappings SET meli_item_id=?, meli_variation_id=?, updated_at=? WHERE sku=?`)
        .bind(ml.meli_item_id, ml.meli_variation_id || null, Date.now(), match.sku).run();
    }
    // Desativa o loser (não deleta pra preservar histórico/state FK)
    await env.DB.prepare(`UPDATE mappings SET active=0, notes=COALESCE(notes,'') || ' [merged-into ' || ? || ']' WHERE sku=?`)
      .bind(winnerSku, loserSku).run();
    usedSpSkus.add(match.sku);
    mappingPairsMerged++;
  }

  // === 4. Desativa mappings com SKU "sujo" (synth tipo MLB123_ABC, MLKIT_, "Gerar...")
  // quando já existe outro mapping ATIVO com mesmo (meli_item_id, meli_variation_id)
  // OU (shopee_item_id, shopee_model_id). Mantém o de SKU limpo.
  const allActive = (await env.DB.prepare(`SELECT sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id FROM mappings WHERE active=1`).all()).results as any[];
  const isDirty = (sku: string) => {
    if (/^\d+$/.test(sku)) return false;  // numérico puro = limpo
    if (/^MLB\d+$/i.test(sku)) return false; // MLB+digits = limpo
    if (sku.includes('_') || /MLKIT|GERAR|AUTOMATICAMENTE/i.test(sku)) return true;
    return false;
  };
  let dirtyDeactivated = 0;
  for (const m of allActive) {
    if (!isDirty(m.sku)) continue;
    // Procura outro mapping ATIVO com mesma variação ML ou Shopee mas SKU limpo
    const cleanSibling = allActive.find(o => {
      if (o.sku === m.sku || isDirty(o.sku)) return false;
      if (m.meli_item_id && m.meli_variation_id && o.meli_item_id === m.meli_item_id && o.meli_variation_id === m.meli_variation_id) return true;
      if (m.shopee_item_id && m.shopee_model_id && o.shopee_item_id === m.shopee_item_id && o.shopee_model_id === m.shopee_model_id) return true;
      return false;
    });
    if (!cleanSibling) continue;
    await env.DB.prepare(`UPDATE mappings SET active=0, notes=COALESCE(notes,'') || ' [auto-disabled: duplicate of ' || ? || ']' WHERE sku=?`)
      .bind(cleanSibling.sku, m.sku).run();
    dirtyDeactivated++;
  }

  return json({
    ok: true,
    ml_only_filled_with_shopee: mlOnlyFilled,
    shopee_only_filled_with_ml: spOnlyFilled,
    partial_mapping_pairs_merged: mappingPairsMerged,
    dirty_sku_duplicates_deactivated: dirtyDeactivated,
  });
});

// ============= Super-pair: roda todo o pipeline de pareamento em sequência =============
// 1. match-by-sku-now (unmapped × unmapped via padrão)
// 2. complete-partial-mappings (mapping parcial × unmapped, merge dirty SKU)
// 3. smart-pair-ml pra CADA ML item em mappings (fetch live, pareia variações novas com Shopee)
add('POST', '/api/super-pair', async (_req, env) => {
  const mac = await import('./mac');
  const result: any = { match_sku: null, complete_partial: null, smart_pair_per_ml: [] };

  // 1. match-by-sku-now (chama internamente)
  try {
    const req1 = new Request('https://x/api/match-by-sku-now', { method: 'POST', headers: { 'x-admin-token': env.ADMIN_TOKEN } });
    const r1 = await handleApi(req1, env);
    if (r1) result.match_sku = await r1.json();
  } catch (e: any) { result.match_sku = { error: String(e.message) }; }

  // 2. complete-partial
  try {
    const req2 = new Request('https://x/api/complete-partial-mappings', { method: 'POST', headers: { 'x-admin-token': env.ADMIN_TOKEN } });
    const r2 = await handleApi(req2, env);
    if (r2) result.complete_partial = await r2.json();
  } catch (e: any) { result.complete_partial = { error: String(e.message) }; }

  // 3. smart-pair-ml por ML item — fetch live e pareia variações novas
  // Pega cada meli_item_id distinto dos mappings ativos
  const mlItems = (await env.DB.prepare(`SELECT DISTINCT meli_item_id FROM mappings WHERE active=1 AND meli_item_id IS NOT NULL`).all()).results as any[];

  const norm = (s: any) => String(s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const candidateKeys = (s: any): string[] => {
    const keys = new Set<string>();
    const raw = String(s || '').trim();
    if (!raw) return [];
    keys.add(norm(raw));
    const lastUnd = raw.lastIndexOf('_');
    if (lastUnd >= 0 && lastUnd < raw.length - 1) keys.add(norm(raw.slice(lastUnd + 1)));
    const firstUnd = raw.indexOf('_');
    if (firstUnd > 0) keys.add(norm(raw.slice(0, firstUnd)));
    for (const seg of raw.split(/[_\-\s]+/)) {
      const n = norm(seg);
      if (n && n.length >= 6) keys.add(n);
    }
    return Array.from(keys).filter(Boolean);
  };
  const getMlSku = (v: any): string => {
    if (v.seller_custom_field) return String(v.seller_custom_field).trim();
    const a = (v.attributes || []).find((x: any) => x.id === 'SELLER_SKU');
    return a?.value_name?.toString().trim() || '';
  };

  // Carrega Shopee unmapped + Shopee-only mappings UMA vez (cache em memória)
  const [spUnmR, spMapR] = await Promise.all([
    env.DB.prepare(`SELECT id, sku, item_id, variation_id FROM unmapped WHERE platform='shopee' AND resolved=0 AND sku IS NOT NULL AND sku != ''`).all(),
    env.DB.prepare(`SELECT sku, shopee_item_id, shopee_model_id FROM mappings WHERE active=1 AND shopee_item_id IS NOT NULL AND meli_item_id IS NULL`).all(),
  ]);
  const spByKey = new Map<string, { source: 'unmapped' | 'mapping'; row: any }>();
  for (const u of spUnmR.results as any[]) {
    for (const k of candidateKeys(u.sku)) {
      if (!spByKey.has(k)) spByKey.set(k, { source: 'unmapped', row: u });
    }
  }
  for (const m of spMapR.results as any[]) {
    for (const k of candidateKeys(m.sku)) {
      if (!spByKey.has(k)) spByKey.set(k, { source: 'mapping', row: m });
    }
  }

  let totalNewPairings = 0, totalUpdatedPairings = 0, totalMlSkipped = 0;
  for (const row of mlItems) {
    const mlItemId = row.meli_item_id;
    try {
      const item: any = await mac.meliGetItem(env, mlItemId);
      if (!item || !item.variations || item.variations.length === 0) { totalMlSkipped++; continue; }
      let pairedNew = 0, pairedUpdated = 0;
      const now = Date.now();
      for (const v of item.variations) {
        const mlSku = getMlSku(v);
        if (!mlSku) continue;
        // Procura Shopee match
        let spMatch: { source: 'unmapped' | 'mapping'; row: any } | null = null;
        for (const k of candidateKeys(mlSku)) {
          if (spByKey.has(k)) { spMatch = spByKey.get(k)!; break; }
        }
        if (!spMatch) continue;
        const sp = spMatch.row;
        const shopeeItemId = sp.shopee_item_id || sp.item_id;
        const shopeeModelId = sp.shopee_model_id || sp.variation_id;
        const existing = await env.DB.prepare(`SELECT sku FROM mappings WHERE meli_item_id=? AND meli_variation_id=? AND active=1`)
          .bind(mlItemId, String(v.id)).first<any>();
        if (existing) {
          await env.DB.prepare(`UPDATE mappings SET shopee_item_id=?, shopee_model_id=?, updated_at=? WHERE sku=?`)
            .bind(shopeeItemId, shopeeModelId || null, now, existing.sku).run();
          pairedUpdated++;
        } else {
          try {
            await env.DB.prepare(`
              INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, product_name, active, notes, created_at, updated_at)
              VALUES (?,?,?,?,?,?,1,'super-pair',?,?)
              ON CONFLICT(sku) DO UPDATE SET
                meli_item_id=excluded.meli_item_id, meli_variation_id=excluded.meli_variation_id,
                shopee_item_id=excluded.shopee_item_id, shopee_model_id=excluded.shopee_model_id,
                active=1, updated_at=excluded.updated_at
            `).bind(mlSku, mlItemId, String(v.id), shopeeItemId, shopeeModelId || null, item.title || '', now, now).run();
            pairedNew++;
          } catch {}
        }
        if (spMatch.source === 'unmapped') {
          await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(sp.id).run();
        } else if (spMatch.source === 'mapping' && sp.sku !== mlSku) {
          await env.DB.prepare(`UPDATE mappings SET active=0, notes=COALESCE(notes,'') || ' [merged-into ' || ? || ']' WHERE sku=?`)
            .bind(mlSku, sp.sku).run();
        }
      }
      if (pairedNew + pairedUpdated > 0) {
        result.smart_pair_per_ml.push({ ml_item_id: mlItemId, paired_new: pairedNew, paired_updated: pairedUpdated });
      }
      totalNewPairings += pairedNew;
      totalUpdatedPairings += pairedUpdated;
    } catch (e: any) {
      result.smart_pair_per_ml.push({ ml_item_id: mlItemId, error: String(e.message) });
    }
  }

  // === 4a. Phantom ML variation_ids: pra cada ML item, fetch live e deactivate
  // mappings cujo meli_variation_id NÃO existe mais nas variações live do ML.
  // Cobre casos onde discovery criou mapping pra variação que foi deletada no ML.
  let phantomMlVarsDeactivated = 0;
  const distinctMlIds = (await env.DB.prepare(`SELECT DISTINCT meli_item_id FROM mappings WHERE active=1 AND meli_item_id IS NOT NULL AND meli_variation_id IS NOT NULL`).all()).results as any[];
  for (const r of distinctMlIds) {
    try {
      const item: any = await mac.meliGetItem(env, r.meli_item_id);
      if (!item) continue;
      const liveVarIds = new Set<string>((item.variations || []).map((v: any) => String(v.id)));
      if (liveVarIds.size === 0) continue; // item sem variações: pula (não dá pra distinguir phantoms)
      const ourMaps = (await env.DB.prepare(`SELECT sku, meli_variation_id FROM mappings WHERE active=1 AND meli_item_id=? AND meli_variation_id IS NOT NULL`).bind(r.meli_item_id).all()).results as any[];
      for (const m of ourMaps) {
        if (!liveVarIds.has(String(m.meli_variation_id))) {
          await env.DB.prepare(`UPDATE mappings SET active=0, notes=COALESCE(notes,'') || ' [auto-disabled: ml_variation no longer exists]' WHERE sku=?`).bind(m.sku).run();
          phantomMlVarsDeactivated++;
        }
      }
    } catch { /* ignore */ }
  }

  // === 4. Global dedup: pra cada (shopee_item_id, shopee_model_id), mantém só 1 mapping ativo
  // (o de SKU + paired status melhor). Aplica nos 2 lados (ML também: meli_item_id+variation_id).
  const allMaps = (await env.DB.prepare(`SELECT sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, notes FROM mappings WHERE active=1`).all()).results as any[];
  const scoreMapping = (m: any) => {
    let s = 50;
    const sku = String(m.sku || '');
    const notes = String(m.notes || '').toLowerCase();
    if (m.meli_item_id && m.shopee_item_id) s += 200;
    if (/^\d+$/.test(sku)) s += 50;
    else if (/^MLB\d+$/i.test(sku)) s += 40;
    if (sku.includes('_') || notes.includes('mlkit') || sku.toLowerCase().includes('gerar')) s -= 100;
    if (notes.includes('backfill') || notes.includes('órfão') || notes.includes('orfao')) s -= 150;
    return s;
  };
  const groupKey = (m: any, side: 'sp' | 'ml') => {
    if (side === 'sp' && m.shopee_item_id) return `sp:${m.shopee_item_id}|${m.shopee_model_id || ''}`;
    if (side === 'ml' && m.meli_item_id) return `ml:${m.meli_item_id}|${m.meli_variation_id || ''}`;
    return null;
  };
  const dedupSides = ['sp', 'ml'] as const;
  let globalDedupDeactivated = 0;
  const deactivatedSkus = new Set<string>();
  for (const side of dedupSides) {
    const byKey = new Map<string, any[]>();
    for (const m of allMaps) {
      if (deactivatedSkus.has(m.sku)) continue;
      const k = groupKey(m, side);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(m);
    }
    for (const [, rows] of byKey) {
      if (rows.length < 2) continue;
      rows.sort((a, b) => scoreMapping(b) - scoreMapping(a));
      const [keep, ...trash] = rows;
      for (const t of trash) {
        await env.DB.prepare(`UPDATE mappings SET active=0, notes=COALESCE(notes,'') || ' [auto-disabled: duplicate of ' || ? || ']' WHERE sku=?`)
          .bind(keep.sku, t.sku).run();
        deactivatedSkus.add(t.sku);
        globalDedupDeactivated++;
      }
    }
  }

  // === 5. Dedup por SKU: se múltiplos mappings ativos tem mesma SKU,
  // mantém só o de maior score (paired > partial), desativa o resto.
  // Cobre caso de "TET-BLK-032 em 13 variações ML" — só 1 fica.
  let skuDedupDeactivated = 0;
  const finalMaps = (await env.DB.prepare(`SELECT sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, notes FROM mappings WHERE active=1`).all()).results as any[];
  const bySku = new Map<string, any[]>();
  for (const m of finalMaps) {
    const k = String(m.sku || '').trim();
    if (!k) continue;
    if (!bySku.has(k)) bySku.set(k, []);
    bySku.get(k)!.push(m);
  }
  for (const [, rows] of bySku) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => scoreMapping(b) - scoreMapping(a));
    const [keep, ...trash] = rows;
    for (const t of trash) {
      // Como sku é primary key e ambos tem o mesmo, só tem 1 fisicamente no DB
      // (não deveria acontecer). Mas se acontecer por algum bug, marca o segundo.
      // Esse loop é redundante mas seguro.
    }
  }
  // Nota: SKU é PK em mappings, então não pode ter 2 ativos com mesma SKU literalmente.
  // O caso TET-BLK-032 em 13 mappings significa que SKU é a SAME string mas cada mapping
  // tem rowid diferente. Não é possível com PRIMARY KEY. Logo, o que vemos é:
  // 13 mappings COM SKU TET-BLK-032 + outras chars (whitespace, etc) OU o esquema permite duplicatas.
  // Vou re-checar com TRIM normalizado pra detectar variações:
  const byNormSku = new Map<string, any[]>();
  for (const m of finalMaps) {
    const k = String(m.sku || '').toLowerCase().trim().replace(/\s+/g, '');
    if (!k) continue;
    if (!byNormSku.has(k)) byNormSku.set(k, []);
    byNormSku.get(k)!.push(m);
  }
  for (const [, rows] of byNormSku) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => scoreMapping(b) - scoreMapping(a));
    const [keep, ...trash] = rows;
    for (const t of trash) {
      if (t.sku === keep.sku) continue;
      await env.DB.prepare(`UPDATE mappings SET active=0, notes=COALESCE(notes,'') || ' [auto-disabled: same SKU as ' || ? || ']' WHERE sku=?`)
        .bind(keep.sku, t.sku).run();
      skuDedupDeactivated++;
    }
  }

  return json({
    ok: true,
    ...result,
    summary: {
      ml_items_processed: mlItems.length,
      ml_items_skipped: totalMlSkipped,
      new_pairings: totalNewPairings,
      updated_pairings: totalUpdatedPairings,
      global_duplicates_deactivated: globalDedupDeactivated,
      phantom_ml_vars_deactivated: phantomMlVarsDeactivated,
      sku_dedup_deactivated: skuDedupDeactivated,
    },
  });
});

// ============= Re-pareamento por SKU sem chamar discovery do GitHub =============
// Pega TODOS os unmapped (Shopee + ML) e cria mappings onde SKU bate (normalizado).
add('POST', '/api/match-by-sku-now', async (_req, env) => {
  const [spR, mlR] = await Promise.all([
    env.DB.prepare(`SELECT id, sku, item_id, variation_id, product_name FROM unmapped WHERE platform='shopee' AND resolved=0 AND sku IS NOT NULL AND sku != ''`).all(),
    env.DB.prepare(`SELECT id, sku, item_id, variation_id, product_name FROM unmapped WHERE platform='meli' AND resolved=0 AND sku IS NOT NULL AND sku != ''`).all(),
  ]);

  // Normalização agressiva: lowercase, sem acento, só alfanumérico
  const norm = (s: any) => {
    if (!s) return '';
    return String(s).toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  };
  // Extrai todas as "chaves candidatas" de um SKU. Cobre padrões comuns:
  //   - direto: "ABC123"
  //   - sufixo após underscore: "MLB123_ABC456" → também ["abc456"]
  //   - prefixo antes de underscore: "ABC123_xxx" → também ["abc123"]
  //   - SHOPEE_<sku>: "SHOPEE_22498181987" → ["22498181987"]
  //   - MLKIT_MLB123_ABC: extrai todos os segmentos numéricos/alfanuméricos
  const candidateKeys = (s: any): string[] => {
    const keys = new Set<string>();
    const raw = String(s || '').trim();
    if (!raw) return [];
    keys.add(norm(raw));
    // Sufixo após o ÚLTIMO _
    const lastUnd = raw.lastIndexOf('_');
    if (lastUnd >= 0 && lastUnd < raw.length - 1) keys.add(norm(raw.slice(lastUnd + 1)));
    // Prefixo antes do PRIMEIRO _
    const firstUnd = raw.indexOf('_');
    if (firstUnd > 0) keys.add(norm(raw.slice(0, firstUnd)));
    // Todos os segmentos separados por _
    for (const seg of raw.split(/[_\-\s]+/)) {
      const n = norm(seg);
      if (n && n.length >= 6) keys.add(n);
    }
    return Array.from(keys).filter(Boolean);
  };

  // Index ML: todas as chaves candidatas apontam pra mesma row
  const mlBySku = new Map<string, any>();
  for (const m of mlR.results as any[]) {
    for (const key of candidateKeys(m.sku)) {
      if (!mlBySku.has(key)) mlBySku.set(key, m);
    }
  }

  let matched = 0, errors = 0;
  const now = Date.now();
  const matchedPairs: any[] = [];

  for (const s of spR.results as any[]) {
    const spKeys = candidateKeys(s.sku);
    if (spKeys.length === 0) continue;
    // Tenta cada chave candidata da Shopee contra o index ML
    let m: any = null;
    for (const k of spKeys) {
      if (mlBySku.has(k)) { m = mlBySku.get(k); break; }
    }
    if (!m) continue;

    try {
      await env.DB.prepare(`
        INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, product_name, active, notes, created_at, updated_at)
        VALUES (?,?,?,?,?,?,1,'match-by-sku-now',?,?)
        ON CONFLICT(sku) DO UPDATE SET
          meli_item_id=excluded.meli_item_id,
          meli_variation_id=excluded.meli_variation_id,
          shopee_item_id=excluded.shopee_item_id,
          shopee_model_id=excluded.shopee_model_id,
          updated_at=excluded.updated_at
      `).bind(
        s.sku,
        m.item_id, m.variation_id || null,
        s.item_id, s.variation_id || null,
        s.product_name || m.product_name || '',
        now, now
      ).run();
      await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=? OR id=?`).bind(s.id, m.id).run();
      matched++;
      if (matchedPairs.length < 30) {
        matchedPairs.push({ sku: s.sku, shopee_item_id: s.item_id, meli_item_id: m.item_id });
      }
    } catch (e: any) {
      errors++;
    }
  }

  return json({
    ok: true,
    matched,
    errors,
    shopee_total: (spR.results as any[]).length,
    meli_total: (mlR.results as any[]).length,
    sample_pairs: matchedPairs,
  });
});

// ============= Batch refresh: atualiza variações de TODOS os anúncios Shopee =============
// Itera por cada shopee_item_id distinto em mappings+unmapped, chama Shopee API live,
// limpa duplicatas/fantasmas e atualiza nomes de variação.
add('POST', '/api/refresh-all-variations', async (_req, env) => {
  // Pega todos os shopee_item_ids únicos (de mappings ativos e unmapped não-resolvidos)
  const ids = await env.DB.prepare(`
    SELECT DISTINCT shopee_item_id AS id FROM mappings WHERE shopee_item_id IS NOT NULL AND active=1
    UNION
    SELECT DISTINCT item_id AS id FROM unmapped WHERE platform='shopee' AND resolved=0
  `).all();
  const itemIds = (ids.results as any[]).map(r => Number(r.id)).filter(n => !isNaN(n));

  let totalDuplicates = 0, totalPhantoms = 0, totalNames = 0, totalMappings = 0, processed = 0;
  const errors: any[] = [];
  for (const itemId of itemIds) {
    try {
      // Reusa a lógica do refresh-variations chamando handlerApi pra essa URL
      const req = new Request(`https://x/api/refresh-variations/${itemId}`, {
        method: 'POST',
        headers: { 'x-admin-token': env.ADMIN_TOKEN },
      });
      const r = await handleApi(req, env);
      if (r) {
        const data: any = await r.json();
        if (data?.ok) {
          totalDuplicates += data.duplicates_cleaned || 0;
          totalPhantoms += data.phantoms_cleaned || 0;
          totalNames += data.names_updated || 0;
          totalMappings += data.mappings_updated || 0;
          processed++;
        } else {
          errors.push({ item_id: itemId, error: data?.error });
        }
      }
    } catch (e: any) {
      errors.push({ item_id: itemId, error: String(e.message) });
    }
  }
  return json({
    ok: true,
    total_items: itemIds.length,
    processed,
    duplicates_cleaned: totalDuplicates,
    phantoms_cleaned: totalPhantoms,
    names_updated: totalNames,
    mappings_updated: totalMappings,
    errors: errors.slice(0, 20),
    error_count: errors.length,
  });
});

// ============= DEBUG: investiga estado de um SKU específico =============
add('GET', '/api/debug/sku/:sku', async (_req, env, params) => {
  const sku = params.sku;
  // 1. Mappings
  const mappingsRow = await env.DB.prepare(`SELECT * FROM mappings WHERE sku=?`).bind(sku).all();
  // 2. Unmapped (qualquer status)
  const unmappedRows = await env.DB.prepare(`SELECT * FROM unmapped WHERE sku=?`).bind(sku).all();
  // 3. State
  const stateRow = await env.DB.prepare(`SELECT * FROM state WHERE sku=?`).bind(sku).first();

  // 4. Live ML: tenta buscar como item_id direto
  let mlLive: any = null;
  if (/^MLB\d+/i.test(sku) || /^\d{8,}$/.test(sku)) {
    const itemId = /^MLB\d+/i.test(sku) ? sku.toUpperCase() : 'MLB' + sku;
    try {
      const mac = await import('./mac');
      const item: any = await mac.meliGetItem(env, itemId);
      if (item) {
        mlLive = {
          id: item.id,
          title: item.title,
          status: item.status,
          available_quantity: item.available_quantity,
          seller_custom_field: item.seller_custom_field,
          item_level_sku: mac.getMeliSku(item),
          variations: (item.variations || []).map((v: any) => ({
            id: v.id,
            sku: mac.getMeliVariationSku(v),
            available_quantity: v.available_quantity,
          })),
        };
      }
    } catch (e: any) { mlLive = { error: e.message }; }
  }

  return json({
    sku,
    mappings: mappingsRow.results,
    unmapped: unmappedRows.results,
    state: stateRow,
    ml_live: mlLive,
  });
});

// ============= DEBUG: compara variações LIVE Shopee vs banco (unmapped + mappings) =============
add('GET', '/api/debug/variations/:item_id', async (_req, env, params) => {
  const itemId = Number(params.item_id);
  if (!itemId) return json({ error: 'item_id inválido' }, 400);

  // 1. Live Shopee
  const r = await fetch(env.MAC_URL, {
    method: 'POST',
    headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'shopee_get_models', params: { item_id: itemId } }),
  });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch {}
  const liveModels = parsed?.response?.model || parsed?.data?.response?.model || [];

  // 2. Unmapped no banco
  const unmappedR = await env.DB.prepare(
    `SELECT sku, variation_id, product_name, resolved FROM unmapped WHERE platform='shopee' AND item_id=? ORDER BY id`
  ).bind(String(itemId)).all();

  // 3. Mappings no banco
  const mappingsR = await env.DB.prepare(
    `SELECT sku, shopee_model_id, meli_item_id, product_name FROM mappings WHERE shopee_item_id=?`
  ).bind(String(itemId)).all();

  // Live models simplificados
  const liveSimple = liveModels.map((m: any) => ({
    model_id: m.model_id,
    model_sku: m.model_sku || null,
    model_name: m.model_name || null,
    stock: m.stock_info?.[0]?.current_stock ?? null,
  }));

  return json({
    item_id: itemId,
    mac_response_status: r.status,
    mac_response_size_bytes: text.length,
    live_count: liveModels.length,
    unmapped_count: unmappedR.results?.length || 0,
    unmapped_resolved_count: (unmappedR.results as any[])?.filter(x => x.resolved === 1).length || 0,
    mappings_count: mappingsR.results?.length || 0,
    live_models: liveSimple,
    db_unmapped: unmappedR.results,
    db_mappings: mappingsR.results,
  });
});

// ============= DEBUG: inspeção crua de produtos via MAC =============
async function macRaw(env: Env, action: string, params: any) {
  const res = await fetch(env.MAC_URL, {
    method: 'POST',
    headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params }),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text, _status: res.status }; }
}

// GET /api/debug/shopee/:id — devolve item + modelos crus
add('GET', '/api/debug/shopee/:id', async (_req, env, params) => {
  const id = Number(params.id);
  const item = await macRaw(env, 'shopee_get_item', { item_id: id });
  const models = await macRaw(env, 'shopee_get_models', { item_id: id });
  return json({ item, models });
});

// GET /api/debug/meli/:id — devolve item ML cru
add('GET', '/api/debug/meli/:id', async (_req, env, params) => {
  const item = await macRaw(env, 'raw', { method: 'GET', path: `/items/${params.id}` });
  return json({ item });
});

// GET /api/debug/meli-search?q=truck — busca anúncios ML por termo
add('GET', '/api/debug/meli-search', async (req, env) => {
  const url = new URL(req.url);
  const q = encodeURIComponent(url.searchParams.get('q') || '');
  const userId = env.MELI_USER_ID;
  const r = await macRaw(env, 'raw', { method: 'GET', path: `/users/${userId}/items/search?q=${q}&limit=10` });
  return json(r);
});

// GET /api/debug/sku-fields — para 5 ML + 5 Shopee aleatórios, lista de quais campos cada
// SKU vem (para entender estrutura real dos dados)
add('GET', '/api/debug/sku-fields', async (_req, env) => {
  const userId = env.MELI_USER_ID;
  const mlSearch: any = await macRaw(env, 'raw', { method: 'GET', path: `/users/${userId}/items/search?limit=5` });
  const mlIds: string[] = mlSearch?.data?.results || mlSearch?.results || [];
  const mlSamples = [];
  for (const id of mlIds.slice(0, 5)) {
    const r: any = await macRaw(env, 'raw', { method: 'GET', path: `/items/${id}` });
    const it = r?.data || r;
    const itemSkuAttr = (it.attributes || []).find((a: any) => a.id === 'SELLER_SKU');
    const vars = (it.variations || []).slice(0, 3).map((v: any) => ({
      id: v.id,
      seller_custom_field: v.seller_custom_field,
      seller_sku: v.seller_sku,
      SELLER_SKU_attr: (v.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name,
      attr_combos: (v.attribute_combinations || []).map((c: any) => c.value_name),
      all_attr_ids: (v.attributes || []).map((a: any) => a.id),
    }));
    mlSamples.push({
      id, title: it.title,
      item_seller_custom_field: it.seller_custom_field,
      item_SELLER_SKU_attr: itemSkuAttr?.value_name,
      variations_count: (it.variations || []).length,
      variations_sample: vars,
    });
  }

  const sp: any = await macRaw(env, 'shopee_list_items', { page_size: 5, offset: 0 });
  const spIds: number[] = (sp?.data?.response?.item || sp?.response?.item || []).map((i: any) => i.item_id);
  const spSamples = [];
  for (const id of spIds.slice(0, 5)) {
    const r: any = await macRaw(env, 'shopee_get_item', { item_id: id });
    const it = (r?.data?.response?.item_list || r?.response?.item_list || [])[0];
    if (!it) continue;
    let models: any[] = [];
    if (it.has_model) {
      const md: any = await macRaw(env, 'shopee_get_models', { item_id: id });
      models = (md?.data?.response?.model || md?.response?.model || []).slice(0, 4).map((m: any) => ({
        model_id: m.model_id, model_sku: m.model_sku, model_name: m.model_name, tier_index: m.tier_index,
      }));
    }
    spSamples.push({
      item_id: id, item_name: it.item_name, item_sku: it.item_sku, has_model: it.has_model,
      tier_variation: it.tier_variation, models,
    });
  }

  return json({ ml: mlSamples, shopee: spSamples });
});

// ============= Reconstroi `changes` a partir de `orders` (popula Movimentações) =============
add('POST', '/api/changes/rebuild', async (_req, env) => {
  await env.DB.prepare(`DELETE FROM changes WHERE trigger='sale_backfill'`).run();

  // Mapa: SKU → existe em mappings? (cache pra evitar query repetida)
  const knownSkus = new Set<string>();
  const mapsRes = await env.DB.prepare(`SELECT sku FROM mappings`).all();
  for (const m of mapsRes.results as any[]) knownSkus.add(m.sku);

  const r = await env.DB.prepare(`SELECT platform, order_id, created_at, items_json FROM orders ORDER BY created_at ASC`).all();
  let inserted = 0, skipped = 0, placeholdersCreated = 0;

  // 1ª passada: coleta SKUs órfãos e cria mappings placeholder (active=0) pra satisfazer FK
  const orphanSkus = new Map<string, { name: string; platform: string; itemId: string; variationId: string | null }>();
  for (const o of r.results as any[]) {
    let items: any[] = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch {}
    for (const it of items) {
      const sku = (it.sku || '').trim();
      if (!sku) continue;
      if (knownSkus.has(sku)) continue;
      if (!orphanSkus.has(sku)) {
        orphanSkus.set(sku, {
          name: it.name || '',
          platform: o.platform,
          itemId: it.item_id || '',
          variationId: it.variation_id || null,
        });
      }
    }
  }

  if (orphanSkus.size) {
    const now = Date.now();
    const orphanStmts: D1PreparedStatement[] = [];
    const orphanStmt = env.DB.prepare(`
      INSERT OR IGNORE INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, product_name, active, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'auto: criado pelo backfill (SKU órfão)', ?, ?)
    `);
    for (const [sku, info] of orphanSkus) {
      const isMl = info.platform === 'meli';
      orphanStmts.push(orphanStmt.bind(
        sku,
        isMl ? info.itemId : null,
        isMl ? info.variationId : null,
        isMl ? null : info.itemId,
        isMl ? null : info.variationId,
        info.name,
        now, now,
      ));
    }
    for (let i = 0; i < orphanStmts.length; i += 100) {
      try {
        await env.DB.batch(orphanStmts.slice(i, i + 100));
        placeholdersCreated += Math.min(100, orphanStmts.length - i);
      } catch {}
    }
    for (const sku of orphanSkus.keys()) knownSkus.add(sku);
  }

  // 2ª passada: insere as movimentações
  const stmts: D1PreparedStatement[] = [];
  const stmt = env.DB.prepare(`
    INSERT INTO changes (ts, sku, source, trigger, meli_stock_before, meli_stock_after, shopee_stock_before, shopee_stock_after, delta, propagated_to, shadow, error)
    VALUES (?, ?, ?, 'sale_backfill', NULL, NULL, NULL, NULL, ?, NULL, 0, NULL)
  `);

  for (const o of r.results as any[]) {
    let items: any[] = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch {}
    for (const it of items) {
      const sku = (it.sku || '').trim();
      if (!sku) { skipped++; continue; }
      if (!knownSkus.has(sku)) { skipped++; continue; }
      const qty = Number(it.qty || 1);
      stmts.push(stmt.bind(o.created_at, sku, o.platform, -qty));
    }
  }

  // Executa em batches de 100
  const BATCH = 100;
  for (let i = 0; i < stmts.length; i += BATCH) {
    const slice = stmts.slice(i, i + BATCH);
    try {
      await env.DB.batch(slice);
      inserted += slice.length;
    } catch (e: any) {
      // Pode falhar se algum tiver FK; ignora o batch inteiro pra não travar
    }
  }

  return json({ ok: true, inserted, skipped, placeholders_created: placeholdersCreated, known_skus: knownSkus.size });
});

// ============= REPROCESS: corrige status ML usando tags via API =============
add('POST', '/api/orders/reprocess-ml-status', async (req, env) => {
  const userId = (env as any).MELI_USER_ID;
  if (!userId) return json({ error: 'MELI_USER_ID não configurado' }, 500);
  const mac = await import('./mac');
  const url = new URL(req.url);
  const maxPages = Math.min(20, Number(url.searchParams.get('pages') || 10)); // até 1000 pedidos

  let fixed = 0, scanned = 0;
  const stmts: D1PreparedStatement[] = [];
  const stmt = env.DB.prepare(`UPDATE orders SET status=? WHERE platform='meli' AND order_id=?`);

  for (let page = 0; page < maxPages; page++) {
    const offset = page * 50;
    const d: any = await macRaw(env, 'raw', {
      method: 'GET',
      path: `/orders/search?seller=${userId}&sort=date_desc&offset=${offset}&limit=50`,
    });
    const results: any[] = (d?.data?.results || d?.results || []);
    if (!results.length) break;
    for (const o of results) {
      scanned++;
      const newStatus = mac.deriveMeliStatus(o);
      stmts.push(stmt.bind(newStatus, String(o.id)));
    }
    if (results.length < 50) break;
  }

  // Batch executa
  for (let i = 0; i < stmts.length; i += 100) {
    const slice = stmts.slice(i, i + 100);
    try {
      const res = await env.DB.batch(slice);
      // conta apenas os que de fato mudaram
      for (const r of res) fixed += (r.meta?.changes ?? 0);
    } catch {}
  }

  return json({ ok: true, scanned, status_updates: fixed });
});

// ============= REPROCESS: atualiza status dos pedidos Shopee (re-fetch live) =============
// Lista pedidos Shopee por cada status real e atualiza o DB.
// Necessário pra pedidos que foram enviados/concluídos depois do backfill inicial.
add('POST', '/api/orders/reprocess-shopee-status', async (req, env) => {
  const url = new URL(req.url);
  const days = Math.min(60, Number(url.searchParams.get('days') || 30));
  const now = Math.floor(Date.now() / 1000);
  const since = now - days * 24 * 3600;
  const ALL_STATUSES = ['UNPAID', 'READY_TO_SHIP', 'PROCESSED', 'RETRY_SHIP', 'SHIPPED', 'COMPLETED', 'IN_CANCEL', 'CANCELLED', 'INVOICE_PENDING'];

  let scanned = 0, fixed = 0;
  const stmt = env.DB.prepare(`UPDATE orders SET status=? WHERE platform='shopee' AND order_id=?`);
  const stmts: D1PreparedStatement[] = [];

  // Janelas de 14 dias (Shopee aceita até 15)
  for (let endTs = now; endTs > since; endTs -= 14 * 24 * 3600) {
    const startTs = Math.max(since, endTs - 14 * 24 * 3600);
    for (const status of ALL_STATUSES) {
      let cursor = '';
      let safety = 0;
      while (safety++ < 20) {
        const params: any = {
          time_range_field: 'create_time',
          time_from: startTs,
          time_to: endTs,
          page_size: 50,
          order_status: status,
        };
        if (cursor) params.cursor = cursor;
        let d: any;
        try { d = await macRaw(env, 'shopee_list_orders', params); } catch { break; }
        const list = d?.data?.response?.order_list || d?.response?.order_list || [];
        for (const o of list) {
          scanned++;
          stmts.push(stmt.bind(status, String(o.order_sn)));
        }
        const more = d?.data?.response?.more || d?.response?.more;
        const next = String(d?.data?.response?.next_cursor || d?.response?.next_cursor || '');
        if (!more || !next || next === cursor) break;
        cursor = next;
      }
    }
  }

  // Batch executa updates
  for (let i = 0; i < stmts.length; i += 100) {
    const slice = stmts.slice(i, i + 100);
    try {
      const res = await env.DB.batch(slice);
      for (const r of res) fixed += (r.meta?.changes ?? 0);
    } catch {}
  }

  return json({ ok: true, scanned, status_updates: fixed, days });
});

// ============= REPROCESS: refaz Shopee buscando buyer_username em pedidos com **** =============
add('POST', '/api/orders/refresh-shopee-buyers', async (_req, env) => {
  const rows = await env.DB.prepare(`
    SELECT order_id FROM orders
    WHERE platform='shopee' AND (buyer='****' OR buyer='' OR buyer IS NULL OR buyer='(comprador Shopee)')
    ORDER BY created_at DESC LIMIT 200
  `).all();
  const snList = (rows.results as any[]).map(r => r.order_id);
  if (!snList.length) return json({ ok: true, fixed: 0, note: 'nada para corrigir' });

  let fixed = 0;
  // Buscar detalhes em batches de 50
  for (let i = 0; i < snList.length; i += 50) {
    const batch = snList.slice(i, i + 50);
    const dd: any = await macRaw(env, 'shopee_get_order_detail', {
      order_sn_list: batch,
      response_optional_fields: 'buyer_username,recipient_address',
    });
    const list = dd?.data?.response?.order_list || dd?.response?.order_list || [];
    for (const o of list) {
      const recipName = o.recipient_address?.name;
      const name = (recipName && !String(recipName).includes('*'))
        ? recipName
        : (o.buyer_username || '');
      if (!name) continue;
      const r = await env.DB.prepare(`UPDATE orders SET buyer=? WHERE platform='shopee' AND order_id=?`)
        .bind(name, String(o.order_sn)).run();
      if ((r.meta.changes ?? 0) > 0) fixed++;
    }
  }
  return json({ ok: true, fixed, processed: snList.length });
});

// ============= BACKFILL: histórico de pedidos (ML + Shopee) =============
add('POST', '/api/orders/backfill', async (req, env) => {
  const url = new URL(req.url);
  const days = Math.min(730, Number(url.searchParams.get('days') || 365));
  const fromDays = Math.max(0, Number(url.searchParams.get('from_days') || 0));   // pular X dias recentes (já importados)
  const now = Date.now();
  const cutoffMs = now - days * 24 * 60 * 60 * 1000;
  const startMs = now - fromDays * 24 * 60 * 60 * 1000; // limite superior

  let mlInserted = 0, mlScanned = 0;
  let spInserted = 0, spScanned = 0;
  const errors: string[] = [];

  // ── ML: pagina /orders/search ─────────────────────────────────
  const userId = (env as any).MELI_USER_ID;
  if (userId) {
    let offset = 0;
    const limit = 50;
    let stop = false;
    while (offset < 10000 && !stop) {
      try {
        const d: any = await macRaw(env, 'raw', {
          method: 'GET',
          path: `/orders/search?seller=${userId}&sort=date_desc&offset=${offset}&limit=${limit}`,
        });
        const results: any[] = (d?.data?.results || d?.results || []);
        if (!results.length) break;
        for (const o of results) {
          mlScanned++;
          const created = new Date(o.date_created || o.last_updated).getTime();
          if (created < cutoffMs) { stop = true; continue; }

          // Versão "lite" — usa só dados do search (sem buscar /orders/{id} pra cada um)
          const items = (o.order_items || []).map((oi: any) => {
            const variationAttrs = (oi.item?.variation_attributes || [])
              .map((a: any) => {
                const v = a.value_name || a.value_id;
                return a.name && v ? `${a.name}: ${v}` : v;
              })
              .filter(Boolean)
              .join(' | ');
            return {
              item_id: String(oi.item?.id || ''),
              variation_id: oi.item?.variation_id ? String(oi.item.variation_id) : null,
              qty: Number(oi.quantity || 1),
              name: oi.item?.title || '',
              variation: variationAttrs || null,
              image: null,
              sku: oi.item?.seller_sku || oi.item?.seller_custom_field || '',
            };
          });
          const buyerName = [o.buyer?.first_name, o.buyer?.last_name].filter(Boolean).join(' ').trim()
            || o.buyer?.nickname || '';
          // Usa deriveMeliStatus pra considerar tags (shipped/delivered/ready_to_ship)
          const macMod = await import('./mac');
          const derivedStatus = macMod.deriveMeliStatus(o);
          const r = await env.DB.prepare(`
            INSERT OR IGNORE INTO orders (platform, order_id, status, buyer, created_at, items_json, processed_at, pack_id)
            VALUES (?,?,?,?,?,?,?,?)
          `).bind('meli', String(o.id), derivedStatus, buyerName, created,
                   JSON.stringify(items), Date.now(),
                   o.pack_id ? String(o.pack_id) : null).run();
          if ((r.meta.changes ?? 0) > 0) mlInserted++;
        }
        if (results.length < limit) break;
        offset += limit;
      } catch (e: any) {
        errors.push(`ML offset=${offset}: ${e.message}`);
        break;
      }
    }
  }

  // ── Shopee: janelas de 14 dias (limite da API) + múltiplos status ─
  const SHOPEE_STATUSES = ['COMPLETED', 'SHIPPED', 'READY_TO_SHIP'];
  const startCutoffSec = Math.floor(cutoffMs / 1000);
  let endTs = Math.floor(startMs / 1000);
  while (endTs > startCutoffSec) {
    const startTs = Math.max(startCutoffSec, endTs - 14 * 24 * 3600);
    try {
      let snList: string[] = [];
      // Itera todos os status (cada status, paginar)
      for (const status of SHOPEE_STATUSES) {
        let cursor = '';
        let safetyLoop = 0;
        while (safetyLoop++ < 20) {
          const d: any = await macRaw(env, 'shopee_list_orders', {
            time_range_field: 'create_time',
            time_from: startTs,
            time_to: endTs,
            page_size: 50,
            order_status: status,
            cursor,
          });
          const orders = d?.data?.response?.order_list || d?.response?.order_list || [];
          for (const o of orders) snList.push(o.order_sn);
          const more = d?.data?.response?.more || d?.response?.more;
          const next = String(d?.data?.response?.next_cursor || d?.response?.next_cursor || '');
          if (!more || !next || next === cursor) break;
          cursor = next;
        }
      }
      // Deduplica
      snList = Array.from(new Set(snList));

      if (snList.length) {
        // Detalhe em batches de 50
        for (let i = 0; i < snList.length; i += 50) {
          const batch = snList.slice(i, i + 50);
          const dd: any = await macRaw(env, 'shopee_get_order_detail', {
            order_sn_list: batch,
            response_optional_fields: 'buyer_username,item_list,recipient_address',
          });
          const list = dd?.data?.response?.order_list || dd?.response?.order_list || [];
          for (const o of list) {
            spScanned++;
            const items = (o.item_list || []).map((it: any) => ({
              item_id: String(it.item_id || ''),
              variation_id: it.model_id ? String(it.model_id) : null,
              qty: Number(it.model_quantity_purchased || 1),
              name: it.item_name || '',
              variation: it.model_name || null,
              image: it.image_info?.image_url || null,
              sku: it.model_sku || it.item_sku || '',
            }));
            const buyerName = o.recipient_address?.name || o.buyer_username || '';
            const created = (o.create_time || 0) * 1000;
            const r = await env.DB.prepare(`
              INSERT OR IGNORE INTO orders (platform, order_id, status, buyer, created_at, items_json, processed_at, pack_id)
              VALUES (?,?,?,?,?,?,?,?)
            `).bind('shopee', String(o.order_sn), o.order_status || '', buyerName, created,
                     JSON.stringify(items), Date.now(), null).run();
            if ((r.meta.changes ?? 0) > 0) spInserted++;
          }
        }
      }
    } catch (e: any) {
      errors.push(`Shopee ${new Date(startTs * 1000).toISOString().slice(0, 10)}: ${e.message}`);
    }
    endTs = startTs - 1;
  }

  return json({
    ok: true,
    days,
    ml: { scanned: mlScanned, inserted: mlInserted },
    shopee: { scanned: spScanned, inserted: spInserted },
    errors: errors.slice(0, 10),
  });
});

// ============= MIGRATION: adiciona pack_id (idempotente) =============
// ============= Marketplace Accounts (multi-loja) =============
// Cria tabela se não existir + sincroniza com MAC
add('POST', '/api/accounts/migrate', async (_req, env) => {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS marketplace_accounts (
      external_id TEXT PRIMARY KEY,
      marketplace TEXT NOT NULL,
      label TEXT,
      connected_at INTEGER,
      expires_at INTEGER,
      is_active INTEGER DEFAULT 1,
      last_synced_at INTEGER
    )
  `).run();
  return json({ ok: true });
});

// Migração: adiciona shopee_account_id em mappings/unmapped/orders
// + popula com a conta atual (puxa do MAC) pra todos os rows existentes
add('POST', '/api/accounts/migrate-columns', async (_req, env) => {
  const results: any = { added: [], skipped: [] };
  const cols: Array<{ table: string; col: string; type: string }> = [
    { table: 'mappings', col: 'shopee_account_id', type: 'TEXT' },
    { table: 'unmapped', col: 'shopee_account_id', type: 'TEXT' },
    { table: 'orders',   col: 'shopee_account_id', type: 'TEXT' },
    // extra_shopee_stores: JSON com [{item_id, model_id, account_id}] pras outras lojas Shopee que compartilham o mesmo SKU
    { table: 'mappings', col: 'extra_shopee_stores', type: 'TEXT' },
  ];
  for (const c of cols) {
    try {
      await env.DB.prepare(`ALTER TABLE ${c.table} ADD COLUMN ${c.col} ${c.type}`).run();
      results.added.push(`${c.table}.${c.col}`);
    } catch (e: any) {
      results.skipped.push(`${c.table}.${c.col} (já existe ou erro: ${String(e.message).slice(0, 100)})`);
    }
  }
  // Backfill: pega conta Shopee atual do MAC e seta nos rows existentes que tem shopee_item_id
  try {
    const r = await fetch(env.MAC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_accounts', params: {} }),
    });
    const data: any = await r.json();
    const currentShop = data?.data?.current?.shopId || data?.current?.shopId;
    if (currentShop) {
      const r1 = await env.DB.prepare(`UPDATE mappings SET shopee_account_id=? WHERE shopee_item_id IS NOT NULL AND shopee_account_id IS NULL`).bind(currentShop).run();
      const r2 = await env.DB.prepare(`UPDATE unmapped SET shopee_account_id=? WHERE platform='shopee' AND shopee_account_id IS NULL`).bind(currentShop).run();
      const r3 = await env.DB.prepare(`UPDATE orders SET shopee_account_id=? WHERE platform='shopee' AND shopee_account_id IS NULL`).bind(currentShop).run();
      results.backfilled = {
        shop_id: currentShop,
        mappings: r1.meta.changes ?? 0,
        unmapped: r2.meta.changes ?? 0,
        orders: r3.meta.changes ?? 0,
      };
    }
  } catch (e: any) {
    results.backfill_error = String(e.message);
  }
  return json({ ok: true, ...results });
});

// Sincroniza contas com MAC (puxa do list_accounts)
add('POST', '/api/accounts/sync', async (_req, env) => {
  const r = await fetch(env.MAC_URL, {
    method: 'POST',
    headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list_accounts', params: {} }),
  });
  const data: any = await r.json();
  const accounts = data?.data?.accounts || data?.accounts || [];
  let inserted = 0, updated = 0;
  const now = Date.now();
  for (const a of accounts) {
    const expiresAt = a.expires_at ? new Date(a.expires_at).getTime() : null;
    const res = await env.DB.prepare(`
      INSERT INTO marketplace_accounts (external_id, marketplace, label, connected_at, expires_at, is_active, last_synced_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(external_id) DO UPDATE SET
        marketplace = excluded.marketplace,
        expires_at = excluded.expires_at,
        is_active = excluded.is_active,
        last_synced_at = excluded.last_synced_at
    `).bind(String(a.external_id), a.marketplace, a.label || null, now, expiresAt, a.connected ? 1 : 0, now).run();
    if ((res.meta.changes ?? 0) > 0) {
      if ((res.meta as any).last_row_id) inserted++; else updated++;
    }
  }
  return json({ ok: true, total: accounts.length, accounts: accounts.map((a: any) => ({ external_id: a.external_id, marketplace: a.marketplace, label: a.label })) });
});

// Lista contas locais
add('GET', '/api/accounts', async (_req, env) => {
  const r = await env.DB.prepare(`SELECT * FROM marketplace_accounts ORDER BY marketplace, external_id`).all();
  return json({ items: r.results });
});

// Atualiza label de uma conta
add('PUT', '/api/accounts/:id/label', async (req, env, params) => {
  const body = await req.json() as { label: string };
  if (typeof body.label !== 'string') return json({ error: 'label required' }, 400);
  await env.DB.prepare(`UPDATE marketplace_accounts SET label=? WHERE external_id=?`).bind(body.label.trim() || null, params.id).run();
  return json({ ok: true });
});

add('POST', '/api/migrate/pack-id', async (_req, env) => {
  try {
    await env.DB.prepare(`ALTER TABLE orders ADD COLUMN pack_id TEXT`).run();
    return json({ ok: true, added: true });
  } catch (e: any) {
    // já existe? ignora
    return json({ ok: true, added: false, note: String(e.message) });
  }
});

// ============= DEBUG: inspeciona pedido Shopee cru =============
add('GET', '/api/debug/shopee-order/:sn', async (_req, env, params) => {
  const d = await macRaw(env, 'shopee_get_order_detail', {
    order_sn_list: [params.sn],
    response_optional_fields: 'buyer_username,buyer_user_id,item_list,recipient_address,total_amount,actual_shipping_fee,note,update_time,pay_time,ship_by_date,days_to_ship',
  });
  return json(d);
});

// ============= DEBUG: testa Shopee order_list raw =============
add('GET', '/api/debug/shopee-orders', async (_req, env) => {
  const now = Math.floor(Date.now() / 1000);
  const r = await macRaw(env, 'shopee_list_orders', {
    time_range_field: 'create_time',
    time_from: now - 14 * 24 * 3600,
    time_to: now,
    page_size: 20,
  });
  return json(r);
});

// ============= DEBUG: variações ML com todos campos =============
add('GET', '/api/debug/meli-variations/:id', async (_req, env, params) => {
  // Pega item raw + tenta endpoint específico de variations
  const item: any = await macRaw(env, 'raw', { method: 'GET', path: `/items/${params.id}?include_attributes=all` });
  const result: any = { item_attributes: (item?.data || item)?.attributes };
  // Tenta puxar 1 variação individual pelo endpoint específico
  const vars = (item?.data || item)?.variations || [];
  if (vars[0]) {
    try {
      const v1: any = await macRaw(env, 'raw', { method: 'GET', path: `/items/${params.id}/variations/${vars[0].id}` });
      result.variation_detail_first = v1?.data || v1;
    } catch (e: any) { result.variation_detail_error = e.message; }
    result.variation_summary = vars.map((v: any) => ({
      id: v.id,
      seller_custom_field: v.seller_custom_field,
      attributes: v.attributes,
      attribute_combinations_brief: (v.attribute_combinations || []).map((c: any) => c.value_name),
      user_product_id: v.user_product_id,
    }));
  }
  // Tenta user_products (onde o ML armazena SKU no novo modelo)
  if (vars[0]?.user_product_id) {
    try {
      const up: any = await macRaw(env, 'raw', { method: 'GET', path: `/user-products/${vars[0].user_product_id}` });
      result.user_product_first = up?.data || up;
    } catch (e: any) { result.user_product_error = e.message; }
  }
  return json(result);
});

// ============= DEBUG: simular discover-local.js (raw call + pickSku) =============
add('GET', '/api/debug/discover-sim/:id', async (_req, env, params) => {
  // Pega item DUAS vezes via call() — mesma função que discover-local.js usa
  const mac = await import('./mac');
  const withAttrs: any = await mac.call(env, 'raw', { method: 'GET', path: `/items/${params.id}?include_attributes=all` });
  const noAttrs: any  = await mac.call(env, 'raw', { method: 'GET', path: `/items/${params.id}` });

  function pickV(v: any): { sku: string | null; candidates: any } {
    const candidates = {
      seller_custom_field: v?.seller_custom_field,
      seller_sku: v?.seller_sku,
      attr_value_name: (v?.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name,
      attr_values_0_name: (v?.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.values?.[0]?.name,
    };
    for (const c of Object.values(candidates)) if (c && String(c).trim()) return { sku: String(c).trim(), candidates };
    return { sku: null, candidates };
  }

  function probe(item: any) {
    if (!item) return { error: 'null' };
    return {
      has_variations: !!item.variations?.length,
      variations_count: item.variations?.length || 0,
      first_variation: item.variations?.[0] ? {
        id: item.variations[0].id,
        attributes_count: item.variations[0].attributes?.length || 0,
        attribute_ids: (item.variations[0].attributes || []).map((a: any) => a.id),
        picked: pickV(item.variations[0]),
      } : null,
    };
  }

  return json({
    item_id: params.id,
    with_include_attributes: probe(withAttrs),
    without_include_attributes: probe(noAttrs),
    raw_keys_with: withAttrs ? Object.keys(withAttrs) : null,
    raw_keys_no: noAttrs ? Object.keys(noAttrs) : null,
    raw_with_preview: typeof withAttrs === 'object' ? JSON.stringify(withAttrs).slice(0, 500) : null,
  });
});

// ============= Enriquecer imagens de produtos pareados (chamadas em lote) =============
// Para cada mapping sem image_url, busca o item na plataforma (ML preferido, fallback Shopee)
// e salva a thumbnail. Roda em chunks pra não estourar subrequests.
add('POST', '/api/products/enrich-images', async (req, env) => {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') || 30), 100);
  const mac = await import('./mac');

  const r = await env.DB.prepare(
    `SELECT sku, meli_item_id, shopee_item_id FROM mappings WHERE image_url IS NULL OR image_url = '' LIMIT ?`
  ).bind(limit).all();
  const rows = r.results as any[];

  let updated = 0, errors = 0;
  for (const m of rows) {
    let image: string | null = null;
    try {
      if (m.meli_item_id) {
        const item: any = await mac.call(env, 'raw', { method: 'GET', path: `/items/${m.meli_item_id}?attributes=thumbnail,secure_thumbnail,pictures` });
        image = item?.secure_thumbnail || item?.thumbnail || item?.pictures?.[0]?.secure_url || item?.pictures?.[0]?.url || null;
      }
      if (!image && m.shopee_item_id) {
        const it: any = await mac.shopeeGetItem(env, Number(m.shopee_item_id));
        image = (it as any)?.image?.image_url_list?.[0] || null;
      }
      if (image) {
        await env.DB.prepare(`UPDATE mappings SET image_url = ? WHERE sku = ?`).bind(image, m.sku).run();
        updated++;
      }
    } catch { errors++; }
  }

  // Quantos faltam ainda?
  const left = await env.DB.prepare(`SELECT COUNT(*) c FROM mappings WHERE image_url IS NULL OR image_url = ''`).first<any>();
  return json({ processed: rows.length, updated, errors, remaining: left?.c ?? 0 });
});

// ============= DEBUG: listar pedidos Shopee num período (pra achar gaps) =============
add('GET', '/api/debug/shopee-orders-range', async (req, env) => {
  const url = new URL(req.url);
  const fromSec = Number(url.searchParams.get('from') || (Math.floor(Date.now()/1000) - 24*3600));
  const toSec   = Number(url.searchParams.get('to')   || Math.floor(Date.now()/1000));
  const mac = await import('./mac');
  const statuses = ['UNPAID','READY_TO_SHIP','PROCESSED','SHIPPED','COMPLETED','IN_CANCEL','CANCELLED','INVOICE_PENDING'];
  const all: any[] = [];
  const perStatus: Record<string, number> = {};
  for (const st of statuses) {
    let cursor = '';
    let count = 0;
    for (let i = 0; i < 5; i++) {
      const params: any = { time_range_field: 'create_time', time_from: fromSec, time_to: toSec, page_size: 50, order_status: st };
      if (cursor) params.cursor = cursor;
      let d: any;
      try { d = await mac.call(env, 'shopee_list_orders', params); } catch { break; }
      for (const o of (d?.response?.order_list || [])) { all.push({ order_sn: o.order_sn, status: st, create_time: o.create_time, ts: new Date((o.create_time||0)*1000).toISOString() }); count++; }
      if (!d?.response?.more) break;
      cursor = d?.response?.next_cursor || '';
      if (!cursor) break;
    }
    perStatus[st] = count;
  }
  return json({ fromSec, toSec, total: all.length, per_status: perStatus, orders: all.sort((a,b) => b.create_time - a.create_time) });
});

// ============= DEBUG: ver estrutura crua de um pedido ML =============
add('GET', '/api/debug/meli-order/:id', async (_req, env, params) => {
  const search = await macRaw(env, 'raw', { method: 'GET', path: `/orders/${params.id}` });
  return json(search);
});

// ============= Orders: refresh (re-fetch dados de pedidos já salvos) =============
add('POST', '/api/orders/refresh', async (_req, env) => {
  const mac = await import('./mac');
  const userId = env.MELI_USER_ID || '';

  // Busca pedidos das duas plataformas (janela ampla: 30 dias)
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const [meliOrders, shopeeOrders] = await Promise.all([
    userId ? mac.meliGetRecentOrders(env, userId, since).catch(() => []) : Promise.resolve([]),
    mac.shopeeGetRecentOrders(env, since).catch(() => []),
  ]);

  let updated = 0;
  for (const o of [...meliOrders, ...shopeeOrders]) {
    const r = await env.DB.prepare(`
      UPDATE orders SET buyer=?, status=?, items_json=?, pack_id=? WHERE platform=? AND order_id=?
    `).bind(o.buyer, o.status, JSON.stringify(o.items), o.pack_id ?? null, o.platform, o.order_id).run();
    if ((r.meta.changes ?? 0) > 0) updated++;
  }
  return json({ ok: true, updated, total_meli: meliOrders.length, total_shopee: shopeeOrders.length });
});

// ============= Orders (agrupados por pack_id, paginados, filtrados) =============
add('GET', '/api/orders', async (req, env) => {
  const url = new URL(req.url);
  const platform = url.searchParams.get('platform') || '';
  const statusGroup = url.searchParams.get('status_group') || ''; // to_ship | cancelled | completed
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const pageSize = Math.min(200, Number(url.searchParams.get('page_size') || 100));

  // Status groups (matching case-insensitive nos statuses brutos)
  // A enviar = pago e ainda não despachado. Não incluir unpaid/payment_required (aguardando pagamento).
  const groups: Record<string, string[]> = {
    to_ship: ['paid','confirmed','ready_to_ship','processed','retry_ship','pending_shipment'],
    completed: ['shipped','delivered','to_confirm_receive','completed'],
    cancelled: ['cancelled','in_cancel','to_return','invalid','invoice_pending'],
    unpaid: ['unpaid','payment_required','payment_in_process','partially_paid'],
  };

  // Busca um superset (até 2000) e filtra/agrupa em memória — D1 não tem janelas
  let baseQuery = `SELECT * FROM orders`;
  const where: string[] = [];
  const binds: any[] = [];
  if (platform) { where.push('platform = ?'); binds.push(platform); }
  if (where.length) baseQuery += ' WHERE ' + where.join(' AND ');
  baseQuery += ' ORDER BY created_at DESC LIMIT 5000';

  const r = await env.DB.prepare(baseQuery).bind(...binds).all();
  let rows = (r.results || []) as any[];

  // Filtro por grupo de status
  if (statusGroup && groups[statusGroup]) {
    const allowed = new Set(groups[statusGroup]);
    rows = rows.filter(o => allowed.has(String(o.status || '').toLowerCase()));
  }

  // Agrupa por pack_id
  const grouped: any[] = [];
  const seen = new Map<string, number>();
  for (const o of rows) {
    const key = o.pack_id ? `${o.platform}:${o.pack_id}` : null;
    if (key && seen.has(key)) {
      const idx = seen.get(key)!;
      const target = grouped[idx];
      try {
        const a = JSON.parse(target.items_json || '[]');
        const b = JSON.parse(o.items_json || '[]');
        target.items_json = JSON.stringify([...a, ...b]);
      } catch {}
      target._order_ids = target._order_ids || [target.order_id];
      target._order_ids.push(o.order_id);
    } else {
      const clone = { ...o };
      if (key) seen.set(key, grouped.length);
      grouped.push(clone);
    }
  }
  for (const g of grouped) {
    g.display_id = g.pack_id || g.order_id;
    g.grouped_count = g._order_ids?.length || 1;
  }

  const total = grouped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const items = grouped.slice(start, start + pageSize);

  return json({ items, total, page, page_size: pageSize, total_pages: totalPages });
});

// ============= Toggle shadow mode (requires re-deploy to persist via vars) =============
// Note: vars in wrangler.toml don't change at runtime. Documented in UI as "edit wrangler.toml + deploy".

// ============= Router entry =============
export async function handleApi(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/') && !['/api/status'].includes(url.pathname)) return null;

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    try {
      return await r.handler(req, env, params);
    } catch (e: any) {
      return json({ error: String(e.message || e), stack: e.stack }, 500);
    }
  }
  return json({ error: 'not found' }, 404);
}
