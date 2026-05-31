// Sync engine — abordagem híbrida:
//   1. Polling de PEDIDOS  (2 chamadas API, escala pra qualquer nº de produtos)
//   2. Mini batch de stock (5 itens/run, capta reposições manuais)
import * as mac from './mac';
import * as db from './db';

export interface SyncEnv extends mac.MacEnv {
  DB: D1Database;
  SHADOW_MODE: string;
  MELI_USER_ID?: string;
  POLL_BATCH_SIZE?: string;
}

interface SyncStats {
  polled: number;
  detected: number;
  applied: number;
  errors: number;
  notes: string;
}

export async function runSync(env: SyncEnv, trigger: 'cron' | 'manual' = 'cron'): Promise<SyncStats> {
  // POLÍTICA DE ESCRITA NA LOJA:
  //   - syncOrders (vendas confirmadas): SEMPRE propaga estoque (cron OU manual)
  //     → seguro porque só roda quando tem evento `order.created` real
  //   - syncStockBatch (poll/reconciliação): SÓ propaga em sync manual
  //     → no cron fica shadow pra evitar zeradas por glitch da API/timeout/race
  //   - set-stock endpoint (botão Atualizar): SEMPRE propaga (ação explícita do usuário)
  const shadowEnv = env.SHADOW_MODE === 'true';
  const ordersShadow = shadowEnv;                            // sempre respeita env
  const pollShadow = trigger === 'cron' ? true : shadowEnv;  // cron força shadow no poll
  const runId = await db.startRun(env.DB, trigger, pollShadow);
  const stats: SyncStats = { polled: 0, detected: 0, applied: 0, errors: 0, notes: '' };
  const errs: string[] = [];

  try {
    // ── FASE 1: Pedidos (vendas) ── propaga estoque por venda confirmada
    await syncOrders(env, stats, errs, ordersShadow);

    // ── FASE 2: Poll/reconciliação ── shadow no cron, live no manual
    const batchSize = Math.min(5, Number(env.POLL_BATCH_SIZE || 5));
    await syncStockBatch(env, stats, errs, pollShadow, batchSize);

  } finally {
    stats.notes = errs.slice(0, 5).join(' | ');
    if (trigger === 'cron' && pollShadow) {
      stats.notes = `[cron: poll-shadow, orders-live] ${stats.notes}`;
    }
    await db.finishRun(env.DB, runId, stats);
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────
// FASE 1 — Sincronização por pedidos
// Busca pedidos novos (2 chamadas total) e propaga estoque
// ─────────────────────────────────────────────────────────────
async function syncOrders(env: SyncEnv, stats: SyncStats, errs: string[], shadow: boolean) {
  const userId = env.MELI_USER_ID || '';
  const DEFAULT_WINDOW = 24 * 60 * 60 * 1000; // primeira vez: últimas 24h

  const [meliSince, shopeeSince] = await Promise.all([
    db.getConfig(env.DB, 'meli_orders_last_check').then(v => v ? Number(v) : Date.now() - DEFAULT_WINDOW),
    db.getConfig(env.DB, 'shopee_orders_last_check').then(v => v ? Number(v) : Date.now() - DEFAULT_WINDOW),
  ]);

  const now = Date.now();

  // Busca pedidos de ambas as plataformas em paralelo
  const [meliOrders, shopeeOrders] = await Promise.all([
    userId ? mac.meliGetRecentOrders(env, userId, meliSince).catch(e => { errs.push('ML orders: ' + e.message); return []; }) : Promise.resolve([]),
    mac.shopeeGetRecentOrders(env, shopeeSince).catch(e => { errs.push('Shopee orders: ' + e.message); return []; }),
  ]);

  // Processa pedidos novos
  for (const order of [...meliOrders, ...shopeeOrders]) {
    try {
      const isNew = await db.saveOrderIfNew(env.DB, {
        platform: order.platform,
        order_id: order.order_id,
        status: order.status,
        buyer: order.buyer,
        created_at: order.created_at,
        items_json: JSON.stringify(order.items),
        pack_id: order.pack_id ?? null,
      });
      if (!isNew) continue; // já processado antes

      stats.detected++;

      // Para cada item do pedido, aplica desconto de estoque
      for (const item of order.items) {
        try {
          await applyOrderItem(env, order, item, stats, shadow);
        } catch (e: any) {
          stats.errors++;
          errs.push(`${order.platform}#${order.order_id} item ${item.item_id}: ${e.message}`);
        }
      }
    } catch (e: any) {
      stats.errors++;
      errs.push(`order ${order.order_id}: ${e.message}`);
    }
  }

  // Atualiza timestamps
  await Promise.all([
    db.setConfig(env.DB, 'meli_orders_last_check', String(now - 60_000)),   // 1 min de overlap p/ segurança
    db.setConfig(env.DB, 'shopee_orders_last_check', String(now - 60_000)),
  ]);
}

async function applyOrderItem(
  env: SyncEnv,
  order: mac.NormalizedOrder,
  item: mac.NormalizedOrder['items'][number],
  stats: SyncStats,
  shadow: boolean,
) {
  // Encontra o mapeamento pelo item_id da plataforma de origem
  const mapping = order.platform === 'meli'
    ? await db.getMappingByMeliId(env.DB, item.item_id, item.variation_id)
    : await db.getMappingByShopeeId(env.DB, item.item_id, item.variation_id);

  if (!mapping) return; // produto não está pareado, ignora

  // Busca estoque atual da plataforma de origem
  const currentStock = order.platform === 'meli'
    ? await fetchMeliStock(env, mapping)
    : await fetchShopeeStock(env, mapping);

  stats.polled++;

  const prev = await db.getState(env.DB, mapping.sku);
  const meliBefore = prev?.meli_stock ?? null;
  const shopeeBefore = prev?.shopee_stock ?? null;
  const masterBefore = prev?.master_stock ?? null;

  // Novo stock = estoque atual já descontado pelo marketplace de origem
  // Propaga o mesmo valor para o outro lado
  const newStock = currentStock ?? Math.max(0, (masterBefore ?? 0) - item.qty);
  let propagatedTo: string | null = null;
  let errorMsg: string | null = null;

  if (!shadow) {
    try {
      if (order.platform === 'meli' && mapping.shopee_item_id) {
        await mac.shopeeUpdateStock(env, Number(mapping.shopee_item_id), newStock,
          mapping.shopee_model_id ? Number(mapping.shopee_model_id) : undefined);
        propagatedTo = 'shopee';
      } else if (order.platform === 'shopee' && mapping.meli_item_id) {
        await mac.meliUpdateStock(env, mapping.meli_item_id, newStock,
          mapping.meli_variation_id ? Number(mapping.meli_variation_id) : undefined);
        propagatedTo = 'meli';
      }
      stats.applied++;
    } catch (e: any) {
      errorMsg = e.message;
      stats.errors++;
    }
  }

  const meliAfter  = order.platform === 'meli' ? newStock : (propagatedTo === 'meli' ? newStock : meliBefore);
  const shopeeAfter = order.platform === 'shopee' ? newStock : (propagatedTo === 'shopee' ? newStock : shopeeBefore);

  await db.logChange(env.DB, {
    sku: mapping.sku,
    source: order.platform,
    trigger: 'sale',
    meli_before: meliBefore,
    meli_after: meliAfter,
    shopee_before: shopeeBefore,
    shopee_after: shopeeAfter,
    delta: newStock - (masterBefore ?? newStock + item.qty),
    propagated_to: propagatedTo,
    shadow,
    error: errorMsg,
  });

  await db.upsertState(env.DB, mapping.sku,
    order.platform === 'meli' ? newStock : (propagatedTo === 'meli' ? newStock : meliBefore),
    order.platform === 'shopee' ? newStock : (propagatedTo === 'shopee' ? newStock : shopeeBefore),
    newStock, true);
}

// ─────────────────────────────────────────────────────────────
// FASE 2 — Mini batch de stock (detecta reposições manuais)
// Verifica os N produtos menos polled recentemente
// ─────────────────────────────────────────────────────────────
async function syncStockBatch(env: SyncEnv, stats: SyncStats, errs: string[], shadow: boolean, batchSize: number) {
  const mappings = await db.getActiveMappings(env.DB, batchSize);

  for (const map of mappings) {
    stats.polled++;
    try {
      const [meliStockNow, shopeeStockNow] = await Promise.all([
        fetchMeliStock(env, map),
        fetchShopeeStock(env, map),
      ]);

      const prev = await db.getState(env.DB, map.sku);

      // Primeira vez: só registra
      if (prev == null) {
        await db.upsertState(env.DB, map.sku, meliStockNow, shopeeStockNow,
          Math.min(meliStockNow ?? 0, shopeeStockNow ?? 0), false);
        continue;
      }

      const meliChanged = prev.meli_stock !== meliStockNow;
      const shopeeChanged = prev.shopee_stock !== shopeeStockNow;

      if (!meliChanged && !shopeeChanged) {
        await db.upsertState(env.DB, map.sku, meliStockNow, shopeeStockNow, prev.master_stock, false);
        continue;
      }

      stats.detected++;

      const source = meliChanged ? 'meli' : 'shopee';
      const newValue = meliChanged ? meliStockNow : shopeeStockNow;
      const triggerKind = (meliChanged ? prev.meli_stock! > meliStockNow! : prev.shopee_stock! > shopeeStockNow!)
        ? 'restock' : 'restock'; // aqui é reposição manual (vendas captadas pela fase 1)

      let propagatedTo: string | null = null;
      let errorMsg: string | null = null;

      if (!shadow) {
        try {
          if (meliChanged && map.shopee_item_id) {
            await mac.shopeeUpdateStock(env, Number(map.shopee_item_id), newValue ?? 0,
              map.shopee_model_id ? Number(map.shopee_model_id) : undefined);
            propagatedTo = 'shopee';
          } else if (shopeeChanged && map.meli_item_id) {
            await mac.meliUpdateStock(env, map.meli_item_id, newValue ?? 0,
              map.meli_variation_id ? Number(map.meli_variation_id) : undefined);
            propagatedTo = 'meli';
          }
          stats.applied++;
        } catch (e: any) {
          errorMsg = String(e.message);
          stats.errors++;
        }
      }

      await db.logChange(env.DB, {
        sku: map.sku, source, trigger: triggerKind,
        meli_before: prev.meli_stock, meli_after: meliStockNow,
        shopee_before: prev.shopee_stock, shopee_after: shopeeStockNow,
        delta: (newValue ?? 0) - (prev.master_stock ?? 0),
        propagated_to: propagatedTo, shadow, error: errorMsg,
      });

      await db.upsertState(env.DB, map.sku,
        shadow ? meliStockNow : newValue,
        shadow ? shopeeStockNow : newValue,
        newValue, true);

    } catch (e: any) {
      stats.errors++;
      errs.push(`${map.sku}: ${e.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
async function fetchMeliStock(env: mac.MacEnv, m: db.Mapping): Promise<number | null> {
  if (!m.meli_item_id) return null;
  const item = await mac.meliGetItem(env, m.meli_item_id);
  if (!item) return null;
  if (m.meli_variation_id) {
    const v = (item.variations || []).find((x: any) => String(x.id) === m.meli_variation_id);
    return v?.available_quantity ?? null;
  }
  return item.available_quantity ?? null;
}

async function fetchShopeeStock(env: mac.MacEnv, m: db.Mapping): Promise<number | null> {
  if (!m.shopee_item_id) return null;
  const item = await mac.shopeeGetItem(env, Number(m.shopee_item_id));
  if (!item) return null;
  if (m.shopee_model_id) {
    const models = await mac.shopeeGetModels(env, Number(m.shopee_item_id));
    const mod = models.find((x: any) => String(x.model_id) === m.shopee_model_id);
    return mod?.stock_info_v2?.summary_info?.total_available_stock ?? null;
  }
  return item.stock_info_v2?.summary_info?.total_available_stock ?? null;
}
