'use strict';
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
