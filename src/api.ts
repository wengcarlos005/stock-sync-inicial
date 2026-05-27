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
  const paired = (await env.DB.prepare(`
    SELECT m.sku, m.product_name, m.image_url, m.active,
           m.meli_item_id, m.meli_variation_id, m.shopee_item_id, m.shopee_model_id,
           s.master_stock, s.meli_stock, s.shopee_stock
    FROM mappings m
    LEFT JOIN state s ON s.sku = m.sku
  `).all()).results as any[];

  // ── 2. Unmapped ────────────────────────────────────────────
  const unmapped = (await env.DB.prepare(`
    SELECT sku, platform, item_id, variation_id, product_name FROM unmapped WHERE resolved=0
  `).all()).results as any[];

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
  const ensureAnuncio = (shopeeId: string | null, meliId: string | null, name: string, image: string | null) => {
    // Procura por anúncio existente que já tenha qualquer um dos IDs
    let key = '';
    if (shopeeId && shopeeIdToKey.has(shopeeId)) key = shopeeIdToKey.get(shopeeId)!;
    else if (meliId && meliIdToKey.has(meliId))  key = meliIdToKey.get(meliId)!;
    else if (shopeeId) key = 'sp:' + shopeeId;
    else if (meliId) key = 'ml:' + meliId;
    if (!key) return null;
    let a: any = anuncios.get(key);
    if (!a) {
      a = { key, shopee_item_id: shopeeId, meli_item_id: meliId, product_name: name, image, variations: [], fully_paired: true, all_names: new Set<string>() };
      anuncios.set(key, a);
    } else {
      if (!a.shopee_item_id && shopeeId) a.shopee_item_id = shopeeId;
      if (!a.meli_item_id && meliId) a.meli_item_id = meliId;
      if (!a.image && image) a.image = image;
      // Prefere nome mais longo (geralmente mais completo)
      if (name && name.length > (a.product_name?.length || 0)) a.product_name = name;
    }
    if (name) a.all_names.add(name);
    if (shopeeId) shopeeIdToKey.set(shopeeId, key);
    if (meliId) meliIdToKey.set(meliId, key);
    return a;
  };

  // a) Pareados primeiro (estabelece o "anúncio" duplo)
  for (const m of paired) {
    const a = ensureAnuncio(m.shopee_item_id || null, m.meli_item_id || null, m.product_name || '', m.image_url);
    if (!a) continue;
    const sales = lookupSales(m.sku, `${m.meli_item_id}|${m.meli_variation_id||''}`, `${m.shopee_item_id}|${m.shopee_model_id||''}`);
    const meta = salesBySku.get(m.sku) || sales;
    a.variations.push({
      sku: m.sku,
      variation: meta?.variation || null,
      image: m.image_url || meta?.image || null,
      meli_item_id: m.meli_item_id || null,
      meli_variation_id: m.meli_variation_id || null,
      shopee_item_id: m.shopee_item_id || null,
      shopee_model_id: m.shopee_model_id || null,
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
      const a = ensureAnuncio(u.item_id, null, u.product_name || '', null);
      if (!a) continue;
      const sales = salesByShopeeVar.get(`${u.item_id}|${u.variation_id||''}`) || (u.sku ? salesBySku.get(u.sku) : null) || null;
      a.variations.push({
        sku: u.sku || '',
        variation: sales?.variation || null,
        image: sales?.image || null,
        meli_item_id: null,
        meli_variation_id: null,
        shopee_item_id: u.item_id,
        shopee_model_id: u.variation_id || null,
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
      a.variations.push({
        sku: u.sku || '',
        variation: sales?.variation || null,
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

  // ── 5. Filtros e busca (nível do anúncio) ──────────────────
  let list = [...anuncios.values()];
  if (filter === 'paired')   list = list.filter(a => a.fully_paired);
  if (filter === 'unpaired') list = list.filter(a => !a.fully_paired);
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

  // 1. Mappings com Shopee preenchido
  const paired = await env.DB.prepare(`
    SELECT m.sku, m.product_name, m.image_url, m.active,
           m.meli_item_id, m.meli_variation_id, m.shopee_item_id, m.shopee_model_id,
           s.master_stock, s.meli_stock, s.shopee_stock
    FROM mappings m
    LEFT JOIN state s ON s.sku = m.sku
    WHERE m.shopee_item_id IS NOT NULL AND m.shopee_item_id != ''
  `).all();

  // 2. Unmapped Shopee (não pareados ainda)
  const unpaired = await env.DB.prepare(`
    SELECT sku, product_name, item_id AS shopee_item_id, variation_id AS shopee_model_id
    FROM unmapped
    WHERE platform = 'shopee' AND resolved = 0
  `).all();

  // 3. Enriquece com imagem/variation/name do último pedido (preenche faltas)
  const ordersR = await env.DB.prepare(`SELECT items_json FROM orders ORDER BY created_at DESC LIMIT 2000`).all();
  const meta = new Map<string, { image: string | null; variation: string | null; name: string | null }>();
  for (const o of ordersR.results as any[]) {
    let items: any[] = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch {}
    for (const it of items) {
      // Index by Shopee item_id+model_id (variations have unique model_id)
      const k = `${it.item_id}|${it.variation_id || ''}`;
      if (!meta.has(k)) meta.set(k, { image: it.image || null, variation: it.variation || null, name: it.name || null });
      // Also by SKU as fallback
      if (it.sku && !meta.has(it.sku)) meta.set(it.sku, { image: it.image || null, variation: it.variation || null, name: it.name || null });
    }
  }

  const enrich = (row: any) => {
    const k = `${row.shopee_item_id}|${row.shopee_model_id || ''}`;
    const m = meta.get(k) || (row.sku ? meta.get(row.sku) : null);
    return {
      ...row,
      image: row.image_url || m?.image || null,
      variation: m?.variation || null,
      product_name: row.product_name || m?.name || '',
    };
  };

  const pairedRows = (paired.results as any[]).map(r => ({ ...enrich(r), paired: true }));
  const unpairedRows = (unpaired.results as any[]).map(r => ({ ...enrich(r), paired: false, active: 0, master_stock: null, meli_stock: null, shopee_stock: null, meli_item_id: null, meli_variation_id: null }));

  let rows = [...pairedRows, ...unpairedRows];

  // Filtros
  if (filter === 'paired')   rows = rows.filter(r => r.paired);
  if (filter === 'unpaired') rows = rows.filter(r => !r.paired);
  if (search) {
    rows = rows.filter(r =>
      (r.sku || '').toLowerCase().includes(search) ||
      (r.product_name || '').toLowerCase().includes(search) ||
      (r.variation || '').toLowerCase().includes(search)
    );
  }

  // Agrupa por shopee_item_id pra mostrar como anúncio + variações
  const grouped = new Map<string, any>();
  for (const r of rows) {
    const gId = r.shopee_item_id;
    if (!grouped.has(gId)) {
      grouped.set(gId, {
        shopee_item_id: gId,
        product_name: r.product_name,
        image: r.image,
        variations: [],
      });
    }
    grouped.get(gId).variations.push(r);
  }

  const items = [...grouped.values()];
  return json({ total: items.length, total_variations: rows.length, items });
});

// ============= Sales stats per SKU (a partir da tabela orders) =============
add('GET', '/api/products/sales', async (req, env) => {
  const url = new URL(req.url);
  const search = url.searchParams.get('q')?.toLowerCase().trim() || '';
  const now = Date.now();
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;

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
          last7: 0,
          last_sale_at: null as number | null,
        };
        stats.set(sku, s);
      }
      s.total += qty;
      if (o.created_at >= monthStart) s.month += qty;
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
    INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, product_name, active, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(sku) DO UPDATE SET
      meli_item_id = excluded.meli_item_id,
      meli_variation_id = excluded.meli_variation_id,
      shopee_item_id = excluded.shopee_item_id,
      shopee_model_id = excluded.shopee_model_id,
      product_name = COALESCE(excluded.product_name, mappings.product_name),
      notes = COALESCE(excluded.notes, mappings.notes),
      updated_at = excluded.updated_at
  `).bind(m.sku, m.meli_item_id ?? null, m.meli_variation_id ?? null, m.shopee_item_id ?? null, m.shopee_model_id ?? null, m.product_name ?? null, m.notes ?? null, now, now).run();

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

// ============= Manual stock override =============
add('POST', '/api/products/:sku/set-stock', async (req, env, params) => {
  const body = await req.json() as { stock: number };
  if (typeof body.stock !== 'number') return json({ error: 'stock required' }, 400);
  // Set master and trigger sync via change log
  const map = await env.DB.prepare(`SELECT * FROM mappings WHERE sku=?`).bind(params.sku).first<any>();
  if (!map) return json({ error: 'mapping not found' }, 404);

  const shadow = env.SHADOW_MODE === 'true';
  // Get current values
  const prev = await env.DB.prepare(`SELECT * FROM state WHERE sku=?`).bind(params.sku).first<any>();
  const meliBefore = prev?.meli_stock ?? null;
  const shopeeBefore = prev?.shopee_stock ?? null;

  // Apply to both (if not shadow)
  let propagated: string[] = [];
  if (!shadow) {
    try {
      const mac = await import('./mac');
      if (map.meli_item_id) {
        await mac.meliUpdateStock(env, map.meli_item_id, body.stock, map.meli_variation_id ? Number(map.meli_variation_id) : undefined);
        propagated.push('meli');
      }
      if (map.shopee_item_id) {
        await mac.shopeeUpdateStock(env, Number(map.shopee_item_id), body.stock, map.shopee_model_id ? Number(map.shopee_model_id) : undefined);
        propagated.push('shopee');
      }
    } catch (e: any) {
      return json({ error: String(e.message) }, 500);
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
    shadow ? meliBefore : body.stock,
    shadow ? shopeeBefore : body.stock,
    body.stock, Date.now(), Date.now()
  ).run();

  return json({ ok: true, shadow, propagated });
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
      await env.DB.prepare(`INSERT INTO unmapped (platform, sku, item_id, variation_id, product_name, first_seen_at, last_seen_at, resolved) VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(sku, platform, item_id, variation_id) DO UPDATE SET last_seen_at=?, product_name=COALESCE(excluded.product_name, unmapped.product_name)`)
        .bind(it.platform, it.sku, it.item_id, it.variation_id || null, it.product_name || null, now, now, now).run();
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
  let query = `SELECT id, platform, sku, item_id, variation_id, product_name FROM unmapped WHERE resolved=0`;
  if (platform) query += ` AND platform='${platform === 'meli' ? 'meli' : 'shopee'}'`;
  const r = await env.DB.prepare(query + ` ORDER BY product_name ASC LIMIT 300`).all();
  let items = r.results as any[];
  if (q) items = items.filter(x => (x.product_name || '').toLowerCase().includes(q) || (x.sku || '').toLowerCase().includes(q));
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
          const r = await env.DB.prepare(`
            INSERT OR IGNORE INTO orders (platform, order_id, status, buyer, created_at, items_json, processed_at, pack_id)
            VALUES (?,?,?,?,?,?,?,?)
          `).bind('meli', String(o.id), o.status || '', buyerName, created,
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
  const groups: Record<string, string[]> = {
    to_ship: ['paid','confirmed','ready_to_ship','processed','retry_ship','payment_required','payment_in_process','partially_paid','pending_shipment','unpaid'],
    completed: ['shipped','delivered','to_confirm_receive','completed'],
    cancelled: ['cancelled','in_cancel','to_return','invalid'],
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
