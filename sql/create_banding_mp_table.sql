-- Create banding_mp table
CREATE TABLE IF NOT EXISTS banding_mp (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tgl DATE NOT NULL,
  kode_toko VARCHAR(100) NOT NULL,
  no_invoice VARCHAR(100) NOT NULL,
  keterangan VARCHAR(255) NOT NULL,
  status_banding VARCHAR(100) NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tgl (tgl),
  INDEX idx_kode_toko (kode_toko),
  INDEX idx_no_invoice (no_invoice),
  INDEX idx_status_banding (status_banding)
);
