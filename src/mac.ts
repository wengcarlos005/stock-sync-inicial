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
  // MAC tem 2 envelopes possíveis para o action 'raw':
  //  (a) Top-level: { status, data, _skill_update }      → body = json.data
  //  (b) Outer wrap: { data: { status, data, _skill_update } } → body = json.data.data
  if (action === 'raw') {
    if (json && typeof json === 'object' && typeof json.status === 'number' && 'data' in json) {
      return json.data; // formato (a)
    }
    if (json && json.data && typeof json.data === 'object' && typeof json.data.status === 'number' && 'data' in json.data) {
      return json.data.data; // formato (b)
    }
  }
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
  const limit = 50;
  // ML só retorna 'active' por padrão. Itera por status pra pegar pausados/inativos também.
  for (const status of ['active', 'paused', 'closed', 'under_review']) {
    let offset = 0;
    while (true) {
      const d = await meliRaw(env, 'GET', `/users/${userId}/items/search?status=${status}&limit=${limit}&offset=${offset}`);
      const results = d?.results || [];
      ids.push(...results);
      if (results.length < limit) break;
      offset += limit;
      if (ids.length > 5000) break;
    }
    if (ids.length > 5000) break;
  }
  return Array.from(new Set(ids));
}

export async function meliGetItem(env: MacEnv, itemId: string): Promise<MeliItem | null> {
  // include_attributes=all garante que variations[].attributes (com SELLER_SKU) venha preenchido
  return meliRaw(env, 'GET', `/items/${itemId}?include_attributes=all`);
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

/** Deriva o status real do pedido ML a partir das tags (porque `status` fica "paid" mesmo após envio) */
export function deriveMeliStatus(o: any): string {
  const tags: string[] = (o.tags || []).map((t: string) => String(t).toLowerCase());
  const base = String(o.status || '').toLowerCase();
  if (base === 'cancelled' || tags.includes('cancelled')) return 'cancelled';
  if (base === 'invalid') return 'invalid';
  if (tags.includes('delivered')) return 'delivered';
  if (tags.includes('shipped')) return 'shipped';
  if (tags.includes('ready_to_ship')) return 'ready_to_ship';
  if (tags.includes('pending_shipment') || tags.includes('not_delivered')) return base; // ainda paid
  return base;
}

/** Para Shopee: usa name real se disponível, senão buyer_username */
export function deriveShopeeName(o: any): string {
  const recipName = o.recipient_address?.name;
  if (recipName && recipName !== '****' && !String(recipName).includes('*')) return recipName;
  return o.buyer_username || '';
}

/** Busca pedidos ML desde sinceMs. Retorna array normalizado. */
export async function meliGetRecentOrders(env: MacEnv, userId: string, sinceMs: number): Promise<NormalizedOrder[]> {
  // 1. Lista pedidos recentes (resumo) - 1 chamada
  const d = await meliRaw(env, 'GET', `/orders/search?seller=${userId}&sort=date_desc&limit=50`);
  const results: any[] = d?.results || [];

  // Filtra antes de gastar chamadas
  const fresh = results.filter(o => {
    const created = new Date(o.date_created || o.last_updated).getTime();
    return created > sinceMs;
  });

  // 2. Para cada pedido novo, busca detalhe completo + imagem do item
  const itemImageCache = new Map<string, string | null>();

  async function getItemImage(itemId: string): Promise<string | null> {
    if (itemImageCache.has(itemId)) return itemImageCache.get(itemId)!;
    try {
      const r: any = await meliRaw(env, 'GET', `/items/${itemId}?attributes=thumbnail,secure_thumbnail,pictures`);
      const img = r?.secure_thumbnail || r?.thumbnail || r?.pictures?.[0]?.secure_url || r?.pictures?.[0]?.url || null;
      itemImageCache.set(itemId, img);
      return img;
    } catch {
      itemImageCache.set(itemId, null);
      return null;
    }
  }

  const out: NormalizedOrder[] = [];
  for (const summary of fresh) {
    let full: any = summary;
    try {
      full = (await meliRaw(env, 'GET', `/orders/${summary.id}`)) || summary;
    } catch { /* mantém summary */ }

    const created = new Date(full.date_created || full.last_updated).getTime();

    const items = await Promise.all((full.order_items || []).map(async (oi: any) => {
      // Variação ML: "Nome: Valor | Nome: Valor"
      const variationAttrs = (oi.item?.variation_attributes || [])
        .map((a: any) => {
          const v = a.value_name || a.value_id;
          return a.name && v ? `${a.name}: ${v}` : v;
        })
        .filter(Boolean)
        .join(' | ');

      const itemId = String(oi.item?.id || '');
      const image = itemId ? await getItemImage(itemId) : null;

      return {
        item_id: itemId,
        variation_id: oi.item?.variation_id ? String(oi.item.variation_id) : null,
        qty: Number(oi.quantity || 1),
        name: oi.item?.title || '',
        variation: variationAttrs || null,
        image,
        sku: oi.item?.seller_sku || oi.item?.seller_custom_field || '',
      };
    }));

    // Nome completo do comprador (com fallback pro nickname)
    const buyerName = [full.buyer?.first_name, full.buyer?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || full.buyer?.nickname || '';

    out.push({
      platform: 'meli',
      order_id: String(full.id),
      pack_id: full.pack_id ? String(full.pack_id) : null,
      status: deriveMeliStatus(full),
      buyer: buyerName,
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

  // 1. Listar order_sn — Shopee EXIGE order_status, então itera por todos os status relevantes
  const statuses = ['UNPAID','READY_TO_SHIP','PROCESSED','SHIPPED','COMPLETED','IN_CANCEL','CANCELLED','INVOICE_PENDING'];
  const orderSnSet = new Set<string>();
  for (const st of statuses) {
    let cursor = '';
    for (let page = 0; page < 5; page++) {
      const params: any = { time_range_field: 'create_time', time_from: sinceUnix, time_to: nowUnix, page_size: 50, order_status: st };
      if (cursor) params.cursor = cursor;
      let d: any;
      try { d = await call(env, 'shopee_list_orders', params); } catch { break; }
      for (const o of (d?.response?.order_list || [])) orderSnSet.add(o.order_sn);
      if (!d?.response?.more) break;
      cursor = d?.response?.next_cursor || '';
      if (!cursor) break;
    }
  }
  const orderSnList = [...orderSnSet];
  if (!orderSnList.length) return [];

  // 2. Buscar detalhes em lote — Shopee permite 50 por chamada
  const out: NormalizedOrder[] = [];
  for (let i = 0; i < orderSnList.length; i += 50) {
    const chunk = orderSnList.slice(i, i + 50);
    let detailData: any;
    try {
      detailData = await call(env, 'shopee_get_order_detail', {
        order_sn_list: chunk,
        response_optional_fields: 'buyer_username,buyer_user_id,item_list,recipient_address',
      });
    } catch { continue; }
    for (const o of detailData?.response?.order_list || []) {
      const items = (o.item_list || []).map((it: any) => ({
        item_id: String(it.item_id || ''),
        variation_id: it.model_id ? String(it.model_id) : null,
        qty: Number(it.model_quantity_purchased || 1),
        name: it.item_name || '',
        variation: it.model_name || null,
        image: it.image_info?.image_url || null,
        sku: it.model_sku || it.item_sku || '',
      }));
      const buyerName = deriveShopeeName(o);
      out.push({
        platform: 'shopee',
        order_id: String(o.order_sn),
        status: o.order_status || '',
        buyer: buyerName,
        created_at: (o.create_time || 0) * 1000,
        items,
      });
    }
  }
  return out;
}

export interface NormalizedOrder {
  platform: 'meli' | 'shopee';
  order_id: string;
  pack_id?: string | null;
  status: string;
  buyer: string;
  created_at: number;
  items: Array<{
    item_id: string;
    variation_id: string | null;
    qty: number;
    name: string;
    variation?: string | null;
    image?: string | null;
    sku: string;
  }>;
}
