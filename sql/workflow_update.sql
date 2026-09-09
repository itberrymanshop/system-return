-- Workflow Update Migration
-- Aligns schema with Return Workflow (bizup)
-- Run AFTER schema.sql and schema_updates.sql

USE return_management_db;

-- ─── 1. Update users.role ENUM ───────────────────────────────────────────────
ALTER TABLE users
  MODIFY COLUMN role ENUM(
    'admin',
    'manager',
    'admin_retur',
    'admin_sorting',
    'staff_recover',
    'purchasing',
    'inspector',
    'warehouse',
    'viewer'
  ) NOT NULL DEFAULT 'admin_retur';

-- ─── 2. Update returns.source_type ENUM ─────────────────────────────────────
ALTER TABLE returns
  MODIFY COLUMN source_type ENUM(
    'kurir_motor',
    'firstmile',
    'retur_grosir',
    'supplier_lokal',
    'customer',
    'supplier',
    'internal',
    'warehouse'
  ) NOT NULL;

-- ─── 3. Update return_items.disposition ENUM ─────────────────────────────────
ALTER TABLE return_items
  MODIFY COLUMN disposition ENUM(
    'rekondisi',
    'refurbish',
    'write_off',
    'return_to_supplier',
    'back_to_grosir',
    'restock',
    'repair',
    'scrap',
    'pending'
  ) DEFAULT 'pending';

-- ─── 4. Add workflow columns to returns ──────────────────────────────────────
-- Using individual ALTER statements compatible with MySQL 5.7+

SET @db = DATABASE();

-- product_category
SET @col = 'product_category';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'returns' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE returns ADD COLUMN product_category ENUM(''rekondisi'',''refurbish'',''write_off'') DEFAULT NULL AFTER current_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- admin_retur_id
SET @col = 'admin_retur_id';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'returns' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE returns ADD COLUMN admin_retur_id INT DEFAULT NULL AFTER approver_user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- staff_recover_id
SET @col = 'staff_recover_id';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'returns' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE returns ADD COLUMN staff_recover_id INT DEFAULT NULL AFTER admin_retur_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sla_days
SET @col = 'sla_days';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'returns' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE returns ADD COLUMN sla_days INT DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sla_deadline
SET @col = 'sla_deadline';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'returns' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE returns ADD COLUMN sla_deadline DATE DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- recovery_price
SET @col = 'recovery_price';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'returns' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE returns ADD COLUMN recovery_price DECIMAL(15,2) DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- vendor_name
SET @col = 'vendor_name';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'returns' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE returns ADD COLUMN vendor_name VARCHAR(150) DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sorting_date
SET @col = 'sorting_date';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'returns' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE returns ADD COLUMN sorting_date DATETIME DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categorized_date
SET @col = 'categorized_date';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'returns' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE returns ADD COLUMN categorized_date DATETIME DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 5. Add FKs for new assignment columns ───────────────────────────────────
ALTER TABLE returns
  ADD CONSTRAINT fk_admin_retur    FOREIGN KEY (admin_retur_id)   REFERENCES users(user_id),
  ADD CONSTRAINT fk_staff_recover  FOREIGN KEY (staff_recover_id) REFERENCES users(user_id);

-- ─── 6. Update approval matrix to use new roles ──────────────────────────────
UPDATE approval_matrix SET required_role = 'admin_sorting' WHERE required_role = 'inspector';
UPDATE approval_matrix SET required_role = 'purchasing'    WHERE required_role = 'manager' AND rule_name LIKE '%General%';

-- ─── 7. Seed new default users (password: password123 — change in production) ─
-- bcrypt hash of 'password123'
INSERT IGNORE INTO users (username, password, full_name, email, role, department) VALUES
('admin_retur1',   '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lkDK', 'Admin Retur',    'admin.retur@example.com',   'admin_retur',   'Retur'),
('admin_sorting1', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lkDK', 'Admin Sorting',  'admin.sorting@example.com', 'admin_sorting', 'Warehouse'),
('staff_recover1', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lkDK', 'Staff Recover',  'staff.recover@example.com', 'staff_recover', 'Recovery'),
('purchasing1',    '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lkDK', 'Purchasing',     'purchasing@example.com',    'purchasing',    'Purchasing');
