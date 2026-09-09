'use strict';
const db = require('../config/database');

async function migrate() {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    console.log('Starting migration for source_type values...');

    // 1. Temporarily modify returns.source_type column to VARCHAR to allow changing existing values
    console.log('Temporarily converting source_type to VARCHAR(50)...');
    await conn.query('ALTER TABLE returns MODIFY COLUMN source_type VARCHAR(50) NOT NULL');

    // 2. Update existing data to the new values
    console.log('Migrating existing source_type values...');
    // 'internal_grosir' -> 'retur_penjualan_grosir'
    await conn.query(`
      UPDATE returns 
      SET source_type = 'retur_penjualan_grosir' 
      WHERE source_type = 'internal_grosir'
    `);

    // 'internal_mp' -> 'retur_internal_qc'
    await conn.query(`
      UPDATE returns 
      SET source_type = 'retur_internal_qc' 
      WHERE source_type = 'internal_mp'
    `);

    // 'external_expedisi' -> 'retur_penjualan_mp'
    await conn.query(`
      UPDATE returns 
      SET source_type = 'retur_penjualan_mp' 
      WHERE source_type = 'external_expedisi'
    `);

    // Guard: Ensure any unexpected/remaining values are defaulted to 'retur_penjualan_mp'
    await conn.query(`
      UPDATE returns 
      SET source_type = 'retur_penjualan_mp' 
      WHERE source_type NOT IN ('retur_penjualan_mp', 'retur_penjualan_grosir', 'retur_internal_qc')
    `);

    // 3. Convert returns.source_type column back to the new ENUM definition
    console.log('Converting source_type column to the new ENUM definition...');
    await conn.query(`
      ALTER TABLE returns 
      MODIFY COLUMN source_type ENUM('retur_penjualan_mp', 'retur_penjualan_grosir', 'retur_internal_qc') NOT NULL
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
