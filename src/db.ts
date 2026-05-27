// Helpers de acesso ao D1
export interface Mapping {
  sku: string;
  meli_item_id: string | null;
  meli_variation_id: string | null;
  shopee_item_id: string | null;
  shopee_model_id: string | null;
  product_name: string | null;
  active: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface StateRow {
  sku: string;
  meli_stock: number | null;
  shopee_stock: number | null;
  master_stock: number | null;
  last_poll_at: number;
  last_change_at: number | null;
}

export async function upsertMapping(db: D1Database, m: Partial<Mapping> & { sku: string }) {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, product_name, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(sku) DO UPDATE SET
      meli_item_id = COALESCE(excluded.meli_item_id, mappings.meli_item_id),
      meli_variation_id = COALESCE(excluded.meli_variation_id, mappings.meli_variation_id),
      shopee_item_id = COALESCE(excluded.shopee_item_id, mappings.shopee_item_id),
      shopee_model_id = COALESCE(excluded.shopee_model_id, mappings.shopee_model_id),
      product_name = COALESCE(excluded.product_name, mappings.product_name),
      updated_at = excluded.updated_at
  `).bind(
    m.sku,
    m.meli_item_id ?? null,
    m.meli_variation_id ?? null,
    m.shopee_item_id ?? null,
    m.shopee_model_id ?? null,
    m.product_name ?? null,
    now, now
  ).run();
}

export async function upsertUnmapped(db: D1Database, sku: string, platform: 'meli' | 'shopee', itemId: string, variationId: string | null, name: string | null) {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO unmapped (sku, platform, item_id, variation_id, product_name, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sku, platform, item_id, variation_id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at
  `).bind(sku, platform, itemId, variationId, name, now, now).run();
}

// ============ Config KV ============
export async function getConfig(db: D1Database, key: string): Promise<string | null> {
  try {
    const r = await db.prepare(`SELECT value FROM config WHERE key=?`).bind(key).first<{ value: string }>();
    return r?.value ?? null;
  } catch { return null; }
}

export async function setConfig(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(`INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .bind(key, value).run();
}

// ============ Orders ============
export async function saveOrderIfNew(db: D1Database, order: {
  platform: string; order_id: string; status: string; buyer: string;
  created_at: number; items_json: string; pack_id?: string | null;
}): Promise<boolean> {
  const r = await db.prepare(`
    INSERT OR IGNORE INTO orders (platform, order_id, status, buyer, created_at, items_json, processed_at, pack_id)
    VALUES (?,?,?,?,?,?,?,?)
  `).bind(order.platform, order.order_id, order.status, order.buyer, order.created_at, order.items_json, Date.now(), order.pack_id ?? null).run();
  return (r.meta.changes ?? 0) > 0; // true = novo, false = já existia
}

// ============ Lookup mapping by marketplace ID ============
export async function getMappingByMeliId(db: D1Database, itemId: string, variationId: string | null): Promise<Mapping | null> {
  if (variationId) {
    const r = await db.prepare(`SELECT * FROM mappings WHERE meli_item_id=? AND meli_variation_id=? AND active=1 LIMIT 1`)
      .bind(itemId, variationId).first<Mapping>();
    if (r) return r;
  }
  // fallback: sem variação (produto simples)
  const r = await db.prepare(`SELECT * FROM mappings WHERE meli_item_id=? AND (meli_variation_id IS NULL OR meli_variation_id='') AND active=1 LIMIT 1`)
    .bind(itemId).first<Mapping>();
  return r ?? null;
}

export async function getMappingByShopeeId(db: D1Database, itemId: string, modelId: string | null): Promise<Mapping | null> {
  if (modelId && modelId !== '0') {
    const r = await db.prepare(`SELECT * FROM mappings WHERE shopee_item_id=? AND shopee_model_id=? AND active=1 LIMIT 1`)
      .bind(itemId, modelId).first<Mapping>();
    if (r) return r;
  }
  const r = await db.prepare(`SELECT * FROM mappings WHERE shopee_item_id=? AND (shopee_model_id IS NULL OR shopee_model_id='' OR shopee_model_id='0') AND active=1 LIMIT 1`)
    .bind(itemId).first<Mapping>();
  return r ?? null;
}

export async function getActiveMappings(db: D1Database, limit = 1000): Promise<Mapping[]> {
  // ORDER BY last_poll_at ASC: polls least-recently-polled items first,
  // so a capped batch rotates through all mappings across consecutive runs.
  const r = await db.prepare(`
    SELECT m.* FROM mappings m
    LEFT JOIN state s ON s.sku = m.sku
    WHERE m.active = 1
    ORDER BY COALESCE(s.last_poll_at, 0) ASC
    LIMIT ?
  `).bind(limit).all<Mapping>();
  return r.results || [];
}

export async function getState(db: D1Database, sku: string): Promise<StateRow | null> {
  const r = await db.prepare(`SELECT * FROM state WHERE sku = ?`).bind(sku).first<StateRow>();
  return r || null;
}

export async function upsertState(db: D1Database, sku: string, meliStock: number | null, shopeeStock: number | null, master: number | null, changed: boolean) {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO state (sku, meli_stock, shopee_stock, master_stock, last_poll_at, last_change_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(sku) DO UPDATE SET
      meli_stock = excluded.meli_stock,
      shopee_stock = excluded.shopee_stock,
      master_stock = excluded.master_stock,
      last_poll_at = excluded.last_poll_at,
      last_change_at = CASE WHEN ? = 1 THEN excluded.last_change_at ELSE state.last_change_at END
  `).bind(sku, meliStock, shopeeStock, master, now, changed ? now : null, changed ? 1 : 0).run();
}

export async function logChange(db: D1Database, c: {
  sku: string; source: string; trigger: string;
  meli_before: number | null; meli_after: number | null;
  shopee_before: number | null; shopee_after: number | null;
  delta: number; propagated_to: string | null; shadow: boolean;
  error?: string | null;
}) {
  await db.prepare(`
    INSERT INTO changes (ts, sku, source, trigger, meli_stock_before, meli_stock_after, shopee_stock_before, shopee_stock_after, delta, propagated_to, shadow, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    Date.now(), c.sku, c.source, c.trigger,
    c.meli_before, c.meli_after, c.shopee_before, c.shopee_after,
    c.delta, c.propagated_to, c.shadow ? 1 : 0, c.error ?? null
  ).run();
}

export async function logConflict(db: D1Database, c: {
  sku: string; meli_before: number | null; meli_after: number | null;
  shopee_before: number | null; shopee_after: number | null;
  resolved_to: number | null; resolution: string;
}) {
  await db.prepare(`
    INSERT INTO conflicts (ts, sku, meli_before, meli_after, shopee_before, shopee_after, resolved_to, resolution, resolved_at, resolved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    Date.now(), c.sku, c.meli_before, c.meli_after,
    c.shopee_before, c.shopee_after, c.resolved_to, c.resolution,
    Date.now(), 'auto'
  ).run();
}

export async function startRun(db: D1Database, trigger: string, shadow: boolean): Promise<number> {
  const r = await db.prepare(`
    INSERT INTO runs (started_at, trigger, shadow) VALUES (?, ?, ?)
  `).bind(Date.now(), trigger, shadow ? 1 : 0).run();
  return r.meta.last_row_id;
}

export async function finishRun(db: D1Database, id: number, stats: { polled: number; detected: number; applied: number; errors: number; notes?: string }) {
  await db.prepare(`
    UPDATE runs SET finished_at = ?, items_polled = ?, changes_detected = ?, changes_applied = ?, errors = ?, notes = ? WHERE id = ?
  `).bind(Date.now(), stats.polled, stats.detected, stats.applied, stats.errors, stats.notes ?? null, id).run();
}
