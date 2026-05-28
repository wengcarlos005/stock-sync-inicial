// Auto-discovery: varre ML+Shopee, pareia por SKU, insere em mappings
import * as mac from './mac';
import * as db from './db';

interface DiscoveryResult {
  meli_items: number;
  shopee_items: number;
  mapped: number;
  unmapped_meli: number;
  unmapped_shopee: number;
  errors: string[];
}

export async function runDiscovery(env: mac.MacEnv & { DB: D1Database; MELI_USER_ID: string }): Promise<DiscoveryResult> {
  const errors: string[] = [];
  const skuToShopee: Record<string, { item_id: string; variation_id: string | null; name: string }> = {};
  const skuToMeli: Record<string, { item_id: string; variation_id: string | null; name: string }> = {};

  // --- Shopee ---
  let shopeeCount = 0;
  try {
    const ids = await mac.shopeeListItemIds(env);
    for (const id of ids) {
      try {
        const item = await mac.shopeeGetItem(env, id);
        if (!item) continue;
        shopeeCount++;
        if (item.has_model) {
          const models = await mac.shopeeGetModels(env, id);
          for (const m of models) {
            // Inclui TODAS as variações, mesmo sem SKU definido (gera placeholder)
            const sku = (m.model_sku?.trim()) || `sp-${id}-${m.model_id}`;
            skuToShopee[sku] = { item_id: String(id), variation_id: String(m.model_id), name: item.item_name + ' - ' + (m.model_name || '') };
          }
        } else {
          const sku = (item.item_sku?.trim()) || `sp-${id}`;
          skuToShopee[sku] = { item_id: String(id), variation_id: null, name: item.item_name || '' };
        }
      } catch (e: any) {
        errors.push(`shopee_get_item ${id}: ${e.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`shopee_list: ${e.message}`);
  }

  // --- Mercado Livre ---
  let meliCount = 0;
  try {
    const ids = await mac.meliListItemIds(env, env.MELI_USER_ID);
    for (const id of ids) {
      try {
        const item = await mac.meliGetItem(env, id);
        if (!item) continue;
        meliCount++;
        if (item.variations && item.variations.length > 0) {
          for (const v of item.variations) {
            const rawSku = mac.getMeliVariationSku(v);
            const sku = (rawSku?.trim()) || `ml-${id}-${v.id}`;
            const combo = (v.attribute_combinations || []).map(c => c.value_name).filter(Boolean).join('/');
            skuToMeli[sku] = { item_id: id, variation_id: String(v.id), name: (item.title || '') + (combo ? ' - ' + combo : '') };
          }
        } else {
          const rawSku = mac.getMeliSku(item);
          const sku = (rawSku?.trim()) || `ml-${id}`;
          skuToMeli[sku] = { item_id: id, variation_id: null, name: item.title || '' };
        }
      } catch (e: any) {
        errors.push(`meli_get_item ${id}: ${e.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`meli_list: ${e.message}`);
  }

  // --- Pair by matching SKU ---
  let mapped = 0;
  const matchingSkus = Object.keys(skuToMeli).filter(sku => sku in skuToShopee);
  for (const sku of matchingSkus) {
    const m = skuToMeli[sku];
    const s = skuToShopee[sku];
    await db.upsertMapping(env.DB, {
      sku,
      meli_item_id: m.item_id,
      meli_variation_id: m.variation_id,
      shopee_item_id: s.item_id,
      shopee_model_id: s.variation_id,
      product_name: m.name || s.name,
    });
    mapped++;
  }

  // --- Track unmapped (existem em só um lado) ---
  let unmappedMeli = 0;
  for (const [sku, m] of Object.entries(skuToMeli)) {
    if (!(sku in skuToShopee)) {
      await db.upsertUnmapped(env.DB, sku, 'meli', m.item_id, m.variation_id, m.name);
      unmappedMeli++;
    }
  }
  let unmappedShopee = 0;
  for (const [sku, s] of Object.entries(skuToShopee)) {
    if (!(sku in skuToMeli)) {
      await db.upsertUnmapped(env.DB, sku, 'shopee', s.item_id, s.variation_id, s.name);
      unmappedShopee++;
    }
  }

  return {
    meli_items: meliCount,
    shopee_items: shopeeCount,
    mapped,
    unmapped_meli: unmappedMeli,
    unmapped_shopee: unmappedShopee,
    errors,
  };
}
