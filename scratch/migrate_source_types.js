'use strict';
const db = require('../config/database');

async function migrate() {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    console.log('Starting migration for source_type...');

    // 1. Temporarily modify to VARCHAR to allow updates
    console.log('Temporarily converting source_type to VARCHAR...');
    await conn.query('ALTER TABLE returns MODIFY COLUMN source_type VARCHAR(50) NOT NULL');

    // 2. Update existing data
    console.log('Migrating existing source_type values...');
    await conn.query(`
      UPDATE returns 
      SET source_type = 'external_expedisi' 
      WHERE source_type IN ('kurir_motor', 'firstmile', 'supplier_lokal', 'customer', 'supplier', '')
    `);
    await conn.query(`
      UPDATE returns 
      SET source_type = 'internal_grosir' 
      WHERE source_type IN ('retur_grosir')
    `);
    await conn.query(`
      UPDATE returns 
      SET source_type = 'internal_mp' 
      WHERE source_type IN ('internal', 'warehouse')
    `);

    // Ensure any unmatched values are defaulted
    await conn.query(`
      UPDATE returns 
      SET source_type = 'external_expedisi' 
      WHERE source_type NOT IN ('external_expedisi', 'internal_grosir', 'internal_mp')
    `);

    // 3. Alter column back to the new ENUM definition
    console.log('Converting source_type column to the new ENUM definition...');
    await conn.query(`
      ALTER TABLE returns 
      MODIFY COLUMN source_type ENUM('external_expedisi', 'internal_grosir', 'internal_mp') NOT NULL
    `);

    await conn.commit();
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    await conn.rollback();
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    conn.release();
  }
}

migrate();
