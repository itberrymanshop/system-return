'use strict';
const db = require('../config/database');

/**
 * Summary counts + values grouped by category × status.
 */
async function getInventorySummary() {
  const [rows] = await db.query(`
    SELECT
      s.category,
      s.status,
      COUNT(*)                            AS count,
      SUM(COALESCE(s.sale_price, ri.unit_price * ri.quantity, 0)) AS total_value
    FROM inventory_stock s
    JOIN return_items ri ON s.item_id = ri.item_id
    GROUP BY s.category, s.status
    ORDER BY s.category, s.status
  `);
  return rows;
}

/**
 * List stock entries for a specific category with item / return details.
 */
async function getInventoryByCategory(category) {
  const orderBy = ['rekondisi', 'refurbish', 'write_off', 'return_to_supplier'].includes(category)
    ? 's.entry_date DESC, s.stock_id DESC'
    : 's.stock_id DESC';

  const hideSelectedBA = ['rekondisi', 'refurbish', 'write_off', 'return_to_supplier'].includes(category);
  const requirePerbaikanDone = ['rekondisi', 'refurbish', 'write_off'].includes(category);

  const [rows] = await db.query(`
    SELECT
      s.*,
      ri.item_name, ri.item_code, ri.sku, ri.serial_number,
      ri.sticker_tag, ri.unit_price, ri.quantity, ri.return_category,
      ri.ikut, ri.ikut_wo, ri.item_category,
      ri.created_at AS item_created_at,
      r.return_number, r.return_date, r.customer_name, r.resi_number, r.sla_deadline,
      v.vendor_name
    FROM inventory_stock s
    JOIN return_items ri ON s.item_id  = ri.item_id
    JOIN returns      r  ON s.return_id = r.return_id
    LEFT JOIN vendors v  ON s.vendor_id = v.vendor_id
    WHERE s.category = ?
      ${hideSelectedBA ? "AND s.status != 'completed'" : ''}
      ${requirePerbaikanDone ? "AND (ri.perbaikan_status IS NULL OR ri.perbaikan_status != 'pending')" : ''}
    ORDER BY ${orderBy}
  `, [category]);
  return rows;
}

/**
 * Add one or more inventory entries (called after sorting categorises items).
 */
async function addInventoryEntry(data) {
  const [result] = await db.query(
    `INSERT INTO inventory_stock
       (return_id, item_id, category, location, status, entry_date, vendor_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.return_id,
      data.item_id,
      data.category,
      data.location || null,
      data.status || 'tersedia',
      data.entry_date || new Date().toISOString().slice(0, 10),
      data.vendor_id || null,
      data.notes || null
    ]
  );
  return result.insertId;
}

/**
 * Record a sale against a stock entry and mark it as terjual.
 */
async function recordStockSale(stockId, salePrice, saleDate, vendorId) {
  await db.query(
    `UPDATE inventory_stock
        SET status = 'terjual', sale_price = ?, sale_date = ?, vendor_id = ?
      WHERE stock_id = ?`,
    [salePrice, saleDate || new Date().toISOString().slice(0, 10), vendorId || null, stockId]
  );
}

/**
 * Update physical location for a stock entry.
 */
async function updateLocation(stockId, location) {
  if (!stockId || isNaN(stockId)) throw new Error(`updateLocation: invalid stockId "${stockId}"`);
  await db.query('UPDATE inventory_stock SET location = ? WHERE stock_id = ?', [location, stockId]);
}

/**
 * Closing-event report: all sales in a date range.
 */
async function getSalesReport(dateFrom, dateTo) {
  const params = [];
  let sql = `
    SELECT s.*, ri.item_name, ri.item_code, ri.sku,
           r.return_number, r.resi_number, r.customer_name,
           v.vendor_name,
           s.sale_price, s.sale_date
    FROM inventory_stock s
    JOIN return_items ri ON s.item_id  = ri.item_id
    JOIN returns      r  ON s.return_id = r.return_id
    LEFT JOIN vendors v  ON s.vendor_id = v.vendor_id
    WHERE s.status = 'terjual'
  `;
  if (dateFrom) { sql += ' AND s.sale_date >= ?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND s.sale_date <= ?'; params.push(dateTo); }
  sql += ' ORDER BY s.sale_date DESC';
  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Change stock category (e.g. rekondisi -> refurbish / write_off).
 */
async function changeStockCategory(stockId, targetCategory, userId, ip, userAgent) {
  if (!['rekondisi', 'refurbish', 'write_off'].includes(targetCategory)) {
    throw new Error('Invalid target category');
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [[stock]] = await conn.query(
      'SELECT stock_id, return_id, item_id, category, status FROM inventory_stock WHERE stock_id = ?',
      [stockId]
    );

    if (!stock) {
      await conn.rollback();
      conn.release();
      return false;
    }

    const oldCategory = stock.category;
    if (oldCategory === targetCategory) {
      await conn.commit();
      conn.release();
      return true;
    }

    // Update inventory_stock
    await conn.query(
      'UPDATE inventory_stock SET category = ?, updated_at = NOW() WHERE stock_id = ?',
      [targetCategory, stockId]
    );

    // Update return_items
    const statusMap = {
      rekondisi: 'Rekondisi',
      refurbish: 'Refurbish',
      write_off: 'Write_Off'
    };
    const newStatus = statusMap[targetCategory] || 'Rekondisi';
    const qcStatus = targetCategory === 'write_off' ? 'tidak_lulus' : 'lulus';
    // For write_off perbaikan_status is null; for refurbish/rekondisi keep it completed/non-pending ('rekondisi') so it appears in inventory stock
    const perbaikanStatus = targetCategory === 'write_off' ? null : 'rekondisi';

    await conn.query(
      `UPDATE return_items
       SET disposition = ?,
           current_status = ?,
           qc_status = ?,
           perbaikan_status = ?,
           updated_at = NOW()
       WHERE item_id = ?`,
      [targetCategory, newStatus, qcStatus, perbaikanStatus, stock.item_id]
    );

    await conn.commit();
    conn.release();

    try {
      const reportService = require('./reportService');
      if (reportService && reportService.logActivity) {
        await reportService.logActivity(
          userId || 1,
          'change_stock_category',
          `Ubah kategori stok #${stockId} (Item #${stock.item_id}) dari ${oldCategory} ke ${targetCategory}`,
          ip,
          userAgent
        );
      }
    } catch (logErr) {
      console.error('Error logging change_stock_category activity:', logErr);
    }

    return true;
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
}

/**
 * Bulk change stock category.
 */
async function bulkChangeStockCategory(stockIds, targetCategory, userId, ip, userAgent) {
  if (!['rekondisi', 'refurbish', 'write_off'].includes(targetCategory)) {
    throw new Error('Invalid target category');
  }

  const ids = stockIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  if (ids.length === 0) return 0;

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [stocks] = await conn.query(
      'SELECT stock_id, return_id, item_id, category, status FROM inventory_stock WHERE stock_id IN (?)',
      [ids]
    );

    if (stocks.length === 0) {
      await conn.rollback();
      conn.release();
      return 0;
    }

    const itemIds = stocks.map(s => s.item_id);

    // Update inventory_stock
    await conn.query(
      'UPDATE inventory_stock SET category = ?, updated_at = NOW() WHERE stock_id IN (?)',
      [targetCategory, ids]
    );

    // Update return_items
    const statusMap = {
      rekondisi: 'Rekondisi',
      refurbish: 'Refurbish',
      write_off: 'Write_Off'
    };
    const newStatus = statusMap[targetCategory] || 'Rekondisi';
    const qcStatus = targetCategory === 'write_off' ? 'tidak_lulus' : 'lulus';
    // For write_off perbaikan_status is null; for refurbish/rekondisi keep it non-pending ('rekondisi') so it appears in inventory stock
    const perbaikanStatus = targetCategory === 'write_off' ? null : 'rekondisi';

    await conn.query(
      `UPDATE return_items
       SET disposition = ?,
           current_status = ?,
           qc_status = ?,
           perbaikan_status = ?,
           updated_at = NOW()
       WHERE item_id IN (?)`,
      [targetCategory, newStatus, qcStatus, perbaikanStatus, itemIds]
    );

    await conn.commit();
    conn.release();

    try {
      const reportService = require('./reportService');
      if (reportService && reportService.logActivity) {
        await reportService.logActivity(
          userId || 1,
          'bulk_change_stock_category',
          `Bulk ubah kategori ${ids.length} item stok ke ${targetCategory}`,
          ip,
          userAgent
        );
      }
    } catch (logErr) {
      console.error('Error logging bulk_change_stock_category activity:', logErr);
    }

    return ids.length;
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
}

module.exports = {
  getInventorySummary,
  getInventoryByCategory,
  addInventoryEntry,
  recordStockSale,
  updateLocation,
  getSalesReport,
  changeStockCategory,
  bulkChangeStockCategory
};
