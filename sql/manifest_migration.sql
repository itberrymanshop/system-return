-- Staging Tables for Return Manifests
USE return_management_db;

CREATE TABLE IF NOT EXISTS return_manifests (
    manifest_id INT AUTO_INCREMENT PRIMARY KEY,
    resi_number VARCHAR(100) NOT NULL,
    no_pesanan VARCHAR(100) NOT NULL,
    customer_name VARCHAR(100) DEFAULT NULL,
    customer_contact VARCHAR(50) DEFAULT NULL,
    source_type VARCHAR(50) DEFAULT NULL,
    return_category VARCHAR(50) DEFAULT NULL,
    return_reason TEXT DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    is_processed TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX idx_resi_pesanan (resi_number, no_pesanan),
    INDEX idx_resi_number (resi_number),
    INDEX idx_no_pesanan (no_pesanan),
    INDEX idx_is_processed (is_processed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS return_manifest_items (
    manifest_item_id INT AUTO_INCREMENT PRIMARY KEY,
    manifest_id INT NOT NULL,
    item_code VARCHAR(100) DEFAULT NULL,
    item_name VARCHAR(200) NOT NULL,
    item_description TEXT DEFAULT NULL,
    serial_number VARCHAR(100) DEFAULT NULL,
    batch_number VARCHAR(100) DEFAULT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (manifest_id) REFERENCES return_manifests(manifest_id) ON DELETE CASCADE,
    INDEX idx_manifest_id (manifest_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
