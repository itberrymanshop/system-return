'use strict';
const db = require('../config/database');
const slaService = require('./slaService');
const dateHelper = require('../utils/dateHelper');

/**
 * Generate a unique return number: RET + YYYYMMDD + 4-digit seq.
 */
async function generateReturnNumber() {
  const date = dateHelper.getJakartaDateString().replace(/-/g, '');
  const prefix = `RET${date}`;

  const [rows] = await db.query(
    'SELECT return_number FROM returns WHERE return_number LIKE ? ORDER BY return_id DESC LIMIT 1',
    [`${prefix}%`]
  );

  let seq = 1;
  if (rows.length > 0) {
    seq = parseInt(rows[0].return_number.slice(-4)) + 1;
  }
  return prefix + String(seq).padStart(4, '0');
}

/**
 * Get paginated returns list with optional filters.
 */
async function getReturns(filters = {}) {
  let sql = `
    SELECT ri.*,
           r.return_number,
           r.return_date,
           r.customer_name,
           r.resi_number,
           r.no_pesanan,
           r.current_status AS return_status,
           r.return_category AS parent_return_category
    FROM return_items ri
    JOIN returns r ON ri.return_id = r.return_id
    WHERE 1=1
  `;
  const params = [];

  if (filters.status) { sql += ' AND ri.current_status = ?'; params.push(filters.status); }
  if (filters.category) {
    sql += ' AND (ri.return_category = ? OR (ri.return_category IS NULL AND r.return_category = ?))';
    params.push(filters.category, filters.category);
  }
  if (filters.priority) { sql += ' AND r.priority = ?'; params.push(filters.priority); }
  if (filters.date_from) { sql += ' AND r.return_date >= ?'; params.push(filters.date_from); }
  if (filters.date_to) { sql += ' AND r.return_date <= ?'; params.push(filters.date_to); }
  if (filters.search) {
    sql += ' AND (r.return_number LIKE ? OR r.customer_name LIKE ? OR ri.item_code LIKE ? OR ri.item_name LIKE ?)';
    params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }

  sql += ' ORDER BY ri.item_id DESC';

  const [rows] = await db.query(sql, params);
  return rows;
}

async function getPendingReturns() {
  const [rows] = await db.query(`
    SELECT ri.*,
           r.return_number,
           r.return_date,
           r.customer_name,
           r.resi_number,
           r.no_pesanan,
           r.current_status AS return_status,
           r.return_category AS parent_return_category,
           u.full_name AS pic_name,
           DATEDIFF(NOW(), r.return_date) AS aging_days
    FROM return_items ri
    JOIN returns r ON ri.return_id = r.return_id
    LEFT JOIN users u ON r.pic_user_id = u.user_id
    WHERE ri.current_status = 'Inbound'
    ORDER BY ri.item_id DESC
  `);
  return rows;
}

/**
 * Get returns in inspection queue.
 */
async function getInspectionQueue() {
  const [returns] = await db.query(`
    SELECT r.*,
           u.full_name AS inspector_name,
           DATEDIFF(NOW(), r.return_date) AS aging_days
    FROM returns r
    LEFT JOIN users u ON r.inspector_user_id = u.user_id
    WHERE r.current_status IN ('Sorting','Rekondisi','Refurbish','Write_Off','Pricing','Recovery')
    ORDER BY r.return_date ASC
  `);

  const [items] = await db.query(`
    SELECT ri.*, r.return_number, r.return_date, r.priority, r.resi_number, r.no_pesanan
    FROM return_items ri
    JOIN returns r ON ri.return_id = r.return_id
    WHERE r.current_status IN ('Sorting','Rekondisi','Refurbish','Write_Off','Pricing','Recovery') AND ri.inspection_result = 'pending'
    ORDER BY r.return_date ASC
  `);

  return { returns, items };
}

/**
 * Get a single return with all related data.
 */
async function getReturnById(returnId) {
  const [rows] = await db.query(`
    SELECT r.*,
           u1.full_name AS pic_name,       u1.email AS pic_email,
           u2.full_name AS inspector_name,
           u3.full_name AS approver_name,
           u4.full_name AS created_by_name,
           u5.full_name AS admin_retur_name,
           u6.full_name AS staff_recover_name
    FROM returns r
    LEFT JOIN users u1 ON r.pic_user_id       = u1.user_id
    LEFT JOIN users u2 ON r.inspector_user_id  = u2.user_id
    LEFT JOIN users u3 ON r.approver_user_id   = u3.user_id
    LEFT JOIN users u4 ON r.created_by         = u4.user_id
    LEFT JOIN users u5 ON r.admin_retur_id     = u5.user_id
    LEFT JOIN users u6 ON r.staff_recover_id   = u6.user_id
    WHERE r.return_id = ?
  `, [returnId]);

  if (!rows.length) return null;

  const ret = rows[0];

  const [items] = await db.query(
    'SELECT * FROM return_items WHERE return_id = ? ORDER BY item_id',
    [returnId]
  );

  const [history] = await db.query(`
    SELECT h.*, u.full_name
    FROM return_status_history h
    LEFT JOIN users u ON h.changed_by = u.user_id
    WHERE h.return_id = ?
    ORDER BY h.changed_at DESC
  `, [returnId]);

  const [comments] = await db.query(`
    SELECT c.*, u.full_name
    FROM return_comments c
    LEFT JOIN users u ON c.user_id = u.user_id
    WHERE c.return_id = ?
    ORDER BY c.created_at DESC
  `, [returnId]);

  return { ...ret, items, history, comments };
}

/**
 * Create a new return with items (transactional).
 */
async function createReturn(data, items, userId) {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const returnNumber = await generateReturnNumber();

    let totalValue = 0;
    items.forEach(item => {
      totalValue += (parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0);
    });

    const [result] = await conn.query(`
      INSERT INTO returns
        (return_number, return_date, customer_name, customer_contact,
         source_type, return_reason, return_category, priority,
         current_status, total_items, total_value,
         pic_user_id, inspector_user_id, notes, created_by,
         resi_number, resi_courier, no_pesanan, inbound_date, completed_date, sla_days, sla_deadline)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      returnNumber,
      data.return_date,
      data.customer_name,
      data.customer_contact || null,
      data.source_type,
      data.return_reason || null,
      data.return_category,
      'medium',
      data.current_status || 'Pending',
      items.length,
      totalValue,
      data.pic_user_id || userId,
      data.inspector_user_id || null,
      data.notes || null,
      userId,
      data.resi_number || null,
      data.resi_courier || null,
      data.no_pesanan || null,
      data.inbound_date || null,
      data.completed_date || null,
      data.sla_days || null,
      data.sla_deadline || null
    ]);

    const returnId = result.insertId;

    for (const item of items) {
      const qty = parseFloat(item.quantity) || 1;
      const price = parseFloat(item.unit_price) || 0;
      const disposition = 'pending';
      const qcStatus = 'belum_cek';
      const inspectionResult = 'pending';
      const itemCurrentStatus = data.current_status || 'Pending';

      const [itemResult] = await conn.query(`
        INSERT INTO return_items
          (return_id, item_code, item_name, item_description,
           serial_number, batch_number, quantity, unit_price,
           total_price, condition_received, image_path, return_category,
           disposition, qc_status, inspection_result, current_status, inspected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        returnId,
        item.item_code || null,
        item.item_name,
        item.item_description || null,
        item.serial_number || null,
        item.batch_number || null,
        qty,
        price,
        qty * price,
        item.condition_received || 'good',
        item.image_path || null,
        item.return_category || null,
        disposition,
        qcStatus,
        inspectionResult,
        itemCurrentStatus,
        null
      ]);
    }

    await logStatusChange(conn, returnId, null, data.current_status || 'Pending',
      'Return created', '', userId);

    await conn.commit();
    conn.release();
    return { returnId, returnNumber };
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
}

/**
 * Update an existing return and its items.
 */
async function updateReturn(returnId, data, items, userId) {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    let totalValue = 0;
    items.forEach(item => {
      totalValue += (parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0);
    });

    await conn.query(`
      UPDATE returns SET
        return_date      = ?,
        customer_name    = ?,
        customer_contact = ?,
        source_type      = ?,
        return_reason    = ?,
        return_category  = ?,
        priority         = ?,
        total_items      = ?,
        total_value      = ?,
        notes            = ?,
        resi_number      = ?,
        resi_courier     = ?,
        no_pesanan       = ?,
        inbound_date     = COALESCE(inbound_date, ?),
        completed_date   = ?,
        inspector_user_id = COALESCE(inspector_user_id, ?),
        current_status   = COALESCE(?, current_status),
        updated_at       = NOW()
      WHERE return_id = ?
    `, [
      data.return_date,
      data.customer_name,
      data.customer_contact || null,
      data.source_type,
      data.return_reason || null,
      data.return_category,
      'medium',
      items.length,
      totalValue,
      data.notes || null,
      data.resi_number || null,
      data.resi_courier || null,
      data.no_pesanan || null,
      data.inbound_date || null,
      data.completed_date || null,
      data.inspector_user_id || null,
      data.current_status || null,
      returnId
    ]);

    // Delete inventory entries and replace items
    await conn.query('DELETE FROM inventory_stock WHERE return_id = ?', [returnId]);
    await conn.query('DELETE FROM return_items WHERE return_id = ?', [returnId]);
    for (const item of items) {
      const qty = parseFloat(item.quantity) || 1;
      const price = parseFloat(item.unit_price) || 0;
      const disposition = 'pending';
      const qcStatus = 'belum_cek';
      const inspectionResult = 'pending';
      const itemCurrentStatus = data.current_status || 'Pending';

      const [itemResult] = await conn.query(`
        INSERT INTO return_items
          (return_id, item_code, item_name, item_description,
           serial_number, batch_number, quantity, unit_price,
           total_price, condition_received, image_path, return_category,
           disposition, qc_status, inspection_result, current_status, inspected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        returnId,
        item.item_code || null,
        item.item_name,
        item.item_description || null,
        item.serial_number || null,
        item.batch_number || null,
        qty,
        price,
        qty * price,
        item.condition_received || 'good',
        item.image_path || null,
        item.return_category || null,
        disposition,
        qcStatus,
        inspectionResult,
        itemCurrentStatus,
        null
      ]);
    }

    await conn.commit();
    conn.release();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
}

/**
 * Update an existing return item (SKU) and recalculate parent return summary.
 */
async function updateReturnItem(returnId, itemId, data, item, userId) {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const qty = parseFloat(item.quantity) || 1;
    const price = parseFloat(item.unit_price) || 0;
    const disposition = 'pending';
    const qcStatus = 'belum_cek';
    const inspectionResult = 'pending';

    const itemCurrentStatus = data.current_status || 'Pending';

    // 1. Update return_items table for the specific itemId
    await conn.query(`
      UPDATE return_items SET
        item_code = ?,
        item_name = ?,
        quantity = ?,
        unit_price = ?,
        total_price = ?,
        image_path = ?,
        return_category = ?,
        disposition = ?,
        qc_status = ?,
        inspection_result = ?,
        current_status = ?,
        inspected_at = ?
      WHERE item_id = ? AND return_id = ?
    `, [
      item.item_code || null,
      item.item_name,
      qty,
      price,
      qty * price,
      item.image_path || null,
      item.return_category || null,
      disposition,
      qcStatus,
      inspectionResult,
      itemCurrentStatus,
      null,
      itemId,
      returnId
    ]);

    // 2. Manage inventory_stock for this item
    await conn.query('DELETE FROM inventory_stock WHERE item_id = ?', [itemId]);

    // 3. Recalculate returns summary fields
    const [allItems] = await conn.query(
      'SELECT return_category, quantity, unit_price FROM return_items WHERE return_id = ? ORDER BY item_id',
      [returnId]
    );

    let totalValue = 0;
    allItems.forEach(ri => {
      totalValue += (parseFloat(ri.quantity) || 1) * (parseFloat(ri.unit_price) || 0);
    });

    const returnCategory = allItems[0] ? allItems[0].return_category : null;
    const totalItems = allItems.length;

    // 4. Update returns table
    await conn.query(`
      UPDATE returns SET
        return_date      = ?,
        customer_name    = ?,
        customer_contact = ?,
        source_type      = ?,
        return_reason    = ?,
        return_category  = ?,
        priority         = ?,
        total_items      = ?,
        total_value      = ?,
        notes            = ?,
        resi_number      = ?,
        resi_courier     = ?,
        no_pesanan       = ?,
        inbound_date     = COALESCE(inbound_date, ?),
        completed_date   = ?,
        inspector_user_id = COALESCE(inspector_user_id, ?),
        current_status   = COALESCE(?, current_status),
        updated_at       = NOW()
      WHERE return_id = ?
    `, [
      data.return_date,
      data.customer_name,
      data.customer_contact || null,
      data.source_type,
      data.return_reason || null,
      returnCategory,
      'medium',
      totalItems,
      totalValue,
      data.notes || null,
      data.resi_number || null,
      data.resi_courier || null,
      data.no_pesanan || null,
      data.inbound_date || null,
      data.completed_date || null,
      data.inspector_user_id || null,
      data.current_status || null,
      returnId
    ]);

    await conn.commit();
    conn.release();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
}

/**
 * Append one or more items to an existing return and recalculate parent summary.
 */
async function addReturnItems(returnId, data, items) {
  if (!items || !items.length) return;

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    for (const item of items) {
      const qty = parseFloat(item.quantity) || 1;
      const price = parseFloat(item.unit_price) || 0;
      const disposition = 'pending';
      const qcStatus = 'belum_cek';
      const inspectionResult = 'pending';
      const itemCurrentStatus = data.current_status || 'Pending';

      const [itemResult] = await conn.query(`
        INSERT INTO return_items
          (return_id, item_code, item_name, item_description,
           serial_number, batch_number, quantity, unit_price,
           total_price, condition_received, image_path, return_category,
           disposition, qc_status, inspection_result, current_status, inspected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        returnId,
        item.item_code || null,
        item.item_name,
        item.item_description || null,
        item.serial_number || null,
        item.batch_number || null,
        qty,
        price,
        qty * price,
        item.condition_received || 'good',
        item.image_path || null,
        item.return_category || null,
        disposition,
        qcStatus,
        inspectionResult,
        itemCurrentStatus,
        null
      ]);
    }

    const [allItems] = await conn.query(
      'SELECT return_category, quantity, unit_price FROM return_items WHERE return_id = ? ORDER BY item_id',
      [returnId]
    );

    let totalValue = 0;
    allItems.forEach(ri => {
      totalValue += (parseFloat(ri.quantity) || 1) * (parseFloat(ri.unit_price) || 0);
    });

    const returnCategory = allItems[0] ? allItems[0].return_category : null;
    const totalItems = allItems.length;

    await conn.query(`
      UPDATE returns SET
        return_date      = ?,
        customer_name    = ?,
        customer_contact = ?,
        source_type      = ?,
        return_reason    = ?,
        return_category  = ?,
        priority         = ?,
        total_items      = ?,
        total_value      = ?,
        notes            = ?,
        resi_number      = ?,
        resi_courier     = ?,
        no_pesanan       = ?,
        inbound_date     = COALESCE(inbound_date, ?),
        completed_date   = ?,
        inspector_user_id = COALESCE(inspector_user_id, ?),
        current_status   = COALESCE(?, current_status),
        updated_at       = NOW()
      WHERE return_id = ?
    `, [
      data.return_date,
      data.customer_name,
      data.customer_contact || null,
      data.source_type,
      data.return_reason || null,
      returnCategory,
      'medium',
      totalItems,
      totalValue,
      data.notes || null,
      data.resi_number || null,
      data.resi_courier || null,
      data.no_pesanan || null,
      data.inbound_date || null,
      data.completed_date || null,
      data.inspector_user_id || null,
      data.current_status || null,
      returnId
    ]);

    await conn.commit();
    conn.release();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
}

/**
 * Delete a single inbound item row from pending inbound queue.
 * If it is the last item, the parent return is also deleted.
 */
async function deleteInboundItem(itemId) {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const [rows] = await conn.query(`
      SELECT ri.item_id, ri.return_id, ri.current_status, ri.disposition, ri.image_path,
             r.current_status AS return_status
      FROM return_items ri
      JOIN returns r ON r.return_id = ri.return_id
      WHERE ri.item_id = ?
      LIMIT 1
    `, [itemId]);

    if (!rows.length) {
      throw new Error('Item not found.');
    }

    const target = rows[0];
    const isInboundItem = target.current_status === 'Inbound' && target.return_status === 'Inbound';
    if (!isInboundItem || target.disposition === 'restock') {
      throw new Error('Only inbound items can be deleted from this page.');
    }

    await conn.query('DELETE FROM inventory_stock WHERE item_id = ?', [itemId]);
    await conn.query('DELETE FROM return_items WHERE item_id = ? AND return_id = ?', [itemId, target.return_id]);

    const [remaining] = await conn.query(
      'SELECT item_id, return_category, quantity, unit_price FROM return_items WHERE return_id = ? ORDER BY item_id',
      [target.return_id]
    );

    let returnDeleted = false;
    if (!remaining.length) {
      await conn.query('DELETE FROM returns WHERE return_id = ?', [target.return_id]);
      returnDeleted = true;
    } else {
      let totalValue = 0;
      remaining.forEach(ri => {
        totalValue += (parseFloat(ri.quantity) || 1) * (parseFloat(ri.unit_price) || 0);
      });

      const returnCategory = remaining[0] ? remaining[0].return_category : null;
      await conn.query(`
        UPDATE returns
        SET total_items = ?,
            total_value = ?,
            return_category = ?,
            updated_at = NOW()
        WHERE return_id = ?
      `, [remaining.length, totalValue, returnCategory, target.return_id]);
    }

    await conn.commit();
    conn.release();

    let deletedImagePaths = [];
    try { deletedImagePaths = JSON.parse(target.image_path || '[]'); }
    catch { deletedImagePaths = target.image_path ? [target.image_path] : []; }

    return {
      returnId: target.return_id,
      returnDeleted,
      deletedImagePaths
    };
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
}

/**
 * Update return status and log it.
 */
async function updateStatus(returnId, fromStatus, newStatus, reason, comments, userId) {
  await db.query(
    'UPDATE returns SET current_status = ?, updated_at = NOW() WHERE return_id = ?',
    [newStatus, returnId]
  );
  await logStatusChange(db, returnId, fromStatus, newStatus, reason, comments, userId);
}

/**
 * Add a comment to a return.
 */
async function addComment(returnId, userId, text, isInternal) {
  await db.query(
    `INSERT INTO return_comments (return_id, user_id, comment_text, is_internal)
     VALUES (?, ?, ?, ?)`,
    [returnId, userId, text, isInternal ? 1 : 0]
  );
}

/**
 * Update item inspection result.
 */
async function updateItemInspection(itemId, { inspectionResult, inspectionNotes, disposition }) {
  await db.query(
    `UPDATE return_items
     SET inspection_result = ?, inspection_notes = ?, disposition = ?, inspected_at = NOW()
     WHERE item_id = ?`,
    [inspectionResult, inspectionNotes || null, disposition || 'pending', itemId]
  );
}

/**
 * Internal helper: log a status change (accepts a connection or pool).
 */
async function logStatusChange(conn, returnId, fromStatus, toStatus, reason, comments, userId) {
  await conn.query(
    `INSERT INTO return_status_history
       (return_id, from_status, to_status, changed_by, change_reason, comments)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [returnId, fromStatus || null, toStatus, userId, reason || null, comments || null]
  );
}

async function getItemImagePaths(returnId) {
  const [rows] = await db.query(
    'SELECT image_path FROM return_items WHERE return_id = ? AND image_path IS NOT NULL',
    [returnId]
  );
  return rows.flatMap(r => {
    try { return JSON.parse(r.image_path); }
    catch { return r.image_path ? [r.image_path] : []; }
  });
}

/**
 * Set / refresh the SLA deadline on a return.
 */
async function setReturnSLA(returnId, slaDays, slaDeadline) {
  await db.query(
    'UPDATE returns SET sla_days = ?, sla_deadline = ? WHERE return_id = ?',
    [slaDays, slaDeadline, returnId]
  );
}

/**
 * Update inbound metadata on a return (resi, courier, inbound_date).
 */
async function confirmInbound(returnId, data, userId) {
  await db.query(
    `UPDATE returns
        SET resi_number  = COALESCE(?, resi_number),
            resi_courier = COALESCE(?, resi_courier),
            inbound_date = COALESCE(?, inbound_date, NOW()),
            inspector_user_id = COALESCE(?, inspector_user_id),
            updated_at   = NOW()
      WHERE return_id = ?`,
    [
      data.resi_number || null,
      data.resi_courier || null,
      data.inbound_date || null,
      data.inspector_user_id || null,
      returnId
    ]
  );
}

/**
 * Update an item's QC/sorting fields.
 */
async function updateItemQC(itemId, data) {
  const qcStatus = data.qc_status || (['write_off', 'return_to_supplier'].includes(data.disposition) ? 'tidak_lulus' : (['rekondisi', 'refurbish', 'restock'].includes(data.disposition) ? 'lulus' : 'belum_cek'));
  const perbaikanStatus = ['rekondisi', 'refurbish', 'write_off'].includes(data.disposition) ? 'pending' : null;
  const statusMap = {
    write_off: 'Write_Off',
    rekondisi: 'Rekondisi',
    refurbish: 'Refurbish',
    restock: 'Completed',
    return_to_supplier: 'Supplier Lokal',
    pending: 'Sorting'
  };
  const itemCurrentStatus = statusMap[data.disposition] || 'Sorting';

  await db.query(
    `UPDATE return_items
        SET sku               = COALESCE(?, sku),
            qc_status         = ?,
            sticker_tag       = ?,
            quantity          = COALESCE(?, quantity),
            physical_location = ?,
            disposition       = ?,
            inspection_notes  = COALESCE(?, inspection_notes),
            item_category     = COALESCE(?, item_category),
            vendor_id         = ?,
            perbaikan_status  = ?,
            current_status    = ?,
            inspected_at      = NOW()
      WHERE item_id = ?`,
    [
      data.sku || null,
      qcStatus,
      data.sticker_tag || null,
      data.quantity || null,
      data.physical_location || null,
      data.disposition || 'pending',
      data.inspection_notes || null,
      data.item_category || null,
      data.vendor_id || null,
      perbaikanStatus,
      itemCurrentStatus,
      itemId
    ]
  );

}

/**
 * Finalize sorting for a return: set product_category, update status,
 * and timestamp sorting completion.
 */
async function categorizeReturn(returnId, category, userId) {
  const statusMap = {
    rekondisi: 'Rekondisi',
    refurbish: 'Refurbish',
    write_off: 'Write_Off'
  };
  const prodCategory = ['rekondisi', 'refurbish', 'write_off'].includes(category) ? category : null;

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [[ret]] = await conn.query('SELECT current_status, ba_id, return_number FROM returns WHERE return_id = ?', [returnId]);
    const newStatus = statusMap[category] || ret.current_status;
    await conn.query(
      `UPDATE returns
          SET product_category  = ?,
              current_status    = ?,
              categorized_at    = NOW(),
              completed_date    = CASE WHEN ? = 'Completed' THEN NOW() ELSE completed_date END,
              closed_at         = CASE WHEN ? = 'Completed' THEN NOW() ELSE closed_at END,
              updated_at        = NOW()
        WHERE return_id = ?`,
      [prodCategory, newStatus, newStatus, newStatus, returnId]
    );

    await logStatusChange(conn, returnId, ret.current_status, newStatus,
      `Kategori ditetapkan: ${category}`, '', userId);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Get returns in recovery stages for Staff Recover.
 */
async function getRecoveryQueue(filters = {}) {
  let sql = `
    SELECT ri.item_id,
           ri.item_code AS sku,
           ri.item_name,
           ri.quantity,
           ri.disposition,
           ri.item_category,
           ri.inspected_at,
           r.return_id,
           r.return_number,
           r.customer_name,
           r.current_status AS return_status,
           COALESCE(
             CASE WHEN ri.current_status = 'Completed' THEN 'Completed' ELSE NULL END,
             CASE WHEN s.status = 'terjual' THEN 'Completed' ELSE NULL END,
             (
               SELECT 
                 CASE 
                   WHEN ps.status = 'pending' THEN 'Pricing'
                   WHEN ps.status = 'approved' THEN 'Recovery'
                   WHEN ps.status = 'rejected' THEN 
                     CASE 
                       WHEN ri.disposition = 'refurbish' THEN 'Refurbish'
                       WHEN ri.disposition = 'rekondisi' THEN 'Rekondisi'
                       ELSE 'Write_Off'
                     END
                 END
               FROM price_submissions ps
               WHERE ps.item_id = ri.item_id
               ORDER BY ps.submission_date DESC
               LIMIT 1
             ),
             CASE 
               WHEN ri.disposition = 'refurbish' THEN 'Refurbish'
               WHEN ri.disposition = 'rekondisi' THEN 'Rekondisi'
               ELSE 'Write_Off'
             END
           ) AS current_status,
           r.sla_deadline AS return_sla_deadline,
           r.return_date,
           r.inbound_date,
           r.resi_number,
           u1.full_name AS pic_name,
           u2.full_name AS staff_recover_name,
           DATEDIFF(NOW(), r.return_date) AS aging_days,
           s.stock_id,
           s.sale_price,
           ri.recovery_sale_price AS recovery_price,
           (SELECT review_date FROM price_submissions WHERE item_id = ri.item_id AND status = 'approved' ORDER BY review_date DESC LIMIT 1) AS approved_at
    FROM return_items ri
    JOIN returns r ON ri.return_id = r.return_id
    LEFT JOIN users u1 ON r.pic_user_id       = u1.user_id
    LEFT JOIN users u2 ON r.staff_recover_id   = u2.user_id
    LEFT JOIN inventory_stock s ON ri.item_id = s.item_id
    WHERE ri.disposition IN ('rekondisi', 'refurbish', 'write_off')
      AND (ri.perbaikan_status IS NULL OR ri.perbaikan_status != 'pending')
      AND (s.status IS NULL OR s.status = 'tersedia')
      AND (ri.current_status IS NULL OR ri.current_status != 'Completed')
  `;
  const params = [];
  if (filters.status) {
    sql += ` AND COALESCE(
             CASE WHEN s.status = 'terjual' THEN 'Completed' ELSE NULL END,
             (
               SELECT 
                 CASE 
                   WHEN ps.status = 'pending' THEN 'Pricing'
                   WHEN ps.status = 'approved' THEN 'Recovery'
                   WHEN ps.status = 'rejected' THEN 
                     CASE 
                       WHEN ri.disposition = 'refurbish' THEN 'Refurbish'
                       WHEN ri.disposition = 'rekondisi' THEN 'Rekondisi'
                       ELSE 'Write_Off'
                     END
                 END
               FROM price_submissions ps
               WHERE ps.item_id = ri.item_id
               ORDER BY ps.submission_date DESC
               LIMIT 1
             ),
             CASE 
               WHEN ri.disposition = 'refurbish' THEN 'Refurbish'
               WHEN ri.disposition = 'rekondisi' THEN 'Rekondisi'
               ELSE 'Write_Off'
             END
           ) = ?`;
    params.push(filters.status);
  }
  if (filters.category) { sql += ' AND ri.disposition = ?'; params.push(filters.category); }

  if (filters.type === 'refurbish') {
    sql += " AND ri.disposition IN ('rekondisi', 'refurbish')";
  } else if (filters.type === 'write_off') {
    sql += " AND ri.disposition = 'write_off'";
  }

  sql += ' ORDER BY r.return_date ASC';
  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Submit a price proposal from Staff Recover → FAT.
 * Also transitions return to 'Pricing' status.
 */
async function submitPricing(returnId, data, userId, itemId = null) {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [[ret]] = await conn.query('SELECT current_status, product_category FROM returns WHERE return_id = ?', [returnId]);

    await conn.query(
      `INSERT INTO price_submissions
         (return_id, item_id, submitted_by, product_category, proposed_price, notes, submission_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [returnId, itemId, userId, data.product_category || ret.product_category,
        data.proposed_price, data.notes || null, dateHelper.getJakartaDateTimeString()]
    );

    if (itemId) {
      await conn.query(
        "UPDATE return_items SET current_status = 'Pricing', updated_at = NOW() WHERE item_id = ?",
        [itemId]
      );
    } else {
      await conn.query(
        `UPDATE return_items 
         SET current_status = 'Pricing', updated_at = NOW() 
         WHERE return_id = ? 
           AND disposition IN ('rekondisi', 'refurbish', 'write_off')
           AND (perbaikan_status IS NULL OR perbaikan_status != 'pending')`,
        [returnId]
      );
    }

    let statusTransitioned = false;
    if (!itemId) {
      statusTransitioned = true;
    } else {
      // Check if all items in recovery phase for this return have been submitted to FAT
      const [items] = await conn.query(
        `SELECT ri.item_id,
                (SELECT status FROM price_submissions WHERE item_id = ri.item_id ORDER BY submission_date DESC LIMIT 1) AS latest_status
         FROM return_items ri
         WHERE ri.return_id = ?
           AND ri.disposition IN ('rekondisi', 'refurbish', 'write_off')
           AND (ri.perbaikan_status IS NULL OR ri.perbaikan_status != 'pending')`,
        [returnId]
      );
      const allSubmitted = items.every(it => it.latest_status === 'pending' || it.latest_status === 'approved');
      if (allSubmitted) {
        statusTransitioned = true;
      }
    }

    if (statusTransitioned && ret.current_status !== 'Pricing') {
      await conn.query(
        "UPDATE returns SET current_status = 'Pricing', updated_at = NOW() WHERE return_id = ?",
        [returnId]
      );
      await logStatusChange(conn, returnId, ret.current_status, 'Pricing',
        'Pengajuan harga dikirim ke FAT', '', userId);
    } else {
      statusTransitioned = false;
    }

    await conn.commit();
    return { statusTransitioned };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Approve or reject a price submission (FAT/Purchasing role).
 */
async function reviewPricing(submissionId, status, finalPrice, reviewNotes, userId) {
  await db.query(
    `UPDATE price_submissions
        SET status = ?, final_price = ?, review_notes = ?,
            reviewed_by = ?, review_date = NOW()
      WHERE submission_id = ?`,
    [status, finalPrice || null, reviewNotes || null, userId, submissionId]
  );

  let statusTransitioned = false;
  if (status === 'approved') {
    const [[sub]] = await db.query('SELECT return_id, item_id FROM price_submissions WHERE submission_id = ?', [submissionId]);
    if (sub) {
      // 1. Update return_items recovery_sale_price if item_id is provided
      if (sub.item_id) {
        await db.query(
          'UPDATE return_items SET recovery_sale_price = ?, current_status = "Recovery" WHERE item_id = ?',
          [finalPrice || null, sub.item_id]
        );
      } else {
        await db.query(
          `UPDATE return_items 
           SET recovery_sale_price = ?, current_status = "Recovery" 
           WHERE return_id = ? 
             AND disposition IN ('rekondisi', 'refurbish', 'write_off')
             AND (perbaikan_status IS NULL OR perbaikan_status != 'pending')`,
          [finalPrice || null, sub.return_id]
        );
      }
    }
  }

  if (status === 'rejected') {
    const [[sub]] = await db.query('SELECT return_id, item_id FROM price_submissions WHERE submission_id = ?', [submissionId]);
    if (sub) {
      if (sub.item_id) {
        await db.query(
          `UPDATE return_items 
           SET current_status = CASE 
             WHEN disposition = 'write_off' THEN 'Write_Off'
             WHEN disposition = 'rekondisi' THEN 'Rekondisi'
             WHEN disposition = 'refurbish' THEN 'Refurbish'
             ELSE 'Sorting'
           END 
           WHERE item_id = ?`,
          [sub.item_id]
        );
      } else {
        await db.query(
          `UPDATE return_items 
           SET current_status = CASE 
             WHEN disposition = 'write_off' THEN 'Write_Off'
             WHEN disposition = 'rekondisi' THEN 'Rekondisi'
             WHEN disposition = 'refurbish' THEN 'Refurbish'
             ELSE 'Sorting'
           END 
           WHERE return_id = ?
             AND disposition IN ('rekondisi', 'refurbish', 'write_off')
             AND (perbaikan_status IS NULL OR perbaikan_status != 'pending')`,
          [sub.return_id]
        );
      }
    }
  }

  if (status === 'approved') {
    const [[sub]] = await db.query('SELECT return_id, item_id FROM price_submissions WHERE submission_id = ?', [submissionId]);
    if (sub) {

      const conn = await db.getConnection();
      await conn.beginTransaction();
      try {
        const [[ret]] = await conn.query('SELECT current_status FROM returns WHERE return_id = ?', [sub.return_id]);

        if (!sub.item_id) {
          statusTransitioned = true;
        } else {
          // Check if all items in recovery phase for this return are approved
          const [items] = await conn.query(
            `SELECT ri.item_id,
                    (SELECT status FROM price_submissions WHERE item_id = ri.item_id ORDER BY submission_date DESC LIMIT 1) AS latest_status
             FROM return_items ri
             WHERE ri.return_id = ?
               AND ri.disposition IN ('rekondisi', 'refurbish', 'write_off')
               AND (ri.perbaikan_status IS NULL OR ri.perbaikan_status != 'pending')`,
            [sub.return_id]
          );
          const allApproved = items.every(it => it.latest_status === 'approved');
          if (allApproved) {
            statusTransitioned = true;
          }
        }

        if (statusTransitioned && ret.current_status !== 'Recovery') {
          await conn.query(
            "UPDATE returns SET current_status = 'Recovery', recovery_price = ?, updated_at = NOW() WHERE return_id = ?",
            [finalPrice || null, sub.return_id]
          );
          await logStatusChange(conn, sub.return_id, ret.current_status, 'Recovery',
            'Harga disetujui FAT – masuk tahap Recovery', reviewNotes || '', userId);
        } else {
          statusTransitioned = false;
        }

        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }
  }
  return { statusTransitioned };
}

/**
 * Get pending price submissions (for FAT/Purchasing review).
 */
async function getPendingPricingSubmissions(filters = {}) {
  let sql = `
    SELECT ps.*,
           r.return_number, r.resi_number, r.customer_name, r.product_category,
           r.current_status,
           ri.item_code, ri.item_name,
           u.full_name AS submitted_by_name
    FROM price_submissions ps
    JOIN returns r ON ps.return_id = r.return_id
    LEFT JOIN return_items ri ON ps.item_id = ri.item_id
    LEFT JOIN users u ON ps.submitted_by = u.user_id
    WHERE 1=1
  `;
  const params = [];
  if (filters.status) { sql += ' AND ps.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY ps.submission_date DESC';
  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Record recovery sales result for a return.
 */
async function recordRecoverySale(returnId, data, userId) {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [[ret]] = await conn.query('SELECT current_status FROM returns WHERE return_id = ?', [returnId]);
    await conn.query(
      `UPDATE returns
          SET recovery_sale_price = ?,
              vendor_id           = COALESCE(?, vendor_id),
              current_status      = 'Completed',
              completed_date      = NOW(),
              closed_at           = NOW(),
              closing_notes       = ?,
              updated_at          = NOW()
        WHERE return_id = ?`,
      [data.recovery_sale_price, data.vendor_id || null, data.closing_notes || null, returnId]
    );

    // Update return_items current_status to Completed and set recovery_sold_at
    await conn.query(
      `UPDATE return_items 
       SET current_status = 'Completed', recovery_sold_at = NOW() 
       WHERE return_id = ?`,
      [returnId]
    );

    await logStatusChange(conn, returnId, ret.current_status, 'Completed',
      'Penjualan recovery dicatat – kasus ditutup', data.closing_notes || '', userId);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Save return manifest to staging tables.
 */
async function saveManifest(manifestData, items) {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [existing] = await conn.query(
      'SELECT manifest_id FROM temp_return_manifests WHERE resi_number = ? AND no_pesanan = ?',
      [manifestData.resi_number, manifestData.no_pesanan]
    );

    let manifestId;
    if (existing.length > 0) {
      manifestId = existing[0].manifest_id;
      await conn.query('DELETE FROM temp_return_manifest_items WHERE manifest_id = ?', [manifestId]);
      await conn.query(
        `UPDATE temp_return_manifests SET 
          customer_name = ?, customer_contact = ?, source_type = ?, 
          return_category = ?, return_reason = ?, notes = ?, is_processed = 0,
          nama_toko = ?, metode_pengiriman = ?, jenis_pengiriman = ?,
          penerima = ?, alamat_pengiriman = ?, waktu_outbound = ?,
          total_harga_pesanan = ?, nama_pemilik = ?, waktu_picking = ?,
          admin_pengemasan = ?, waktu_packing = ?,
          nomor_daftar = ?, no_pesanan_wms = ?, no_pesanan_oms = ?,
          status = ?, gudang = ?, waktu_pesanan = ?,
          batas_waktu_pengiriman = ?, waktu_cetak = ?, mata_uang = ?
         WHERE manifest_id = ?`,
        [
          manifestData.customer_name || null,
          manifestData.customer_contact || null,
          manifestData.source_type || null,
          manifestData.return_category || null,
          manifestData.return_reason || null,
          manifestData.notes || null,
          manifestData.nama_toko || null,
          manifestData.metode_pengiriman || null,
          manifestData.jenis_pengiriman || null,
          manifestData.penerima || null,
          manifestData.alamat_pengiriman || null,
          manifestData.waktu_outbound || null,
          manifestData.total_harga_pesanan || 0.00,
          manifestData.nama_pemilik || null,
          manifestData.waktu_picking || null,
          manifestData.admin_pengemasan || null,
          manifestData.waktu_packing || null,
          manifestData.nomor_daftar || null,
          manifestData.no_pesanan_wms || null,
          manifestData.no_pesanan_oms || null,
          manifestData.status || null,
          manifestData.gudang || null,
          manifestData.waktu_pesanan || null,
          manifestData.batas_waktu_pengiriman || null,
          manifestData.waktu_cetak || null,
          manifestData.mata_uang || null,
          manifestId
        ]
      );
    } else {
      const [res] = await conn.query(
        `INSERT INTO temp_return_manifests 
          (resi_number, no_pesanan, customer_name, customer_contact, source_type, return_category, return_reason, notes, is_processed,
           nama_toko, metode_pengiriman, jenis_pengiriman, penerima, alamat_pengiriman, waktu_outbound, total_harga_pesanan, nama_pemilik, waktu_picking, admin_pengemasan, waktu_packing,
           nomor_daftar, no_pesanan_wms, no_pesanan_oms, status, gudang, waktu_pesanan, batas_waktu_pengiriman, waktu_cetak, mata_uang)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          manifestData.resi_number,
          manifestData.no_pesanan,
          manifestData.customer_name || null,
          manifestData.customer_contact || null,
          manifestData.source_type || null,
          manifestData.return_category || null,
          manifestData.return_reason || null,
          manifestData.notes || null,
          manifestData.nama_toko || null,
          manifestData.metode_pengiriman || null,
          manifestData.jenis_pengiriman || null,
          manifestData.penerima || null,
          manifestData.alamat_pengiriman || null,
          manifestData.waktu_outbound || null,
          manifestData.total_harga_pesanan || 0.00,
          manifestData.nama_pemilik || null,
          manifestData.waktu_picking || null,
          manifestData.admin_pengemasan || null,
          manifestData.waktu_packing || null,
          manifestData.nomor_daftar || null,
          manifestData.no_pesanan_wms || null,
          manifestData.no_pesanan_oms || null,
          manifestData.status || null,
          manifestData.gudang || null,
          manifestData.waktu_pesanan || null,
          manifestData.batas_waktu_pengiriman || null,
          manifestData.waktu_cetak || null,
          manifestData.mata_uang || null
        ]
      );
      manifestId = res.insertId;
    }

    for (const item of items) {
      await conn.query(
        `INSERT INTO temp_return_manifest_items 
          (manifest_id, item_code, item_name, item_description, serial_number, batch_number, quantity, unit_price, varian_product, nomor, rak)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          manifestId,
          item.item_code || null,
          item.item_name,
          item.item_description || null,
          item.serial_number || null,
          item.batch_number || null,
          parseInt(item.quantity) || 1,
          parseFloat(item.unit_price) || 0.00,
          item.varian_product || null,
          item.nomor || null,
          item.rak || null
        ]
      );
    }

    // Sync unique items to master_barang
    const masterBarangRows = [];
    const seenCodes = new Set();
    for (const item of items) {
      const code = (item.item_code || '').trim();
      const name = (item.item_name || '').trim();
      if (code && name && !seenCodes.has(code)) {
        seenCodes.add(code);
        masterBarangRows.push([code, name]);
      }
    }
    if (masterBarangRows.length > 0) {
      await conn.query(
        `INSERT INTO master_barang (kode_barang, nama_barang) VALUES ?
         ON DUPLICATE KEY UPDATE nama_barang = VALUES(nama_barang)`,
        [masterBarangRows]
      );
    }

    await conn.commit();
    return manifestId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Save return manifests to staging tables in batch.
 */
async function saveManifestsBatch(batch) {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    for (const manifestData of batch) {
      const [existing] = await conn.query(
        'SELECT manifest_id FROM temp_return_manifests WHERE resi_number = ? AND no_pesanan = ?',
        [manifestData.resi_number, manifestData.no_pesanan]
      );

      let manifestId;
      if (existing.length > 0) {
        manifestId = existing[0].manifest_id;
        await conn.query('DELETE FROM temp_return_manifest_items WHERE manifest_id = ?', [manifestId]);
        await conn.query(
          `UPDATE temp_return_manifests SET 
            customer_name = ?, customer_contact = ?, source_type = ?, 
            return_category = ?, return_reason = ?, notes = ?, is_processed = 0,
            nama_toko = ?, metode_pengiriman = ?, jenis_pengiriman = ?,
            penerima = ?, alamat_pengiriman = ?, waktu_outbound = ?,
            total_harga_pesanan = ?, nama_pemilik = ?, waktu_picking = ?,
            admin_pengemasan = ?, waktu_packing = ?,
            nomor_daftar = ?, no_pesanan_wms = ?, no_pesanan_oms = ?,
            status = ?, gudang = ?, waktu_pesanan = ?,
            batas_waktu_pengiriman = ?, waktu_cetak = ?, mata_uang = ?
           WHERE manifest_id = ?`,
          [
            manifestData.customer_name || null,
            manifestData.customer_contact || null,
            manifestData.source_type || null,
            manifestData.return_category || null,
            manifestData.return_reason || null,
            manifestData.notes || null,
            manifestData.nama_toko || null,
            manifestData.metode_pengiriman || null,
            manifestData.jenis_pengiriman || null,
            manifestData.penerima || null,
            manifestData.alamat_pengiriman || null,
            manifestData.waktu_outbound || null,
            manifestData.total_harga_pesanan || 0.00,
            manifestData.nama_pemilik || null,
            manifestData.waktu_picking || null,
            manifestData.admin_pengemasan || null,
            manifestData.waktu_packing || null,
            manifestData.nomor_daftar || null,
            manifestData.no_pesanan_wms || null,
            manifestData.no_pesanan_oms || null,
            manifestData.status || null,
            manifestData.gudang || null,
            manifestData.waktu_pesanan || null,
            manifestData.batas_waktu_pengiriman || null,
            manifestData.waktu_cetak || null,
            manifestData.mata_uang || null,
            manifestId
          ]
        );
      } else {
        const [res] = await conn.query(
          `INSERT INTO temp_return_manifests 
            (resi_number, no_pesanan, customer_name, customer_contact, source_type, return_category, return_reason, notes, is_processed,
             nama_toko, metode_pengiriman, jenis_pengiriman, penerima, alamat_pengiriman, waktu_outbound, total_harga_pesanan, nama_pemilik, waktu_picking, admin_pengemasan, waktu_packing,
             nomor_daftar, no_pesanan_wms, no_pesanan_oms, status, gudang, waktu_pesanan, batas_waktu_pengiriman, waktu_cetak, mata_uang)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            manifestData.resi_number,
            manifestData.no_pesanan,
            manifestData.customer_name || null,
            manifestData.customer_contact || null,
            manifestData.source_type || null,
            manifestData.return_category || null,
            manifestData.return_reason || null,
            manifestData.notes || null,
            manifestData.nama_toko || null,
            manifestData.metode_pengiriman || null,
            manifestData.jenis_pengiriman || null,
            manifestData.penerima || null,
            manifestData.alamat_pengiriman || null,
            manifestData.waktu_outbound || null,
            manifestData.total_harga_pesanan || 0.00,
            manifestData.nama_pemilik || null,
            manifestData.waktu_picking || null,
            manifestData.admin_pengemasan || null,
            manifestData.waktu_packing || null,
            manifestData.nomor_daftar || null,
            manifestData.no_pesanan_wms || null,
            manifestData.no_pesanan_oms || null,
            manifestData.status || null,
            manifestData.gudang || null,
            manifestData.waktu_pesanan || null,
            manifestData.batas_waktu_pengiriman || null,
            manifestData.waktu_cetak || null,
            manifestData.mata_uang || null
          ]
        );
        manifestId = res.insertId;
      }

      for (const item of manifestData.items) {
        await conn.query(
          `INSERT INTO temp_return_manifest_items 
            (manifest_id, item_code, item_name, item_description, serial_number, batch_number, quantity, unit_price, varian_product, nomor, rak)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            manifestId,
            item.item_code || null,
            item.item_name,
            item.item_description || null,
            item.serial_number || null,
            item.batch_number || null,
            parseInt(item.quantity) || 1,
            parseFloat(item.unit_price) || 0.00,
            item.varian_product || null,
            item.nomor || null,
            item.rak || null
          ]
        );
      }
    }

    // Sync unique items to master_barang across all batch items
    const masterBarangRows = [];
    const seenCodes = new Set();
    for (const manifestData of batch) {
      for (const item of manifestData.items) {
        const code = (item.item_code || '').trim();
        const name = (item.item_name || '').trim();
        if (code && name && !seenCodes.has(code)) {
          seenCodes.add(code);
          masterBarangRows.push([code, name]);
        }
      }
    }
    if (masterBarangRows.length > 0) {
      await conn.query(
        `INSERT INTO master_barang (kode_barang, nama_barang) VALUES ?
         ON DUPLICATE KEY UPDATE nama_barang = VALUES(nama_barang)`,
        [masterBarangRows]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}


/**
 * Get manifest by resi_number or no_pesanan.
 */
async function getManifestByQuery(queryStr) {
  const q = queryStr.trim();
  
  // First, check if it is already in return_manifests
  const [existing] = await db.query(
    'SELECT * FROM return_manifests WHERE resi_number = ? OR no_pesanan = ? ORDER BY is_processed ASC, manifest_id DESC LIMIT 1',
    [q, q]
  );
  
  if (existing.length > 0) {
    const manifest = existing[0];
    const [items] = await db.query(
      'SELECT * FROM return_manifest_items WHERE manifest_id = ?',
      [manifest.manifest_id]
    );
    return { ...manifest, items };
  }
  
  // If not found in return_manifests, lookup in temp_return_manifests
  const [temps] = await db.query(
    'SELECT * FROM temp_return_manifests WHERE resi_number = ? OR no_pesanan = ? ORDER BY is_processed ASC, manifest_id DESC LIMIT 1',
    [q, q]
  );
  
  if (temps.length === 0) return null;
  
  const tempManifest = temps[0];
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [res] = await conn.query(
      `INSERT INTO return_manifests 
        (resi_number, no_pesanan, customer_name, customer_contact, source_type, return_category, return_reason, notes, is_processed,
         nama_toko, metode_pengiriman, jenis_pengiriman, penerima, alamat_pengiriman, waktu_outbound, total_harga_pesanan, nama_pemilik, waktu_picking, admin_pengemasan, waktu_packing,
         nomor_daftar, no_pesanan_wms, no_pesanan_oms, status, gudang, waktu_pesanan, batas_waktu_pengiriman, waktu_cetak, mata_uang)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tempManifest.resi_number,
        tempManifest.no_pesanan,
        tempManifest.customer_name,
        tempManifest.customer_contact,
        tempManifest.source_type,
        tempManifest.return_category,
        tempManifest.return_reason,
        tempManifest.notes,
        tempManifest.nama_toko,
        tempManifest.metode_pengiriman,
        tempManifest.jenis_pengiriman,
        tempManifest.penerima,
        tempManifest.alamat_pengiriman,
        tempManifest.waktu_outbound,
        tempManifest.total_harga_pesanan,
        tempManifest.nama_pemilik,
        tempManifest.waktu_picking,
        tempManifest.admin_pengemasan,
        tempManifest.waktu_packing,
        tempManifest.nomor_daftar,
        tempManifest.no_pesanan_wms,
        tempManifest.no_pesanan_oms,
        tempManifest.status,
        tempManifest.gudang,
        tempManifest.waktu_pesanan,
        tempManifest.batas_waktu_pengiriman,
        tempManifest.waktu_cetak,
        tempManifest.mata_uang
      ]
    );
    const newManifestId = res.insertId;

    const [tempItems] = await conn.query(
      'SELECT * FROM temp_return_manifest_items WHERE manifest_id = ?',
      [tempManifest.manifest_id]
    );

    for (const item of tempItems) {
      await conn.query(
        `INSERT INTO return_manifest_items 
          (manifest_id, item_code, item_name, item_description, serial_number, batch_number, quantity, unit_price, varian_product, nomor, rak)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newManifestId,
          item.item_code,
          item.item_name,
          item.item_description,
          item.serial_number,
          item.batch_number,
          item.quantity,
          item.unit_price,
          item.varian_product,
          item.nomor,
          item.rak
        ]
      );
    }

    // Delete from temp (foreign key cascade will delete items automatically)
    await conn.query('DELETE FROM temp_return_manifests WHERE manifest_id = ?', [tempManifest.manifest_id]);

    await conn.commit();

    // Fetch the newly created manifest details and items
    const [inserted] = await db.query(
      'SELECT * FROM return_manifests WHERE manifest_id = ?',
      [newManifestId]
    );
    const manifest = inserted[0];
    const [items] = await db.query(
      'SELECT * FROM return_manifest_items WHERE manifest_id = ?',
      [newManifestId]
    );

    return { ...manifest, items };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Mark a manifest as processed.
 */
async function markManifestProcessed(resiNumber, noPesanan) {
  await db.query(
    'UPDATE return_manifests SET is_processed = 1 WHERE resi_number = ? AND no_pesanan = ?',
    [resiNumber, noPesanan]
  );
}

/**
 * Get all return manifests with aggregate details.
 */
async function getManifestsList() {
  const [rows] = await db.query(`
    SELECT rm.*, 
           COALESCE(COUNT(rmi.manifest_item_id), 0) AS total_items, 
           COALESCE(SUM(rmi.quantity), 0) AS total_quantity
    FROM return_manifests rm
    LEFT JOIN return_manifest_items rmi ON rm.manifest_id = rmi.manifest_id
    GROUP BY rm.manifest_id
    ORDER BY rm.is_processed ASC, rm.manifest_id DESC
  `);
  return rows;
}

async function getManifestsListPaginated({ page = 1, limit = 15, search = '', barcodes = [], month = '', year = '' }) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(rm.resi_number LIKE ? OR rm.no_pesanan LIKE ? OR rm.customer_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  } else if (barcodes && barcodes.length > 0) {
    const cleanBarcodes = barcodes.map(b => String(b).trim()).filter(Boolean);
    if (cleanBarcodes.length > 0) {
      const placeholders = cleanBarcodes.map(() => '?').join(',');
      conditions.push(`(rm.resi_number IN (${placeholders}) OR rm.no_pesanan IN (${placeholders}))`);
      params.push(...cleanBarcodes, ...cleanBarcodes);
    }
  }

  if (month) {
    conditions.push('MONTH(rm.created_at) = ?');
    params.push(parseInt(month));
  }

  if (year) {
    conditions.push('YEAR(rm.created_at) = ?');
    params.push(parseInt(year));
  }

  const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

  // Get total count
  const countSql = `SELECT COUNT(DISTINCT rm.manifest_id) AS total FROM return_manifests rm ${whereClause}`;
  const [countRows] = await db.query(countSql, params);
  const total = countRows[0].total || 0;

  // Get paginated rows
  const sql = `
    SELECT rm.*, 
           COALESCE(COUNT(rmi.manifest_item_id), 0) AS total_items, 
           COALESCE(SUM(rmi.quantity), 0) AS total_quantity
    FROM return_manifests rm
    LEFT JOIN return_manifest_items rmi ON rm.manifest_id = rmi.manifest_id
    ${whereClause}
    GROUP BY rm.manifest_id
    ORDER BY rm.is_processed ASC, rm.manifest_id DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, [...params, limit, offset]);
  return {
    rows,
    total,
    totalPages: Math.ceil(total / limit)
  };
}

/**
 * Get return manifests summary statistics.
 */
async function getManifestsStats({ month = '', year = '' } = {}) {
  let tempWhere = '';
  let mainWhere = '';
  const tempParams = [];
  const mainParams = [];
  const tempConditions = [];
  const mainConditions = [];

  if (month) {
    tempConditions.push('MONTH(created_at) = ?');
    mainConditions.push('MONTH(created_at) = ?');
    tempParams.push(parseInt(month));
    mainParams.push(parseInt(month));
  }

  if (year) {
    tempConditions.push('YEAR(created_at) = ?');
    mainConditions.push('YEAR(created_at) = ?');
    tempParams.push(parseInt(year));
    mainParams.push(parseInt(year));
  }

  if (tempConditions.length > 0) {
    tempWhere = ' WHERE ' + tempConditions.join(' AND ');
  }
  if (mainConditions.length > 0) {
    mainWhere = ' WHERE ' + mainConditions.join(' AND ');
  }

  const [tempRows] = await db.query(`SELECT COUNT(*) AS total FROM temp_return_manifests ${tempWhere}`, tempParams);
  const [mainRows] = await db.query(`SELECT COUNT(*) AS total FROM return_manifests ${mainWhere}`, mainParams);

  return {
    totalManifests: tempRows[0].total || 0,
    pendingManifests: tempRows[0].total || 0,
    processedManifests: mainRows[0].total || 0
  };
}


/**
 * Get items for a specific manifest.
 */
async function getManifestItems(manifestId) {
  const [rows] = await db.query(
    'SELECT * FROM return_manifest_items WHERE manifest_id = ?',
    [manifestId]
  );
  return rows;
}

/**
 * Flatten all manifest rows with items for flat CSV export.
 */
async function getAllManifestsWithItems() {
  const [rows] = await db.query(`
    SELECT rm.resi_number, rm.no_pesanan, rm.customer_name, rm.customer_contact, 
           rm.source_type, rm.return_category, rm.return_reason, rm.notes,
           rm.nama_toko, rm.metode_pengiriman, rm.jenis_pengiriman, rm.penerima,
           rm.alamat_pengiriman, rm.waktu_outbound, rm.total_harga_pesanan, rm.nama_pemilik,
           rm.waktu_picking, rm.admin_pengemasan, rm.waktu_packing,
           rm.nomor_daftar, rm.no_pesanan_wms, rm.no_pesanan_oms, rm.status,
           rm.gudang, rm.waktu_pesanan, rm.batas_waktu_pengiriman, rm.waktu_cetak,
           rm.mata_uang,
           rmi.item_code, rmi.item_name, rmi.quantity, rmi.unit_price, 
           rmi.serial_number, rmi.batch_number, rmi.item_description, rmi.varian_product,
           rmi.nomor, rmi.rak
    FROM return_manifests rm
    JOIN return_manifest_items rmi ON rm.manifest_id = rmi.manifest_id
    ORDER BY rm.manifest_id DESC
  `);
  return rows;
}

/**
 * Delete a return manifest and its items.
 */
async function deleteManifest(manifestId) {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [rows] = await conn.query('SELECT is_processed FROM return_manifests WHERE manifest_id = ?', [manifestId]);
    if (rows.length === 0) {
      throw new Error('Manifest not found');
    }
    if (rows[0].is_processed === 1) {
      throw new Error('Cannot delete a manifest that has already been processed');
    }

    await conn.query('DELETE FROM return_manifest_items WHERE manifest_id = ?', [manifestId]);
    await conn.query('DELETE FROM return_manifests WHERE manifest_id = ?', [manifestId]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Delete all pending return manifests and their items.
 */
async function deleteAllPendingManifests() {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query(`
      DELETE rmi FROM return_manifest_items rmi
      JOIN return_manifests rm ON rmi.manifest_id = rm.manifest_id
      WHERE rm.is_processed = 0
    `);
    await conn.query('DELETE FROM return_manifests WHERE is_processed = 0');
    
    // Also clear all temp tables
    await conn.query('DELETE FROM temp_return_manifest_items');
    await conn.query('DELETE FROM temp_return_manifests');
    
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Get details of a single return item by its item_id, including parent return metadata.
 */
async function getReturnItemDetail(itemId) {
  const [itemRows] = await db.query(`
    SELECT ri.*,
           r.created_at,
           r.return_number, r.return_date, r.customer_name, r.customer_contact, r.no_pesanan,
           r.resi_number, r.resi_courier, r.inbound_date, r.total_value, r.return_reason,
           r.notes, r.current_status AS return_status, r.product_category, r.sla_deadline, r.vendor_name,
           r.recovery_price,
           u1.full_name AS pic_name,       u1.email AS pic_email,
           u2.full_name AS inspector_name,
           u3.full_name AS approver_name,
           u4.full_name AS created_by_name,
           u5.full_name AS admin_retur_name,
           u6.full_name AS staff_recover_name
    FROM return_items ri
    JOIN returns r ON ri.return_id = r.return_id
    LEFT JOIN users u1 ON r.pic_user_id       = u1.user_id
    LEFT JOIN users u2 ON r.inspector_user_id  = u2.user_id
    LEFT JOIN users u3 ON r.approver_user_id   = u3.user_id
    LEFT JOIN users u4 ON r.created_by         = u4.user_id
    LEFT JOIN users u5 ON r.admin_retur_id     = u5.user_id
    LEFT JOIN users u6 ON r.staff_recover_id   = u6.user_id
    WHERE ri.item_id = ?
  `, [itemId]);

  if (!itemRows.length) return null;

  const item = itemRows[0];

  const [history] = await db.query(`
    SELECT h.*, u.full_name
    FROM return_status_history h
    LEFT JOIN users u ON h.changed_by = u.user_id
    WHERE h.return_id = ?
    ORDER BY h.changed_at DESC
  `, [item.return_id]);

  const [comments] = await db.query(`
    SELECT c.*, u.full_name
    FROM return_comments c
    LEFT JOIN users u ON c.user_id = u.user_id
    WHERE c.return_id = ?
    ORDER BY c.created_at DESC
  `, [item.return_id]);

  const [siblingItems] = await db.query(`
    SELECT * FROM return_items WHERE return_id = ? AND item_id != ? ORDER BY item_id
  `, [item.return_id, itemId]);

  return { ...item, history, comments, siblingItems };
}

module.exports = {
  generateReturnNumber,
  getReturns,
  getPendingReturns,
  getInspectionQueue,
  getReturnById,
  getReturnItemDetail,
  createReturn,
  updateReturn,
  updateReturnItem,
  addReturnItems,
  deleteInboundItem,
  getItemImagePaths,
  updateStatus,
  addComment,
  updateItemInspection,
  // New workflow methods
  setReturnSLA,
  confirmInbound,
  updateItemQC,
  categorizeReturn,
  getRecoveryQueue,
  submitPricing,
  reviewPricing,
  getPendingPricingSubmissions,
  recordRecoverySale,
  // Manifest methods
  saveManifest,
  saveManifestsBatch,
  getManifestByQuery,
  markManifestProcessed,
  getManifestsList,
  getManifestsListPaginated,
  getManifestsStats,
  getManifestItems,
  getAllManifestsWithItems,
  deleteManifest,
  deleteAllPendingManifests
};
