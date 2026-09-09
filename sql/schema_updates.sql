-- Schema updates for Node.js migration
-- Run these after importing the base schema.sql

USE return_management_db;

-- Add columns needed by Node.js app (may already exist: use IF NOT EXISTS via ALTER IGNORE or check first)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login DATETIME DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_change DATETIME DEFAULT NULL;

-- Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  log_id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT,
  action_type       VARCHAR(50)  NOT NULL,
  action_description TEXT,
  ip_address        VARCHAR(45),
  user_agent        TEXT,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_user_id    (user_id),
  INDEX idx_action_type (action_type),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add image_path per item (for photo upload on create/edit)
-- Note: IF NOT EXISTS requires MySQL 8.0.3+. On older versions use the two-step check below.
ALTER TABLE return_items ADD COLUMN image_path VARCHAR(500) DEFAULT NULL;

-- Add 'staff' role option if not present (original schema only has admin/manager/inspector/warehouse/viewer)
-- If ENUM modification fails on your MySQL version, run this separately:
-- ALTER TABLE users MODIFY COLUMN role ENUM('admin','manager','inspector','warehouse','staff','viewer') NOT NULL DEFAULT 'staff';

-- ─── Master Barang ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_barang (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  kode_barang   VARCHAR(100)    NOT NULL UNIQUE,
  nama_barang   VARCHAR(255)    NOT NULL,
  kategori      VARCHAR(100)    DEFAULT NULL,
  satuan        VARCHAR(50)     DEFAULT NULL,
  harga_beli    DECIMAL(15,2)   NOT NULL DEFAULT 0,
  harga_jual    DECIMAL(15,2)   NOT NULL DEFAULT 0,
  stok_minimum  INT             NOT NULL DEFAULT 0,
  deskripsi     TEXT            DEFAULT NULL,
  status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at    TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_kode_barang (kode_barang),
  INDEX idx_nama_barang (nama_barang),
  INDEX idx_kategori    (kategori),
  INDEX idx_status      (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add item_id to price_submissions for per-SKU pricing
ALTER TABLE price_submissions ADD COLUMN item_id INT DEFAULT NULL AFTER return_id;
ALTER TABLE price_submissions ADD FOREIGN KEY (item_id) REFERENCES return_items(item_id) ON DELETE CASCADE;
