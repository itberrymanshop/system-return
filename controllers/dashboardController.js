'use strict';
const db = require('../config/database');
const config = require('../config/config');
const slaService = require('../services/slaService');

exports.index = async (req, res, next) => {
  try {
    const selectedMonth = req.query.month ? parseInt(req.query.month) : null;
    const selectedYear = req.query.year ? parseInt(req.query.year) : null;

    // Fetch dynamic years available in returns and berita_acara
    const [yearsResult] = await db.query(`
      SELECT DISTINCT YEAR(return_date) AS yr FROM returns WHERE return_date IS NOT NULL
      UNION
      SELECT DISTINCT YEAR(created_at) AS yr FROM berita_acara WHERE created_at IS NOT NULL
      UNION
      SELECT DISTINCT tahun AS yr FROM paket_terkirim WHERE is_show = 1
      ORDER BY yr DESC
    `);
    const availableYears = yearsResult.map(r => r.yr).filter(Boolean);
    const currentYear = new Date().getFullYear();
    if (!availableYears.includes(currentYear)) {
      availableYears.push(currentYear);
      availableYears.sort((a, b) => b - a);
    }

    const monthsList = [
      { value: 1, name: 'Januari' },
      { value: 2, name: 'Februari' },
      { value: 3, name: 'Maret' },
      { value: 4, name: 'April' },
      { value: 5, name: 'Mei' },
      { value: 6, name: 'Juni' },
      { value: 7, name: 'Juli' },
      { value: 8, name: 'Agustus' },
      { value: 9, name: 'September' },
      { value: 10, name: 'Oktober' },
      { value: 11, name: 'November' },
      { value: 12, name: 'Desember' }
    ];

    // Build WHERE clauses for returns
    let returnWhereClauses = [];
    let returnParams = [];
    if (selectedYear) {
      returnWhereClauses.push('YEAR(return_date) = ?');
      returnParams.push(selectedYear);
    }
    if (selectedMonth) {
      returnWhereClauses.push('MONTH(return_date) = ?');
      returnParams.push(selectedMonth);
    }
    const returnWhere = returnWhereClauses.length > 0 ? 'WHERE ' + returnWhereClauses.join(' AND ') : '';
    const returnWhereAnd = returnWhereClauses.length > 0 ? 'AND ' + returnWhereClauses.join(' AND ') : '';

    // Build WHERE clauses for returns with alias 'r'
    let rWhereClauses = [];
    let rParams = [];
    if (selectedYear) {
      rWhereClauses.push('YEAR(r.return_date) = ?');
      rParams.push(selectedYear);
    }
    if (selectedMonth) {
      rWhereClauses.push('MONTH(r.return_date) = ?');
      rParams.push(selectedMonth);
    }
    const rWhere = rWhereClauses.length > 0 ? 'WHERE ' + rWhereClauses.join(' AND ') : '';

    // Build WHERE clauses for berita_acara with alias 'ba'
    let baWhereClauses = [];
    let baParams = [];
    if (selectedYear) {
      baWhereClauses.push('YEAR(ba.created_at) = ?');
      baParams.push(selectedYear);
    }
    if (selectedMonth) {
      baWhereClauses.push('MONTH(ba.created_at) = ?');
      baParams.push(selectedMonth);
    }
    const baWhere = baWhereClauses.length > 0 ? 'WHERE ' + baWhereClauses.join(' AND ') : '';
    const baWhereAnd = baWhereClauses.length > 0 ? 'AND ' + baWhereClauses.join(' AND ') : '';

    // Build WHERE clauses for return_status_history with alias 'h'
    let historyWhereClauses = ["h.to_status IN ('Completed', 'Rejected', 'Supplier_Return')"];
    let historyParams = [];
    if (selectedYear) {
      historyWhereClauses.push('YEAR(h.changed_at) = ?');
      historyParams.push(selectedYear);
    }
    if (selectedMonth) {
      historyWhereClauses.push('MONTH(h.changed_at) = ?');
      historyParams.push(selectedMonth);
    }
    const historyWhere = 'WHERE ' + historyWhereClauses.join(' AND ');

    // 1. Totals (returns)
    const [[totals]] = await db.query(`
      SELECT
        COUNT(*)                                                          AS total_returns,
        COALESCE(SUM(current_status = 'Inbound'), 0)                      AS pending_returns,
        COALESCE(SUM(current_status IN ('Inbound')), 0) AS inspecting_returns,
        COALESCE(SUM(current_status IN ('Pricing','Recovery')), 0)        AS recovery_returns,
        COALESCE(SUM(current_status = 'Refurbish'), 0) AS refurbish_returns,
        COALESCE(SUM(current_status = 'Rekondisi'), 0) AS rekondisi_returns,
        COALESCE(SUM(current_status = 'Write_Off'), 0) AS write_off_returns,
        COALESCE(SUM(current_status = 'Supplier_Return'), 0) AS supplier_returns
      FROM return_items
      ${returnWhere}
    `, returnParams);

    // 1b. Item-level disposition stats (Refurbish, Rekondisi, Supplier Return, Write Off) using master_barang.harga_jual
    const [[dispositionStats]] = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN ri.disposition = 'refurbish' THEN ri.quantity ELSE 0 END), 0) AS refurbish_qty,
        COALESCE(SUM(CASE WHEN ri.disposition = 'refurbish' THEN ri.quantity * COALESCE(mb.harga_jual, 0) ELSE 0 END), 0) AS refurbish_val,
        COALESCE(SUM(CASE WHEN ri.disposition = 'rekondisi' THEN ri.quantity ELSE 0 END), 0) AS rekondisi_qty,
        COALESCE(SUM(CASE WHEN ri.disposition = 'rekondisi' THEN ri.quantity * COALESCE(mb.harga_jual, 0) ELSE 0 END), 0) AS rekondisi_val,
        COALESCE(SUM(CASE WHEN ri.disposition = 'return_to_supplier' THEN ri.quantity ELSE 0 END), 0) AS supplier_qty,
        COALESCE(SUM(CASE WHEN ri.disposition = 'return_to_supplier' THEN ri.quantity * COALESCE(mb.harga_jual, 0) ELSE 0 END), 0) AS supplier_val,
        COALESCE(SUM(CASE WHEN ri.disposition = 'write_off' THEN ri.quantity ELSE 0 END), 0) AS write_off_qty,
        COALESCE(SUM(CASE WHEN ri.disposition = 'write_off' THEN ri.quantity * COALESCE(mb.harga_jual, 0) ELSE 0 END), 0) AS write_off_val
      FROM return_items ri
      JOIN returns r ON ri.return_id = r.return_id
      LEFT JOIN master_barang mb ON ri.item_code = mb.kode_barang COLLATE utf8mb4_general_ci
      ${rWhere}
    `, rParams);

    // 2. Recent Returns
    const [recentReturns] = await db.query(`
      SELECT r.*, u.full_name AS pic_name
      FROM returns r
      LEFT JOIN users u ON r.pic_user_id = u.user_id
      ${rWhere}
      ORDER BY r.created_at DESC LIMIT 10
    `, rParams);

    // 3. Status Data
    const [statusData] = await db.query(`
      SELECT current_status, COUNT(*) AS count
      FROM returns
      ${returnWhere}
      GROUP BY current_status
    `, returnParams);

    // 4. Aging Data
    const { NORMAL, WARNING, CRITICAL } = config.AGING;
    const [[aging]] = await db.query(`
      SELECT
        COALESCE(SUM(DATEDIFF(NOW(), return_date) < ${NORMAL}), 0)                              AS normal,
        COALESCE(SUM(DATEDIFF(NOW(), return_date) BETWEEN ${NORMAL} AND ${WARNING - 1}), 0)    AS warning,
        COALESCE(SUM(DATEDIFF(NOW(), return_date) BETWEEN ${WARNING} AND ${CRITICAL - 1}), 0)  AS critical,
        COALESCE(SUM(DATEDIFF(NOW(), return_date) >= ${CRITICAL}), 0)                           AS overdue
      FROM returns
      WHERE current_status NOT IN ('Completed','Rejected')
      ${returnWhereAnd}
    `, returnParams);

    // SLA alerts (returns near or past SLA deadline grouped by SKU)
    const slaAlerts = await slaService.getSLAAlertsBySKU();

    // Role-specific quick stats
    const role = req.session.userRole;
    let roleStats = {};

    if (role === 'admin_sorting') {
      const [[s]] = await db.query(`
        SELECT COUNT(*) AS count FROM returns
        WHERE current_status IN ('Inbound','Sorting')
        ${returnWhereAnd}
      `, returnParams);
      roleStats.sortingQueue = s.count;
    }
    if (role === 'admin_retur') {
      const [[s]] = await db.query(`
        SELECT COUNT(*) AS count FROM returns
        WHERE current_status = 'Inbound'
        ${returnWhereAnd}
      `, returnParams);
      roleStats.inboundQueue = s.count;
    }
    if (role === 'staff_recover') {
      const [[s]] = await db.query(`
        SELECT COUNT(*) AS count FROM returns
        WHERE current_status IN ('Rekondisi','Refurbish','Write_Off','Pricing','Recovery')
        ${returnWhereAnd}
      `, returnParams);
      roleStats.recoveryQueue = s.count;
    }
    if (['purchasing', 'manager'].includes(role)) {
      const [[s]] = await db.query(
        "SELECT COUNT(*) AS count FROM price_submissions WHERE status='pending'"
      );
      roleStats.pendingPricing = s.count;
    }

    // Inbound & Outbound Movement Stats
    const [[movementStats]] = await db.query(`
      SELECT
        COUNT(*) AS total_inbound,
        COALESCE(SUM(inbound_date IS NOT NULL), 0) AS confirmed_inbound,
        COALESCE(SUM(current_status = 'Inbound'), 0) AS pending_inbound,
        COALESCE(SUM(current_status IN ('Completed', 'Rejected', 'Supplier_Return')), 0) AS total_outbound,
        COALESCE(SUM(current_status = 'Completed'), 0) AS outbound_completed,
        COALESCE(SUM(current_status = 'Supplier_Return'), 0) AS outbound_supplier_return,
        COALESCE(SUM(current_status = 'Rejected'), 0) AS outbound_rejected,
        COALESCE(SUM(CASE WHEN current_status IN ('Completed', 'Rejected', 'Supplier_Return') THEN total_value ELSE 0 END), 0) AS outbound_value
      FROM returns
      ${returnWhere}
    `, returnParams);

    // Outbound Team Performance Leaderboard
    const [outboundPerformance] = await db.query(`
      SELECT
        u.full_name AS staff_name,
        u.role AS staff_role,
        COUNT(DISTINCT h.return_id) AS total_finalized,
        COUNT(DISTINCT CASE WHEN h.to_status = 'Completed' THEN h.return_id END) AS completed_count,
        COUNT(DISTINCT CASE WHEN h.to_status = 'Supplier_Return' THEN h.return_id END) AS supplier_return_count,
        COUNT(DISTINCT CASE WHEN h.to_status = 'Rejected' THEN h.return_id END) AS rejected_count
      FROM return_status_history h
      JOIN users u ON h.changed_by = u.user_id
      ${historyWhere}
      GROUP BY h.changed_by, u.full_name, u.role
      ORDER BY total_finalized DESC
    `, historyParams);

    // Dynamic Monthly trends for Inbound vs Outbound chart (last 6 months or 12 months)
    let trendStartDate, trendEndDate;
    if (selectedYear) {
      if (selectedMonth) {
        // Show 6 months leading up to the selected month and year
        trendEndDate = new Date(selectedYear, selectedMonth, 0); // last day of selected month
        trendStartDate = new Date(selectedYear, selectedMonth - 6, 1); // 6 months prior, 1st day
      } else {
        // Show the whole selected year (12 months)
        trendStartDate = new Date(selectedYear, 0, 1);
        trendEndDate = new Date(selectedYear, 11, 31);
      }
    } else {
      // Default to last 6 months from now
      const now = new Date();
      trendEndDate = now;
      trendStartDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    }

    const formatSQLDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${r}`;
    };
    const startStr = formatSQLDate(trendStartDate);
    const endStr = formatSQLDate(trendEndDate);

    const [inboundTrend] = await db.query(`
      SELECT DATE_FORMAT(return_date, '%Y-%m') AS month, COUNT(*) AS count
      FROM returns
      WHERE return_date BETWEEN ? AND ?
      GROUP BY month ORDER BY month ASC
    `, [startStr, endStr]);

    const [outboundTrend] = await db.query(`
      SELECT DATE_FORMAT(COALESCE(completed_date, updated_at), '%Y-%m') AS month, COUNT(*) AS count
      FROM returns
      WHERE current_status IN ('Completed', 'Rejected', 'Supplier_Return')
        AND (
          (completed_date BETWEEN ? AND ?) OR
          (completed_date IS NULL AND updated_at BETWEEN ? AND ?)
        )
      GROUP BY month ORDER BY month ASC
    `, [startStr, endStr, startStr, endStr]);

    // --- Berita Acara (BA) stats ---
    // 1. BA general totals
    const [[baTotals]] = await db.query(`
      SELECT
        COUNT(*) AS total_ba,
        COALESCE(SUM(status = 'draft'), 0) AS draft_count,
        COALESCE(SUM(status = 'pending_sign'), 0) AS pending_sign_count,
        COALESCE(SUM(status = 'signed'), 0) AS signed_count,
        COALESCE(SUM(status = 'void'), 0) AS void_count,
        COALESCE(SUM(CASE WHEN status != 'void' THEN final_price ELSE 0 END), 0) AS total_ba_value
      FROM berita_acara ba
      ${baWhere}
    `, baParams);

    // 2. Aggregated item stats from Berita Acara
    const [baItemStats] = await db.query(`
      SELECT 
        CASE 
          WHEN s.category IS NOT NULL THEN s.category
          WHEN ba.ba_type = 'retur_supplier' THEN 'return_to_supplier'
          ELSE ba.ba_type
        END AS item_status,
        ri.item_code AS sku,
        ri.item_name,
        COALESCE(ri.return_category, ri.condition_received, 'good') AS kondisi,
        SUM(ri.quantity) AS total_qty
      FROM berita_acara ba
      LEFT JOIN inventory_stock s ON s.ba_id = ba.ba_id
      JOIN return_items ri ON (
        (s.stock_id IS NOT NULL AND s.item_id = ri.item_id) OR
        (s.stock_id IS NULL AND ba.return_id = ri.return_id AND (
          (ba.ba_type = 'write_off' AND ri.disposition = 'write_off') OR
          (ba.ba_type IN ('refurbish', 'rekondisi') AND ri.disposition IN ('refurbish', 'rekondisi')) OR
          (ba.ba_type = 'retur_supplier' AND ri.disposition = 'return_to_supplier' AND (ba.vendor_id IS NULL OR ri.vendor_id = ba.vendor_id)) OR
          (ba.ba_type NOT IN ('write_off', 'refurbish', 'rekondisi', 'retur_supplier'))
        ))
      )
      WHERE ba.status != 'void'
      ${baWhereAnd}
      GROUP BY 
        CASE 
          WHEN s.category IS NOT NULL THEN s.category
          WHEN ba.ba_type = 'retur_supplier' THEN 'return_to_supplier'
          ELSE ba.ba_type
        END,
        ri.item_code,
        ri.item_name,
        COALESCE(ri.return_category, ri.condition_received, 'good')
      ORDER BY total_qty DESC
    `, baParams);

    // Group by status for summary
    const summaryMap = {
      rekondisi: 0,
      refurbish: 0,
      write_off: 0,
      return_to_supplier: 0
    };

    baItemStats.forEach(row => {
      const status = row.item_status;
      if (summaryMap[status] !== undefined) {
        summaryMap[status] += parseInt(row.total_qty) || 0;
      }
    });

    const totalPcs = Object.values(summaryMap).reduce((a, b) => a + b, 0);
    const baSummary = Object.keys(summaryMap).map(status => {
      const qty = summaryMap[status];
      const pct = totalPcs ? ((qty / totalPcs) * 100).toFixed(1) : '0.0';
      return { status, qty, pct };
    });

    // Helper to extract top 10 and top 3
    const filterAndSlice = (status) => {
      const items = baItemStats
        .filter(row => row.item_status === status)
        .map(row => ({
          sku: row.sku,
          item_name: row.item_name,
          kondisi: row.kondisi,
          qty: parseInt(row.total_qty) || 0
        }));

      return {
        top10: items.slice(0, 10),
        top3: items.slice(0, 3)
      };
    };

    const rekondisiData = filterAndSlice('rekondisi');
    const refurbishData = filterAndSlice('refurbish');
    const writeOffData = filterAndSlice('write_off');
    const supplierLokalData = filterAndSlice('return_to_supplier');

    // --- Query Paket Terkirim ---
    let paketWhereClauses = ['is_show = 1'];
    let paketParams = [];
    if (selectedYear) {
      paketWhereClauses.push('tahun = ?');
      paketParams.push(selectedYear);
    }
    if (selectedMonth) {
      paketWhereClauses.push('bulan = ?');
      paketParams.push(selectedMonth);
    }
    const paketWhere = 'WHERE ' + paketWhereClauses.join(' AND ');

    const [[paketResult]] = await db.query(`
      SELECT COALESCE(SUM(total_terkirim), 0) AS total_sent
      FROM paket_terkirim
      ${paketWhere}
    `, paketParams);

    const totalSentPackages = paketResult ? paketResult.total_sent : 0;
    const totalReturnsInPeriod = totals ? totals.total_returns : 0;
    const returnPercentage = totalSentPackages > 0 ? (totalReturnsInPeriod / totalSentPackages) * 100 : 0;

    let periodName = 'Semua Periode';
    if (selectedYear) {
      if (selectedMonth) {
        const monthObj = monthsList.find(m => m.value === selectedMonth);
        periodName = `${monthObj ? monthObj.name : ''} ${selectedYear}`;
      } else {
        periodName = `Tahun ${selectedYear}`;
      }
    } else if (selectedMonth) {
      const monthObj = monthsList.find(m => m.value === selectedMonth);
      periodName = `${monthObj ? monthObj.name : ''}`;
    }

    const lang = req.session.lang === 'en' ? 'en-US' : 'id-ID';

    res.render('dashboard/index', {
      title: 'Dashboard',
      stats: totals,
      recentReturns,
      statusData,
      aging,
      slaAlerts,
      roleStats,
      movementStats,
      outboundPerformance,
      inboundTrend,
      outboundTrend,
      baTotals,
      baSummary,
      rekondisiData,
      refurbishData,
      writeOffData,
      supplierLokalData,
      dispositionStats,
      monthsList,
      availableYears,
      selectedMonth,
      selectedYear,
      totalSentPackages,
      totalReturnsInPeriod,
      returnPercentage,
      periodName,
      formatNumberId: (num) => (num || 0).toLocaleString(lang),
      formatPercentageId: (num) => (num || 0).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%',
    });
  } catch (err) {
    next(err);
  }
};
