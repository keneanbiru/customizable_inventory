CREATE TABLE IF NOT EXISTS product_warehouse_stock (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  quantity_on_hand NUMERIC(14, 3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse_id),
  CONSTRAINT product_warehouse_stock_non_negative CHECK (quantity_on_hand >= 0)
);

CREATE INDEX IF NOT EXISTS idx_product_warehouse_stock_warehouse_id
  ON product_warehouse_stock(warehouse_id);

INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity_on_hand, updated_at)
SELECT p.id, p.warehouse_id, p.quantity_on_hand, now()
FROM products p
WHERE p.warehouse_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM product_warehouse_stock s
    WHERE s.product_id = p.id AND s.warehouse_id = p.warehouse_id
  );
