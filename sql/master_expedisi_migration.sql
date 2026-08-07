-- ─── Master Expedisi ──────────────────────────────────────────────────────────
-- Run this migration to add the master_expedisi table.

CREATE TABLE IF NOT EXISTS master_expedisi (
  id             INT          NOT NULL AUTO_INCREMENT,
  kode_expedisi  VARCHAR(20)  NOT NULL,
  nama_expedisi  VARCHAR(255) NOT NULL,
  status         ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kode_expedisi (kode_expedisi)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Seed data (optional) ─────────────────────────────────────────────────────
INSERT IGNORE INTO master_expedisi (kode_expedisi, nama_expedisi) VALUES
  ('EXP-001', 'JNE Regular'),
  ('EXP-002', 'J&T Express'),
  ('EXP-003', 'SiCepat REG'),
  ('EXP-004', 'AnterAja'),
  ('EXP-005', 'Pos Indonesia');
