USE return_management_db;

ALTER TABLE return_manifest_items 
  ADD COLUMN is_checked TINYINT DEFAULT 0,
  ADD COLUMN checked_by VARCHAR(100) DEFAULT NULL,
  ADD COLUMN checked_at DATETIME DEFAULT NULL;
