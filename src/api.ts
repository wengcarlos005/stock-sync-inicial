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
    SELECT m.sku, m.product_name, m.active, m.notes,
           m.meli_item_id, m.meli_variation_id, m.shopee_item_id, m.shopee_model_id,
           s.meli_stock, s.shopee_stock, s.master_stock, s.last_poll_at, s.last_change_at,
           m.updated_at
    FROM mappings m
    LEFT JOIN state s ON s.sku = m.sku
    ORDER BY COALESCE(s.last_change_at, m.updated_at) DESC
  `).all();

  let rows = r.results as any[];
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
  }
  return json({ total: rows.length, items: rows });
});

// ============= Changes feed =============
add('GET', '/api/changes', async (req, env) => {
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get('limit') || 50));
  const sku = url.searchParams.get('sku');
  const q = sku
    ? env.DB.prepare(`SELECT * FROM changes WHERE sku = ? ORDER BY ts DESC LIMIT ?`).bind(sku, limit)
    : env.DB.prepare(`SELECT * FROM changes ORDER BY ts DESC LIMIT ?`).bind(limit);
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
  const r = await env.DB.prepare(`SELECT * FROM unmapped WHERE resolved=0 ORDER BY last_seen_at DESC LIMIT 200`).all();
  return json({ items: r.results });
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

// ============= Orders =============
add('GET', '/api/orders', async (req, env) => {
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get('limit') || 100));
  const platform = url.searchParams.get('platform') || '';
  const r = platform
    ? await env.DB.prepare(`SELECT * FROM orders WHERE platform=? ORDER BY created_at DESC LIMIT ?`).bind(platform, limit).all()
    : await env.DB.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  return json({ items: r.results });
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
