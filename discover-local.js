/**
 * Discovery — varre ML + Shopee, pareia por SKU, envia para o Worker via API.
 * Roda no PC ou no GitHub Actions. Não precisa do wrangler CLI.
 *
 * Uso local:  node discover-local.js
 * GitHub Actions: configurar secrets WORKER_URL, ADMIN_TOKEN, MAC_API_KEY
 */

const MAC_URL = process.env.MAC_URL   || 'https://keymlnklhffwnleruvpy.supabase.co/functions/v1/marketplace-mcp';
const MAC_KEY = process.env.MAC_API_KEY || 'mc_live_81ae21dc00069526c08cad3e564d17eb10d056c4ba6cf92a8d523d5b0b0bf65a';
const MELI_USER_ID = process.env.MELI_USER_ID || '1826916479';
const WORKER_URL   = process.env.WORKER_URL   || 'https://stock-sync.wengcarlos005.workers.dev';
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  console.error('❌ ADMIN_TOKEN não definido. Export ADMIN_TOKEN=seu_token antes de rodar.');
  process.exit(1);
}

let lastCall = 0;
async function throttle(ms = 400) {
  const wait = ms - (Date.now() - lastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

async function macCall(action, params = {}) {
  await throttle();
  const res = await fetch(MAC_URL, {
    method: 'POST',
    headers: { 'x-api-key': MAC_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`MAC ${action} HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return j.data;
}

async function workerApi(path, method = 'GET', body = null) {
  const res = await fetch(WORKER_URL + path, {
    method,
    headers: { 'x-admin-token': ADMIN_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Worker ${path} HTTP ${res.status}`);
  return res.json();
}

function getMeliSku(item) {
  const attr = (item.attributes || []).find(a => a.id === 'SELLER_SKU');
  return attr?.value_name || null;
}
function getMeliVariationSku(v) {
  if (v.seller_custom_field) return v.seller_custom_field;
  const attr = (v.attributes || []).find(a => a.id === 'SELLER_SKU');
  return attr?.value_name || null;
}

async function main() {
  console.log('=== Discovery (via Worker API) ===\n');
  const skuToShopee = {};
  const skuToMeli   = {};

  // ── SHOPEE ──────────────────────────────────────────────
  console.log('Varrendo Shopee...');
  let shopeeIds = [];
  let offset = 0;
  while (true) {
    const d = await macCall('shopee_list_items', { page_size: 50, offset });
    const items = d?.response?.item || [];
    shopeeIds.push(...items.map(i => i.item_id));
    if (!d?.response?.has_next_page) break;
    offset = d.response.next_offset;
    if (shopeeIds.length > 5000) break;
  }
  console.log(`  ${shopeeIds.length} items encontrados`);

  for (let i = 0; i < shopeeIds.length; i++) {
    const id = shopeeIds[i];
    process.stdout.write(`  Shopee ${i + 1}/${shopeeIds.length}...\r`);
    try {
      const d = await macCall('shopee_get_item', { item_id: id });
      const item = d?.response?.item_list?.[0];
      if (!item) continue;
      if (item.has_model) {
        const md = await macCall('shopee_get_models', { item_id: id });
        for (const m of md?.response?.model || []) {
          const sku = m.model_sku?.trim();
          if (!sku) continue;
          skuToShopee[sku] = { item_id: String(id), model_id: String(m.model_id), name: `${item.item_name} - ${m.model_name || ''}` };
        }
      } else {
        const sku = item.item_sku?.trim();
        if (!sku) continue;
        skuToShopee[sku] = { item_id: String(id), model_id: null, name: item.item_name || '' };
      }
    } catch (e) { console.error(`\n  ERRO shopee ${id}: ${e.message}`); }
  }
  console.log(`\n  SKUs Shopee: ${Object.keys(skuToShopee).length}`);

  // ── MERCADO LIVRE ────────────────────────────────────────
  console.log('\nVarrendo Mercado Livre...');
  let meliIds = [], meliOffset = 0;
  while (true) {
    const d = await macCall('raw', { method: 'GET', path: `/users/${MELI_USER_ID}/items/search?limit=50&offset=${meliOffset}` });
    const results = d?.results || [];
    meliIds.push(...results);
    if (results.length < 50) break;
    meliOffset += 50;
    if (meliIds.length > 5000) break;
  }
  console.log(`  ${meliIds.length} items encontrados`);

  for (let i = 0; i < meliIds.length; i++) {
    const id = meliIds[i];
    process.stdout.write(`  ML ${i + 1}/${meliIds.length}...\r`);
    try {
      const item = await macCall('raw', { method: 'GET', path: `/items/${id}` });
      if (!item) continue;
      if (item.variations?.length > 0) {
        for (const v of item.variations) {
          const sku = getMeliVariationSku(v)?.trim();
          if (!sku) continue;
          const combo = (v.attribute_combinations || []).map(c => c.value_name).filter(Boolean).join('/');
          skuToMeli[sku] = { item_id: id, variation_id: String(v.id), name: (item.title || '') + (combo ? ' - ' + combo : '') };
        }
      } else {
        const sku = getMeliSku(item)?.trim();
        if (!sku) continue;
        skuToMeli[sku] = { item_id: id, variation_id: null, name: item.title || '' };
      }
    } catch (e) { console.error(`\n  ERRO meli ${id}: ${e.message}`); }
  }
  console.log(`\n  SKUs ML: ${Object.keys(skuToMeli).length}`);

  // ── PAREAR ───────────────────────────────────────────────
  console.log('\nPareando e enviando para o Worker...');

  const shopeeById = {};
  for (const [sku, s] of Object.entries(skuToShopee)) shopeeById[s.item_id] = { ...s, sku };

  const pairedShopeeIds = new Set();
  const pairedMeliSkus  = new Set();
  let mapped = 0, mapErrors = 0;

  for (const [meliSku, m] of Object.entries(skuToMeli)) {
    let shopeeEntry = null, canonicalSku = meliSku;

    // Estratégia 1: SELLER_SKU = "SHOPEE_<item_id>"
    if (meliSku.startsWith('SHOPEE_')) {
      const shopeeId = meliSku.replace(/^SHOPEE_/, '');
      shopeeEntry = shopeeById[shopeeId] || null;
      if (shopeeEntry) canonicalSku = shopeeEntry.sku;
    }
    // Estratégia 2: SKU real comum
    if (!shopeeEntry && meliSku in skuToShopee) {
      shopeeEntry = { ...skuToShopee[meliSku], sku: meliSku };
    }
    if (!shopeeEntry) continue;

    pairedShopeeIds.add(shopeeEntry.item_id);
    pairedMeliSkus.add(meliSku);

    try {
      await workerApi('/api/mappings', 'POST', {
        sku: canonicalSku,
        meli_item_id: m.item_id,
        meli_variation_id: m.variation_id,
        shopee_item_id: shopeeEntry.item_id,
        shopee_model_id: shopeeEntry.model_id,
        product_name: m.name || shopeeEntry.name,
      });
      mapped++;
    } catch (e) { mapErrors++; }
  }

  // ── UNMAPPED: enviar em lotes de 50 ─────────────────────
  const unmappedItems = [];
  for (const [sku, m] of Object.entries(skuToMeli)) {
    if (!pairedMeliSkus.has(sku))
      unmappedItems.push({ platform: 'meli', sku, item_id: m.item_id, variation_id: m.variation_id, product_name: m.name });
  }
  for (const [sku, s] of Object.entries(skuToShopee)) {
    if (!pairedShopeeIds.has(s.item_id))
      unmappedItems.push({ platform: 'shopee', sku, item_id: s.item_id, variation_id: s.model_id, product_name: s.name });
  }

  let unmappedInserted = 0;
  for (let i = 0; i < unmappedItems.length; i += 50) {
    const batch = unmappedItems.slice(i, i + 50);
    try {
      const r = await workerApi('/api/catalog/bulk', 'POST', { items: batch });
      unmappedInserted += r.inserted || 0;
    } catch (e) { console.error(`  ERRO bulk ${i}: ${e.message}`); }
  }

  console.log(`\n✅ Discovery concluído:`);
  console.log(`   Shopee: ${shopeeIds.length} items | ML: ${meliIds.length} items`);
  console.log(`   ✔ Pareados: ${mapped} (${mapErrors} erros)`);
  console.log(`   ? Não pareados inseridos: ${unmappedInserted}/${unmappedItems.length}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
