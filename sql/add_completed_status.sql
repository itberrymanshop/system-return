-- Add 'completed' status to inventory_stock table
-- Purpose: Track items that have been linked to a Berita Acara (BA)

ALTER TABLE inventory_stock
MODIFY status ENUM('tersedia','terjual','diproses','void','completed') DEFAULT 'tersedia';
