'use strict';
const XLSX = require('xlsx-js-style');
const inventoryService = require('../services/inventoryService');
const slaService      = require('../services/slaService');
const db               = require('../config/database');

// ─── Inventory Dashboard ──────────────────────────────────────────────────────
exports.index = async (req, res, next) => {
  try {
    const summary = await inventoryService.getInventorySummary();

    // Pivot summary into a usable structure
    const cats = ['rekondisi', 'refurbish', 'write_off', 'stok_utama', 'return_to_supplier'];
    const pivot = {};
    cats.forEach(c => { pivot[c] = { tersedia: 0, terjual: 0, diproses: 0, void: 0, total_value: 0 }; });
    summary.forEach(row => {
      if (pivot[row.category]) {
        pivot[row.category][row.status] = row.count;
        pivot[row.category].total_value += parseFloat(row.total_value) || 0;
      }
    });

    // Recent sales
    const recentSales = await inventoryService.getSalesReport(null, null);
    const recent = recentSales.slice(0, 20);

    res.render('inventory/index', { title: 'Manajemen Inventory', pivot, recentSales: recent });
  } catch (err) { next(err); }
};

// ─── Stock by Category ────────────────────────────────────────────────────────
exports.byCategory = async (req, res, next) => {
  try {
    const { category } = req.params;
    const validCats = ['rekondisi', 'refurbish', 'write_off', 'stok_utama', 'return_to_supplier'];
    if (!validCats.includes(category)) {
      req.flash('error', 'Kategori tidak valid.');
      return res.redirect('/inventory');
    }

    const items = await inventoryService.getInventoryByCategory(category);
    if (['rekondisi', 'refurbish'].includes(category)) {
      items.forEach(item => {
        item.slaInfo = slaService.getSLAStatus(item.sla_deadline);
      });
    }

    const catTitles = {
      rekondisi: 'Stok Rekondisi',
      refurbish: 'Stok Refurbish',
      write_off: 'Stok Write Off',
      stok_utama: 'Stok Utama',
      return_to_supplier: 'Stok Supplier Lokal'
    };
    const title = catTitles[category] || `Stok ${category.replace('_', ' ')}`;
    res.render('inventory/category', { title, category, items });
  } catch (err) { next(err); }
};

// ─── Export Supplier Lokal Stock ──────────────────────────────────────────────
exports.exportSupplierLokal = async (req, res, next) => {
  try {
    const rows = await inventoryService.getSupplierLokalExport(req.query.search || '');
    const data = [
      ['No', 'No Resi', 'Nama Barang', 'SKU', 'Kondisi', 'Qty', 'Status', 'Tanggal Input', 'Vendor']
    ];
    rows.forEach((row, index) => {
      data.push([
        index + 1,
        row.resi_number || '-',
        row.item_name || '-',
        row.sku || row.item_code || '-',
        row.return_category || '-',
        Number(row.quantity) || 0,
        row.status || '-',
        row.entry_date ? new Date(row.entry_date).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-',
        row.vendor_name || '-'
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
      { wch: 6 }, { wch: 18 }, { wch: 35 }, { wch: 16 }, { wch: 14 },
      { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 24 }
    ];
    data[0].forEach((_, col) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: col })];
      if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '0B2240' } } };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stok Supplier Lokal');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    res.setHeader('Content-Disposition', `attachment; filename=Stok_Supplier_Lokal_${timestamp}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) { next(err); }
};

exports.exportWriteOff = async (req, res, next) => {
  try {
    const rows = await inventoryService.getWriteOffExport(req.query.search || '');
    const data = [['No', 'No Resi', 'Nama Barang', 'SKU', 'Kondisi', 'Qty', 'Ikut', 'Status', 'Tanggal Input']];
    rows.forEach((row, index) => data.push([
      index + 1,
      row.resi_number || '-',
      row.item_name || '-',
      row.sku || row.item_code || '-',
      row.return_category || '-',
      Number(row.quantity) || 0,
      row.ikut || '-',
      row.status || '-',
      row.entry_date ? new Date(row.entry_date).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-'
    ]));

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
      { wch: 6 }, { wch: 18 }, { wch: 35 }, { wch: 16 }, { wch: 14 },
      { wch: 8 }, { wch: 20 }, { wch: 16 }, { wch: 16 }
    ];
    data[0].forEach((_, col) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: col })];
      if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '0B2240' } } };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stok Write Off');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename=Stok_Write_Off_${Date.now()}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) { next(err); }
};

// ─── Sales / Closing Report ───────────────────────────────────────────────────
exports.salesReport = async (req, res, next) => {
  try {
    const { date_from, date_to } = req.query;
    const sales = await inventoryService.getSalesReport(date_from, date_to);

    const totalRevenue = sales.reduce((s, r) => s + (parseFloat(r.sale_price) || 0), 0);

    res.render('inventory/sales-report', {
      title       : 'Laporan Penjualan & Closing',
      sales,
      totalRevenue,
      filters     : req.query
    });
  } catch (err) { next(err); }
};

// ─── Cancel Supplier Lokal Stock ─────────────────────────────────────────────
exports.cancelSupplierStock = async (req, res, next) => {
  try {
    const { stockId } = req.params;
    const reason = String(req.body.reason || '').trim();
    const redirectUrl = req.get('Referrer') || '/inventory/category/return_to_supplier';
    if (!reason) {
      req.flash('error', 'Alasan pembatalan wajib diisi.');
      return res.redirect(redirectUrl);
    }

    const cancelled = await inventoryService.cancelSupplierStock(
      stockId, reason, req.session.userId, req.ip, req.headers['user-agent']
    );
    req.flash(cancelled ? 'success' : 'error', cancelled
      ? 'Stok dibatalkan dan dikembalikan ke antrian sorting.'
      : 'Stok tidak ditemukan atau sudah diproses.');
    return res.redirect(redirectUrl);
  } catch (err) { next(err); }
};

// ─── Bulk Cancel Supplier Lokal Stock ─────────────────────────────────────────
exports.cancelSupplierStockBulk = async (req, res, next) => {
  try {
    const reason = String(req.body.reason || '').trim();
    const stockIds = String(req.body.stock_ids || '').split(',').filter(Boolean);
    if (!reason || !stockIds.length) {
      req.flash('error', 'Pilih item dan isi alasan pembatalan.');
      return res.redirect('/inventory/category/return_to_supplier');
    }
    const count = await inventoryService.cancelSupplierStockBulk(
      stockIds, reason, req.session.userId, req.ip, req.headers['user-agent']
    );
    req.flash(count ? 'success' : 'error', count
      ? `${count} stok dibatalkan dan dikembalikan ke antrian sorting.`
      : 'Tidak ada stok tersedia yang dapat dibatalkan.');
    return res.redirect('/inventory/category/return_to_supplier');
  } catch (err) { next(err); }
};

// ─── Change Stock Category (e.g. Rekondisi -> Refurbish / Write Off) ─────────
exports.changeCategory = async (req, res, next) => {
  try {
    const { stockId } = req.params;
    const { target_category } = req.body;
    const userId = req.session.userId;
    const redirectUrl = req.get('Referrer') || '/inventory';

    const validTargets = ['rekondisi', 'refurbish', 'write_off'];
    if (!validTargets.includes(target_category)) {
      req.flash('error', 'Kategori tujuan tidak valid.');
      return res.redirect(redirectUrl);
    }

    const updated = await inventoryService.changeStockCategory(stockId, target_category, userId, req.ip, req.headers['user-agent']);
    if (!updated) {
      req.flash('error', 'Item stok tidak ditemukan atau tidak dapat diubah.');
      return res.redirect(redirectUrl);
    }

    const catLabels = { rekondisi: 'Rekondisi', refurbish: 'Refurbish', write_off: 'Write Off' };
    req.flash('success', `Status stok berhasil diubah menjadi ${catLabels[target_category]}.`);
    return res.redirect(redirectUrl);
  } catch (err) {
    next(err);
  }
};

// ─── Bulk Change Stock Category ─────────────────────────────────────────────
exports.bulkChangeCategory = async (req, res, next) => {
  try {
    let { stock_ids, target_category } = req.body;
    const userId = req.session.userId;
    const redirectUrl = req.get('Referrer') || '/inventory';

    const validTargets = ['rekondisi', 'refurbish', 'write_off'];
    if (!validTargets.includes(target_category)) {
      req.flash('error', 'Kategori tujuan tidak valid.');
      return res.redirect(redirectUrl);
    }

    if (!stock_ids) {
      req.flash('error', 'Pilih minimal satu item stok.');
      return res.redirect(redirectUrl);
    }

    if (typeof stock_ids === 'string') {
      stock_ids = stock_ids.split(',').map(s => s.trim()).filter(Boolean);
    }

    if (!Array.isArray(stock_ids) || stock_ids.length === 0) {
      req.flash('error', 'Pilih minimal satu item stok.');
      return res.redirect(redirectUrl);
    }

    const count = await inventoryService.bulkChangeStockCategory(stock_ids, target_category, userId, req.ip, req.headers['user-agent']);
    const catLabels = { rekondisi: 'Rekondisi', refurbish: 'Refurbish', write_off: 'Write Off' };
    req.flash('success', `Berhasil mengubah ${count} item stok menjadi ${catLabels[target_category]}.`);
    return res.redirect(redirectUrl);
  } catch (err) {
    next(err);
  }
};


