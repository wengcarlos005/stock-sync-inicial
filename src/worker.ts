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
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
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
