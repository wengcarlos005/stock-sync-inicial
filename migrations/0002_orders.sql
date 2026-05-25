-- v0.2: tabela de pedidos e configuração

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  platform     TEXT NOT NULL,         -- 'meli' | 'shopee'
  order_id     TEXT NOT NULL,         -- ML order_id ou Shopee order_sn
  status       TEXT,
  buyer        TEXT,
  created_at   INTEGER,               -- epoch ms da criação do pedido
  items_json   TEXT,                  -- JSON: [{name, sku, qty, item_id, variation_id}]
  processed_at INTEGER,               -- quando processamos (atualizamos estoque)
  UNIQUE(platform, order_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_platform ON orders(platform, created_at DESC);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
