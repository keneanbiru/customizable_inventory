DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_txn_type') THEN
    CREATE TYPE inventory_txn_type AS ENUM ('in', 'out', 'adjustment');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  cost_price NUMERIC(14, 2),
  selling_price NUMERIC(14, 2),
  quantity_on_hand NUMERIC(14, 3) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(14, 3),
  expiry_warning_days INTEGER,
  low_stock_threshold NUMERIC(14, 3),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT products_sku_not_blank CHECK (btrim(sku) <> ''),
  CONSTRAINT products_cost_non_negative CHECK (cost_price IS NULL OR cost_price >= 0),
  CONSTRAINT products_selling_non_negative CHECK (selling_price IS NULL OR selling_price >= 0),
  CONSTRAINT products_quantity_non_negative CHECK (quantity_on_hand >= 0),
  CONSTRAINT products_reorder_non_negative CHECK (reorder_level IS NULL OR reorder_level >= 0),
  CONSTRAINT products_expiry_non_negative CHECK (expiry_warning_days IS NULL OR expiry_warning_days >= 0),
  CONSTRAINT products_low_stock_non_negative CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0)
);

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_warehouse_id ON products(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  transaction_type inventory_txn_type NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_txn_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product_id
  ON inventory_transactions(product_id, created_at DESC);
