// Migração de anúncios entre Shopee ↔ Mercado Livre.
// Pipeline: detectar candidatos → gerar rascunho adaptado → revisar → publicar → parear.
import * as mac from './mac';

export interface MigEnv extends mac.MacEnv {
  DB: D1Database;
  MELI_USER_ID?: string;
}

// ────────────────────────────────────────────────────────────
// Helpers de texto
// ────────────────────────────────────────────────────────────
function fixMojibake(s: string): string {
  if (!s) return '';
  try { const f = decodeURIComponent(escape(s)); return f.includes(String.fromCharCode(0xFFFD)) ? s : f; } catch { return s; }
}
function truncate(s: string, max: number): string {
  s = (s || '').trim();
  if (s.length <= max) return s;
  // corta na última palavra inteira antes do limite
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}
function norm(s: string): string {
  return fixMojibake(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// ────────────────────────────────────────────────────────────
// Schema da tabela de rascunhos
// ────────────────────────────────────────────────────────────
export async function ensureMigrationTable(env: MigEnv): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS migration_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_platform TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      source_account_id TEXT,
      target_platform TEXT NOT NULL,
      target_shop_id TEXT,
      product_name TEXT,
      image_url TEXT,
      draft_json TEXT,
      photos_json TEXT,
      validation_json TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      published_item_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(source_platform, source_item_id, target_platform, target_shop_id)
    )
  `).run();
  // Migração leve: adiciona target_shop_id se a tabela já existia sem ela
  await env.DB.prepare(`ALTER TABLE migration_drafts ADD COLUMN target_shop_id TEXT`).run().catch(() => {});
}

// ────────────────────────────────────────────────────────────
// FASE 1 — Detecção de candidatos
// Item existe num lado mas falta no outro.
// ────────────────────────────────────────────────────────────
export interface Candidate {
  source_platform: 'shopee' | 'meli';
  target_platform: 'shopee' | 'meli';
  source_item_id: string;
  source_account_id: string | null;
  source_account_label: string | null;
  product_name: string;
  image_url: string | null;
  variation_count: number;
  draft_status?: string | null; // se já tem rascunho
}

export async function findCandidates(env: MigEnv): Promise<Candidate[]> {
  // Labels de contas
  const accRows = (await env.DB.prepare(`SELECT external_id, label FROM marketplace_accounts`).all().catch(() => ({ results: [] }))).results as any[];
  const labels = new Map<string, string>();
  for (const a of accRows) labels.set(String(a.external_id), a.label || a.external_id);

  // Shopee item_ids que JÁ estão pareados com ML (pra excluir)
  const pairedShopee = new Set<string>();
  const pairedMeli = new Set<string>();
  const mapRows = (await env.DB.prepare(
    `SELECT shopee_item_id, meli_item_id, extra_shopee_stores FROM mappings WHERE active=1`
  ).all()).results as any[];
  for (const m of mapRows) {
    if (m.shopee_item_id && m.meli_item_id) {
      pairedShopee.add(String(m.shopee_item_id));
      pairedMeli.add(String(m.meli_item_id));
    }
    // extras também contam como "já tem ML"
    if (m.meli_item_id && m.extra_shopee_stores) {
      try { for (const ex of JSON.parse(m.extra_shopee_stores)) pairedShopee.add(String(ex.item_id)); } catch {}
    }
  }

  // Drafts existentes (pra mostrar status)
  const draftRows = (await env.DB.prepare(`SELECT source_platform, source_item_id, target_platform, status FROM migration_drafts`).all().catch(() => ({ results: [] }))).results as any[];
  const draftStatus = new Map<string, string>();
  for (const d of draftRows) draftStatus.set(`${d.source_platform}:${d.source_item_id}:${d.target_platform}`, d.status);

  // ── Candidatos Shopee → ML: itens Shopee sem par no ML ──
  // Fonte: unmapped (platform=shopee) + mappings só-shopee (meli_item_id NULL)
  const shopeeAgg = new Map<string, Candidate>(); // key = item_id
  const spUnmapped = (await env.DB.prepare(
    `SELECT item_id, shopee_account_id, product_name FROM unmapped WHERE platform='shopee' AND resolved=0`
  ).all()).results as any[];
  const spMapOnly = (await env.DB.prepare(
    `SELECT shopee_item_id as item_id, shopee_account_id, product_name FROM mappings WHERE active=1 AND shopee_item_id IS NOT NULL AND (meli_item_id IS NULL OR meli_item_id='')`
  ).all()).results as any[];
  for (const r of [...spUnmapped, ...spMapOnly]) {
    const id = String(r.item_id);
    if (pairedShopee.has(id)) continue; // já tem ML
    const cur = shopeeAgg.get(id);
    if (cur) { cur.variation_count++; continue; }
    shopeeAgg.set(id, {
      source_platform: 'shopee', target_platform: 'meli',
      source_item_id: id,
      source_account_id: r.shopee_account_id || null,
      source_account_label: r.shopee_account_id ? (labels.get(String(r.shopee_account_id)) || String(r.shopee_account_id)) : null,
      product_name: fixMojibake(r.product_name || ''),
      image_url: null,
      variation_count: 1,
      draft_status: draftStatus.get(`shopee:${id}:meli`) || null,
    });
  }

  // ── Candidatos ML → Shopee: itens ML sem par na Shopee ──
  const meliAgg = new Map<string, Candidate>();
  const mlUnmapped = (await env.DB.prepare(
    `SELECT item_id, product_name FROM unmapped WHERE platform='meli' AND resolved=0`
  ).all()).results as any[];
  const mlMapOnly = (await env.DB.prepare(
    `SELECT meli_item_id as item_id, product_name FROM mappings WHERE active=1 AND meli_item_id IS NOT NULL AND (shopee_item_id IS NULL OR shopee_item_id='')`
  ).all()).results as any[];
  for (const r of [...mlUnmapped, ...mlMapOnly]) {
    const id = String(r.item_id);
    if (pairedMeli.has(id)) continue;
    const cur = meliAgg.get(id);
    if (cur) { cur.variation_count++; continue; }
    meliAgg.set(id, {
      source_platform: 'meli', target_platform: 'shopee',
      source_item_id: id,
      source_account_id: null,
      source_account_label: 'Mercado Livre',
      product_name: fixMojibake(r.product_name || ''),
      image_url: null,
      variation_count: 1,
      draft_status: draftStatus.get(`meli:${id}:shopee`) || null,
    });
  }

  return [...shopeeAgg.values(), ...meliAgg.values()]
    .sort((a, b) => (a.draft_status ? 1 : 0) - (b.draft_status ? 1 : 0) || b.variation_count - a.variation_count);
}

// ────────────────────────────────────────────────────────────
// FASE 2 — Geração de rascunho Shopee → ML
// ────────────────────────────────────────────────────────────
export interface DraftResult {
  draft: any;
  validation: { field: string; level: 'error' | 'warn'; message: string }[];
  photos: { source: string; status: string }[];
  source_summary: any;
}

// Mapeia atributos da origem por nome normalizado pra facilitar match
function indexAttrs(list: any[], nameKey: string, valKey: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of list || []) {
    const n = norm(a[nameKey] || a.name || '');
    const v = a[valKey] ?? a.value_name ?? a.original_value_name ?? '';
    if (n && v) m.set(n, String(v));
  }
  return m;
}

export async function buildMeliDraftFromShopee(env: MigEnv, shopeeItemId: string, shopId?: string): Promise<DraftResult> {
  const validation: DraftResult['validation'] = [];

  // 1. Lê origem
  const item = await mac.shopeeGetItem(env, Number(shopeeItemId), shopId);
  if (!item) throw new Error('Item Shopee não encontrado: ' + shopeeItemId);
  const { models, tierVariation } = await mac.shopeeGetModelsFull(env, Number(shopeeItemId), shopId);

  const rawName = fixMojibake((item as any).item_name || '');
  const title = truncate(rawName, 60);
  if (rawName.length > 60) validation.push({ field: 'title', level: 'warn', message: `Título cortado de ${rawName.length} → 60 chars (limite ML). Revise.` });

  // 2. Prevê categoria ML
  let categoryId = ''; let categoryName = ''; let domainId = '';
  let categorySuggestions: any[] = [];
  try {
    const pred = await mac.meliRaw(env, 'GET', `/sites/MLB/domain_discovery/search?q=${encodeURIComponent(rawName)}`);
    const arr = Array.isArray(pred) ? pred : (pred?.data || []);
    categorySuggestions = arr.slice(0, 3).map((p: any) => ({ category_id: p.category_id, category_name: p.category_name, domain_id: p.domain_id }));
    if (arr[0]) { categoryId = arr[0].category_id; categoryName = arr[0].category_name; domainId = arr[0].domain_id; }
  } catch (e: any) { validation.push({ field: 'category', level: 'warn', message: 'Predição de categoria falhou: ' + e.message }); }
  if (!categoryId) validation.push({ field: 'category', level: 'error', message: 'Sem categoria ML — selecione manualmente.' });

  // 3. Atributos obrigatórios da categoria ML
  let requiredAttrs: any[] = [];
  if (categoryId) {
    try {
      const attrs = await mac.call(env, 'category_attributes', { category_id: categoryId });
      const list = Array.isArray(attrs) ? attrs : (attrs?.data || attrs?.attributes || []);
      requiredAttrs = (list || []).filter((a: any) => (a.tags && (a.tags.required || a.tags.catalog_required)) || a.required);
    } catch {}
  }

  // 4. Mapeia atributos da Shopee → ML por nome
  const spAttrIndex = indexAttrs((item as any).attribute_list || [], 'original_attribute_name', 'attribute_value_list');
  // attribute_value_list é array de {value_name}; reindexar:
  const spAttrSimple = new Map<string, string>();
  for (const a of (item as any).attribute_list || []) {
    const n = norm(a.original_attribute_name || a.attribute_name || '');
    const vals = (a.attribute_value_list || []).map((v: any) => v.value_name || v.original_value_name).filter(Boolean);
    if (n && vals.length) spAttrSimple.set(n, vals.join(', '));
  }

  const mlAttributes: any[] = [];
  const missingRequired: string[] = [];
  for (const ra of requiredAttrs) {
    const nm = norm(ra.name || '');
    let val = spAttrSimple.get(nm) || null;
    // heurísticas comuns
    if (!val && ra.id === 'BRAND') val = fixMojibake((item as any).brand?.original_brand_name || '') || null;
    if (!val && (ra.id === 'ITEM_CONDITION')) val = 'Novo';
    if (!val && ra.id === 'SELLER_SKU') val = (item as any).item_sku || null;
    if (val) mlAttributes.push({ id: ra.id, value_name: String(val) });
    else if (ra.id !== 'GTIN') missingRequired.push(ra.id);
  }
  for (const mr of missingRequired) {
    validation.push({ field: 'attr:' + mr, level: 'error', message: `Atributo obrigatório ML faltando: ${mr}` });
  }

  // 5. Dimensões/peso → atributos de pacote ML
  const dim = (item as any).dimension || {};
  const weightKg = (item as any).weight;
  if (dim.package_length) mlAttributes.push({ id: 'SELLER_PACKAGE_LENGTH', value_name: `${dim.package_length} cm` });
  if (dim.package_width) mlAttributes.push({ id: 'SELLER_PACKAGE_WIDTH', value_name: `${dim.package_width} cm` });
  if (dim.package_height) mlAttributes.push({ id: 'SELLER_PACKAGE_HEIGHT', value_name: `${dim.package_height} cm` });
  if (weightKg) mlAttributes.push({ id: 'SELLER_PACKAGE_WEIGHT', value_name: `${Math.round(Number(weightKg) * 1000)} g` });

  // 6. Preço e estoque (do model mais barato com estoque, ou item base)
  let price = 0; let qty = 0;
  if (models.length) {
    for (const m of models) {
      const p = m.price_info?.[0]?.current_price ?? m.price_info?.[0]?.original_price ?? 0;
      const s = m.stock_info_v2?.summary_info?.total_available_stock ?? 0;
      if (p > 0 && (price === 0 || p < price)) price = p;
      qty += s;
    }
  }
  if (!price) validation.push({ field: 'price', level: 'error', message: 'Preço não detectado — preencha manualmente.' });

  // 7. Fotos (Shopee CDN URLs → ML baixa via source)
  const photoUrls: string[] = ((item as any).image?.image_url_list || []).slice(0, 12);
  const photos = photoUrls.map(u => ({ source: u, status: 'ready' }));
  if (!photos.length) validation.push({ field: 'pictures', level: 'error', message: 'Sem fotos na origem.' });

  // 8. Variações: detecta nº de eixos
  const hasModel = (item as any).has_model;
  let variationPlan: any = null;
  if (hasModel && tierVariation.length === 1) {
    // 1 eixo → suportado. Casa com atributo de variação ML (tentativa por nome)
    const tierName = norm(tierVariation[0]?.name || '');
    variationPlan = {
      supported: true,
      axis_name: tierVariation[0]?.name,
      models: models.map(m => ({
        name: mac.buildShopeeModelName(m, tierVariation),
        sku: m.model_sku || '',
        price: m.price_info?.[0]?.current_price ?? price,
        stock: m.stock_info_v2?.summary_info?.total_available_stock ?? 0,
      })),
    };
    validation.push({ field: 'variations', level: 'warn', message: `Anúncio com 1 eixo de variação (${tierVariation[0]?.name}). Confirme o mapeamento do atributo ML.` });
  } else if (hasModel && tierVariation.length > 1) {
    variationPlan = { supported: false, axes: tierVariation.length };
    validation.push({ field: 'variations', level: 'error', message: `Anúncio com ${tierVariation.length} eixos de variação — migração multi-eixo ainda não suportada. Crie manualmente ou simplifique.` });
  }

  // Monta payload-base ML (create_item)
  const draft = {
    title,
    category_id: categoryId,
    category_name: categoryName,
    domain_id: domainId,
    category_suggestions: categorySuggestions,
    price: price || 0,
    currency_id: 'BRL',
    available_quantity: qty || 1,
    buying_mode: 'buy_it_now',
    listing_type_id: 'gold_special',
    condition: ((item as any).condition === 'USED') ? 'used' : 'new',
    description: fixMojibake((item as any).description || ''),
    pictures: photos.map(p => ({ source: p.source })),
    attributes: mlAttributes,
    shipping: { mode: 'me2', local_pick_up: false, free_shipping: false },
    sale_terms: [{ id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '30 dias' }],
    variation_plan: variationPlan,
    source_sku: (item as any).item_sku || '',
  };

  return {
    draft,
    validation,
    photos,
    source_summary: {
      platform: 'shopee', item_id: shopeeItemId,
      name: rawName, category_id: (item as any).category_id,
      price, qty, photos: photoUrls.length, has_model: hasModel,
      variations: models.length,
    },
  };
}

// ────────────────────────────────────────────────────────────
// FASE 2b — Geração de rascunho ML → Shopee
// ────────────────────────────────────────────────────────────
export async function buildShopeeDraftFromMeli(env: MigEnv, meliItemId: string, targetShopId?: string): Promise<DraftResult> {
  const validation: DraftResult['validation'] = [];
  const item: any = await mac.meliGetItem(env, meliItemId);
  if (!item) throw new Error('Item ML não encontrado: ' + meliItemId);

  const rawName = fixMojibake(item.title || '');
  const title = truncate(rawName, 120); // Shopee aceita mais

  // Prevê categoria Shopee (e resolve os NOMES das categorias sugeridas)
  let categoryId = 0; let categorySuggestions: { id: number; name: string }[] = [];
  try {
    const rec = await mac.call(env, 'shopee_recommend_category', { item_name: rawName, shopId: targetShopId });
    const ids: number[] = rec?.response?.category_id || rec?.category_id || [];
    if (ids.length) {
      categoryId = ids[0];
      // mapa id→nome via lista de categorias da Shopee (caminho completo)
      let nameMap = new Map<number, string>();
      try {
        const cats = await mac.call(env, 'shopee_get_categories', { shopId: targetShopId });
        const list = cats?.response?.category_list || cats?.category_list || [];
        const byId = new Map<number, any>();
        for (const c of list) byId.set(c.category_id, c);
        for (const c of list) {
          // monta caminho "Pai > Filho" pra ficar claro
          let path = c.display_category_name || c.category_name;
          let p = byId.get(c.parent_category_id);
          let guard = 0;
          while (p && guard++ < 5) { path = (p.display_category_name || p.category_name) + ' > ' + path; p = byId.get(p.parent_category_id); }
          nameMap.set(c.category_id, path);
        }
      } catch {}
      categorySuggestions = ids.slice(0, 3).map(id => ({ id, name: nameMap.get(id) || ('Categoria ' + id) }));
    }
  } catch (e: any) { validation.push({ field: 'category', level: 'warn', message: 'Predição categoria Shopee falhou: ' + e.message }); }
  if (!categoryId) validation.push({ field: 'category', level: 'error', message: 'Sem categoria Shopee — selecione manualmente.' });

  // Preço/estoque
  const price = item.price || 0;
  const qty = item.available_quantity || 0;
  if (!price) validation.push({ field: 'price', level: 'error', message: 'Preço não detectado.' });

  // Fotos: ML urls → precisam ser re-uploaded via shopee_upload_image (feito no publish)
  const picUrls: string[] = (item.pictures || []).map((p: any) => p.secure_url || p.url).filter(Boolean).slice(0, 9);
  const photos = picUrls.map(u => ({ source: u, status: 'pending_upload' }));
  if (!photos.length) validation.push({ field: 'pictures', level: 'error', message: 'Sem fotos na origem ML.' });

  // Peso/dimensões dos atributos ML
  const attrMap = new Map<string, string>();
  for (const a of item.attributes || []) if (a.id && a.value_name) attrMap.set(a.id, a.value_name);
  const parseNum = (s?: string) => s ? Number(String(s).replace(/[^\d.]/g, '')) : undefined;
  const weight = parseNum(attrMap.get('SELLER_PACKAGE_WEIGHT')); // em g → Shopee quer kg
  const dimension = {
    package_length: parseNum(attrMap.get('SELLER_PACKAGE_LENGTH')) || 20,
    package_width: parseNum(attrMap.get('SELLER_PACKAGE_WIDTH')) || 15,
    package_height: parseNum(attrMap.get('SELLER_PACKAGE_HEIGHT')) || 10,
  };

  // Variações ML
  const variations = item.variations || [];
  let variationPlan: any = null;
  if (variations.length > 0) {
    variationPlan = {
      supported: variations.length <= 50,
      models: variations.map((v: any) => ({
        name: (v.attribute_combinations || []).map((c: any) => c.value_name).join(' / '),
        sku: mac.getMeliVariationSku(v) || '',
        price: v.price || price,
        stock: v.available_quantity || 0,
      })),
    };
    validation.push({ field: 'variations', level: 'warn', message: `${variations.length} variações ML — confirme eixos na Shopee.` });
  }

  const draft = {
    item_name: title,
    category_id: categoryId,
    category_suggestions: categorySuggestions,
    description: fixMojibake((item.descriptions?.[0]?.plain_text) || rawName),
    original_price: price,
    stock: qty,
    weight: weight ? weight / 1000 : 0.5,
    dimension,
    condition: item.condition === 'used' ? 'USED' : 'NEW',
    brand: { brand_id: 0, original_brand_name: attrMap.get('BRAND') || 'NoBrand' },
    pictures: picUrls,
    variation_plan: variationPlan,
    source_sku: mac.getMeliSku(item) || item.seller_custom_field || '',
  };

  return {
    draft, validation, photos,
    source_summary: { platform: 'meli', item_id: meliItemId, name: rawName, price, qty, photos: picUrls.length, variations: variations.length },
  };
}

// ────────────────────────────────────────────────────────────
// FASE 2c — Cópia Shopee → outra loja Shopee (mesmo formato)
// ────────────────────────────────────────────────────────────
export async function buildShopeeDraftFromShopee(env: MigEnv, shopeeItemId: string, sourceShopId?: string, _targetShopId?: string): Promise<DraftResult> {
  const validation: DraftResult['validation'] = [];
  const item: any = await mac.shopeeGetItem(env, Number(shopeeItemId), sourceShopId);
  if (!item) throw new Error('Item Shopee origem não encontrado: ' + shopeeItemId);
  const { models, tierVariation } = await mac.shopeeGetModelsFull(env, Number(shopeeItemId), sourceShopId);

  const name = truncate(fixMojibake(item.item_name || ''), 120);
  const picUrls: string[] = (item.image?.image_url_list || []).slice(0, 9);
  if (!picUrls.length) validation.push({ field: 'pictures', level: 'error', message: 'Sem fotos na origem.' });

  let price = 0, qty = 0;
  for (const m of models) {
    const p = m.price_info?.[0]?.current_price ?? m.price_info?.[0]?.original_price ?? 0;
    if (p > 0 && (price === 0 || p < price)) price = p;
    qty += m.stock_info_v2?.summary_info?.total_available_stock ?? 0;
  }
  if (!price) { price = (item as any).price_info?.[0]?.current_price || 0; }

  let variationPlan: any = null;
  if (item.has_model && models.length) {
    variationPlan = { supported: tierVariation.length === 1, models: models.map((m: any) => ({
      name: mac.buildShopeeModelName(m, tierVariation), sku: m.model_sku || '',
      price: m.price_info?.[0]?.current_price ?? price, stock: m.stock_info_v2?.summary_info?.total_available_stock ?? 0,
    })) };
    validation.push({ field: 'variations', level: 'warn', message: `${models.length} variações — cópia de variações ainda em desenvolvimento.` });
  }

  const draft = {
    item_name: name,
    category_id: item.category_id,
    category_suggestions: [item.category_id],
    description: fixMojibake(item.description || ''),
    original_price: price,
    stock: qty,
    weight: item.weight || 0.5,
    dimension: item.dimension || { package_length: 20, package_width: 15, package_height: 10 },
    condition: item.condition || 'NEW',
    brand: item.brand || { brand_id: 0, original_brand_name: 'NoBrand' },
    pictures: picUrls,
    variation_plan: variationPlan,
    source_sku: item.item_sku || '',
  };
  return {
    draft, validation,
    photos: picUrls.map(u => ({ source: u, status: 'pending_upload' })),
    source_summary: { platform: 'shopee', item_id: shopeeItemId, name: fixMojibake(item.item_name || ''), price, qty, photos: picUrls.length, variations: models.length },
  };
}

// ────────────────────────────────────────────────────────────
// Preencher variações faltantes num anúncio que JÁ existe
// ────────────────────────────────────────────────────────────
// ML: adiciona variações ao item existente via POST /items/:id/variations
export async function fillMissingVariationsMeli(env: MigEnv, meliItemId: string, missing: { name: string; sku?: string; qty?: number; price?: number }[]): Promise<any> {
  const item: any = await mac.meliGetItem(env, meliItemId);
  if (!item) throw new Error('Item ML não encontrado: ' + meliItemId);
  const existing = item.variations || [];
  // Descobre o(s) atributo(s) de variação usados (ex: CHARACTER_VERSION, COLOR)
  const sampleCombos = existing[0]?.attribute_combinations || [];
  if (!sampleCombos.length) {
    throw new Error('Anúncio ML não tem variações existentes — não dá pra inferir o eixo. Use "Migrar anúncio" pra recriar.');
  }
  const axisIds = sampleCombos.map((c: any) => c.id); // normalmente 1 (CHARACTER_VERSION)
  const basePrice = item.price || existing[0]?.price || 0;
  const picIds = (item.pictures || []).map((p: any) => p.id).filter(Boolean);

  const results: any[] = [];
  for (const mv of missing) {
    try {
      // monta attribute_combinations: usa o nome da variação no 1º eixo
      const combos = axisIds.map((id: string, i: number) => ({ id, value_name: i === 0 ? mv.name : (sampleCombos[i]?.value_name || mv.name) }));
      const body: any = {
        attribute_combinations: combos,
        available_quantity: mv.qty ?? 0,
        price: (mv.price && mv.price > 0) ? mv.price : basePrice,
      };
      if (mv.sku) body.seller_custom_field = mv.sku, body.attributes = [{ id: 'SELLER_SKU', value_name: mv.sku }];
      if (picIds.length) body.picture_ids = picIds.slice(0, 1);
      const res = await mac.meliRaw(env, 'POST', `/items/${meliItemId}/variations`, body);
      // Validação HONESTA: ML retorna erro com {message,error,cause} OU sucesso com id
      if (res?.error || res?.message && !res?.id || res?.cause) {
        const msg = res.message || res.error || JSON.stringify(res?.cause || res).slice(0, 200);
        results.push({ name: mv.name, ok: false, error: 'ML: ' + msg });
        continue;
      }
      const newVarId = res?.id || res?.variations?.slice(-1)?.[0]?.id;
      if (!newVarId) {
        results.push({ name: mv.name, ok: false, error: 'ML não retornou ID da variação criada: ' + JSON.stringify(res).slice(0, 150) });
        continue;
      }
      results.push({ name: mv.name, ok: true, variation_id: newVarId });
      // pareia no mapping se tiver sku
      if (mv.sku) {
        const now = Date.now();
        await env.DB.prepare(`UPDATE mappings SET meli_item_id=?, meli_variation_id=?, updated_at=? WHERE sku=?`)
          .bind(meliItemId, newVarId ? String(newVarId) : null, now, mv.sku).run().catch(() => {});
      }
    } catch (e: any) {
      results.push({ name: mv.name, ok: false, error: String(e.message).slice(0, 200) });
    }
  }
  return { ok: results.every(r => r.ok), results };
}

// Shopee: adiciona models faltantes a um item existente na loja destino
export async function fillMissingVariationsShopee(env: MigEnv, targetItemId: string, targetShopId: string, sourceItemId: string, sourceShopId: string | undefined, missingSkus: string[]): Promise<any> {
  // Lê tier + models da ORIGEM e do DESTINO (pra validar de verdade)
  const src = await mac.shopeeGetModelsFull(env, Number(sourceItemId), sourceShopId);
  const tgt = await mac.shopeeGetModelsFull(env, Number(targetItemId), targetShopId);
  const results: any[] = [];

  let tgtState = tgt;
  for (const sku of missingSkus) {
    try {
      const m = src.models.find((x: any) => (x.model_sku || '').trim() === sku.trim());
      if (!m) { results.push({ sku, ok: false, error: 'modelo de origem não encontrado' }); continue; }

      // O destino JÁ tem esse SKU fisicamente? Então só registra no mapping (cobertura vira ✓).
      const already = tgtState.models.find((x: any) => (x.model_sku || '').trim() === sku.trim());
      if (already) {
        await recordShopeeStoreInMapping(env, sku, String(targetItemId), String(already.model_id), targetShopId);
        results.push({ sku, ok: true, error: null, model_id: already.model_id, note: 'já existia na loja — registrado no sistema' });
        continue;
      }

      // Nome + imagem da opção na origem (preserva acentuação/caixa + foto)
      const srcOpt = src.tierVariation?.[0]?.option_list?.[m.tier_index?.[0]];
      const srcOptNameRaw = srcOpt?.option || '';
      const srcOptImageUrl = srcOpt?.image?.image_url || null;
      if (!srcOptNameRaw) { results.push({ sku, ok: false, error: 'não consegui ler o nome da opção na origem' }); continue; }
      const modelData = {
        sku: m.model_sku || '',
        price: m.price_info?.[0]?.original_price ?? m.price_info?.[0]?.current_price ?? 0,
        stock: m.stock_info_v2?.summary_info?.total_available_stock ?? 0,
      };

      const r = await addShopeeOptionAndModel(env, Number(targetItemId), targetShopId, srcOptNameRaw, modelData, tgtState, srcOptImageUrl);
      results.push({ sku, ok: r.ok, error: r.ok ? null : r.error, model_id: r.model_id });
      if (r.ok) {
        // Registra a loja destino no mapping (extra_shopee_stores) pra cobertura virar ✓
        await recordShopeeStoreInMapping(env, sku, String(targetItemId), r.model_id != null ? String(r.model_id) : null, targetShopId);
        // atualiza estado do destino pra próximas iterações verem a opção nova
        try { tgtState = await mac.shopeeGetModelsFull(env, Number(targetItemId), targetShopId); } catch {}
      }
    } catch (e: any) {
      results.push({ sku, ok: false, error: String(e.message).slice(0, 200) });
    }
  }
  return { ok: results.length > 0 && results.every(r => r.ok), results };
}

// Registra que um SKU agora também existe numa loja Shopee (atualiza extra_shopee_stores do mapping)
// pra a cobertura (✓/✗) refletir a migração sem precisar rodar discovery.
async function recordShopeeStoreInMapping(env: MigEnv, sku: string, itemId: string, modelId: string | null, accountId: string): Promise<void> {
  const map = await env.DB.prepare(`SELECT * FROM mappings WHERE sku=?`).bind(sku).first<any>();
  if (!map) return;
  // Se o mapping principal já é essa loja, nada a fazer
  if (String(map.shopee_item_id || '') === itemId && String(map.shopee_account_id || '') === accountId) return;
  let extras: any[] = [];
  try { extras = map.extra_shopee_stores ? JSON.parse(map.extra_shopee_stores) : []; } catch {}
  if (extras.some(e => String(e.item_id) === itemId && String(e.account_id) === accountId)) return; // já registrado
  extras.push({ item_id: itemId, model_id: modelId, account_id: accountId });
  await env.DB.prepare(`UPDATE mappings SET extra_shopee_stores=?, updated_at=? WHERE sku=?`)
    .bind(JSON.stringify(extras), Date.now(), sku).run().catch(() => {});
}

// Adiciona uma OPÇÃO nova ao eixo de variação Shopee + cria o model — preservando as existentes.
// Padrão seguro (Upseller): anexa a opção no FIM (índices das existentes não mudam),
// re-mapeia models existentes com tier_index inalterado, valida antes/depois.
async function addShopeeOptionAndModel(
  env: MigEnv, itemId: number, shopId: string,
  optionName: string, model: { sku: string; price: number; stock: number },
  current: { models: any[]; tierVariation: any[] },
  newOptionImageUrl?: string | null,
): Promise<{ ok: boolean; error?: string; model_id?: any }> {
  if ((current.tierVariation || []).length !== 1) {
    return { ok: false, error: 'anúncio destino tem múltiplos eixos de variação — não suportado' };
  }
  const tier = current.tierVariation[0];
  // PRESERVA o campo image de cada opção — senão a Shopee apaga as fotos das variações!
  const optList = (tier.option_list || []).map((o: any) => o.image ? { option: o.option, image: { image_id: o.image.image_id } } : { option: o.option });
  const norm = (s: string) => String(s || '').trim().toLowerCase();
  // A Shopee exige: ou TODAS as opções têm imagem, ou nenhuma. Vê se as existentes têm.
  const existingHaveImages = (tier.option_list || []).length > 0 && (tier.option_list || []).every((o: any) => o.image && o.image.image_id);

  let idx = optList.findIndex((o: any) => norm(o.option) === norm(optionName));
  // SNAPSHOT das variações existentes (model_id → sku) pra validar integridade depois
  const before = new Map<string, string>();
  for (const m of current.models) before.set(String(m.model_id), (m.model_sku || '').trim());

  if (idx < 0) {
    // Se as existentes têm imagem, a opção nova TAMBÉM precisa ter — sobe a foto da origem
    let newOpt: any = { option: optionName };
    if (existingHaveImages) {
      if (!newOptionImageUrl) {
        return { ok: false, error: 'as outras variações têm foto e esta não tem foto na origem — a Shopee exige foto em todas. Adicione a foto manualmente.' };
      }
      try {
        const up = await mac.call(env, 'shopee_upload_image', { shopId, image_url: newOptionImageUrl });
        const imgId = up?.response?.image_info?.image_id || up?.image_id || up?.response?.image_id;
        if (!imgId) return { ok: false, error: 'falha ao subir a foto da variação nova: ' + JSON.stringify(up).slice(0, 150) };
        newOpt = { option: optionName, image: { image_id: imgId } };
      } catch (e: any) {
        return { ok: false, error: 'upload da foto falhou: ' + e.message };
      }
    }
    // 1) Anexa a opção nova no FIM (preserva índices existentes)
    optList.push(newOpt);
    idx = optList.length - 1;
    // 2) Re-mapeia models existentes com tier_index INALTERADO (não toca em sku/preço/estoque)
    const remap = current.models.map((m: any) => ({ model_id: m.model_id, tier_index: m.tier_index }));
    const upd = await mac.call(env, 'shopee_update_variation', {
      shopId, item_id: itemId,
      tier_variation: [{ name: tier.name, option_list: optList }],
      model: remap,
    });
    if (upd?.error) return { ok: false, error: 'update_tier_variation: ' + (upd.message || upd.error) };
    // 3) VALIDA integridade: todas as variações antigas continuam com o mesmo SKU?
    const mid = await mac.shopeeGetModelsFull(env, itemId, shopId);
    if (mid.models.length < current.models.length) {
      return { ok: false, error: `ABORTADO: re-consulta mostra ${mid.models.length} models (antes ${current.models.length}) — algo se perdeu` };
    }
    for (const m of mid.models) {
      const prevSku = before.get(String(m.model_id));
      if (prevSku !== undefined && (m.model_sku || '').trim() !== prevSku) {
        return { ok: false, error: `ABORTADO: variação ${m.model_id} mudou de SKU ("${prevSku}"→"${m.model_sku}") — integridade comprometida` };
      }
    }
  }
  // 4) Adiciona o model na opção (nova ou existente)
  //    Shopee exige seller_stock no formato [{ stock }] (por localização), não normal_stock
  const addRes = await mac.call(env, 'shopee_add_model', {
    shopId, item_id: itemId,
    model_list: [{
      tier_index: [idx],
      model_sku: model.sku,
      original_price: model.price,
      seller_stock: [{ stock: model.stock }],
    }],
  });
  if (addRes?.error) return { ok: false, error: 'add_model: ' + (addRes.message || addRes.error) };
  // 5) Confirma que o model entrou
  const after = await mac.shopeeGetModelsFull(env, itemId, shopId);
  const added = after.models.find((m: any) => (m.model_sku || '').trim() === (model.sku || '').trim() && Array.isArray(m.tier_index) && m.tier_index[0] === idx);
  if (!added) return { ok: false, error: 'API aceitou mas o model não apareceu na re-consulta' };
  return { ok: true, model_id: added.model_id };
}

// ────────────────────────────────────────────────────────────
// Salvar / ler rascunhos
// ────────────────────────────────────────────────────────────
export async function saveDraft(env: MigEnv, c: { source_platform: string; source_item_id: string; source_account_id: string | null; target_platform: string; target_shop_id?: string | null; product_name: string; image_url: string | null; }, result: DraftResult): Promise<number> {
  const now = Date.now();
  const tshop = c.target_shop_id || '';
  // Upsert manual (não depende do UNIQUE exato): apaga rascunho equivalente não-publicado e reinsere
  await env.DB.prepare(
    `DELETE FROM migration_drafts WHERE source_platform=? AND source_item_id=? AND target_platform=? AND COALESCE(target_shop_id,'')=? AND status!='published'`
  ).bind(c.source_platform, c.source_item_id, c.target_platform, tshop).run();
  await env.DB.prepare(`
    INSERT INTO migration_drafts (source_platform, source_item_id, source_account_id, target_platform, target_shop_id, product_name, image_url, draft_json, photos_json, validation_json, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    c.source_platform, c.source_item_id, c.source_account_id, c.target_platform, c.target_shop_id || null,
    c.product_name, c.image_url,
    JSON.stringify(result.draft), JSON.stringify(result.photos), JSON.stringify(result.validation),
    'needs_review', now, now,
  ).run();
  const row = await env.DB.prepare(
    `SELECT id FROM migration_drafts WHERE source_platform=? AND source_item_id=? AND target_platform=? AND COALESCE(target_shop_id,'')=? ORDER BY id DESC LIMIT 1`
  ).bind(c.source_platform, c.source_item_id, c.target_platform, tshop).first<any>();
  return row?.id;
}

// ────────────────────────────────────────────────────────────
// FASE 4 — Publicar
// ────────────────────────────────────────────────────────────
export async function publishDraft(env: MigEnv, draftId: number, overrides?: any): Promise<any> {
  const row = await env.DB.prepare(`SELECT * FROM migration_drafts WHERE id=?`).bind(draftId).first<any>();
  if (!row) throw new Error('Rascunho não encontrado');
  const draft = { ...JSON.parse(row.draft_json || '{}'), ...(overrides || {}) };
  const now = Date.now();

  // Bloqueia se houver erros de validação não resolvidos
  const validation = JSON.parse(row.validation_json || '[]');
  const hardErrors = validation.filter((v: any) => v.level === 'error');
  if (hardErrors.length && !overrides?.force) {
    return { ok: false, blocked: true, errors: hardErrors };
  }
  // SEGURANÇA: publicação de variações ainda não implementada (F5).
  // Produto com variação publicado como simples = anúncio errado. Bloqueia.
  if (draft.variation_plan && draft.variation_plan.models && draft.variation_plan.models.length > 0 && !overrides?.force) {
    return { ok: false, blocked: true, errors: [{ field: 'variations', message: 'Publicação de produtos COM VARIAÇÃO ainda não está disponível (em desenvolvimento). Por enquanto só produtos simples (sem variação) podem ser publicados automaticamente.' }] };
  }

  await env.DB.prepare(`UPDATE migration_drafts SET status='publishing', updated_at=? WHERE id=?`).bind(now, draftId).run();

  try {
    let publishedId = '';
    if (row.target_platform === 'meli') {
      // create_item no ML
      const payload: any = {
        title: draft.title,
        category_id: draft.category_id,
        price: draft.price,
        currency_id: draft.currency_id || 'BRL',
        available_quantity: draft.available_quantity || 1,
        buying_mode: draft.buying_mode || 'buy_it_now',
        listing_type_id: draft.listing_type_id || 'gold_special',
        condition: draft.condition || 'new',
        pictures: draft.pictures || [],
        attributes: draft.attributes || [],
        sale_terms: draft.sale_terms || [],
        shipping: draft.shipping || { mode: 'me2' },
      };
      if (draft.description) payload.description = { plain_text: draft.description };
      const res = await mac.call(env, 'create_item', payload);
      publishedId = res?.id || res?.data?.id;
      if (!publishedId) throw new Error('ML create_item não retornou id: ' + JSON.stringify(res).slice(0, 300));
    } else {
      // shopee_create_item — roteia pra LOJA DESTINO (target_shop_id)
      const targetShop = row.target_shop_id || undefined;
      const imageIds: string[] = [];
      for (const url of (draft.pictures || []).slice(0, 9)) {
        try {
          const up = await mac.call(env, 'shopee_upload_image', { image_url: url, shopId: targetShop });
          const id = up?.response?.image_info?.image_id || up?.image_id;
          if (id) imageIds.push(id);
        } catch {}
      }
      // Shopee exige pelo menos 1 canal de frete habilitado — busca os da loja destino
      let logisticInfo: any[] = [];
      try {
        const ch = await mac.call(env, 'shopee_get_logistics_channels', { shopId: targetShop });
        const list = ch?.response?.logistics_channel_list || ch?.logistics_channel_list || [];
        logisticInfo = list.filter((c: any) => c.enabled).map((c: any) => ({ logistics_channel_id: c.logistics_channel_id, enabled: true }));
      } catch {}
      if (!logisticInfo.length) throw new Error('nenhum canal de frete habilitado na loja destino — habilite um no painel da Shopee');

      const payload: any = {
        shopId: targetShop,
        item_name: draft.item_name,
        category_id: Number(draft.category_id),
        description: draft.description,
        original_price: Number(draft.original_price) || 0,
        // Shopee exige seller_stock no formato [{ stock }], não normal_stock
        seller_stock: [{ stock: Number(draft.stock) || 0 }],
        weight: Number(draft.weight) || 0.5,
        dimension: draft.dimension,
        condition: draft.condition || 'NEW',
        brand: draft.brand,
        logistic_info: logisticInfo,
        image: { image_id_list: imageIds },
      };
      const res = await mac.call(env, 'shopee_create_item', payload);
      if (res?.error) throw new Error('Shopee: ' + (res.message || res.error));
      publishedId = String(res?.response?.item_id || res?.item_id || '');
      if (!publishedId) throw new Error('Shopee create não retornou item_id: ' + JSON.stringify(res).slice(0, 300));
    }

    // Sucesso: cria mapping pareando origem ↔ destino e resolve unmapped
    const sku = draft.source_sku || `MIG_${row.source_item_id}_${publishedId}`;
    let meliItem: string | null = null, shopeeItem: string | null = null, shopeeAcc: string | null = null;
    if (row.target_platform === 'meli') {
      // shopee (origem) → ML (novo)
      meliItem = publishedId;
      shopeeItem = row.source_item_id;
      shopeeAcc = row.source_account_id || null;
    } else if (row.source_platform === 'meli') {
      // ML (origem) → Shopee (novo na loja destino)
      meliItem = row.source_item_id;
      shopeeItem = publishedId;
      shopeeAcc = row.target_shop_id || null;
    } else {
      // shopee → shopee (cópia pra outra loja): novo anúncio Shopee standalone
      shopeeItem = publishedId;
      shopeeAcc = row.target_shop_id || null;
    }
    await env.DB.prepare(`
      INSERT INTO mappings (sku, meli_item_id, shopee_item_id, shopee_account_id, product_name, active, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,1,'migração automática',?,?)
      ON CONFLICT(sku) DO UPDATE SET
        meli_item_id=COALESCE(excluded.meli_item_id, mappings.meli_item_id),
        shopee_item_id=COALESCE(excluded.shopee_item_id, mappings.shopee_item_id),
        updated_at=excluded.updated_at
    `).bind(sku + (row.target_platform === 'shopee' && row.source_platform === 'shopee' ? '_' + (row.target_shop_id || 'sp') : ''), meliItem, shopeeItem, shopeeAcc, row.product_name || null, now, now).run().catch(() => {});
    await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE platform=? AND item_id=?`).bind(row.source_platform, row.source_item_id).run().catch(() => {});

    await env.DB.prepare(`UPDATE migration_drafts SET status='published', published_item_id=?, updated_at=? WHERE id=?`).bind(publishedId, now, draftId).run();
    return { ok: true, published_item_id: publishedId, sku };
  } catch (e: any) {
    await env.DB.prepare(`UPDATE migration_drafts SET status='failed', error=?, updated_at=? WHERE id=?`).bind(String(e.message).slice(0, 500), now, draftId).run();
    return { ok: false, error: String(e.message) };
  }
}
