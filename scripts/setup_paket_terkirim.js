'use strict';

const db = require('../config/database');

async function run() {
  try {
    console.log("Creating 'paket_terkirim' table...");
    await db.query(`
      CREATE TABLE IF NOT EXISTS paket_terkirim (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bulan INT NOT NULL,
        tahun INT NOT NULL,
        total_terkirim INT NOT NULL,
        is_show TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bulan_tahun_show (bulan, tahun, is_show)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("Table 'paket_terkirim' created successfully.");

    console.log("Adding permissions to 'role_permissions'...");
    // Roles to grant permission to
    const roles = ['admin', 'manager', 'admin_retur', 'admin_sorting', 'staff_recover', 'purchasing', 'sales'];
    for (const role of roles) {
      const allowed = ['admin', 'manager', 'admin_retur', 'admin_sorting', 'staff_recover', 'purchasing'].includes(role) ? 1 : 0;
      await db.query(`
        INSERT INTO role_permissions (role, menu_key, is_allowed)
        VALUES (?, 'paket_terkirim', ?)
        ON DUPLICATE KEY UPDATE is_allowed = VALUES(is_allowed)
      `, [role, allowed]);
    }
    console.log("Permissions seeded successfully.");
    console.log("DB Setup Completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Error setting up DB:", err);
    process.exit(1);
  }
}

run();
