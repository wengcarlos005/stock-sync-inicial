/**
 * Discovery — varre ML + Shopee, pareia por SKU, envia para o Worker via API.
 * Inclui TODOS os produtos ML no unmapped (mesmo sem SELLER_SKU configurado).
 */

const MAC_URL = process.env.MAC_URL   || 'https://keymlnklhffwnleruvpy.supabase.co/functions/v1/marketplace-mcp';
const MAC_KEY = process.env.MAC_API_KEY || 'mc_live_81ae21dc00069526c08cad3e564d17eb10d056c4ba6cf92a8d523d5b0b0bf65a';
const MELI_USER_ID = process.env.MELI_USER_ID || '1826916479';
const WORKER_URL   = process.env.WORKER_URL   || 'https://stock-sync.wengcarlos005.workers.dev';
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  console.error('❌ ADMIN_TOKEN não definido.');
  process.exit(1);
}

let lastCall = 0;
async function throttle(ms = 350) {
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
  return attr?.value_name?.trim() || null;
}
function getMeliVariationSku(v) {
  if (v.seller_custom_field?.trim()) return v.seller_custom_field.trim();
  const attr = (v.attributes || []).find(a => a.id === 'SELLER_SKU');
  return attr?.value_name?.trim() || null;
}
// Normaliza string para comparação: remove acentos, espaços/separadores → '-', lowercase
function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s\/\-_]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/^-+|-+$/g, '');
}
function getMeliVariationCombo(v) {
  const parts = (v.attribute_combinations || []).map(c => c.value_name).filter(Boolean);
  return parts.length ? parts.join('-') : null;
}

async function main() {
  console.log('=== Discovery ===\n');

  const skuToShopee = {};  // sku → {item_id, model_id, name, modelName}
  const skuToMeli   = {};  // sku → {item_id, variation_id, name, combo}
  const meliNoSku   = [];  // items ML sem SELLER_SKU → Estratégia 3 ou unmapped manual
  const normTitleToShopee = {};  // normalize(shopee_item_name) → [{item_id, model_id, modelName, sku}]

  // ── SHOPEE ──────────────────────────────────────────────────
  console.log('Varrendo Shopee...');
  let shopeeIds = [], offset = 0;
  while (true) {
    const d = await macCall('shopee_list_items', { page_size: 50, offset });
    const items = d?.response?.item || [];
    shopeeIds.push(...items.map(i => i.item_id));
    if (!d?.response?.has_next_page) break;
    offset = d.response.next_offset;
    if (shopeeIds.length > 5000) break;
  }
  console.log(`  ${shopeeIds.length} items`);

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
          const normTitle = normalize(item.item_name || '');
          if (!normTitleToShopee[normTitle]) normTitleToShopee[normTitle] = [];
          normTitleToShopee[normTitle].push({ item_id: String(id), model_id: String(m.model_id), modelName: m.model_name || '', sku: sku || null });
          if (!sku) continue;
          skuToShopee[sku] = { item_id: String(id), model_id: String(m.model_id), name: `${item.item_name} - ${m.model_name || ''}`, modelName: m.model_name || '' };
        }
      } else {
        const sku = item.item_sku?.trim();
        const normTitle = normalize(item.item_name || '');
        if (!normTitleToShopee[normTitle]) normTitleToShopee[normTitle] = [];
        normTitleToShopee[normTitle].push({ item_id: String(id), model_id: null, modelName: '', sku: sku || null });
        if (!sku) continue;
        skuToShopee[sku] = { item_id: String(id), model_id: null, name: item.item_name || '', modelName: '' };
      }
    } catch (e) { console.error(`\n  ERRO shopee ${id}: ${e.message}`); }
  }
  console.log(`\n  SKUs Shopee: ${Object.keys(skuToShopee).length}`);

  // ── MERCADO LIVRE ────────────────────────────────────────────
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
  console.log(`  ${meliIds.length} items`);

  for (let i = 0; i < meliIds.length; i++) {
    const id = meliIds[i];
    process.stdout.write(`  ML ${i + 1}/${meliIds.length}...\r`);
    try {
      const item = await macCall('raw', { method: 'GET', path: `/items/${id}` });
      if (!item) continue;

      if (item.variations?.length > 0) {
        for (const v of item.variations) {
          const sku = getMeliVariationSku(v);
          const combo = (v.attribute_combinations || []).map(c => c.value_name).filter(Boolean).join('/');
          const name = (item.title || '') + (combo ? ' — ' + combo : '');
          if (sku) {
            skuToMeli[sku] = { item_id: id, variation_id: String(v.id), name, combo: getMeliVariationCombo(v) };
          } else {
            // Sem SKU: guarda para Estratégia 3 (combo) ou unmapped manual
            meliNoSku.push({ item_id: id, variation_id: String(v.id), name, sku: '', itemTitle: item.title || '', combo: getMeliVariationCombo(v) });
          }
        }
      } else {
        const sku = getMeliSku(item);
        const name = item.title || '';
        if (sku) {
          skuToMeli[sku] = { item_id: id, variation_id: null, name, combo: null };
        } else {
          meliNoSku.push({ item_id: id, variation_id: null, name, sku: '', itemTitle: item.title || '', combo: null });
        }
      }
    } catch (e) { console.error(`\n  ERRO meli ${id}: ${e.message}`); }
  }
  console.log(`\n  SKUs ML: ${Object.keys(skuToMeli).length} | Sem SKU: ${meliNoSku.length}`);

  // ── PAREAR ───────────────────────────────────────────────────
  console.log('\nPareando...');
  // shopeeByItemId: item_id → array de modelos (para Strategy 1 com SHOPEE_ prefix)
  const shopeeByItemId = {};
  for (const [sku, s] of Object.entries(skuToShopee)) {
    if (!shopeeByItemId[s.item_id]) shopeeByItemId[s.item_id] = [];
    shopeeByItemId[s.item_id].push({ ...s, sku });
  }
  // shopeeById: item_id → primeiro modelo (compatibilidade) — DEPRECATED, use shopeeByItemId
  const shopeeById = {};
  for (const [id, arr] of Object.entries(shopeeByItemId)) shopeeById[id] = arr[0];

  const pairedShopeeIds = new Set();
  const pairedMeliSkus  = new Set();
  let mapped = 0, mapErrors = 0;

  for (const [meliSku, m] of Object.entries(skuToMeli)) {
    let shopeeEntry = null, canonicalSku = meliSku;

    // Estratégia 1: SELLER_SKU = "SHOPEE_<item_id>" — casa pelo item_id Shopee
    if (meliSku.startsWith('SHOPEE_')) {
      const shopeeId = meliSku.replace(/^SHOPEE_/, '');
      const allModels = shopeeByItemId[shopeeId] || [];
      if (allModels.length === 1) {
        shopeeEntry = allModels[0];
      } else if (allModels.length > 1) {
        // Múltiplos modelos Shopee: tenta casar pelo combo de atributos da variação ML
        const meliCombo = normalize(m.combo || '');
        shopeeEntry = (meliCombo && allModels.find(sm => normalize(sm.modelName || '') === meliCombo)) || allModels[0];
      }
      if (shopeeEntry) canonicalSku = shopeeEntry.sku;
    }
    // Estratégia 2: SKU idêntico nos dois lados
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

  // ── ESTRATÉGIA 3: ML sem SKU × Shopee por título + combo ────────
  console.log('\nEstratégia 3: pareando ML sem SKU por título + combo...');
  const pairedMeliItemVars = new Set();  // "item_id|variation_id" já pareados pela S3
  let s3paired = 0;

  for (const m of meliNoSku) {
    const titleKey = normalize(m.itemTitle || '');
    if (!titleKey) continue;
    const shopeeModels = normTitleToShopee[titleKey] || [];
    if (!shopeeModels.length) continue;

    let shopeeEntry = null;
    if (m.combo) {
      const normCombo = normalize(m.combo);
      // Casa por nome do modelo ou pelo sku do modelo (normalizado)
      shopeeEntry = shopeeModels.find(sm =>
        normalize(sm.modelName || '') === normCombo ||
        (sm.sku && normalize(sm.sku) === normCombo)
      ) || null;
    } else if (shopeeModels.length === 1) {
      // Produto simples sem variações em ambos os lados
      shopeeEntry = shopeeModels[0];
    }
    if (!shopeeEntry) continue;

    // SKU canônico: usa o do Shopee, senão gera por IDs
    const canonicalSku = shopeeEntry.sku || `ML${m.item_id}_SP${shopeeEntry.item_id}`;

    pairedShopeeIds.add(shopeeEntry.item_id);
    pairedMeliItemVars.add(`${m.item_id}|${m.variation_id}`);

    try {
      await workerApi('/api/mappings', 'POST', {
        sku: canonicalSku,
        meli_item_id: m.item_id,
        meli_variation_id: m.variation_id,
        shopee_item_id: shopeeEntry.item_id,
        shopee_model_id: shopeeEntry.model_id,
        product_name: m.name || '',
      });
      s3paired++;
      mapped++;
    } catch (e) { mapErrors++; }
  }
  console.log(`  Estratégia 3: ${s3paired} pareados`);

  // ── UNMAPPED ─────────────────────────────────────────────────
  const unmappedItems = [];

  // ML com SKU mas sem par Shopee
  for (const [sku, m] of Object.entries(skuToMeli)) {
    if (!pairedMeliSkus.has(sku))
      unmappedItems.push({ platform: 'meli', sku, item_id: m.item_id, variation_id: m.variation_id, product_name: m.name });
  }
  // ML sem SELLER_SKU — pula os já pareados pela Estratégia 3
  for (const m of meliNoSku) {
    if (pairedMeliItemVars.has(`${m.item_id}|${m.variation_id}`)) continue;
    unmappedItems.push({ platform: 'meli', sku: '', item_id: m.item_id, variation_id: m.variation_id, product_name: m.name });
  }
  // Shopee sem par ML
  for (const [sku, s] of Object.entries(skuToShopee)) {
    if (!pairedShopeeIds.has(s.item_id))
      unmappedItems.push({ platform: 'shopee', sku, item_id: s.item_id, variation_id: s.model_id, product_name: s.name });
  }

  let unmappedInserted = 0;
  for (let i = 0; i < unmappedItems.length; i += 50) {
    try {
      const r = await workerApi('/api/catalog/bulk', 'POST', { items: unmappedItems.slice(i, i + 50) });
      unmappedInserted += r.inserted || 0;
    } catch (e) { console.error(`  ERRO bulk ${i}: ${e.message}`); }
  }

  // ── DIAGNÓSTICO DE PEDIDOS ───────────────────────────────────
  console.log('\nTestando acesso a pedidos ML...');
  try {
    const orders = await macCall('raw', { method: 'GET', path: `/orders/search?seller=${MELI_USER_ID}&sort=date_desc&limit=5` });
    const count = orders?.results?.length ?? 0;
    console.log(`  ✅ ML orders API: ${count} pedidos recentes encontrados`);
    if (count > 0) console.log(`  Primeiro: #${orders.results[0].id} status=${orders.results[0].status}`);
  } catch (e) {
    console.log(`  ❌ ML orders API indisponível via MAC: ${e.message}`);
  }

  try {
    const shopeeOrders = await macCall('shopee_get_order_list', { time_range_field: 'create_time', time_from: Math.floor(Date.now()/1000) - 86400, time_to: Math.floor(Date.now()/1000), page_size: 5 });
    const count = shopeeOrders?.response?.order_list?.length ?? 0;
    console.log(`  ✅ Shopee orders API: ${count} pedidos recentes encontrados`);
  } catch (e) {
    console.log(`  ❌ Shopee orders API indisponível via MAC: ${e.message}`);
  }

  console.log(`\n✅ Discovery concluído:`);
  console.log(`   Shopee: ${shopeeIds.length} items | ML: ${meliIds.length} items`);
  console.log(`   ✔ Pareados: ${mapped} (${mapErrors} erros)`);
  console.log(`   📋 Não pareados: ${unmappedInserted}/${unmappedItems.length} (${meliNoSku.length - s3paired} ML sem SKU restantes após Estratégia 3)`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
