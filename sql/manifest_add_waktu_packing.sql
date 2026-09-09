USE return_management_db;

-- Add waktu_packing column to return_manifests table
ALTER TABLE return_manifests
  ADD COLUMN waktu_packing VARCHAR(100) DEFAULT NULL;
