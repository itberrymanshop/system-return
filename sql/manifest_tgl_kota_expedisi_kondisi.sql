USE return_management_db;

-- Add columns to temp_return_manifests
ALTER TABLE temp_return_manifests
  ADD COLUMN tgl DATE DEFAULT NULL,
  ADD COLUMN kota VARCHAR(100) DEFAULT NULL,
  ADD COLUMN expedisi VARCHAR(100) DEFAULT NULL;

-- Add columns to return_manifests
ALTER TABLE return_manifests
  ADD COLUMN tgl DATE DEFAULT NULL,
  ADD COLUMN kota VARCHAR(100) DEFAULT NULL,
  ADD COLUMN expedisi VARCHAR(100) DEFAULT NULL;

-- Add column to temp_return_manifest_items
ALTER TABLE temp_return_manifest_items
  ADD COLUMN kondisi VARCHAR(50) DEFAULT NULL;

-- Add column to return_manifest_items
ALTER TABLE return_manifest_items
  ADD COLUMN kondisi VARCHAR(50) DEFAULT NULL;
