USE return_management_db;

-- Add new columns to return_manifests
ALTER TABLE return_manifests
  ADD COLUMN nama_toko VARCHAR(100) DEFAULT NULL,
  ADD COLUMN metode_pengiriman VARCHAR(100) DEFAULT NULL,
  ADD COLUMN jenis_pengiriman VARCHAR(100) DEFAULT NULL,
  ADD COLUMN penerima VARCHAR(100) DEFAULT NULL,
  ADD COLUMN alamat_pengiriman TEXT DEFAULT NULL,
  ADD COLUMN waktu_outbound VARCHAR(100) DEFAULT NULL,
  ADD COLUMN total_harga_pesanan DECIMAL(15, 2) DEFAULT 0.00,
  ADD COLUMN nama_pemilik VARCHAR(100) DEFAULT NULL,
  ADD COLUMN waktu_picking VARCHAR(100) DEFAULT NULL,
  ADD COLUMN admin_pengemasan VARCHAR(100) DEFAULT NULL;

-- Add new column to return_manifest_items
ALTER TABLE return_manifest_items
  ADD COLUMN varian_product VARCHAR(100) DEFAULT NULL;
