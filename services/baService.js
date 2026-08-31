'use strict';
const db = require('../config/database');

/* ── Helpers ─────────────────────────────────────────────────────────────── */

async function generateBANumber(type) {
  const d = new Date();
  const yr  = d.getFullYear();
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const code = { rekondisi: 'RKD', refurbish: 'RFB', write_off: 'WO', retur_supplier: 'RS', retur_final: 'RF' }[type] || 'BA';
  const prefix = `BA/${code}/${yr}/${mon}/`;

  const [rows] = await db.query(
    `SELECT ba_number FROM berita_acara WHERE ba_number LIKE ? ORDER BY ba_id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  const seq = rows.length ? parseInt(rows[0].ba_number.split('/').pop()) + 1 : 1;
  return prefix + String(seq).padStart(4, '0');
}

/* ── CRUD ────────────────────────────────────────────────────────────────── */

async function createBA(data, userId) {
  const baNumber = await generateBANumber(data.ba_type);
  const [result] = await db.query(
    `INSERT INTO berita_acara
       (ba_number, return_id, ba_type, created_by, title, content, final_price, vendor_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      baNumber,
      data.return_id ? parseInt(data.return_id) : null,
      data.ba_type,
      userId,
      data.title        || null,
      data.content      || null,
      data.final_price  || null,
      data.vendor_id    || null
    ]
  );

  // Link BA back to the return if return_id is provided
  if (data.return_id) {
    await db.query('UPDATE returns SET ba_id = ? WHERE return_id = ?', [result.insertId, parseInt(data.return_id)]);
  }

  return { baId: result.insertId, baNumber };
}

async function getBAById(baId) {
  const [rows] = await db.query(`
    SELECT ba.*,
           r.return_number, r.resi_number, r.resi_courier, r.customer_name, r.return_date, r.current_status,
           u1.full_name AS created_by_name,
           u2.full_name AS sig_staff_recover_name,
           u3.full_name AS sig_fat_name,
           u4.full_name AS sig_admin_name,
           v.vendor_name
    FROM berita_acara ba
    LEFT JOIN  returns r   ON ba.return_id  = r.return_id
    LEFT JOIN users u1 ON ba.created_by           = u1.user_id
    LEFT JOIN users u2 ON ba.sig_staff_recover_by  = u2.user_id
    LEFT JOIN users u3 ON ba.sig_fat_by            = u3.user_id
    LEFT JOIN users u4 ON ba.sig_admin_by          = u4.user_id
    LEFT JOIN vendors v ON ba.vendor_id            = v.vendor_id
    WHERE ba.ba_id = ?
  `, [baId]);
  return rows[0] || null;
}

function buildLegacyDispositionCondition(baAlias, itemAlias) {
  return `(
    (${baAlias}.ba_type = 'write_off' AND ${itemAlias}.disposition = 'write_off') OR
    (${baAlias}.ba_type IN ('refurbish', 'rekondisi') AND ${itemAlias}.disposition IN ('refurbish', 'rekondisi')) OR
    (${baAlias}.ba_type = 'retur_supplier' AND ${itemAlias}.disposition = 'return_to_supplier' AND (${baAlias}.vendor_id IS NULL OR ${itemAlias}.vendor_id = ${baAlias}.vendor_id)) OR
    (${baAlias}.ba_type NOT IN ('write_off', 'refurbish', 'rekondisi', 'retur_supplier'))
  )`;
}

async function getBAList(filters = {}) {
  const params = [];
  const legacyDispositionCondition = buildLegacyDispositionCondition('ba_legacy', 'ri_legacy');
  const statusColumnMap = {
    rekondisi: 'has_rekondisi',
    refurbish: 'has_refurbish',
    write_off: 'has_write_off',
    return_to_supplier: 'has_return_to_supplier'
  };
  const statusSkuColumnMap = {
    rekondisi: 'skus_rekondisi',
    refurbish: 'skus_refurbish',
    write_off: 'skus_write_off',
    return_to_supplier: 'skus_return_to_supplier'
  };
  const skuExpression = filters.status && statusSkuColumnMap[filters.status]
    ? `COALESCE(stock_agg.${statusSkuColumnMap[filters.status]}, legacy_agg.${statusSkuColumnMap[filters.status]})`
    : 'COALESCE(stock_agg.skus, legacy_agg.skus)';
  let sql = `
    SELECT 
      ba.ba_id, 
      ba.ba_number, 
      ba.ba_type, 
      ba.status, 
      ba.created_at,
      ba.final_price, 
      ba.title, 
      ba.vendor_id,
      r.return_number,
      COALESCE(stock_agg.resi_number, r.resi_number) AS resi_number,
      r.customer_name,
      u.full_name AS created_by_name,
      v.vendor_name,
      ${skuExpression} AS skus,
      COALESCE(stock_agg.total_qty, legacy_agg.total_qty) AS total_qty,
      COALESCE(stock_agg.item_dispositions, legacy_agg.item_dispositions) AS item_dispositions
    FROM berita_acara ba
    LEFT JOIN returns r ON ba.return_id = r.return_id
    LEFT JOIN vendors v ON ba.vendor_id = v.vendor_id
    LEFT JOIN users u ON ba.created_by = u.user_id
    LEFT JOIN (
      SELECT
        s.ba_id,
        GROUP_CONCAT(DISTINCT r2.resi_number ORDER BY r2.resi_number SEPARATOR ', ') AS resi_number,
        GROUP_CONCAT(DISTINCT ri2.item_code ORDER BY ri2.item_code SEPARATOR ', ') AS skus,
        GROUP_CONCAT(DISTINCT CASE WHEN s.category = 'rekondisi' THEN ri2.item_code END ORDER BY ri2.item_code SEPARATOR ', ') AS skus_rekondisi,
        GROUP_CONCAT(DISTINCT CASE WHEN s.category = 'refurbish' THEN ri2.item_code END ORDER BY ri2.item_code SEPARATOR ', ') AS skus_refurbish,
        GROUP_CONCAT(DISTINCT CASE WHEN s.category = 'write_off' THEN ri2.item_code END ORDER BY ri2.item_code SEPARATOR ', ') AS skus_write_off,
        GROUP_CONCAT(DISTINCT CASE WHEN s.category = 'return_to_supplier' THEN ri2.item_code END ORDER BY ri2.item_code SEPARATOR ', ') AS skus_return_to_supplier,
        SUM(ri2.quantity) AS total_qty,
        GROUP_CONCAT(DISTINCT s.category ORDER BY s.category SEPARATOR ', ') AS item_dispositions,
        MAX(s.category = 'rekondisi') AS has_rekondisi,
        MAX(s.category = 'refurbish') AS has_refurbish,
        MAX(s.category = 'write_off') AS has_write_off,
        MAX(s.category = 'return_to_supplier') AS has_return_to_supplier
      FROM inventory_stock s
      JOIN returns r2 ON s.return_id = r2.return_id
      JOIN return_items ri2 ON s.item_id = ri2.item_id
      WHERE s.ba_id IS NOT NULL
      GROUP BY s.ba_id
    ) stock_agg ON stock_agg.ba_id = ba.ba_id
    LEFT JOIN (
      SELECT
        ba_legacy.ba_id,
        GROUP_CONCAT(DISTINCT ri_legacy.item_code ORDER BY ri_legacy.item_code SEPARATOR ', ') AS skus,
        GROUP_CONCAT(DISTINCT CASE WHEN ri_legacy.disposition = 'rekondisi' THEN ri_legacy.item_code END ORDER BY ri_legacy.item_code SEPARATOR ', ') AS skus_rekondisi,
        GROUP_CONCAT(DISTINCT CASE WHEN ri_legacy.disposition = 'refurbish' THEN ri_legacy.item_code END ORDER BY ri_legacy.item_code SEPARATOR ', ') AS skus_refurbish,
        GROUP_CONCAT(DISTINCT CASE WHEN ri_legacy.disposition = 'write_off' THEN ri_legacy.item_code END ORDER BY ri_legacy.item_code SEPARATOR ', ') AS skus_write_off,
        GROUP_CONCAT(DISTINCT CASE WHEN ri_legacy.disposition = 'return_to_supplier' THEN ri_legacy.item_code END ORDER BY ri_legacy.item_code SEPARATOR ', ') AS skus_return_to_supplier,
        SUM(ri_legacy.quantity) AS total_qty,
        GROUP_CONCAT(DISTINCT ri_legacy.disposition ORDER BY ri_legacy.disposition SEPARATOR ', ') AS item_dispositions,
        MAX(ri_legacy.disposition = 'rekondisi') AS has_rekondisi,
        MAX(ri_legacy.disposition = 'refurbish') AS has_refurbish,
        MAX(ri_legacy.disposition = 'write_off') AS has_write_off,
        MAX(ri_legacy.disposition = 'return_to_supplier') AS has_return_to_supplier
      FROM berita_acara ba_legacy
      JOIN return_items ri_legacy
        ON ri_legacy.return_id = ba_legacy.return_id
       AND ${legacyDispositionCondition}
      GROUP BY ba_legacy.ba_id
    ) legacy_agg ON legacy_agg.ba_id = ba.ba_id AND stock_agg.ba_id IS NULL
    WHERE 1=1
  `;
  if (filters.status)  {
    const statusColumn = statusColumnMap[filters.status];
    if (statusColumn) {
      sql += ` AND COALESCE(stock_agg.${statusColumn}, legacy_agg.${statusColumn}, 0) = 1`;
    }
  }
  if (filters.vendor_id) {
    let vendorIds = [];
    if (Array.isArray(filters.vendor_id)) {
      vendorIds = filters.vendor_id.map(v => parseInt(v)).filter(v => !isNaN(v));
    } else if (typeof filters.vendor_id === 'string') {
      vendorIds = filters.vendor_id.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
    } else if (typeof filters.vendor_id === 'number') {
      vendorIds = [filters.vendor_id];
    }
    if (vendorIds.length > 0) {
      sql += ' AND (ba.vendor_id IN (?) OR ba.ba_id IN (SELECT DISTINCT s_v.ba_id FROM inventory_stock s_v WHERE s_v.vendor_id IN (?)))';
      params.push(vendorIds, vendorIds);
    }
  }
  if (filters.start_date) { sql += ' AND ba.created_at >= ?'; params.push(`${filters.start_date} 00:00:00`); }
  if (filters.end_date)   { sql += ' AND ba.created_at < DATE_ADD(?, INTERVAL 1 DAY)'; params.push(filters.end_date); }
  if (filters.search) {
    sql += ' AND (ba.ba_number LIKE ? OR ba.title LIKE ? OR v.vendor_name LIKE ?)';
    const lk = `%${filters.search}%`;
    params.push(lk, lk, lk);
  }
  sql += ' ORDER BY ba.created_at DESC';
  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Advance BA to pending_sign status (triggers signature request).
 */
async function submitForSigning(baId) {
  await db.query(`UPDATE berita_acara SET status = 'pending_sign' WHERE ba_id = ?`, [baId]);
}

/**
 * Save a digital signature for one party.
 * sigField: 'staff_recover' | 'fat' | 'admin'
 * signatureData: base64 PNG data URI from canvas
 */
async function signBA(baId, sigField, signatureData, userId) {
  const fieldMap = {
    staff_recover : { sig: 'sig_staff_recover',    by: 'sig_staff_recover_by', at: 'sig_staff_recover_at' },
    fat           : { sig: 'sig_fat',              by: 'sig_fat_by',           at: 'sig_fat_at'           },
    admin         : { sig: 'sig_admin',            by: 'sig_admin_by',         at: 'sig_admin_at'         }
  };
  const f = fieldMap[sigField];
  if (!f) throw new Error('Invalid signature field: ' + sigField);

  await db.query(
    `UPDATE berita_acara
        SET \`${f.sig}\` = ?, \`${f.by}\` = ?, \`${f.at}\` = NOW()
      WHERE ba_id = ?`,
    [signatureData, userId, baId]
  );

  // Auto-advance to 'signed' once all three parties have signed
  const [rows] = await db.query(
    `SELECT sig_staff_recover, sig_fat, sig_admin FROM berita_acara WHERE ba_id = ?`,
    [baId]
  );
  if (rows.length && rows[0].sig_staff_recover && rows[0].sig_fat && rows[0].sig_admin) {
    await db.query(`UPDATE berita_acara SET status = 'signed' WHERE ba_id = ?`, [baId]);
  }
}

/**
 * Void / cancel a BA document.
 */
async function voidBA(baId) {
  await db.query(`UPDATE berita_acara SET status = 'void' WHERE ba_id = ?`, [baId]);
}

/* ── Vendor helpers ──────────────────────────────────────────────────────── */

async function getVendors(activeOnly = true) {
  const [rows] = await db.query(
    `SELECT * FROM vendors ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY vendor_name`,
    []
  );
  return rows;
}

async function createVendor(data, userId) {
  const [result] = await db.query(
    `INSERT INTO vendors (vendor_name, vendor_type, contact_person, phone, email, address, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.vendor_name, data.vendor_type || 'general', data.contact_person || null,
     data.phone || null, data.email || null, data.address || null, userId]
  );
  return result.insertId;
}

async function getVendorById(vendorId) {
  const [rows] = await db.query('SELECT * FROM vendors WHERE vendor_id = ?', [vendorId]);
  return rows[0] || null;
}

async function updateVendor(vendorId, data) {
  await db.query(
    `UPDATE vendors SET vendor_name=?, vendor_type=?, contact_person=?, phone=?, email=?, address=?, is_active=?
     WHERE vendor_id = ?`,
    [data.vendor_name, data.vendor_type, data.contact_person || null,
     data.phone || null, data.email || null, data.address || null,
     data.is_active !== undefined ? data.is_active : 1, vendorId]
  );
}

module.exports = {
  generateBANumber,
  createBA, getBAById, getBAList, submitForSigning, signBA, voidBA,
  getVendors, createVendor, getVendorById, updateVendor
};
