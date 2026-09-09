-- =============================================================================
-- SQL SCRIPT: HAPUS SEMUA DATA TRANSAKSI RETUR (RESET STATE UNTUK TESTING)
-- =============================================================================
-- Script ini akan menghapus semua data transaksi terkait retur, berita acara,
-- pengajuan harga ke FAT, stok inventori hasil retur, log aktivitas, dan tracking SLA.
-- Master data (seperti users, vendors, master_barang, master_expedisi, dan sla_configs)
-- TETAP DIPERTAHANKAN agar sistem tetap dapat berjalan normal.
-- =============================================================================

-- 1. Matikan sementara pengecekan foreign key
SET FOREIGN_KEY_CHECKS = 0;

-- 2. Kosongkan semua tabel transaksi retur & inventory terkait
TRUNCATE TABLE returns;
TRUNCATE TABLE return_items;
TRUNCATE TABLE return_status_history;
TRUNCATE TABLE return_comments;
TRUNCATE TABLE return_attachments;
TRUNCATE TABLE return_manifests;
TRUNCATE TABLE return_manifest_items;
TRUNCATE TABLE price_submissions;
TRUNCATE TABLE berita_acara;
TRUNCATE TABLE inventory_stock;
TRUNCATE TABLE sla_tracking;
TRUNCATE TABLE activity_logs;

-- 3. Nyalakan kembali pengecekan foreign key
SET FOREIGN_KEY_CHECKS = 1;

-- Log hasil
SELECT '✅ Database transactional tables successfully reset!' AS status;
