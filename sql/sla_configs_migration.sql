-- SLA Configs Migration - Update to new structure
-- This migration restructures sla_configs to support the new SLA standard

-- 1. Backup old sla_configs
CREATE TABLE IF NOT EXISTS sla_configs_backup AS SELECT * FROM sla_configs;

-- 2. Drop old table
DROP TABLE IF EXISTS sla_configs;

-- 3. Create new sla_configs table with enhanced structure
CREATE TABLE IF NOT EXISTS sla_configs (
  sla_id              INT AUTO_INCREMENT PRIMARY KEY,
  sla_name            VARCHAR(200) NOT NULL COMMENT 'Nama SLA (e.g., SLA Dokumentasi, SLA Sorting)',
  code_name           VARCHAR(100) NOT NULL COMMENT 'Code Name (e.g., SLA Sorting, SLA Proses, SLA Recover)',
  code_trigger        VARCHAR(100) COMMENT 'Code Trigger untuk filter pertama',
  code_trigger_2      VARCHAR(100) COMMENT 'Code Trigger untuk filter kedua',
  sla_type            ENUM('STANDARD', 'MASA_TENGGANG') NOT NULL DEFAULT 'STANDARD' COMMENT 'Tipe SLA',
  sla_hours           INT NOT NULL DEFAULT 24 COMMENT 'Batas waktu dalam jam',
  sla_days            INT NOT NULL DEFAULT 1 COMMENT 'Batas waktu dalam hari (calculated)',
  description         VARCHAR(500),
  is_active           TINYINT(1) DEFAULT 1,
  priority            INT DEFAULT 0 COMMENT 'Urutan prioritas untuk sorting',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sla_config (code_name, code_trigger, code_trigger_2),
  INDEX idx_code_name (code_name),
  INDEX idx_sla_type (sla_type),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Insert new SLA STANDARD configs
INSERT IGNORE INTO sla_configs 
  (sla_name, code_name, code_trigger, code_trigger_2, sla_type, sla_hours, sla_days, priority, description) 
VALUES
  -- SLA STANDARD
  ('SLA Dokumentasi (tidak ada di system)', '[No Code]', '[No Code]', NULL, 'STANDARD', 24, 1, 1, 'SLA Dokumentasi - 24 Jam / 1 Hari'),
  ('SLA Sorting', 'SLA Sorting', '[No Code]', NULL, 'STANDARD', 48, 2, 2, 'SLA Sorting - 48 Jam / 2 Hari'),
  ('SLA Process - Rekondisi Non Elektronik', 'SLA Proses', 'Non Elektronik', 'Rekondisi', 'STANDARD', 96, 4, 3, 'SLA Proses Rekondisi Non Elektronik - 96 Jam / 4 Hari'),
  ('SLA Process - Rekondisi Elektronik', 'SLA Proses', 'Elektronik', 'Rekondisi', 'STANDARD', 168, 7, 4, 'SLA Proses Rekondisi Elektronik - 168 Jam / 7 Hari'),
  ('SLA Process - Refurbished Non Elektronik', 'SLA Proses', 'Non Elektronik', 'Refurbish', 'STANDARD', 96, 4, 5, 'SLA Proses Refurbished Non Elektronik - 96 Jam / 4 Hari'),
  ('SLA Process - Refurbished Elektronik', 'SLA Proses', 'Elektronik', 'Refurbish', 'STANDARD', 168, 7, 6, 'SLA Proses Refurbished Elektronik - 168 Jam / 7 Hari'),
  ('SLA Process - Write off', 'SLA Proses', '[No Code]', 'Write off', 'STANDARD', 24, 1, 7, 'SLA Proses Write off - 24 Jam / 1 Hari'),
  ('SLA Recover - Refurbished', 'SLA Recover', 'Column T [checked]', 'Refurbish', 'STANDARD', 96, 4, 8, 'SLA Recover Refurbished - 96 Jam / 4 Hari'),
  ('SLA Recover - Write off', 'SLA Recover', 'Column T [checked]', 'Write off', 'STANDARD', 72, 3, 9, 'SLA Recover Write off - 72 Jam / 3 Hari'),
  
  -- SLA MASA TENGGANG
  ('SLA Masa Tenggang Dokumentasi & Sorting', 'SLA Sorting', 'SLA Dokumentasi & Sorting [Passed]', NULL, 'MASA_TENGGANG', 24, 1, 1, 'SLA Masa Tenggang Dokumentasi & Sorting - 24 Jam / 1 Hari'),
  ('SLA Masa tenggang Process Non Elektronik & Elektronik', 'SLA Process', 'SLA Process [Passed]', NULL, 'MASA_TENGGANG', 168, 7, 2, 'SLA Masa tenggang Process - 168 Jam / 7 Hari'),
  ('SLA Masa tenggang Recover - Refurbished', 'SLA Recover', '[No Code]', 'Refurbish', 'MASA_TENGGANG', 336, 14, 3, 'SLA Masa tenggang Recover Refurbished - 336 Jam / 14 Hari');

-- 5. Create trigger to automatically calculate sla_days from sla_hours
DELIMITER //
DROP TRIGGER IF EXISTS trg_calculate_sla_days //
CREATE TRIGGER trg_calculate_sla_days
BEFORE INSERT ON sla_configs
FOR EACH ROW
BEGIN
  SET NEW.sla_days = CEIL(NEW.sla_hours / 24);
END//
DELIMITER ;

-- 6. Recalculate all sla_days from sla_hours
UPDATE sla_configs SET sla_days = CEIL(sla_hours / 24);

-- 7. Create SLA tracking table for monitoring SLA breaches
CREATE TABLE IF NOT EXISTS sla_tracking (
  tracking_id         INT AUTO_INCREMENT PRIMARY KEY,
  return_id           INT NOT NULL,
  sla_id              INT NOT NULL,
  stage               VARCHAR(100),
  started_at          DATETIME NOT NULL,
  expected_completion DATETIME NOT NULL,
  completed_at        DATETIME,
  is_breached         TINYINT(1) DEFAULT 0,
  breach_hours        INT,
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (return_id) REFERENCES returns(return_id) ON DELETE CASCADE,
  FOREIGN KEY (sla_id) REFERENCES sla_configs(sla_id),
  INDEX idx_return_id (return_id),
  INDEX idx_sla_id (sla_id),
  INDEX idx_is_breached (is_breached),
  INDEX idx_expected_completion (expected_completion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
