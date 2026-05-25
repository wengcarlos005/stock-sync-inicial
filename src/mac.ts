// Wrapper MAC API: chamadas comuns ML e Shopee
export interface MacEnv {
  MAC_URL: string;
  MAC_API_KEY: string;
}

export async function call(env: MacEnv, action: string, params: any = {}): Promise<any> {
  const res = await fetch(env.MAC_URL, {
    method: 'POST',
    headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MAC ${action} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json() as any;
  return json.data;
}

// ============ Shopee ============
export interface ShopeeItem {
  item_id: number;
  item_sku?: string;
  item_name?: string;
  has_model?: boolean;
  stock_info_v2?: { summary_info?: { total_available_stock?: number } };
  models?: Array<{ model_id: number; model_sku?: string; model_name?: string; stock_info_v2?: any }>;
}

export async function shopeeListItemIds(env: MacEnv): Promise<number[]> {
  const ids: number[] = [];
  let offset = 0;
  while (true) {
    const d = await call(env, 'shopee_list_items', { page_size: 50, offset });
    const items = d?.response?.item || [];
    for (const it of items) ids.push(it.item_id);
    if (!d?.response?.has_next_page) break;
    offset = d.response.next_offset;
    if (ids.length > 5000) break;
  }
  return ids;
}

export async function shopeeGetItem(env: MacEnv, itemId: number): Promise<ShopeeItem | null> {
  const d = await call(env, 'shopee_get_item', { item_id: itemId });
  return d?.response?.item_list?.[0] || null;
}

export async function shopeeGetModels(env: MacEnv, itemId: number): Promise<any[]> {
  const d = await call(env, 'shopee_get_models', { item_id: itemId });
  return d?.response?.model || [];
}

export async function shopeeUpdateStock(
  env: MacEnv,
  itemId: number,
  newStock: number,
  modelId?: number
): Promise<any> {
  const stockList = modelId
    ? [{ model_id: modelId, seller_stock: [{ stock: newStock }] }]
    : [{ seller_stock: [{ stock: newStock }] }];
  return call(env, 'shopee_update_stock', { item_id: itemId, stock_list: stockList });
}

// ============ Mercado Livre ============
export interface MeliItem {
  id: string;
  title?: string;
  available_quantity?: number;
  attributes?: Array<{ id: string; value_name?: string }>;
  variations?: Array<{
    id: number;
    available_quantity?: number;
    attributes?: Array<{ id: string; value_name?: string }>;
    attribute_combinations?: Array<{ id: string; value_name?: string }>;
    seller_custom_field?: string;
  }>;
  user_product_id?: string;
}

export async function meliRaw(env: MacEnv, method: string, path: string, body?: any): Promise<any> {
  return call(env, 'raw', { method, path, body });
}

export async function meliListItemIds(env: MacEnv, userId: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const d = await meliRaw(env, 'GET', `/users/${userId}/items/search?limit=${limit}&offset=${offset}`);
    const results = d?.results || [];
    ids.push(...results);
    if (results.length < limit) break;
    offset += limit;
    if (ids.length > 5000) break;
  }
  return ids;
}

export async function meliGetItem(env: MacEnv, itemId: string): Promise<MeliItem | null> {
  return meliRaw(env, 'GET', `/items/${itemId}`);
}

export async function meliUpdateStock(env: MacEnv, itemId: string, qty: number, variationId?: number): Promise<any> {
  if (variationId) {
    return meliRaw(env, 'PUT', `/items/${itemId}`, {
      variations: [{ id: variationId, available_quantity: qty }],
    });
  }
  return meliRaw(env, 'PUT', `/items/${itemId}`, { available_quantity: qty });
}

export function getMeliSku(item: MeliItem): string | null {
  const attr = (item.attributes || []).find(a => a.id === 'SELLER_SKU');
  return attr?.value_name || null;
}

export function getMeliVariationSku(variation: any): string | null {
  if (variation.seller_custom_field) return variation.seller_custom_field;
  const attr = (variation.attributes || []).find((a: any) => a.id === 'SELLER_SKU');
  return attr?.value_name || null;
}
