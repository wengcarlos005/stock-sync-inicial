-- Schema D1: stock-sync v0.1
-- Roda com: npm run db:migrate:prod

-- =============================================================
-- mappings: pareamento SKU → IDs nas plataformas
-- =============================================================
CREATE TABLE IF NOT EXISTS mappings (
  sku             TEXT PRIMARY KEY,
  meli_item_id    TEXT,                 -- MLB... (item-pai)
  meli_variation_id TEXT,               -- null se sem variação
  shopee_item_id  TEXT,                 -- 22993636198
  shopee_model_id TEXT,                 -- null se sem variação
  product_name    TEXT,                 -- nome de exibição (do primeiro lado descoberto)
  active          INTEGER NOT NULL DEFAULT 1,  -- 0 = não sincronizar
  notes           TEXT,                 -- motivo de desativação ou observações
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mappings_active ON mappings(active);
CREATE INDEX IF NOT EXISTS idx_mappings_meli ON mappings(meli_item_id);
CREATE INDEX IF NOT EXISTS idx_mappings_shopee ON mappings(shopee_item_id);

-- =============================================================
-- state: último estoque conhecido por canal
-- =============================================================
CREATE TABLE IF NOT EXISTS state (
  sku             TEXT PRIMARY KEY,
  meli_stock      INTEGER,              -- último estoque visto no ML
  shopee_stock    INTEGER,              -- último estoque visto na Shopee
  master_stock    INTEGER,              -- valor consolidado (geralmente igual aos 2)
  last_poll_at    INTEGER NOT NULL,
  last_change_at  INTEGER,
  FOREIGN KEY (sku) REFERENCES mappings(sku) ON DELETE CASCADE
);

-- =============================================================
-- changes: log audit append-only de toda mudança detectada
-- =============================================================
CREATE TABLE IF NOT EXISTS changes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  sku             TEXT NOT NULL,
  source          TEXT NOT NULL,        -- 'meli' | 'shopee' | 'manual' | 'reconcile'
  trigger         TEXT NOT NULL,        -- 'sale' | 'restock' | 'manual_set' | 'startup' | 'conflict'
  meli_stock_before  INTEGER,
  meli_stock_after   INTEGER,
  shopee_stock_before INTEGER,
  shopee_stock_after  INTEGER,
  delta           INTEGER,              -- mudança líquida (negativo = vendeu)
  propagated_to   TEXT,                 -- 'meli' | 'shopee' | NULL (se shadow ou falha)
  shadow          INTEGER NOT NULL DEFAULT 0,  -- 1 = só logado, não escrito
  error           TEXT,                 -- mensagem de erro se push falhou
  FOREIGN KEY (sku) REFERENCES mappings(sku)
);
CREATE INDEX IF NOT EXISTS idx_changes_ts ON changes(ts DESC);
CREATE INDEX IF NOT EXISTS idx_changes_sku ON changes(sku);

-- =============================================================
-- conflicts: quando ambos lados mudaram entre 2 polls
-- =============================================================
CREATE TABLE IF NOT EXISTS conflicts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  sku             TEXT NOT NULL,
  meli_before     INTEGER,
  meli_after      INTEGER,
  shopee_before   INTEGER,
  shopee_after    INTEGER,
  resolved_to     INTEGER,              -- valor escolhido (default = min)
  resolution      TEXT NOT NULL,        -- 'auto_min' | 'manual'
  resolved_at     INTEGER,
  resolved_by     TEXT
);
CREATE INDEX IF NOT EXISTS idx_conflicts_unresolved ON conflicts(resolved_at);

-- =============================================================
-- unmapped: SKUs que existem só em um lado (alerta)
-- =============================================================
CREATE TABLE IF NOT EXISTS unmapped (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sku             TEXT NOT NULL,
  platform        TEXT NOT NULL,        -- 'meli' | 'shopee'
  item_id         TEXT NOT NULL,
  variation_id    TEXT,
  product_name    TEXT,
  first_seen_at   INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  resolved        INTEGER NOT NULL DEFAULT 0,  -- 1 = ignorado/mapeado
  UNIQUE(sku, platform, item_id, variation_id)
);

-- =============================================================
-- runs: log de cada execução do cron
-- =============================================================
CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  trigger         TEXT NOT NULL,        -- 'cron' | 'manual' | 'discover'
  items_polled    INTEGER DEFAULT 0,
  changes_detected INTEGER DEFAULT 0,
  changes_applied INTEGER DEFAULT 0,
  errors          INTEGER DEFAULT 0,
  shadow          INTEGER NOT NULL DEFAULT 0,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
