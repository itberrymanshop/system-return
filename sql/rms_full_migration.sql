-- ============================================================
-- RMS Full Workflow Migration
-- Run AFTER schema.sql + schema_updates.sql + workflow_update.sql
-- ============================================================
USE return_management_db;

-- ─── 1. Extend return_items ───────────────────────────────────────────────────
ALTER TABLE return_items
  MODIFY COLUMN disposition ENUM(
    'rekondisi','refurbish','write_off',
    'return_to_supplier','back_to_grosir',
    'restock','repair','scrap','pending'
  ) DEFAULT 'pending';

-- Add columns to return_items only if they don't exist
DROP PROCEDURE IF EXISTS rms_add_column_safe;
DELIMITER //
CREATE PROCEDURE rms_add_column_safe()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='return_items' AND COLUMN_NAME='sku') THEN
    ALTER TABLE return_items ADD COLUMN sku VARCHAR(100) DEFAULT NULL AFTER item_code;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='return_items' AND COLUMN_NAME='physical_location') THEN
    ALTER TABLE return_items ADD COLUMN physical_location VARCHAR(100) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='return_items' AND COLUMN_NAME='sticker_tag') THEN
    ALTER TABLE return_items ADD COLUMN sticker_tag VARCHAR(50) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='return_items' AND COLUMN_NAME='qc_status') THEN
    ALTER TABLE return_items ADD COLUMN qc_status ENUM('belum_cek','lulus','tidak_lulus') DEFAULT 'belum_cek';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='return_items' AND COLUMN_NAME='recovery_sale_price') THEN
    ALTER TABLE return_items ADD COLUMN recovery_sale_price DECIMAL(15,2) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='return_items' AND COLUMN_NAME='recovery_sold_at') THEN
    ALTER TABLE return_items ADD COLUMN recovery_sold_at DATETIME DEFAULT NULL;
  END IF;
  -- returns table
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns' AND COLUMN_NAME='resi_number') THEN
    ALTER TABLE returns ADD COLUMN resi_number VARCHAR(100) DEFAULT NULL AFTER return_number;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns' AND COLUMN_NAME='resi_courier') THEN
    ALTER TABLE returns ADD COLUMN resi_courier VARCHAR(100) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns' AND COLUMN_NAME='inbound_date') THEN
    ALTER TABLE returns ADD COLUMN inbound_date DATETIME DEFAULT NULL AFTER return_date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns' AND COLUMN_NAME='sorting_started_at') THEN
    ALTER TABLE returns ADD COLUMN sorting_started_at DATETIME DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns' AND COLUMN_NAME='categorized_at') THEN
    ALTER TABLE returns ADD COLUMN categorized_at DATETIME DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns' AND COLUMN_NAME='recovery_sale_price') THEN
    ALTER TABLE returns ADD COLUMN recovery_sale_price DECIMAL(15,2) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns' AND COLUMN_NAME='vendor_id') THEN
    ALTER TABLE returns ADD COLUMN vendor_id INT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns' AND COLUMN_NAME='ba_id') THEN
    ALTER TABLE returns ADD COLUMN ba_id INT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns' AND COLUMN_NAME='closing_notes') THEN
    ALTER TABLE returns ADD COLUMN closing_notes TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns' AND COLUMN_NAME='closed_at') THEN
    ALTER TABLE returns ADD COLUMN closed_at DATETIME DEFAULT NULL;
  END IF;
END //
DELIMITER ;
CALL rms_add_column_safe();
DROP PROCEDURE IF EXISTS rms_add_column_safe;

-- ─── 3. SLA Configurations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sla_configs (
  sla_id      INT AUTO_INCREMENT PRIMARY KEY,
  stage       VARCHAR(50) NOT NULL,
  priority    VARCHAR(20) NOT NULL DEFAULT 'medium',
  sla_days    INT         NOT NULL DEFAULT 7,
  description VARCHAR(200),
  is_active   TINYINT(1) DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_stage_priority (stage, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO sla_configs (stage, priority, sla_days, description) VALUES
  ('Inbound',   'low',    5,  'Inbound low priority – 5 hari'),
  ('Inbound',   'medium', 3,  'Inbound medium priority – 3 hari'),
  ('Inbound',   'high',   2,  'Inbound high priority – 2 hari'),
  ('Inbound',   'urgent', 1,  'Inbound urgent – 1 hari'),
  ('Sorting',   'low',    7,  'Sorting low priority – 7 hari'),
  ('Sorting',   'medium', 5,  'Sorting medium priority – 5 hari'),
  ('Sorting',   'high',   3,  'Sorting high priority – 3 hari'),
  ('Sorting',   'urgent', 2,  'Sorting urgent – 2 hari'),
  ('Rekondisi', 'low',    14, 'Rekondisi low – 14 hari'),
  ('Rekondisi', 'medium', 10, 'Rekondisi medium – 10 hari'),
  ('Rekondisi', 'high',   7,  'Rekondisi high – 7 hari'),
  ('Rekondisi', 'urgent', 5,  'Rekondisi urgent – 5 hari'),
  ('Refurbish', 'low',    21, 'Refurbish low – 21 hari'),
  ('Refurbish', 'medium', 14, 'Refurbish medium – 14 hari'),
  ('Refurbish', 'high',   10, 'Refurbish high – 10 hari'),
  ('Refurbish', 'urgent', 7,  'Refurbish urgent – 7 hari'),
  ('Write_Off', 'low',    30, 'Write-Off low – 30 hari'),
  ('Write_Off', 'medium', 21, 'Write-Off medium – 21 hari'),
  ('Write_Off', 'high',   14, 'Write-Off high – 14 hari'),
  ('Write_Off', 'urgent', 10, 'Write-Off urgent – 10 hari'),
  ('Pricing',   'low',    5,  'Pricing low – 5 hari'),
  ('Pricing',   'medium', 3,  'Pricing medium – 3 hari'),
  ('Pricing',   'high',   2,  'Pricing high – 2 hari'),
  ('Pricing',   'urgent', 1,  'Pricing urgent – 1 hari');

-- ─── 4. Vendors ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  vendor_id      INT AUTO_INCREMENT PRIMARY KEY,
  vendor_name    VARCHAR(150) NOT NULL,
  vendor_type    ENUM('refurbish','write_off','rekondisi','general') DEFAULT 'general',
  contact_person VARCHAR(100),
  phone          VARCHAR(50),
  email          VARCHAR(100),
  address        TEXT,
  is_active      TINYINT(1) DEFAULT 1,
  created_by     INT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  INDEX idx_vendor_type (vendor_type),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 5. Price Submissions (Staff Recover → FAT/Purchasing) ────────────────────
CREATE TABLE IF NOT EXISTS price_submissions (
  submission_id   INT AUTO_INCREMENT PRIMARY KEY,
  return_id       INT NOT NULL,
  submitted_by    INT NOT NULL,
  submission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  product_category ENUM('rekondisi','refurbish','write_off') NOT NULL,
  proposed_price  DECIMAL(15,2) NOT NULL,
  notes           TEXT,
  status          ENUM('pending','approved','rejected') DEFAULT 'pending',
  reviewed_by     INT DEFAULT NULL,
  review_date     DATETIME DEFAULT NULL,
  review_notes    TEXT,
  final_price     DECIMAL(15,2) DEFAULT NULL,
  FOREIGN KEY (return_id)    REFERENCES returns(return_id) ON DELETE CASCADE,
  FOREIGN KEY (submitted_by) REFERENCES users(user_id),
  FOREIGN KEY (reviewed_by)  REFERENCES users(user_id),
  INDEX idx_return_id  (return_id),
  INDEX idx_status     (status),
  INDEX idx_submitted  (submitted_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 6. Berita Acara (BA) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS berita_acara (
  ba_id         INT AUTO_INCREMENT PRIMARY KEY,
  ba_number     VARCHAR(60) UNIQUE NOT NULL,
  return_id     INT NOT NULL,
  ba_type       ENUM('rekondisi','refurbish','write_off','retur_supplier') NOT NULL,
  created_by    INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  title         VARCHAR(200),
  content       TEXT,
  final_price   DECIMAL(15,2) DEFAULT NULL,
  vendor_id     INT DEFAULT NULL,
  status        ENUM('draft','pending_sign','signed','void') DEFAULT 'draft',
  -- Signatures (stored as base64 canvas data)
  sig_staff_recover    MEDIUMTEXT DEFAULT NULL,
  sig_staff_recover_by INT        DEFAULT NULL,
  sig_staff_recover_at DATETIME   DEFAULT NULL,
  sig_fat              MEDIUMTEXT DEFAULT NULL,
  sig_fat_by           INT        DEFAULT NULL,
  sig_fat_at           DATETIME   DEFAULT NULL,
  sig_admin            MEDIUMTEXT DEFAULT NULL,
  sig_admin_by         INT        DEFAULT NULL,
  sig_admin_at         DATETIME   DEFAULT NULL,
  FOREIGN KEY (return_id)           REFERENCES returns(return_id),
  FOREIGN KEY (created_by)          REFERENCES users(user_id),
  FOREIGN KEY (vendor_id)           REFERENCES vendors(vendor_id),
  FOREIGN KEY (sig_staff_recover_by) REFERENCES users(user_id),
  FOREIGN KEY (sig_fat_by)          REFERENCES users(user_id),
  FOREIGN KEY (sig_admin_by)        REFERENCES users(user_id),
  INDEX idx_return_id (return_id),
  INDEX idx_status    (status),
  INDEX idx_ba_type   (ba_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 7. Inventory Stock (separate bins per category) ──────────────────────────
CREATE TABLE IF NOT EXISTS inventory_stock (
  stock_id   INT AUTO_INCREMENT PRIMARY KEY,
  return_id  INT NOT NULL,
  item_id    INT NOT NULL,
  category   ENUM('rekondisi','refurbish','write_off','stok_utama','return_to_supplier') NOT NULL,
  location   VARCHAR(100),
  status     ENUM('tersedia','terjual','diproses','void') DEFAULT 'tersedia',
  entry_date DATE NOT NULL,
  sale_date  DATE DEFAULT NULL,
  sale_price DECIMAL(15,2) DEFAULT NULL,
  vendor_id  INT DEFAULT NULL,
  notes      TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (return_id) REFERENCES returns(return_id),
  FOREIGN KEY (item_id)   REFERENCES return_items(item_id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(vendor_id),
  INDEX idx_category   (category),
  INDEX idx_status     (status),
  INDEX idx_entry_date (entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 8. FK: returns.vendor_id → vendors ──────────────────────────────────────
-- (only safe after vendors table exists)
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'returns'
    AND CONSTRAINT_NAME = 'fk_returns_vendor'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE returns ADD CONSTRAINT fk_returns_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(vendor_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 9. FK: returns.ba_id → berita_acara ─────────────────────────────────────
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'returns'
    AND CONSTRAINT_NAME = 'fk_returns_ba'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE returns ADD CONSTRAINT fk_returns_ba FOREIGN KEY (ba_id) REFERENCES berita_acara(ba_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'RMS Full Migration completed.' AS status;
