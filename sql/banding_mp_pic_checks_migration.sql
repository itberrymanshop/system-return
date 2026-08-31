-- Migration: Add PIC Checks (SALES & FAT) to banding_mp table
USE return_management_db;

ALTER TABLE banding_mp 
  ADD COLUMN check_sales TINYINT DEFAULT 0,
  ADD COLUMN checked_sales_by VARCHAR(100) DEFAULT NULL,
  ADD COLUMN checked_sales_at DATETIME DEFAULT NULL,
  ADD COLUMN check_fat TINYINT DEFAULT 0,
  ADD COLUMN checked_fat_by VARCHAR(100) DEFAULT NULL,
  ADD COLUMN checked_fat_at DATETIME DEFAULT NULL;
