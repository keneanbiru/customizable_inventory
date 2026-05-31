-- Milestone 3: global settings and category overrides

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS category_settings (
  category_id UUID PRIMARY KEY REFERENCES categories (id) ON DELETE CASCADE,
  low_stock_threshold NUMERIC,
  expiry_warning_days INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
