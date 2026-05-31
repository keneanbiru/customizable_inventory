ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS capacity_skus INTEGER NOT NULL DEFAULT 15000;

ALTER TABLE warehouses
  ADD CONSTRAINT warehouses_capacity_skus_positive
  CHECK (capacity_skus > 0);
