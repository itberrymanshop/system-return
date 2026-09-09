-- ============================================================
-- BA Notes Migration
-- Tabel catatan untuk setiap Berita Acara
-- ============================================================
USE return_management_db;

CREATE TABLE IF NOT EXISTS ba_notes (
  note_id    INT AUTO_INCREMENT PRIMARY KEY,
  ba_id      INT NOT NULL,
  user_id    INT NOT NULL,
  note_text  TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ba_id)   REFERENCES berita_acara(ba_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  INDEX idx_ba_id     (ba_id),
  INDEX idx_created   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'BA Notes migration completed.' AS status;
