-- Migration: Add 3 PIC Check fields (SALES, FAT, OPS) to return_manifests & temp_return_manifests
USE return_management_db;

ALTER TABLE return_manifests 
  ADD COLUMN check_sales TINYINT DEFAULT 0,
  ADD COLUMN checked_sales_by VARCHAR(100) DEFAULT NULL,
  ADD COLUMN checked_sales_at DATETIME DEFAULT NULL,
  ADD COLUMN check_fat TINYINT DEFAULT 0,
  ADD COLUMN checked_fat_by VARCHAR(100) DEFAULT NULL,
  ADD COLUMN checked_fat_at DATETIME DEFAULT NULL,
  ADD COLUMN check_ops TINYINT DEFAULT 0,
  ADD COLUMN checked_ops_by VARCHAR(100) DEFAULT NULL,
  ADD COLUMN checked_ops_at DATETIME DEFAULT NULL;

ALTER TABLE temp_return_manifests 
  ADD COLUMN check_sales TINYINT DEFAULT 0,
  ADD COLUMN checked_sales_by VARCHAR(100) DEFAULT NULL,
  ADD COLUMN checked_sales_at DATETIME DEFAULT NULL,
  ADD COLUMN check_fat TINYINT DEFAULT 0,
  ADD COLUMN checked_fat_by VARCHAR(100) DEFAULT NULL,
  ADD COLUMN checked_fat_at DATETIME DEFAULT NULL,
  ADD COLUMN check_ops TINYINT DEFAULT 0,
  ADD COLUMN checked_ops_by VARCHAR(100) DEFAULT NULL,
  ADD COLUMN checked_ops_at DATETIME DEFAULT NULL;
