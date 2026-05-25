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

// ============ Orders ============

/** Busca pedidos ML desde sinceMs. Retorna array normalizado. */
export async function meliGetRecentOrders(env: MacEnv, userId: string, sinceMs: number): Promise<NormalizedOrder[]> {
  // Pega últimos 50 pedidos ordenados por data (janela de 5min raramente passa disso)
  const d = await meliRaw(env, 'GET', `/orders/search?seller=${userId}&sort=date_desc&limit=50`);
  const results: any[] = d?.results || [];
  const out: NormalizedOrder[] = [];
  for (const o of results) {
    const created = new Date(o.date_created || o.last_updated).getTime();
    if (created <= sinceMs) continue; // já processado
    const items = (o.order_items || []).map((oi: any) => ({
      item_id: String(oi.item?.id || ''),
      variation_id: oi.item?.variation_id ? String(oi.item.variation_id) : null,
      qty: Number(oi.quantity || 1),
      name: oi.item?.title || '',
      sku: '',
    }));
    out.push({
      platform: 'meli',
      order_id: String(o.id),
      status: o.status || '',
      buyer: o.buyer?.nickname || '',
      created_at: created,
      items,
    });
  }
  return out;
}

/** Busca pedidos Shopee desde sinceMs. Retorna array normalizado. */
export async function shopeeGetRecentOrders(env: MacEnv, sinceMs: number): Promise<NormalizedOrder[]> {
  const sinceUnix = Math.max(Math.floor(sinceMs / 1000), Math.floor(Date.now() / 1000) - 15 * 24 * 3600);
  const nowUnix = Math.floor(Date.now() / 1000);

  // 1. Listar order_sn
  let listData: any;
  try {
    listData = await call(env, 'shopee_get_order_list', {
      time_range_field: 'create_time',
      time_from: sinceUnix,
      time_to: nowUnix,
      page_size: 50,
    });
  } catch { return []; } // se MAC não suporta, ignora silenciosamente

  const orderSnList: string[] = (listData?.response?.order_list || []).map((o: any) => o.order_sn);
  if (!orderSnList.length) return [];

  // 2. Buscar detalhes em lote
  let detailData: any;
  try {
    detailData = await call(env, 'shopee_get_order_detail', {
      order_sn_list: orderSnList,
      response_optional_fields: 'buyer_username,item_list',
    });
  } catch { return []; }

  const out: NormalizedOrder[] = [];
  for (const o of detailData?.response?.order_list || []) {
    const items = (o.item_list || []).map((it: any) => ({
      item_id: String(it.item_id || ''),
      variation_id: it.model_id ? String(it.model_id) : null,
      qty: Number(it.model_quantity_purchased || 1),
      name: it.item_name || '',
      sku: it.model_sku || it.item_sku || '',
    }));
    out.push({
      platform: 'shopee',
      order_id: String(o.order_sn),
      status: o.order_status || '',
      buyer: o.buyer_username || '',
      created_at: (o.create_time || 0) * 1000,
      items,
    });
  }
  return out;
}

export interface NormalizedOrder {
  platform: 'meli' | 'shopee';
  order_id: string;
  status: string;
  buyer: string;
  created_at: number;
  items: Array<{ item_id: string; variation_id: string | null; qty: number; name: string; sku: string }>;
}
