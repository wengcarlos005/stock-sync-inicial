// Cloudflare Worker entrypoint
import { runSync, SyncEnv } from './sync';
import { handleApi } from './api';
import { html } from './ui';

export interface Env extends SyncEnv {
  DB: D1Database;
  MAC_API_KEY: string;
  MAC_URL: string;
  ADMIN_TOKEN: string;
  MELI_USER_ID: string;
  SHADOW_MODE: string;
  GITHUB_TOKEN?: string;   // PAT com permissão actions:write para disparar discovery
  GITHUB_REPO?: string;    // ex: "wengcarlos005/stock-sync-inicial"
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Serve UI at root (sem auth — auth na UI por modal)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // TEMP: diagnóstico pública pra MAC orders (remover depois)
    if (url.pathname === '/_test-orders-x9k2') {
      const r = await fetch(env.MAC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/orders/search?seller=${env.MELI_USER_ID}&sort=date_desc&limit=2` } }),
      });
      const txt = await r.text();
      return new Response(JSON.stringify({
        worker_mac_url: env.MAC_URL,
        worker_key_prefix: env.MAC_API_KEY?.slice(0, 14) + '...',
        worker_meli_user: env.MELI_USER_ID,
        mac_response_status: r.status,
        mac_response_body: txt.slice(0, 400),
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: chama o endpoint /api/products/shopee-master internamente sem auth
    if (url.pathname.startsWith('/_master-test-x9k2')) {
      const filter = url.searchParams.get('filter') || 'all';
      // Faz request interna pro endpoint real, injetando o token via env não funciona;
      // chama o handler diretamente
      const fakeReq = new Request('https://x/api/products/shopee-master?filter=' + filter, {
        headers: { 'x-admin-token': env.ADMIN_TOKEN },
      });
      const r = await (await import('./api')).handleApi(fakeReq, env);
      if (!r) return new Response('null', { status: 500 });
      const txt = await r.text();
      // Volta só estatísticas pra ficar legível
      try {
        const parsed = JSON.parse(txt);
        return new Response(JSON.stringify({
          filter,
          total_groups: parsed.total,
          total_variations: parsed.total_variations,
          first_5_groups: (parsed.items || []).slice(0, 5).map((g: any) => ({
            name: g.product_name,
            variations_count: g.variations?.length || 0,
            stocks: (g.variations || []).slice(0, 3).map((v: any) => ({ sku: v.sku, master: v.master_stock, ml: v.meli_stock, sp: v.shopee_stock })),
          })),
        }, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch {
        return new Response(txt.slice(0, 1000), { status: 500 });
      }
    }

    // TEMP: ver retorno de /api/products/shopee-master sem auth pra debug filtros
    if (url.pathname === '/_filter-test-x9k2') {
      const filter = url.searchParams.get('filter') || 'all';
      // Conta variações por categoria
      const allRows = await env.DB.prepare(`
        SELECT m.sku, m.shopee_item_id, m.meli_item_id, s.master_stock, s.meli_stock, s.shopee_stock
        FROM mappings m LEFT JOIN state s ON s.sku=m.sku
        WHERE m.active=1
      `).all();
      const list = allRows.results as any[];
      const stockOf = (r: any) => {
        if (r.master_stock != null) return r.master_stock;
        const a = r.meli_stock, b = r.shopee_stock;
        if (a == null && b == null) return null;
        if (a == null) return b;
        if (b == null) return a;
        return Math.min(a, b);
      };
      const zero = list.filter(r => stockOf(r) === 0);
      const low = list.filter(r => { const s = stockOf(r); return s != null && s > 0 && s < 3; });
      const high = list.filter(r => { const s = stockOf(r); return s != null && s >= 3; });
      const nullStock = list.filter(r => stockOf(r) == null);
      return new Response(JSON.stringify({
        filter_requested: filter,
        total_mappings: list.length,
        counts: {
          out_of_stock_zero: zero.length,
          low_stock_1_or_2: low.length,
          ok_3_or_more: high.length,
          null_stock: nullStock.length,
        },
        sample_zero: zero.slice(0, 5),
        sample_low: low.slice(0, 5),
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: Shopee item debug público (ver dados crus do MAC)
    if (url.pathname.startsWith('/_sp-debug-x9k2/')) {
      const itemId = Number(url.pathname.replace('/_sp-debug-x9k2/', ''));
      const rItem = await fetch(env.MAC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'shopee_get_item', params: { item_id: itemId } }),
      });
      const rModels = await fetch(env.MAC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'shopee_get_models', params: { item_id: itemId } }),
      });
      const itemTxt = await rItem.text();
      const modelsTxt = await rModels.text();
      // Conta unmapped do DB
      const unmCount = await env.DB.prepare(`SELECT COUNT(*) as n FROM unmapped WHERE platform='shopee' AND item_id=? AND resolved=0`).bind(String(itemId)).first<{ n: number }>();
      const unmRows = await env.DB.prepare(`SELECT id, sku, variation_id, product_name, resolved FROM unmapped WHERE platform='shopee' AND item_id=? ORDER BY id LIMIT 30`).bind(String(itemId)).all();
      return new Response(JSON.stringify({
        item_id: itemId,
        db_unmapped_active_count: unmCount?.n || 0,
        db_unmapped_sample: unmRows.results,
        mac_get_item_status: rItem.status,
        mac_get_item_body: itemTxt.slice(0, 2000),
        mac_get_models_status: rModels.status,
        mac_get_models_body: modelsTxt.slice(0, 3000),
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: dump completo de um anúncio (SP + ML) com counts e samples
    if (url.pathname.startsWith('/_anuncio-debug-x9k2/')) {
      const spId = url.pathname.replace('/_anuncio-debug-x9k2/', '');
      // Pega mappings desse SP
      const maps = await env.DB.prepare(`SELECT * FROM mappings WHERE shopee_item_id=?`).bind(spId).all();
      const mlIds = new Set<string>();
      for (const m of maps.results as any[]) if (m.meli_item_id) mlIds.add(m.meli_item_id);
      // Unmapped SP (qualquer resolved status)
      const unmSp = await env.DB.prepare(`SELECT id, sku, variation_id, product_name, resolved FROM unmapped WHERE platform='shopee' AND item_id=? ORDER BY id`).bind(spId).all();
      // Unmapped ML pra cada item_id linkado
      const unmMl: any[] = [];
      for (const mlId of mlIds) {
        const r = await env.DB.prepare(`SELECT id, sku, item_id, variation_id, product_name, resolved FROM unmapped WHERE platform='meli' AND item_id=? ORDER BY id`).bind(mlId).all();
        for (const row of r.results as any[]) unmMl.push(row);
      }
      return new Response(JSON.stringify({
        shopee_item_id: spId,
        ml_item_ids: Array.from(mlIds),
        mappings_count: (maps.results || []).length,
        mappings_sample: (maps.results as any[]).slice(0, 10),
        unmapped_sp_count: (unmSp.results || []).length,
        unmapped_sp_resolved_0: (unmSp.results as any[]).filter(r => r.resolved === 0).length,
        unmapped_sp_sample: (unmSp.results as any[]).slice(0, 30),
        unmapped_ml_count: unmMl.length,
        unmapped_ml_resolved_0: unmMl.filter(r => r.resolved === 0).length,
        unmapped_ml_sample: unmMl.slice(0, 30),
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: debug fotos de um item ML
    if (url.pathname.startsWith('/_ml-pics-x9k2/')) {
      const itemId = url.pathname.replace('/_ml-pics-x9k2/', '');
      const r = await fetch(env.MAC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/items/${itemId}?include_attributes=all` } }),
      });
      const txt = await r.text();
      const parsed = JSON.parse(txt);
      const item = parsed?.data || parsed;
      const variations = (item.variations || []).map((v: any) => ({
        id: v.id,
        attribute_combinations: v.attribute_combinations,
        picture_ids: v.picture_ids,
        pictures_count: (v.picture_ids || []).length,
        seller_sku: v.seller_sku,
      }));
      return new Response(JSON.stringify({
        item_id: item.id,
        category_id: item.category_id,
        item_status: item.status,
        item_pictures_count: (item.pictures || []).length,
        item_picture_ids: (item.pictures || []).map((p: any) => p.id || p.url).slice(0, 30),
        variations_count: variations.length,
        variations_picture_counts: variations.map((v: any) => ({ id: v.id, count: v.pictures_count })),
        total_variation_pictures: variations.reduce((sum: number, v: any) => sum + v.pictures_count, 0),
        all_variation_pic_ids_unique: [...new Set(variations.flatMap((v: any) => v.picture_ids || []))].length,
        variations_sample: variations.slice(0, 3),
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: refresh unmapped.sku do lado ML pra 1 item específico (busca ML live e atualiza DB)
    if (url.pathname.startsWith('/_refresh-ml-item-x9k2/')) {
      try {
      const itemId = url.pathname.replace('/_refresh-ml-item-x9k2/', '');
      const r = await fetch(env.MAC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/items/${itemId}?include_attributes=all` } }),
      });
      const txt = await r.text();
      let parsed: any = null;
      try { parsed = JSON.parse(txt); } catch { return new Response(JSON.stringify({ error: 'invalid json', raw: txt.slice(0, 300) }), { status: 500 }); }
      const item = parsed?.data || parsed;
      if (!item || item.error) return new Response(JSON.stringify({ error: 'item not found', raw: txt.slice(0, 300) }), { status: 404 });
      const variations = item.variations || [];
      // Atualiza unmapped pra cada variation_id com o SKU live
      let updatedUnmapped = 0, updatedMappings = 0, totalLiveVars = variations.length;
      for (const v of variations) {
        const liveSku = (v.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name || v.seller_custom_field;
        if (!liveSku) continue;
        const vid = String(v.id);
        // Update unmapped row sku se diferir
        const rUnm = await env.DB.prepare(`UPDATE unmapped SET sku=? WHERE platform='meli' AND item_id=? AND variation_id=? AND sku != ?`)
          .bind(liveSku, itemId, vid, liveSku).run();
        updatedUnmapped += (rUnm.meta.changes ?? 0);
        // Mappings também — atualiza SKU se diferir (pode ter mapping com SKU antigo apontando pra essa variação)
        const rMap = await env.DB.prepare(`UPDATE mappings SET sku=? WHERE meli_item_id=? AND meli_variation_id=? AND sku != ?`)
          .bind(liveSku, itemId, vid, liveSku).run();
        updatedMappings += (rMap.meta.changes ?? 0);
      }
      // Se item sem variação, atualiza com SKU item-level
      if (variations.length === 0) {
        const liveSku = (item.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name || item.seller_custom_field;
        if (liveSku) {
          const r1 = await env.DB.prepare(`UPDATE unmapped SET sku=? WHERE platform='meli' AND item_id=? AND (variation_id IS NULL OR variation_id='') AND sku != ?`)
            .bind(liveSku, itemId, liveSku).run();
          updatedUnmapped += (r1.meta.changes ?? 0);
        }
      }
      return new Response(JSON.stringify({
        item_id: itemId,
        title: item.title,
        live_variations: totalLiveVars,
        unmapped_skus_updated: updatedUnmapped,
        mappings_skus_updated: updatedMappings,
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e: any) { return new Response(JSON.stringify({ error: 'exception', message: String(e?.message || e), stack: String(e?.stack || '').slice(0, 500) }), { status: 500 }); }
    }

    // TEMP: fetch ML item live + pareia variações automaticamente pelos SKUs com Shopee mappings/unmapped
    if (url.pathname.startsWith('/_smart-pair-ml-x9k2/')) {
      const mlItemId = url.pathname.replace('/_smart-pair-ml-x9k2/', '');
      // Fetch ML live
      const r = await fetch(env.MAC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/items/${mlItemId}?include_attributes=all` } }),
      });
      const txt = await r.text();
      let parsed: any = null;
      try { parsed = JSON.parse(txt); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 500 }); }
      const item = parsed?.data || parsed;
      if (!item || item.error) return new Response(JSON.stringify({ error: 'item not found' }), { status: 404 });

      // Helper: extrai SKU de uma variação
      const getSku = (v: any): string => {
        if (v.seller_custom_field) return String(v.seller_custom_field).trim();
        const a = (v.attributes || []).find((x: any) => x.id === 'SELLER_SKU');
        return a?.value_name?.toString().trim() || '';
      };
      // Helper: candidate keys (mesma lógica do api.ts)
      const norm = (s: any) => String(s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
      const candidateKeys = (s: any): string[] => {
        const keys = new Set<string>();
        const raw = String(s || '').trim();
        if (!raw) return [];
        keys.add(norm(raw));
        const lastUnd = raw.lastIndexOf('_');
        if (lastUnd >= 0 && lastUnd < raw.length - 1) keys.add(norm(raw.slice(lastUnd + 1)));
        const firstUnd = raw.indexOf('_');
        if (firstUnd > 0) keys.add(norm(raw.slice(0, firstUnd)));
        for (const seg of raw.split(/[_\-\s]+/)) {
          const n = norm(seg);
          if (n && n.length >= 6) keys.add(n);
        }
        return Array.from(keys).filter(Boolean);
      };

      // Carrega TODOS Shopee unmapped e Shopee-only mappings pra matching
      const [spUnmR, spMapR] = await Promise.all([
        env.DB.prepare(`SELECT id, sku, item_id, variation_id FROM unmapped WHERE platform='shopee' AND resolved=0 AND sku IS NOT NULL`).all(),
        env.DB.prepare(`SELECT sku, shopee_item_id, shopee_model_id FROM mappings WHERE active=1 AND shopee_item_id IS NOT NULL AND meli_item_id IS NULL`).all(),
      ]);
      // Index Shopee por candidate keys
      const spByKey = new Map<string, { source: 'unmapped' | 'mapping'; row: any }>();
      for (const u of spUnmR.results as any[]) {
        for (const k of candidateKeys(u.sku)) {
          if (!spByKey.has(k)) spByKey.set(k, { source: 'unmapped', row: u });
        }
      }
      for (const m of spMapR.results as any[]) {
        for (const k of candidateKeys(m.sku)) {
          if (!spByKey.has(k)) spByKey.set(k, { source: 'mapping', row: m });
        }
      }

      const variations = item.variations || [];
      const results: any[] = [];
      let pairedNew = 0, pairedExisting = 0, noShopeeMatch = 0;
      const now = Date.now();

      for (const v of variations) {
        const mlSku = getSku(v);
        if (!mlSku) { results.push({ var_id: v.id, status: 'no_ml_sku' }); continue; }
        const mlKeys = candidateKeys(mlSku);
        // Procura Shopee match
        let spMatch: { source: 'unmapped' | 'mapping'; row: any } | null = null;
        for (const k of mlKeys) {
          if (spByKey.has(k)) { spMatch = spByKey.get(k)!; break; }
        }
        if (!spMatch) {
          noShopeeMatch++;
          results.push({ var_id: v.id, ml_sku: mlSku, status: 'no_shopee_match' });
          continue;
        }
        const sp = spMatch.row;
        const shopeeItemId = sp.shopee_item_id || sp.item_id;
        const shopeeModelId = sp.shopee_model_id || sp.variation_id;
        // Verifica se já existe mapping pra essa variação ML
        const existing = await env.DB.prepare(`SELECT sku, active FROM mappings WHERE meli_item_id=? AND meli_variation_id=?`)
          .bind(mlItemId, String(v.id)).first<any>();
        if (existing) {
          // Já existe — só completa Shopee se faltava
          await env.DB.prepare(`UPDATE mappings SET shopee_item_id=?, shopee_model_id=?, active=1, updated_at=? WHERE sku=?`)
            .bind(shopeeItemId, shopeeModelId || null, now, existing.sku).run();
          pairedExisting++;
          results.push({ var_id: v.id, ml_sku: mlSku, sp_sku: sp.sku, status: 'updated_existing', mapping_sku: existing.sku });
        } else {
          // Cria mapping novo usando o SKU "limpo" (preferindo o do ML que é o que o user setou)
          try {
            await env.DB.prepare(`
              INSERT INTO mappings (sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, product_name, active, notes, created_at, updated_at)
              VALUES (?,?,?,?,?,?,1,'smart-pair-ml',?,?)
              ON CONFLICT(sku) DO UPDATE SET
                meli_item_id=excluded.meli_item_id, meli_variation_id=excluded.meli_variation_id,
                shopee_item_id=excluded.shopee_item_id, shopee_model_id=excluded.shopee_model_id,
                active=1, updated_at=excluded.updated_at
            `).bind(mlSku, mlItemId, String(v.id), shopeeItemId, shopeeModelId || null, item.title || '', now, now).run();
            pairedNew++;
            results.push({ var_id: v.id, ml_sku: mlSku, sp_sku: sp.sku, status: 'created_new' });
          } catch (e: any) {
            results.push({ var_id: v.id, ml_sku: mlSku, error: String(e.message) });
          }
        }
        // Marca unmapped/old mapping como resolvido/inativo
        if (spMatch.source === 'unmapped') {
          await env.DB.prepare(`UPDATE unmapped SET resolved=1 WHERE id=?`).bind(sp.id).run();
        } else if (spMatch.source === 'mapping' && sp.sku !== mlSku) {
          // Desativa o mapping Shopee-only se ele tem SKU diferente do paired final
          await env.DB.prepare(`UPDATE mappings SET active=0, notes=COALESCE(notes,'') || ' [merged-into ' || ? || ']' WHERE sku=?`)
            .bind(mlSku, sp.sku).run();
        }
      }

      return new Response(JSON.stringify({
        ml_item_id: mlItemId,
        item_title: item.title,
        total_ml_variations: variations.length,
        paired_new: pairedNew,
        paired_existing_updated: pairedExisting,
        no_shopee_match: noShopeeMatch,
        results: results.slice(0, 50),
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: testa MAC actions e endpoints ML alternativos pra stock
    if (url.pathname.startsWith('/_test-mac-stock-x9k2/')) {
      const parts = url.pathname.replace('/_test-mac-stock-x9k2/', '').split('/');
      const itemId = parts[0];
      const variationId = parts[1];
      const qty = Number(parts[2] || 1);

      const tries: Array<{ name: string; action: string; params: any }> = [
        // MAC actions diretas
        { name: 'mac_meli_update_stock', action: 'meli_update_stock', params: { item_id: itemId, variation_id: Number(variationId), quantity: qty } },
        { name: 'mac_meli_set_stock', action: 'meli_set_stock', params: { item_id: itemId, variation_id: Number(variationId), quantity: qty } },
        { name: 'mac_meli_stock', action: 'meli_stock', params: { item_id: itemId, variation_id: Number(variationId), quantity: qty } },
        { name: 'mac_meli_update_inventory', action: 'meli_update_inventory', params: { item_id: itemId, variation_id: Number(variationId), quantity: qty } },
        // ML endpoints menos comuns
        { name: 'mac_raw_PATCH_items', action: 'raw', params: { method: 'PATCH', path: `/items/${itemId}`, body: { variations: [{ id: Number(variationId), available_quantity: qty }] } } },
        { name: 'mac_raw_PUT_field_qp', action: 'raw', params: { method: 'PUT', path: `/items/${itemId}?attributes=available_quantity`, body: { variations: [{ id: Number(variationId), available_quantity: qty }] } } },
        // PUT direto na variação (não documentado mas alguns ERPs usam)
        { name: 'mac_raw_PUT_variation', action: 'raw', params: { method: 'PUT', path: `/items/${itemId}/variations/${variationId}`, body: { available_quantity: qty } } },
        { name: 'mac_raw_POST_variation', action: 'raw', params: { method: 'POST', path: `/items/${itemId}/variations/${variationId}/stock`, body: { available_quantity: qty } } },
      ];
      const attempts: any[] = [];
      for (const t of tries) {
        try {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: t.action, params: t.params }),
          });
          const txt = await r.text();
          let parsed: any = null;
          try { parsed = JSON.parse(txt); } catch {}
          const status = parsed?.status || r.status;
          const errMsg = parsed?.data?.cause?.[0]?.message || parsed?.cause?.[0]?.message || parsed?.data?.message || parsed?.message || parsed?.error || null;
          const isOk = (status >= 200 && status < 300) || (parsed?.data && !parsed?.data?.error);
          attempts.push({ name: t.name, action: t.action, status, error: errMsg, ok: isOk, body_sample: txt.slice(0, 250) });
        } catch (e: any) {
          attempts.push({ name: t.name, error: String(e.message) });
        }
      }
      return new Response(JSON.stringify({ item_id: itemId, variation_id: variationId, attempts }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: testa endpoint user-products/stock que bypassa validação do item
    if (url.pathname.startsWith('/_test-userproducts-stock-x9k2/')) {
      const parts = url.pathname.replace('/_test-userproducts-stock-x9k2/', '').split('/');
      const userProductId = parts[0]; // ex: MLBU2543207145
      const qty = Number(parts[1] || 1);
      const tries: Array<{ name: string; method: string; path: string; body: any }> = [
        { name: 'POST_stock_quantity', method: 'POST', path: `/user-products/${userProductId}/stock`, body: { quantity: qty } },
        { name: 'POST_stock_available_quantity', method: 'POST', path: `/user-products/${userProductId}/stock`, body: { available_quantity: qty } },
        { name: 'PUT_stock_quantity', method: 'PUT', path: `/user-products/${userProductId}/stock`, body: { quantity: qty } },
        { name: 'PUT_userprod_quantity', method: 'PUT', path: `/user-products/${userProductId}`, body: { quantity: qty } },
        { name: 'POST_stock_full', method: 'POST', path: `/user-products/${userProductId}/stock`, body: { stock: qty } },
      ];
      const attempts: any[] = [];
      for (const t of tries) {
        try {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'raw', params: { method: t.method, path: t.path, body: t.body } }),
          });
          const txt = await r.text();
          let parsed: any = null;
          try { parsed = JSON.parse(txt); } catch {}
          const status = parsed?.status || r.status;
          const errMsg = parsed?.data?.cause?.[0]?.message || parsed?.cause?.[0]?.message || parsed?.data?.message || parsed?.message || null;
          attempts.push({ name: t.name, path: t.path, status, error: errMsg, ok: status >= 200 && status < 300, body_sample: txt.slice(0, 300) });
        } catch (e: any) {
          attempts.push({ name: t.name, error: String(e.message) });
        }
      }
      return new Response(JSON.stringify({ user_product_id: userProductId, attempts }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: descobre como MAC lida com múltiplas contas
    if (url.pathname === '/_mac-accounts-x9k2') {
      const tries: Array<{ name: string; action: string; params: any }> = [
        { name: 'accounts', action: 'accounts', params: {} },
        { name: 'list_accounts', action: 'list_accounts', params: {} },
        { name: 'me', action: 'me', params: {} },
        { name: 'list_items_no_acct', action: 'shopee_list_items', params: { page_size: 1 } },
        { name: 'list_items_acct_710', action: 'shopee_list_items', params: { page_size: 1, account_id: '710749365' } },
        { name: 'list_items_acct_1351', action: 'shopee_list_items', params: { page_size: 1, account_id: '1351430393' } },
        { name: 'list_items_shop_710', action: 'shopee_list_items', params: { page_size: 1, shop_id: '710749365' } },
        { name: 'list_items_shop_1351', action: 'shopee_list_items', params: { page_size: 1, shop_id: '1351430393' } },
      ];
      const results: any[] = [];
      for (const t of tries) {
        try {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: t.action, params: t.params }),
          });
          const txt = await r.text();
          let parsed: any = null;
          try { parsed = JSON.parse(txt); } catch {}
          results.push({ name: t.name, status: parsed?.status || r.status, sample: txt.slice(0, 600) });
        } catch (e: any) {
          results.push({ name: t.name, error: String(e.message) });
        }
      }
      return new Response(JSON.stringify(results, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: descobre se item tem inventory_id, user_product_id, family_id etc
    if (url.pathname.startsWith('/_ml-meta-x9k2/')) {
      const itemId = url.pathname.replace('/_ml-meta-x9k2/', '');
      const r = await fetch(env.MAC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/items/${itemId}` } }),
      });
      const txt = await r.text();
      const parsed = JSON.parse(txt);
      const item = parsed?.data || parsed;
      const variationIds = (item.variations || []).map((v: any) => ({ id: v.id, inventory_id: v.inventory_id, user_product_id: v.user_product_id }));
      return new Response(JSON.stringify({
        item_id: item.id,
        family_id: item.family_id,
        family_name: item.family_name,
        catalog_product_id: item.catalog_product_id,
        catalog_listing: item.catalog_listing,
        inventory_id: item.inventory_id,
        user_product_id: item.user_product_id,
        shipping_logistic_type: item.shipping?.logistic_type,
        listing_type_id: item.listing_type_id,
        status: item.status,
        variations_meta: variationIds.slice(0, 5),
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: testa vários payloads/endpoints pra atualizar estoque de uma variação ML
    if (url.pathname.startsWith('/_test-ml-stock-x9k2/')) {
      const parts = url.pathname.replace('/_test-ml-stock-x9k2/', '').split('/');
      const itemId = parts[0];
      const variationId = parts[1];
      const qty = Number(parts[2] || 1);
      const attempts: any[] = [];
      const tries: Array<{ name: string; method: string; path: string; body: any }> = [
        { name: 'PUT_variations_arr', method: 'PUT', path: `/items/${itemId}`, body: { variations: [{ id: Number(variationId), available_quantity: qty }] } },
        { name: 'PUT_only_qty_no_var', method: 'PUT', path: `/items/${itemId}`, body: { available_quantity: qty } },
        { name: 'PUT_with_status_active', method: 'PUT', path: `/items/${itemId}`, body: { status: 'active', variations: [{ id: Number(variationId), available_quantity: qty }] } },
        { name: 'PUT_with_validate_only_false', method: 'PUT', path: `/items/${itemId}?validate_only=false`, body: { variations: [{ id: Number(variationId), available_quantity: qty }] } },
        { name: 'PUT_var_array_string_id', method: 'PUT', path: `/items/${itemId}`, body: { variations: [{ id: variationId, available_quantity: qty }] } },
      ];
      for (const t of tries) {
        try {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'raw', params: { method: t.method, path: t.path, body: t.body } }),
          });
          const txt = await r.text();
          let parsed: any = null;
          try { parsed = JSON.parse(txt); } catch {}
          const status = parsed?.status || r.status;
          const errMsg = parsed?.data?.cause?.[0]?.message || parsed?.cause?.[0]?.message || parsed?.data?.message || parsed?.message || null;
          attempts.push({ name: t.name, status, error: errMsg, ok: status >= 200 && status < 300 });
        } catch (e: any) {
          attempts.push({ name: t.name, error: String(e.message) });
        }
      }
      return new Response(JSON.stringify({ item_id: itemId, variation_id: variationId, attempts }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: dump mappings com SKU synth
    if (url.pathname === '/_synth-debug-x9k2') {
      const synth = await env.DB.prepare(`SELECT sku, meli_item_id, meli_variation_id, shopee_item_id, shopee_model_id, active FROM mappings WHERE sku LIKE 'MLB5141578342%' ORDER BY sku`).all();
      return new Response(JSON.stringify({ count: (synth.results || []).length, synth_mappings: synth.results }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: dump mappings parciais do Pokemon
    if (url.pathname === '/_pokemon-debug-x9k2') {
      const onlyMl = await env.DB.prepare(`SELECT sku, meli_item_id, meli_variation_id, shopee_item_id, product_name, active FROM mappings WHERE meli_item_id LIKE 'MLB5141578342%' OR sku LIKE 'MLB5141578342%' OR sku LIKE '%18572%' OR sku LIKE '%18774%' OR sku LIKE '%2284%' OR sku LIKE '%1595%' OR sku LIKE '%2294%' OR sku LIKE '%1298%' ORDER BY sku LIMIT 30`).all();
      const unmSp = await env.DB.prepare(`SELECT sku, item_id, variation_id, resolved FROM unmapped WHERE platform='shopee' AND (sku LIKE '18572%' OR sku LIKE '18774%' OR sku LIKE '22878%' OR sku LIKE '15954%' OR sku LIKE '22941%' OR sku LIKE '12983%') ORDER BY sku LIMIT 30`).all();
      const unmMl = await env.DB.prepare(`SELECT sku, item_id, variation_id, resolved FROM unmapped WHERE platform='meli' AND (item_id='MLB5141578342' OR sku LIKE 'MLB5141578342%') ORDER BY sku LIMIT 30`).all();
      return new Response(JSON.stringify({ mappings: onlyMl.results, unmapped_shopee: unmSp.results, unmapped_meli: unmMl.results }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: roda complete-partial-mappings sem auth
    if (url.pathname === '/_complete-partial-x9k2') {
      const fakeReq = new Request('https://x/api/complete-partial-mappings', {
        method: 'POST',
        headers: { 'x-admin-token': env.ADMIN_TOKEN },
      });
      const r = await (await import('./api')).handleApi(fakeReq, env);
      if (!r) return new Response('null', { status: 500 });
      return r;
    }

    // TEMP: roda match-by-sku-now sem auth
    if (url.pathname === '/_match-now-x9k2') {
      const fakeReq = new Request('https://x/api/match-by-sku-now', {
        method: 'POST',
        headers: { 'x-admin-token': env.ADMIN_TOKEN },
      });
      const r = await (await import('./api')).handleApi(fakeReq, env);
      if (!r) return new Response('null', { status: 500 });
      return r;
    }

    // TEMP: lista N últimos anúncios criados (por start_time desc)
    if (url.pathname.startsWith('/_ml-recent-x9k2')) {
      const userId = env.MELI_USER_ID;
      const limit = Number(url.searchParams.get('limit') || 20);
      const r = await fetch(env.MAC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/users/${userId}/items/search?orders=start_time_desc&limit=${limit}` } }),
      });
      const txt = await r.text();
      const parsed = JSON.parse(txt);
      const ids: string[] = parsed?.data?.results || parsed?.results || [];
      const items: any[] = [];
      for (const id of ids) {
        const rr = await fetch(env.MAC_URL, {
          method: 'POST',
          headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/items/${id}?attributes=id,title,attributes,family_id,status,start_time` } }),
        });
        const t = await rr.text();
        try {
          const p = JSON.parse(t);
          const it = p?.data || p;
          if (it && !it.error) {
            const sku = (it.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name;
            items.push({ id: it.id, title: it.title, sku, status: it.status, family_id: it.family_id, start_time: it.start_time });
          }
        } catch {}
      }
      return new Response(JSON.stringify({ raw_total: parsed?.data?.paging?.total || parsed?.paging?.total, items }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: re-pareia mapping (SKU → novo meli_item_id, com meli_variation_id=NULL pra single-variation)
    if (url.pathname.startsWith('/_repair-x9k2/')) {
      // Format: /sku/MLB_id (separados por barra)
      const parts = url.pathname.replace('/_repair-x9k2/', '').split('/');
      const sku = parts[0];
      const mlbId = parts[1];
      if (!sku || !mlbId) return new Response(JSON.stringify({ error: 'use /sku/MLBxxx' }), { status: 400 });
      const r = await env.DB.prepare(
        `UPDATE mappings SET meli_item_id=?, meli_variation_id=NULL, updated_at=?, notes=COALESCE(notes,'') || ' [re-paired to single-item]' WHERE sku=?`
      ).bind(mlbId, Date.now(), sku).run();
      return new Response(JSON.stringify({ sku, meli_item_id: mlbId, rows_updated: r.meta.changes }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: pega SKU + title de um item ML
    if (url.pathname.startsWith('/_ml-sku-x9k2/')) {
      const itemId = url.pathname.replace('/_ml-sku-x9k2/', '');
      const r = await fetch(env.MAC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/items/${itemId}?include_attributes=all` } }),
      });
      const txt = await r.text();
      const parsed = JSON.parse(txt);
      const item = parsed?.data || parsed;
      const sku = (item.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name;
      return new Response(JSON.stringify({ item_id: item.id, title: item.title, sku, family_id: item.family_id, status: item.status }), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: lista itens do vendedor com family_id específico
    if (url.pathname.startsWith('/_ml-by-family-x9k2/')) {
      const familyId = url.pathname.replace('/_ml-by-family-x9k2/', '');
      const userId = env.MELI_USER_ID;
      // Lista todos os items do vendedor com paginação
      const allItems: string[] = [];
      for (const status of ['active', 'paused', 'closed', 'under_review']) {
        let offset = 0;
        while (offset < 2000) {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/users/${userId}/items/search?status=${status}&limit=50&offset=${offset}` } }),
          });
          const txt = await r.text();
          let parsed: any = null;
          try { parsed = JSON.parse(txt); } catch {}
          const ids: string[] = parsed?.data?.results || parsed?.results || [];
          if (ids.length === 0) break;
          allItems.push(...ids);
          if (ids.length < 50) break;
          offset += 50;
        }
      }
      // Filtra por family_id
      const matches: any[] = [];
      for (const id of allItems) {
        try {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/items/${id}?attributes=family_id,title,attributes,status` } }),
          });
          const txt = await r.text();
          let parsed: any = null;
          try { parsed = JSON.parse(txt); } catch {}
          const item = parsed?.data || parsed;
          if (!item || item.error) continue;
          if (String(item.family_id || '') === String(familyId)) {
            const sku = (item.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name;
            matches.push({ item_id: item.id, title: item.title, sku, status: item.status });
          }
        } catch {}
      }
      return new Response(JSON.stringify({ family_id: familyId, total_user_items: allItems.length, matches }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: busca itens do vendedor por SKU
    if (url.pathname.startsWith('/_ml-find-sku-x9k2/')) {
      const sku = url.pathname.replace('/_ml-find-sku-x9k2/', '');
      const userId = env.MELI_USER_ID;
      // Busca todos os status pra pegar inclusive recém-criados
      const allItems: any[] = [];
      for (const status of ['active', 'paused', 'closed', 'under_review']) {
        let offset = 0;
        while (offset < 1000) {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/users/${userId}/items/search?status=${status}&limit=50&offset=${offset}` } }),
          });
          const txt = await r.text();
          let parsed: any = null;
          try { parsed = JSON.parse(txt); } catch {}
          const ids: string[] = parsed?.data?.results || parsed?.results || [];
          if (ids.length === 0) break;
          for (const id of ids) allItems.push({ status, id });
          if (ids.length < 50) break;
          offset += 50;
        }
      }
      // Pra cada item, busca o /items/{id} e checa se contém o SKU
      const matches: any[] = [];
      for (const it of allItems.slice(0, 200)) {
        try {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/items/${it.id}?include_attributes=all` } }),
          });
          const txt = await r.text();
          let parsed: any = null;
          try { parsed = JSON.parse(txt); } catch {}
          const item = parsed?.data || parsed;
          if (!item || item.error) continue;
          // Procura SKU nos atributos do item OU nas variações
          const itemSku = (item.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name;
          const variationSkus: string[] = [];
          for (const v of (item.variations || [])) {
            const vSku = (v.attributes || []).find((a: any) => a.id === 'SELLER_SKU')?.value_name || v.seller_custom_field;
            if (vSku) variationSkus.push(vSku);
          }
          if (itemSku === sku || variationSkus.includes(sku) || variationSkus.some(s => s && s.toString().toLowerCase() === sku.toLowerCase())) {
            matches.push({
              item_id: item.id, title: item.title, status: item.status,
              item_sku: itemSku, variation_skus: variationSkus, variations_count: (item.variations || []).length,
              family_id: item.family_id, family_name: item.family_name,
            });
          }
        } catch {}
      }
      return new Response(JSON.stringify({ sku_searched: sku, items_scanned: allItems.length, matches }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: descobre o que é um ID ML (item, catalog product, family, etc)
    if (url.pathname.startsWith('/_ml-whois-x9k2/')) {
      const id = url.pathname.replace('/_ml-whois-x9k2/', '');
      const userId = env.MELI_USER_ID;
      const tries = [
        { name: 'item_direto', path: `/items/${id}` },
        { name: 'item_MLB', path: `/items/MLB${id}` },
        { name: 'product_catalog', path: `/products/${id}` },
        { name: 'product_search', path: `/products/search?status=active&product_identifier=${id}` },
        { name: 'user_items_seller_search', path: `/users/${userId}/items/search?q=${id}` },
        { name: 'catalog_products_family', path: `/catalog_products/family/${id}` },
        { name: 'sites_products', path: `/sites/MLB/products?family_id=${id}` },
      ];
      const results: any[] = [];
      for (const t of tries) {
        try {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: t.path } }),
          });
          const txt = await r.text();
          let parsed: any = null;
          try { parsed = JSON.parse(txt); } catch {}
          const status = parsed?.status || r.status;
          results.push({ try: t.name, path: t.path, status, body_sample: txt.slice(0, 400) });
        } catch (e: any) {
          results.push({ try: t.name, path: t.path, error: String(e.message) });
        }
      }
      return new Response(JSON.stringify({ id, results }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: desvincula item do catálogo (family_id=null)
    if (url.pathname.startsWith('/_ml-unlink-catalog-x9k2/')) {
      const itemId = url.pathname.replace('/_ml-unlink-catalog-x9k2/', '');
      // Tenta varios payloads pra desvincular do catálogo
      const attempts = [
        { family_id: null },
        { catalog_listing: false },
        { catalog_product_id: null },
      ];
      const results: any[] = [];
      for (const payload of attempts) {
        try {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'raw', params: { method: 'PUT', path: `/items/${itemId}`, body: payload } }),
          });
          const txt = await r.text();
          results.push({ payload, status: r.status, response: txt.slice(0, 500) });
          if (r.ok) break;
        } catch (e: any) {
          results.push({ payload, error: String(e.message) });
        }
      }
      return new Response(JSON.stringify({ item_id: itemId, attempts: results }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: dump completo do item ML
    if (url.pathname.startsWith('/_ml-full-x9k2/')) {
      const itemId = url.pathname.replace('/_ml-full-x9k2/', '');
      const r = await fetch(env.MAC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/items/${itemId}?include_attributes=all` } }),
      });
      const txt = await r.text();
      return new Response(txt, { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: chama recreate-ml-variations sem auth (dry_run e real)
    if (url.pathname.startsWith('/_recreate-ml-x9k2/')) {
      const parts = url.pathname.replace('/_recreate-ml-x9k2/', '').split('/');
      const itemId = parts[0];
      const real = url.searchParams.get('real') === '1';
      const target = `https://x/api/recreate-ml-variations/${itemId}${real ? '' : '?dry_run=1'}`;
      const fakeReq = new Request(target, {
        method: 'POST',
        headers: { 'x-admin-token': env.ADMIN_TOKEN },
      });
      const r = await (await import('./api')).handleApi(fakeReq, env);
      if (!r) return new Response('null', { status: 500 });
      return r;
    }

    // TEMP: SKU debug público (remover depois)
    if (url.pathname.startsWith('/_sku-debug-x9k2/')) {
      const sku = decodeURIComponent(url.pathname.replace('/_sku-debug-x9k2/', ''));
      const [mapsR, unmR, st, unmByItemId, mapsByItemId, lastRuns] = await Promise.all([
        env.DB.prepare(`SELECT * FROM mappings WHERE sku=?`).bind(sku).all(),
        env.DB.prepare(`SELECT * FROM unmapped WHERE sku=?`).bind(sku).all(),
        env.DB.prepare(`SELECT * FROM state WHERE sku=?`).bind(sku).first(),
        env.DB.prepare(`SELECT * FROM unmapped WHERE item_id=? OR item_id=?`).bind(sku, sku.replace(/^MLB/i, '')).all(),
        env.DB.prepare(`SELECT * FROM mappings WHERE meli_item_id=? OR meli_item_id=?`).bind(sku, sku.replace(/^MLB/i, '')).all(),
        env.DB.prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT 3`).all(),
      ]);
      // Live ML
      let mlLive: any = null;
      if (/^MLB\d+/i.test(sku) || /^\d{8,}$/.test(sku)) {
        const itemId = /^MLB\d+/i.test(sku) ? sku.toUpperCase() : 'MLB' + sku;
        try {
          const r = await fetch(env.MAC_URL, {
            method: 'POST',
            headers: { 'x-api-key': env.MAC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'raw', params: { method: 'GET', path: `/items/${itemId}?include_attributes=all` } }),
          });
          const txt = await r.text();
          let item: any = null;
          try { const parsed = JSON.parse(txt); item = parsed?.data || parsed; } catch {}
          if (item && !item.error) {
            const skuAttr = (item.attributes || []).find((a: any) => a.id === 'SELLER_SKU');
            mlLive = {
              id: item.id,
              title: item.title,
              status: item.status,
              available_quantity: item.available_quantity,
              seller_custom_field: item.seller_custom_field,
              seller_sku: item.seller_sku,
              SELLER_SKU_attr: skuAttr?.value_name || skuAttr?.values?.[0]?.name || null,
              variations_count: (item.variations || []).length,
              variations: (item.variations || []).slice(0, 5).map((v: any) => {
                const vAttr = (v.attributes || []).find((a: any) => a.id === 'SELLER_SKU');
                return {
                  id: v.id,
                  seller_custom_field: v.seller_custom_field,
                  seller_sku: v.seller_sku,
                  SELLER_SKU_attr: vAttr?.value_name || vAttr?.values?.[0]?.name || null,
                  available_quantity: v.available_quantity,
                  attr_combos: (v.attribute_combinations || []).map((c: any) => c.value_name).filter(Boolean),
                };
              }),
            };
          } else {
            mlLive = { error: 'item not returned', raw: txt.slice(0, 300) };
          }
        } catch (e: any) { mlLive = { error: e.message }; }
      }
      return new Response(JSON.stringify({
        sku,
        mappings_by_sku: mapsR.results,
        unmapped_by_sku: unmR.results,
        state: st,
        unmapped_by_item_id: unmByItemId.results,
        mappings_by_meli_item_id: mapsByItemId.results,
        recent_runs: lastRuns.results,
        ml_live: mlLive,
      }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // TEMP: trigger único de discovery (remover depois)
    if (url.pathname === '/_kick-discovery-once-x9k2') {
      if (!env.GITHUB_TOKEN) return new Response(JSON.stringify({ error: 'GITHUB_TOKEN not configured' }), { status: 500 });
      const repo = env.GITHUB_REPO || 'wengcarlos005/stock-sync-inicial';
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/282879355/dispatches`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'stock-sync-worker',
        },
        body: JSON.stringify({ ref: 'main', inputs: { debug: 'false' } }),
      });
      return new Response(JSON.stringify({ status: r.status, ok: r.ok }), { status: r.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
    }



    // API endpoints — todos precisam de admin token
    if (url.pathname.startsWith('/api/')) {
      const token = req.headers.get('x-admin-token') || url.searchParams.get('token');
      if (token !== env.ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      const r = await handleApi(req, env);
      if (r) return r;
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        const stats = await runSync(env, 'cron');
        console.log('Cron sync done:', JSON.stringify(stats));
      } catch (e: any) {
        console.error('Cron sync failed:', e.message);
      }
    })());
  },
};
