// Polling + reconciler. Shadow mode = só detecta, não escreve.
import * as mac from './mac';
import * as db from './db';

export interface SyncEnv extends mac.MacEnv {
  DB: D1Database;
  SHADOW_MODE: string;  // "true" | "false"
}

interface SyncStats {
  polled: number;
  detected: number;
  applied: number;
  errors: number;
  notes: string;
}

export async function runSync(env: SyncEnv, trigger: 'cron' | 'manual' = 'cron'): Promise<SyncStats> {
  const shadow = env.SHADOW_MODE === 'true';
  const runId = await db.startRun(env.DB, trigger, shadow);
  const stats: SyncStats = { polled: 0, detected: 0, applied: 0, errors: 0, notes: '' };
  const errs: string[] = [];

  try {
    // Free plan: 50 subrequests/invocation. Each mapping = 2 fetch calls.
    // Cap at 20 per run → 40 fetches (safe margin). Items rotate via ORDER BY last_poll_at ASC.
    const batchSize = Math.min(20, Number((env as any).POLL_BATCH_SIZE || 20));
    const mappings = await db.getActiveMappings(env.DB, batchSize);

    for (const map of mappings) {
      stats.polled++;
      try {
        // Pull current stock from both sides
        const [meliStockNow, shopeeStockNow] = await Promise.all([
          fetchMeliStock(env, map),
          fetchShopeeStock(env, map),
        ]);

        const prev = await db.getState(env.DB, map.sku);
        const meliBefore = prev?.meli_stock ?? null;
        const shopeeBefore = prev?.shopee_stock ?? null;
        const masterBefore = prev?.master_stock ?? null;

        const meliChanged = prev != null && meliBefore !== meliStockNow;
        const shopeeChanged = prev != null && shopeeBefore !== shopeeStockNow;

        // First poll for this SKU — just record state, don't propagate
        if (prev == null) {
          await db.upsertState(env.DB, map.sku, meliStockNow, shopeeStockNow, Math.min(meliStockNow ?? 0, shopeeStockNow ?? 0), false);
          continue;
        }

        if (!meliChanged && !shopeeChanged) {
          // No change — just refresh poll timestamp
          await db.upsertState(env.DB, map.sku, meliStockNow, shopeeStockNow, masterBefore, false);
          continue;
        }

        stats.detected++;

        // CONFLICT: both sides changed
        if (meliChanged && shopeeChanged) {
          // Resolve to min (safer for oversell)
          const resolved = Math.min(meliStockNow ?? 0, shopeeStockNow ?? 0);
          await db.logConflict(env.DB, {
            sku: map.sku,
            meli_before: meliBefore, meli_after: meliStockNow,
            shopee_before: shopeeBefore, shopee_after: shopeeStockNow,
            resolved_to: resolved, resolution: 'auto_min',
          });
          if (!shadow) {
            // Push resolved to whichever is higher
            if ((meliStockNow ?? 0) > resolved) await mac.meliUpdateStock(env, map.meli_item_id!, resolved, map.meli_variation_id ? Number(map.meli_variation_id) : undefined);
            if ((shopeeStockNow ?? 0) > resolved) await mac.shopeeUpdateStock(env, Number(map.shopee_item_id!), resolved, map.shopee_model_id ? Number(map.shopee_model_id) : undefined);
            stats.applied++;
          }
          await db.logChange(env.DB, {
            sku: map.sku, source: 'reconcile', trigger: 'conflict',
            meli_before: meliBefore, meli_after: shadow ? meliStockNow : resolved,
            shopee_before: shopeeBefore, shopee_after: shadow ? shopeeStockNow : resolved,
            delta: resolved - (masterBefore ?? 0),
            propagated_to: shadow ? null : 'both', shadow,
          });
          await db.upsertState(env.DB, map.sku, shadow ? meliStockNow : resolved, shadow ? shopeeStockNow : resolved, resolved, true);
          continue;
        }

        // SIMPLE PROPAGATION: one side changed → mirror to the other
        const source = meliChanged ? 'meli' : 'shopee';
        const newValue = meliChanged ? meliStockNow : shopeeStockNow;
        const triggerKind = (meliChanged ? meliBefore! > meliStockNow! : shopeeBefore! > shopeeStockNow!) ? 'sale' : 'restock';
        let propagatedTo: string | null = null;
        let errorMsg: string | null = null;

        if (!shadow) {
          try {
            if (meliChanged) {
              await mac.shopeeUpdateStock(env, Number(map.shopee_item_id!), newValue ?? 0, map.shopee_model_id ? Number(map.shopee_model_id) : undefined);
              propagatedTo = 'shopee';
            } else {
              await mac.meliUpdateStock(env, map.meli_item_id!, newValue ?? 0, map.meli_variation_id ? Number(map.meli_variation_id) : undefined);
              propagatedTo = 'meli';
            }
            stats.applied++;
          } catch (e: any) {
            errorMsg = String(e.message || e);
            stats.errors++;
          }
        }

        await db.logChange(env.DB, {
          sku: map.sku, source, trigger: triggerKind,
          meli_before: meliBefore, meli_after: shadow ? meliStockNow : newValue,
          shopee_before: shopeeBefore, shopee_after: shadow ? shopeeStockNow : newValue,
          delta: (newValue ?? 0) - (masterBefore ?? 0),
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
  } finally {
    stats.notes = errs.slice(0, 5).join(' | ');
    await db.finishRun(env.DB, runId, stats);
  }

  return stats;
}

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
