USE return_management_db;

-- Add new columns to return_manifests
ALTER TABLE return_manifests
  ADD COLUMN nomor_daftar VARCHAR(100) DEFAULT NULL,
  ADD COLUMN no_pesanan_wms VARCHAR(100) DEFAULT NULL,
  ADD COLUMN no_pesanan_oms VARCHAR(100) DEFAULT NULL,
  ADD COLUMN status VARCHAR(100) DEFAULT NULL,
  ADD COLUMN gudang VARCHAR(100) DEFAULT NULL,
  ADD COLUMN waktu_pesanan VARCHAR(100) DEFAULT NULL,
  ADD COLUMN batas_waktu_pengiriman VARCHAR(100) DEFAULT NULL,
  ADD COLUMN waktu_cetak VARCHAR(100) DEFAULT NULL,
  ADD COLUMN mata_uang VARCHAR(50) DEFAULT NULL;

-- Add new columns to return_manifest_items
ALTER TABLE return_manifest_items
  ADD COLUMN nomor VARCHAR(50) DEFAULT NULL,
  ADD COLUMN rak VARCHAR(100) DEFAULT NULL;
