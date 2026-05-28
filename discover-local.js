/**
 * Discovery v3 — pareamento robusto ML × Shopee.
 *
 * Estratégias (em ordem):
 *  1. SKU exato (extraído de TODOS campos possíveis dos dois lados)
 *  2. SHOPEE_<item_id> no SELLER_SKU ML → casa pelo item_id Shopee + combo
 *  3. Título do item (normalizado) + parte do combo de variação
 *  4. Título do item (normalizado) puro (produtos sem variação dos dois lados)
 *
 * Suporte a DEBUG=1: dumpa estrutura crua dos primeiros 3 itens ML e Shopee.
 */

// URL nova do MAC (antiga keymlnklhffwnleruvpy.supabase.co foi descontinuada em 2026-05)
const MAC_URL_DEFAULT = 'https://ucxjnhqjegqkoevsdjwa.supabase.co/functions/v1/marketplace-mcp';
const MAC_URL = (process.env.MAC_URL && !process.env.MAC_URL.includes('keymlnklhffwnleruvpy')) ? process.env.MAC_URL : MAC_URL_DEFAULT;
const MAC_KEY = process.env.MAC_API_KEY || 'mc_live_81ae21dc00069526c08cad3e564d17eb10d056c4ba6cf92a8d523d5b0b0bf65a';
const MELI_USER_ID = process.env.MELI_USER_ID || '1826916479';
const WORKER_URL   = process.env.WORKER_URL   || 'https://stock-sync.wengcarlos005.workers.dev';
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN;
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

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
  if (action === 'raw') {
    if (j && typeof j === 'object' && typeof j.status === 'number' && 'data' in j) return j.data;
    if (j && j.data && typeof j.data === 'object' && typeof j.data.status === 'number' && 'data' in j.data) return j.data.data;
  }
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

// ── Helpers de extração de SKU (cobre TODOS os campos possíveis) ──
function pickSkuMeliItem(item) {
  // Item-level ML: tenta seller_custom_field, depois attribute SELLER_SKU
  const candidates = [
    item.seller_custom_field,
    item.seller_sku,
    (item.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name,
    (item.attributes || []).find(a => a.id === 'SELLER_SKU')?.values?.[0]?.name,
  ];
  for (const c of candidates) if (c && String(c).trim()) return String(c).trim();
  return null;
}
function pickSkuMeliVariation(v) {
  const candidates = [
    v.seller_custom_field,
    v.seller_sku,
    (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name,
    (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.values?.[0]?.name,
  ];
  for (const c of candidates) if (c && String(c).trim()) return String(c).trim();
  return null;
}

// Combo: lista de value_names dos attribute_combinations
function comboParts(v) {
  return (v.attribute_combinations || [])
    .map(c => c.value_name)
    .filter(Boolean)
    .map(s => String(s).trim());
}

// Normaliza pra comparação: minúsculo, sem acento, separadores → '-', remove não-alfanum
function normalize(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s\/\-_]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/^-+|-+$/g, '');
}

// Stopwords pra remover dos tokens de título (palavras genéricas)
const STOPWORDS = new Set([
  'de','do','da','dos','das','para','com','em','no','na','nos','nas','e','o','a','os','as',
  '2','em','1','3','4','5','6','7','8','9','10','un','und','unidade','unidades','pcs','pç','pçs',
  'brinquedo','brinquedos','infantil','crianca','criancas','menino','menina','educativo','educatil',
  'kit','novo','original','promocao','importado','pronto','entrega','frete','gratis',
]);

// Tokeniza título: normaliza, split por '-', remove stopwords e tokens curtos
function titleTokens(s) {
  const norm = normalize(s);
  if (!norm) return [];
  return norm.split('-').filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

// Similaridade Jaccard entre dois sets de tokens
function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

async function main() {
  console.log('=== Discovery v3 ===\n');

  const skuToShopee  = {};   // normalize(sku) → entry
  const itemTitleToShopee = {};  // normalize(item_name) → array de entries
  const shopeeByItemId = {}; // shopee item_id → array de entries

  // MELI: indexação dupla — por SKU e por título+combo
  const skuToMeli = {};      // normalize(sku) → entry
  const meliItems = [];      // todos os ML items para parear depois
  const meliNoSku = [];      // ML variations sem SKU

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

  let debugShopeeDumped = 0;
  for (let i = 0; i < shopeeIds.length; i++) {
    const id = shopeeIds[i];
    process.stdout.write(`  Shopee ${i + 1}/${shopeeIds.length}...\r`);
    try {
      const d = await macCall('shopee_get_item', { item_id: id });
      const item = d?.response?.item_list?.[0];
      if (!item) continue;

      if (DEBUG && debugShopeeDumped < 3) {
        console.log(`\n[DEBUG Shopee ${id}]`);
        console.log('  item.item_name:', item.item_name);
        console.log('  item.item_sku:', JSON.stringify(item.item_sku));
        console.log('  item.has_model:', item.has_model);
        console.log('  item.tier_variation:', JSON.stringify(item.tier_variation));
        debugShopeeDumped++;
      }

      const normTitle = normalize(item.item_name || '');
      if (!itemTitleToShopee[normTitle]) itemTitleToShopee[normTitle] = [];
      if (!shopeeByItemId[String(id)]) shopeeByItemId[String(id)] = [];

      if (item.has_model) {
        const md = await macCall('shopee_get_models', { item_id: id });
        const models = md?.response?.model || [];
        if (DEBUG && debugShopeeDumped <= 3) {
          for (const m of models.slice(0, 3)) {
            console.log(`  model_id=${m.model_id} model_sku=${JSON.stringify(m.model_sku)} model_name=${JSON.stringify(m.model_name)}`);
          }
        }
        for (const m of models) {
          const sku = (m.model_sku || '').toString().trim();
          const modelName = (m.model_name || '').toString().trim();
          const entry = {
            item_id: String(id),
            model_id: String(m.model_id),
            modelName,
            sku: sku || null,
            itemName: item.item_name || '',
            normModelName: normalize(modelName),
          };
          itemTitleToShopee[normTitle].push(entry);
          shopeeByItemId[String(id)].push(entry);
          if (sku) skuToShopee[normalize(sku)] = entry;
        }
      } else {
        const sku = (item.item_sku || '').toString().trim();
        const entry = {
          item_id: String(id),
          model_id: null,
          modelName: '',
          sku: sku || null,
          itemName: item.item_name || '',
          normModelName: '',
        };
        itemTitleToShopee[normTitle].push(entry);
        shopeeByItemId[String(id)].push(entry);
        if (sku) skuToShopee[normalize(sku)] = entry;
      }
    } catch (e) { console.error(`\n  ERRO shopee ${id}: ${e.message}`); }
  }
  console.log(`\n  Shopee SKUs indexados: ${Object.keys(skuToShopee).length} | títulos: ${Object.keys(itemTitleToShopee).length}`);

  // ── MERCADO LIVRE ────────────────────────────────────────────
  console.log('\nVarrendo Mercado Livre (todos os status: active/paused/closed)...');
  let meliIds = [];
  // ML retorna só ativos por padrão. Itera por status pra pegar também pausados/inativos.
  for (const status of ['active', 'paused', 'closed', 'under_review']) {
    let meliOffset = 0;
    let countForStatus = 0;
    while (true) {
      const d = await macCall('raw', { method: 'GET', path: `/users/${MELI_USER_ID}/items/search?status=${status}&limit=50&offset=${meliOffset}` });
      const results = d?.results || [];
      meliIds.push(...results);
      countForStatus += results.length;
      if (results.length < 50) break;
      meliOffset += 50;
      if (meliIds.length > 5000) break;
    }
    console.log(`  status=${status}: ${countForStatus} items`);
    if (meliIds.length > 5000) break;
  }
  // Dedup (mesmo item não deveria aparecer em 2 status, mas garante)
  meliIds = Array.from(new Set(meliIds));
  console.log(`  total único: ${meliIds.length} items`);

  let debugMeliDumped = 0;
  for (let i = 0; i < meliIds.length; i++) {
    const id = meliIds[i];
    process.stdout.write(`  ML ${i + 1}/${meliIds.length}...\r`);
    try {
      const item = await macCall('raw', { method: 'GET', path: `/items/${id}?include_attributes=all` });
      if (!item) continue;

      if (DEBUG && debugMeliDumped < 3) {
        console.log(`\n[DEBUG ML ${id}]`);
        console.log('  title:', item.title);
        console.log('  item.seller_custom_field:', JSON.stringify(item.seller_custom_field));
        console.log('  item.seller_sku:', JSON.stringify(item.seller_sku));
        const itemSkuAttr = (item.attributes || []).find(a => a.id === 'SELLER_SKU');
        console.log('  item SELLER_SKU attr:', JSON.stringify(itemSkuAttr?.value_name), 'values:', JSON.stringify(itemSkuAttr?.values));
        console.log('  variations.length:', (item.variations || []).length);
        for (const v of (item.variations || []).slice(0, 3)) {
          console.log(`    v.id=${v.id}`);
          console.log(`      seller_custom_field=${JSON.stringify(v.seller_custom_field)}`);
          console.log(`      seller_sku=${JSON.stringify(v.seller_sku)}`);
          const vAttr = (v.attributes || []).find(a => a.id === 'SELLER_SKU');
          console.log(`      SELLER_SKU attr=${JSON.stringify(vAttr?.value_name)} values=${JSON.stringify(vAttr?.values)}`);
          console.log(`      attr_combos=${JSON.stringify(comboParts(v))}`);
          console.log(`      all_attr_ids=${JSON.stringify((v.attributes || []).map(a => a.id))}`);
        }
        debugMeliDumped++;
      }

      const itemTitle = item.title || '';
      if (item.variations?.length > 0) {
        for (const v of item.variations) {
          const sku = pickSkuMeliVariation(v);
          const parts = comboParts(v);
          const fullCombo = parts.join('/');
          const name = itemTitle + (fullCombo ? ' — ' + fullCombo : '');
          const entry = {
            item_id: id,
            variation_id: String(v.id),
            name,
            itemTitle,
            comboParts: parts,
            sku,
          };
          if (sku) skuToMeli[normalize(sku)] = entry;
          else meliNoSku.push(entry);
          meliItems.push(entry);
        }
      } else {
        const sku = pickSkuMeliItem(item);
        const entry = {
          item_id: id, variation_id: null,
          name: itemTitle, itemTitle, comboParts: [], sku,
        };
        if (sku) skuToMeli[normalize(sku)] = entry;
        else meliNoSku.push(entry);
        meliItems.push(entry);
      }
    } catch (e) { console.error(`\n  ERRO meli ${id}: ${e.message}`); }
  }
  console.log(`\n  ML: ${Object.keys(skuToMeli).length} com SKU | ${meliNoSku.length} sem SKU`);

  // ── PAREAMENTO ─────────────────────────────────────────────────
  const pairedShopeeKeys = new Set(); // "item_id|model_id"
  const pairedMeliKeys = new Set();   // "item_id|variation_id"
  let mapped = 0, mapErrors = 0;
  const strategyStats = { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0 };

  async function createMapping(canonicalSku, meliE, shopeeE, strategyTag) {
    if (!canonicalSku) canonicalSku = `ML${meliE.item_id}_SP${shopeeE.item_id}${shopeeE.model_id ? '_M' + shopeeE.model_id : ''}`;
    try {
      await workerApi('/api/mappings', 'POST', {
        sku: canonicalSku,
        meli_item_id: meliE.item_id,
        meli_variation_id: meliE.variation_id,
        shopee_item_id: shopeeE.item_id,
        shopee_model_id: shopeeE.model_id,
        product_name: meliE.name || shopeeE.itemName,
      });
      pairedShopeeKeys.add(`${shopeeE.item_id}|${shopeeE.model_id || ''}`);
      pairedMeliKeys.add(`${meliE.item_id}|${meliE.variation_id || ''}`);
      mapped++;
      strategyStats[strategyTag]++;
      return true;
    } catch (e) { mapErrors++; return false; }
  }

  // ── ESTRATÉGIA 5: Shopee model_sku é o variation_id (ou item_id) do ML ──
  // Padrão comum: seller cadastra o ID da variação ML como SKU do modelo Shopee.
  console.log('\nEstratégia 5: Shopee SKU é o ID da variação ML...');
  for (const meliE of meliItems) {
    const mlKey = `${meliE.item_id}|${meliE.variation_id || ''}`;
    if (pairedMeliKeys.has(mlKey)) continue;
    // Tenta variation_id primeiro (mais comum), depois item_id
    const candidates = [meliE.variation_id, meliE.item_id].filter(Boolean);
    for (const c of candidates) {
      const norm = normalize(String(c));
      const shopeeE = skuToShopee[norm];
      if (!shopeeE) continue;
      const spKey = `${shopeeE.item_id}|${shopeeE.model_id || ''}`;
      if (pairedShopeeKeys.has(spKey)) continue;
      await createMapping(shopeeE.sku || String(c), meliE, shopeeE, 's5');
      break;
    }
  }
  console.log(`  ✔ ${strategyStats.s5} pareados`);

  // ── ESTRATÉGIA 1: SKU exato (normalizado) dos dois lados ────
  console.log('\nEstratégia 1: SKU exato normalizado...');
  for (const meliE of meliItems) {
    if (!meliE.sku) continue;
    if (pairedMeliKeys.has(`${meliE.item_id}|${meliE.variation_id || ''}`)) continue;
    const normSku = normalize(meliE.sku);
    if (!normSku) continue;
    // Pula SKU prefixado SHOPEE_ — estratégia 2 trata
    if (meliE.sku.toUpperCase().startsWith('SHOPEE_')) continue;
    const shopeeE = skuToShopee[normSku];
    if (!shopeeE) continue;
    await createMapping(shopeeE.sku || meliE.sku, meliE, shopeeE, 's1');
  }
  console.log(`  ✔ ${strategyStats.s1} pareados`);

  // ── ESTRATÉGIA 2: SHOPEE_<item_id> ───────────────────────────
  console.log('Estratégia 2: prefixo SHOPEE_<id>...');
  for (const meliE of meliItems) {
    if (pairedMeliKeys.has(`${meliE.item_id}|${meliE.variation_id || ''}`)) continue;
    if (!meliE.sku || !meliE.sku.toUpperCase().startsWith('SHOPEE_')) continue;
    const shopeeId = meliE.sku.replace(/^SHOPEE_/i, '');
    const allModels = shopeeByItemId[shopeeId] || [];
    if (!allModels.length) continue;
    let shopeeE = null;
    if (allModels.length === 1) shopeeE = allModels[0];
    else {
      // Múltiplos modelos: casa por combo parts
      for (const part of meliE.comboParts) {
        const np = normalize(part);
        const found = allModels.find(sm => sm.normModelName === np || (sm.sku && normalize(sm.sku) === np));
        if (found) { shopeeE = found; break; }
      }
      if (!shopeeE) shopeeE = allModels[0];
    }
    await createMapping(shopeeE.sku || `SHOPEE_${shopeeId}`, meliE, shopeeE, 's2');
  }
  console.log(`  ✔ ${strategyStats.s2} pareados`);

  // ── ESTRATÉGIA 3: pareamento fuzzy de título + combo parts ──
  // Para cada item ML, acha o item Shopee mais similar (Jaccard de tokens
  // do título ≥ 0.5). Dentro desse par, pareia variação pelo combo.
  console.log('Estratégia 3: fuzzy título (Jaccard) + combo...');

  // Pré-computa tokens dos títulos Shopee, agrupados por item_id
  const shopeeItemMap = {}; // item_id → { itemName, tokens, models[] }
  for (const [itemId, arr] of Object.entries(shopeeByItemId)) {
    if (!arr.length) continue;
    const itemName = arr[0].itemName;
    shopeeItemMap[itemId] = { itemId, itemName, tokens: titleTokens(itemName), models: arr };
  }
  const shopeeItemEntries = Object.values(shopeeItemMap);

  // Agrupa items ML por meli_item_id pra processar 1 vez por anúncio ML
  const mlByItemId = {};
  for (const e of meliItems) {
    if (pairedMeliKeys.has(`${e.item_id}|${e.variation_id || ''}`)) continue;
    if (!mlByItemId[e.item_id]) mlByItemId[e.item_id] = { itemTitle: e.itemTitle, variants: [] };
    mlByItemId[e.item_id].variants.push(e);
  }

  for (const [mlItemId, ml] of Object.entries(mlByItemId)) {
    const mlTokens = titleTokens(ml.itemTitle);
    if (mlTokens.length < 2) continue;

    // Acha melhor Shopee item por Jaccard
    let bestSp = null, bestScore = 0;
    for (const sp of shopeeItemEntries) {
      if (!sp.tokens.length) continue;
      const score = jaccard(mlTokens, sp.tokens);
      if (score > bestScore) { bestScore = score; bestSp = sp; }
    }
    if (!bestSp || bestScore < 0.4) continue;

    // Pareia cada variação ML com modelo Shopee correspondente
    for (const meliE of ml.variants) {
      const mlKey = `${meliE.item_id}|${meliE.variation_id || ''}`;
      if (pairedMeliKeys.has(mlKey)) continue;

      let shopeeE = null;
      const availableModels = bestSp.models.filter(m => !pairedShopeeKeys.has(`${m.item_id}|${m.model_id || ''}`));
      if (!availableModels.length) continue;

      if (meliE.comboParts.length) {
        // Tenta casar cada parte do combo individualmente (resolve "32/Truck" → "Truck")
        for (const part of meliE.comboParts) {
          const np = normalize(part);
          if (!np) continue;
          const found = availableModels.find(c =>
            c.normModelName === np ||
            (c.sku && normalize(c.sku) === np) ||
            (c.sku && normalize(c.sku).endsWith('-' + np)) ||
            (c.sku && normalize(c.sku).startsWith(np + '-'))
          );
          if (found) { shopeeE = found; break; }
        }
      } else if (availableModels.length === 1) {
        shopeeE = availableModels[0];
      }
      if (!shopeeE) continue;
      await createMapping(shopeeE.sku || null, meliE, shopeeE, 's3');
    }
  }
  console.log(`  ✔ ${strategyStats.s3} pareados`);

  // ── ESTRATÉGIA 4: título ML normalizado puro (sem variação) ──
  console.log('Estratégia 4: título ML normalizado puro...');
  for (const meliE of meliItems) {
    if (pairedMeliKeys.has(`${meliE.item_id}|${meliE.variation_id || ''}`)) continue;
    if (meliE.comboParts.length > 0) continue; // só pra produtos sem variação
    const titleKey = normalize(meliE.itemTitle);
    if (!titleKey) continue;
    const candidates = itemTitleToShopee[titleKey] || [];
    if (candidates.length !== 1) continue; // só se Shopee também tem 1 só
    const shopeeE = candidates[0];
    const spKey = `${shopeeE.item_id}|${shopeeE.model_id || ''}`;
    if (pairedShopeeKeys.has(spKey)) continue;
    await createMapping(shopeeE.sku || null, meliE, shopeeE, 's4');
  }
  console.log(`  ✔ ${strategyStats.s4} pareados`);

  // ── UNMAPPED ─────────────────────────────────────────────────
  const unmappedItems = [];
  for (const meliE of meliItems) {
    if (pairedMeliKeys.has(`${meliE.item_id}|${meliE.variation_id || ''}`)) continue;
    unmappedItems.push({
      platform: 'meli',
      sku: meliE.sku || '',
      item_id: meliE.item_id,
      variation_id: meliE.variation_id,
      product_name: meliE.name,
    });
  }
  // Shopee não pareados
  for (const arr of Object.values(shopeeByItemId)) {
    for (const s of arr) {
      const key = `${s.item_id}|${s.model_id || ''}`;
      if (pairedShopeeKeys.has(key)) continue;
      unmappedItems.push({
        platform: 'shopee',
        sku: s.sku || '',
        item_id: s.item_id,
        variation_id: s.model_id,
        product_name: s.itemName + (s.modelName ? ' — ' + s.modelName : ''),
      });
    }
  }

  let unmappedInserted = 0;
  for (let i = 0; i < unmappedItems.length; i += 50) {
    try {
      const r = await workerApi('/api/catalog/bulk', 'POST', { items: unmappedItems.slice(i, i + 50) });
      unmappedInserted += r.inserted || 0;
    } catch (e) { console.error(`  ERRO bulk ${i}: ${e.message}`); }
  }

  console.log(`\n✅ Discovery concluído:`);
  console.log(`   Shopee: ${shopeeIds.length} items | ML: ${meliIds.length} items`);
  console.log(`   ✔ Total pareados: ${mapped}  (erros: ${mapErrors})`);
  console.log(`     S5 SKU=ML var/item ID: ${strategyStats.s5}`);
  console.log(`     S1 SKU exato:          ${strategyStats.s1}`);
  console.log(`     S2 SHOPEE_<id>:        ${strategyStats.s2}`);
  console.log(`     S3 fuzzy título+combo: ${strategyStats.s3}`);
  console.log(`     S4 título puro:        ${strategyStats.s4}`);
  console.log(`   📋 Não pareados:   ${unmappedInserted}/${unmappedItems.length}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
