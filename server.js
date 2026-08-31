'use strict';
require('dotenv').config();

const app         = require('./app');
const pool        = require('./config/database');
const rbacService = require('./services/rbacService');

const PORT = process.env.PORT || 3000;

async function runMigrations() {
  try {
    console.log('🔄 Checking database migrations...');
    
    // 1. Make berita_acara.return_id nullable
    const [baColumns] = await pool.query("SHOW COLUMNS FROM berita_acara LIKE 'return_id'");
    if (baColumns.length > 0 && baColumns[0].Null === 'NO') {
      console.log('   - Modifying berita_acara.return_id to be nullable...');
      await pool.query("ALTER TABLE berita_acara MODIFY COLUMN return_id INT DEFAULT NULL");
    }
    
    // 2. Add ba_id to inventory_stock
    const [stockColumns] = await pool.query("SHOW COLUMNS FROM inventory_stock LIKE 'ba_id'");
    if (stockColumns.length === 0) {
      console.log('   - Adding ba_id column to inventory_stock...');
      await pool.query("ALTER TABLE inventory_stock ADD COLUMN ba_id INT DEFAULT NULL");
      
      console.log('   - Adding foreign key constraint for ba_id to berita_acara...');
      try {
        await pool.query("ALTER TABLE inventory_stock ADD CONSTRAINT fk_inventory_stock_ba FOREIGN KEY (ba_id) REFERENCES berita_acara(ba_id) ON DELETE SET NULL");
      } catch (fkErr) {
        console.warn('   - Note: Could not add FK constraint:', fkErr.message);
      }
    }

    const [stockBaIndex] = await pool.query("SHOW INDEX FROM inventory_stock WHERE Key_name = 'idx_inventory_stock_ba_id'");
    if (stockBaIndex.length === 0) {
      console.log('   - Adding index idx_inventory_stock_ba_id on inventory_stock(ba_id)...');
      await pool.query("ALTER TABLE inventory_stock ADD INDEX idx_inventory_stock_ba_id (ba_id)");
    }

    const [stockBaCategoryIndex] = await pool.query("SHOW INDEX FROM inventory_stock WHERE Key_name = 'idx_inventory_stock_ba_category'");
    if (stockBaCategoryIndex.length === 0) {
      console.log('   - Adding composite index idx_inventory_stock_ba_category on inventory_stock(ba_id, category)...');
      await pool.query("ALTER TABLE inventory_stock ADD INDEX idx_inventory_stock_ba_category (ba_id, category)");
    }
    
    // 3. Modify berita_acara.ba_type to be VARCHAR(50)
    const [baTypeColumn] = await pool.query("SHOW COLUMNS FROM berita_acara LIKE 'ba_type'");
    if (baTypeColumn.length > 0 && baTypeColumn[0].Type.startsWith('enum')) {
      console.log('   - Modifying berita_acara.ba_type to be VARCHAR(50)...');
      await pool.query("ALTER TABLE berita_acara MODIFY COLUMN ba_type VARCHAR(50) NOT NULL");
    }

    const [baCreatedAtIndex] = await pool.query("SHOW INDEX FROM berita_acara WHERE Key_name = 'idx_created_at'");
    if (baCreatedAtIndex.length === 0) {
      console.log('   - Adding index idx_created_at on berita_acara(created_at)...');
      await pool.query("ALTER TABLE berita_acara ADD INDEX idx_created_at (created_at)");
    }

    const [baVendorIndex] = await pool.query("SHOW INDEX FROM berita_acara WHERE Key_name = 'idx_vendor_id'");
    if (baVendorIndex.length === 0) {
      console.log('   - Adding index idx_vendor_id on berita_acara(vendor_id)...');
      await pool.query("ALTER TABLE berita_acara ADD INDEX idx_vendor_id (vendor_id)");
    }

    // 4. Add ikut column to return_items
    const [ikutColumns] = await pool.query("SHOW COLUMNS FROM return_items LIKE 'ikut'");
    if (ikutColumns.length === 0) {
      console.log('   - Adding ikut column to return_items...');
      await pool.query("ALTER TABLE return_items ADD COLUMN ikut VARCHAR(50) DEFAULT NULL AFTER item_category");
    }

    // 5. Add ikut_wo column to return_items
    const [ikutWoColumns] = await pool.query("SHOW COLUMNS FROM return_items LIKE 'ikut_wo'");
    if (ikutWoColumns.length === 0) {
      console.log('   - Adding ikut_wo column to return_items...');
      await pool.query("ALTER TABLE return_items ADD COLUMN ikut_wo VARCHAR(50) DEFAULT NULL AFTER ikut");
    }
    
    console.log('✅ Migrations checked and applied successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  }
}

async function start() {
  try {
    // Verify database connection before starting
    const conn = await pool.getConnection();
    console.log('✅ Database connected successfully');
    conn.release();

    // Run database migrations
    await runMigrations();

    // Ensure RBAC table exists and is seeded with defaults
    await rbacService.seedDefaults();
    console.log('✅ RBAC permissions ready');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
