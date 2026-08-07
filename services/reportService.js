'use strict';
const db = require('../config/database');
const config = require('../config/config');

function buildDateRangeFilter(columnName, dateFrom, dateTo) {
  const clauses = [];
  const params = [];

  if (dateFrom) {
    clauses.push(`${columnName} >= ?`);
    params.push(dateFrom);
  }

  if (dateTo) {
    clauses.push(`${columnName} <= ?`);
    params.push(dateTo);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

/**
 * Summary statistics over a date range.
 */
async function getSummaryReport(dateFrom, dateTo) {
  const [[stats]] = await db.query(
    `SELECT
       COUNT(*)                                                                                    AS total_returns,
       SUM(CASE WHEN current_status = 'Completed'                             THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN current_status = 'Approved'                              THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN current_status = 'Rejected'                              THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN current_status NOT IN ('Completed','Approved','Rejected') THEN 1 ELSE 0 END) AS pending,
       COALESCE(SUM(total_value), 0)                                                              AS total_value,
       COALESCE(SUM(total_items), 0)                                                              AS total_items,
       ROUND(AVG(DATEDIFF(COALESCE(completed_date, NOW()), return_date)), 1)                      AS avg_processing_time
     FROM returns WHERE return_date BETWEEN ? AND ?`,
    [dateFrom, dateTo]
  );

  const [byStatus] = await db.query(
    `SELECT current_status as return_status, COUNT(*) AS count, COALESCE(SUM(total_value),0) AS value
     FROM returns WHERE return_date BETWEEN ? AND ?
     GROUP BY current_status ORDER BY count DESC`,
    [dateFrom, dateTo]
  );

  const [byCategory] = await db.query(
    `SELECT return_category, COUNT(*) AS count, COALESCE(SUM(total_value),0) AS value
     FROM returns WHERE return_date BETWEEN ? AND ?
     GROUP BY return_category ORDER BY count DESC`,
    [dateFrom, dateTo]
  );

  const byPriority = [];

  const [bySource] = await db.query(
    `SELECT source_type, COUNT(*) AS count, COALESCE(SUM(total_value),0) AS value
     FROM returns WHERE return_date BETWEEN ? AND ?
     GROUP BY source_type ORDER BY count DESC`,
    [dateFrom, dateTo]
  );

  const [byPic] = await db.query(
    `SELECT u.full_name,
            COUNT(*) AS total_returns,
            SUM(CASE WHEN r.current_status = 'Completed' THEN 1 ELSE 0 END) AS completed_returns,
            SUM(CASE WHEN r.current_status = 'Completed' THEN r.total_value ELSE 0 END) AS completed_returns_amount,
            SUM(CASE WHEN r.current_status = 'Approved'  THEN 1 ELSE 0 END) AS approved_returns,
            SUM(CASE WHEN r.current_status = 'Approved'  THEN r.total_value ELSE 0 END) AS approved_returns_amount,
            SUM(CASE WHEN r.current_status = 'Rejected'  THEN 1 ELSE 0 END) AS rejected_returns,
            SUM(CASE WHEN r.current_status = 'Rejected'  THEN r.total_value ELSE 0 END) AS rejected_returns_amount,
            SUM(CASE WHEN r.current_status = 'Pending' THEN r.total_value ELSE 0 END) AS pending_returns_amount
     FROM returns r
     LEFT JOIN users u ON r.pic_user_id = u.user_id
     WHERE r.return_date BETWEEN ? AND ?
     GROUP BY u.user_id ORDER BY total_returns DESC LIMIT 10`,
    [dateFrom, dateTo]
  );

  const [trend] = await db.query(
    `SELECT DATE_FORMAT(return_date, '%Y-%m') AS month, COUNT(*) AS count
     FROM returns
     WHERE return_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
     GROUP BY month ORDER BY month ASC`
  );

  return { stats, byStatus, byCategory, byPriority, bySource, byPic, trend };
}

/**
 * Aging report (open returns grouped by age bucket).
 */
async function getAgingReport(filters = {}) {
  const { NORMAL, WARNING, CRITICAL } = config.AGING;

  const [overview] = await db.query(
    `SELECT
       SUM(CASE WHEN DATEDIFF(NOW(), return_date) < ${NORMAL}                                 THEN 1 ELSE 0 END) AS normal_count,
       SUM(CASE WHEN DATEDIFF(NOW(), return_date) BETWEEN ${NORMAL} AND ${WARNING - 1}        THEN 1 ELSE 0 END) AS warning_count,
       SUM(CASE WHEN DATEDIFF(NOW(), return_date) BETWEEN ${WARNING} AND ${CRITICAL - 1}      THEN 1 ELSE 0 END) AS critical_count,
       SUM(CASE WHEN DATEDIFF(NOW(), return_date) >= ${CRITICAL}                              THEN 1 ELSE 0 END) AS overdue_count
     FROM returns
     WHERE current_status NOT IN ('Completed','Approved','Rejected')`
  );

  let sql = `
    SELECT r.*,
           u.full_name AS pic_name,
           DATEDIFF(NOW(), r.return_date) AS aging_days
    FROM returns r
    LEFT JOIN users u ON r.pic_user_id = u.user_id
    WHERE r.current_status NOT IN ('Completed','Approved','Rejected')
  `;
  const params = [];
  if (filters.category) { sql += ' AND r.return_category = ?'; params.push(filters.category); }
  sql += ' ORDER BY aging_days DESC';

  const [returns] = await db.query(sql, params);
  return { overview: overview[0], returns };
}

/**
 * Value-impact report.
 */
async function getValueImpactReport(dateFrom, dateTo) {
  const [[totals]] = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN current_status NOT IN ('Completed','Approved','Rejected') THEN total_value END), 0) AS open_value,
       COALESCE(SUM(CASE WHEN current_status = 'Approved'  THEN total_value END), 0)                             AS approved_value,
       COALESCE(SUM(CASE WHEN current_status = 'Completed' THEN total_value END), 0)                             AS recovered_value,
       COALESCE(SUM(CASE WHEN current_status = 'Rejected'  THEN total_value END), 0)                             AS lost_value,
       COALESCE(SUM(total_value), 0)                                                                              AS total_value
     FROM returns WHERE return_date BETWEEN ? AND ?`,
    [dateFrom, dateTo]
  );

  const [byCategory] = await db.query(
    `SELECT return_category,
       COUNT(*) AS count,
       COALESCE(SUM(total_value), 0) AS total_value,
       COALESCE(SUM(CASE WHEN current_status = 'Completed' THEN total_value END), 0) AS recovered_value
     FROM returns WHERE return_date BETWEEN ? AND ?
     GROUP BY return_category ORDER BY total_value DESC`,
    [dateFrom, dateTo]
  );

  const [topReturns] = await db.query(
    `SELECT r.return_id, r.return_number, r.resi_number, r.return_date, r.customer_name, r.return_category,
            r.current_status as return_status, r.total_value,
            u.full_name AS pic_name
     FROM returns r
     LEFT JOIN users u ON r.pic_user_id = u.user_id
     WHERE r.return_date BETWEEN ? AND ?
     ORDER BY r.total_value DESC LIMIT 20`,
    [dateFrom, dateTo]
  );

  const [dispositionValue] = await db.query(
    `SELECT ri.disposition,
       COUNT(*) AS count,
       COALESCE(SUM(ri.total_price), 0) AS total_price
     FROM return_items ri
     JOIN returns r ON ri.return_id = r.return_id
     WHERE r.return_date BETWEEN ? AND ?
     GROUP BY ri.disposition ORDER BY total_price DESC`,
    [dateFrom, dateTo]
  );

  return { totals, byCategory, topReturns, dispositionValue };
}

/**
 * Activity logs.
 */
async function getActivityLogs(filters = {}) {
  let sql = `
    SELECT al.*, u.username, u.full_name
    FROM activity_logs al
    LEFT JOIN users u ON al.user_id = u.user_id
    WHERE 1=1
  `;
  const params = [];

  if (filters.user_id) { sql += ' AND al.user_id = ?'; params.push(parseInt(filters.user_id)); }
  if (filters.action_type) { sql += ' AND al.action_type = ?'; params.push(filters.action_type); }
  if (filters.date_from) { sql += ' AND DATE(al.created_at) >= ?'; params.push(filters.date_from); }
  if (filters.date_to) { sql += ' AND DATE(al.created_at) <= ?'; params.push(filters.date_to); }

  sql += ' ORDER BY al.created_at DESC LIMIT 500';

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Log a user action.
 */
async function logActivity(userId, actionType, description, ipAddress, userAgent) {
  try {
    await db.query(
      `INSERT INTO activity_logs (user_id, action_type, action_description, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, actionType, description, ipAddress || 'Unknown', userAgent || 'Unknown']
    );
  } catch {
    // Non-critical – swallow silently
  }
}

/**
 * Return analysis — Sumber Retur + Kategori Product.
 * JOIN returns + return_items, hitung total per source_type dan item_category.
 */
async function getReturnAnalysis(dateFrom, dateTo) {
  const returnDateFilter = buildDateRangeFilter('r.return_date', dateFrom, dateTo);

  // ── 1. Sumber Retur (source_type) ──────────────────────────────────────────
  const sourceTypeKeys = ['retur_penjualan_mp', 'retur_penjualan_grosir', 'retur_internal_qc'];

  const [bySourceItems] = await db.query(
    `SELECT
       r.source_type,
       COUNT(DISTINCT r.return_id)   AS total_returns,
       COALESCE(SUM(ri.quantity), 0) AS total_qty
     FROM returns r
     LEFT JOIN return_items ri ON ri.return_id = r.return_id
     ${returnDateFilter.sql}${returnDateFilter.sql ? ' AND' : ' WHERE'}
       r.source_type IN ('retur_penjualan_mp', 'retur_penjualan_grosir', 'retur_internal_qc')
     GROUP BY r.source_type`,
    [...returnDateFilter.params]
  );

  const sourceItemsMap = {};
  let sourceItemsTotal = { total_returns: 0, total_qty: 0 };
  sourceTypeKeys.forEach(k => { sourceItemsMap[k] = { source_type: k, total_returns: 0, total_qty: 0 }; });
  bySourceItems.forEach(row => {
    if (sourceItemsMap[row.source_type] !== undefined) {
      sourceItemsMap[row.source_type] = row;
      sourceItemsTotal.total_returns += Number(row.total_returns);
      sourceItemsTotal.total_qty += Number(row.total_qty);
    }
  });
  const bySourceItemsList = sourceTypeKeys.map(k => sourceItemsMap[k]);

  // ── 2. Kategori Product (item_category) ────────────────────────────────────
  const itemCategoryKeys = ['Elektronik', 'Non Elektronik'];

  const [byItemCategoryRaw] = await db.query(
    `SELECT
       ri.item_category,
       COUNT(DISTINCT r.return_id)   AS total_returns,
       COALESCE(SUM(ri.quantity), 0) AS total_qty
     FROM return_items ri
     JOIN returns r ON ri.return_id = r.return_id
     ${returnDateFilter.sql}${returnDateFilter.sql ? ' AND' : ' WHERE'}
       ri.item_category IN ('Elektronik', 'Non Elektronik')
     GROUP BY ri.item_category`,
    [...returnDateFilter.params]
  );

  const itemCategoryMap = {};
  let itemCategoryTotal = { total_returns: 0, total_qty: 0 };
  itemCategoryKeys.forEach(k => { itemCategoryMap[k] = { item_category: k, total_returns: 0, total_qty: 0 }; });
  byItemCategoryRaw.forEach(row => {
    if (itemCategoryMap[row.item_category] !== undefined) {
      itemCategoryMap[row.item_category] = row;
      itemCategoryTotal.total_returns += Number(row.total_returns);
      itemCategoryTotal.total_qty += Number(row.total_qty);
    }
  });
  const byItemCategoryList = itemCategoryKeys.map(k => itemCategoryMap[k]);

  // ── 3. Alasan Retur (return_category) ─────────────────────────────────────
  const reasonKeys = ['packing_rusak', 'pecah', 'kurang_part', 'rekondisi_baik'];

  const [byReturnReasonRaw] = await db.query(
    `SELECT
       CASE
         WHEN LOWER(REPLACE(TRIM(COALESCE(ri.return_category, r.return_category, '')), ' ', '_')) IN ('packing_rusak') THEN 'packing_rusak'
         WHEN LOWER(REPLACE(TRIM(COALESCE(ri.return_category, r.return_category, '')), ' ', '_')) IN ('pecah') THEN 'pecah'
         WHEN LOWER(REPLACE(TRIM(COALESCE(ri.return_category, r.return_category, '')), ' ', '_')) IN ('kurang_part') THEN 'kurang_part'
         WHEN LOWER(REPLACE(REPLACE(TRIM(COALESCE(ri.return_category, r.return_category, '')), ' ', '_'), '/', '_')) IN ('rekondisi_baik', 'rekondisi', 'baik', 'refurbish') THEN 'rekondisi_baik'
         ELSE NULL
       END AS reason_key,
       COALESCE(SUM(ri.quantity), 0) AS total_qty
     FROM returns r
     JOIN return_items ri ON ri.return_id = r.return_id
     ${returnDateFilter.sql}
     GROUP BY reason_key`,
    [...returnDateFilter.params]
  );

  const returnReasonMap = {};
  let returnReasonTotal = { total_qty: 0 };
  reasonKeys.forEach(k => { returnReasonMap[k] = { reason_key: k, total_qty: 0 }; });
  byReturnReasonRaw.forEach(row => {
    if (!row.reason_key) return;
    if (returnReasonMap[row.reason_key] !== undefined) {
      returnReasonMap[row.reason_key] = row;
      returnReasonTotal.total_qty += Number(row.total_qty);
    }
  });
  const byReturnReasonList = reasonKeys.map(k => returnReasonMap[k]);

  // ── 4. Kategori Sorting (disposition pada return_items) ──────────────────
  const sortingKeys = ['return_to_supplier', 'rekondisi', 'refurbish', 'write_off'];

  const [bySortingCategoryRaw] = await db.query(
    `SELECT
       CASE
         WHEN LOWER(TRIM(COALESCE(ri.disposition, ''))) = 'return_to_supplier' THEN 'return_to_supplier'
         WHEN LOWER(TRIM(COALESCE(ri.disposition, ''))) = 'rekondisi' THEN 'rekondisi'
         WHEN LOWER(TRIM(COALESCE(ri.disposition, ''))) = 'refurbish' THEN 'refurbish'
         WHEN LOWER(TRIM(COALESCE(ri.disposition, ''))) = 'write_off' THEN 'write_off'
         ELSE NULL
       END AS sorting_key,
       COUNT(ri.item_id) AS total_items
     FROM returns r
     JOIN return_items ri ON ri.return_id = r.return_id
     ${returnDateFilter.sql}
     GROUP BY sorting_key`,
    [...returnDateFilter.params]
  );

  const sortingCategoryMap = {};
  let sortingCategoryTotal = { total_items: 0 };
  sortingKeys.forEach(k => { sortingCategoryMap[k] = { sorting_key: k, total_items: 0 }; });
  bySortingCategoryRaw.forEach(row => {
    if (!row.sorting_key) return;
    if (sortingCategoryMap[row.sorting_key] !== undefined) {
      sortingCategoryMap[row.sorting_key] = row;
      sortingCategoryTotal.total_items += Number(row.total_items);
    }
  });
  const bySortingCategoryList = sortingKeys.map(k => sortingCategoryMap[k]);

  return {
    bySourceItemsList,
    sourceItemsTotal,
    byItemCategoryList,
    itemCategoryTotal,
    byReturnReasonList,
    returnReasonTotal,
    bySortingCategoryList,
    sortingCategoryTotal
  };
}

module.exports = {
  getSummaryReport,
  getAgingReport,
  getValueImpactReport,
  getActivityLogs,
  logActivity,
  getReturnAnalysis
};
