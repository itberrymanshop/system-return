'use strict';
const db        = require('../config/database');
const baService = require('../services/baService');
const reportService = require('../services/reportService');

// ─── Index ────────────────────────────────────────────────────────────────────
exports.index = async (req, res, next) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM vendors WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (vendor_name LIKE ? OR contact_person LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY vendor_name ASC';

    const [rows] = await db.query(sql, params);

    res.render('master-supplier/index', {
      title  : 'Master Supplier',
      items  : rows,
      filters: req.query
    });
  } catch (err) { next(err); }
};

// ─── Store ────────────────────────────────────────────────────────────────────
exports.store = async (req, res, next) => {
  try {
    const { vendor_name } = req.body;
    if (!vendor_name || !vendor_name.trim()) {
      req.flash('error', 'Nama supplier wajib diisi.');
      return res.redirect('/master-supplier');
    }

    await baService.createVendor(req.body, req.session.userId);

    await reportService.logActivity(req.session.userId, 'create_supplier',
      `Tambah supplier "${vendor_name.trim()}"`, req.ip, req.headers['user-agent']);

    req.flash('success', `Supplier "${vendor_name.trim()}" berhasil ditambahkan.`);
    res.redirect('/master-supplier');
  } catch (err) { next(err); }
};

// ─── Update ───────────────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { vendor_name } = req.body;
    if (!vendor_name || !vendor_name.trim()) {
      req.flash('error', 'Nama supplier wajib diisi.');
      return res.redirect('/master-supplier');
    }

    await baService.updateVendor(parseInt(req.params.id), req.body);

    await reportService.logActivity(req.session.userId, 'update_supplier',
      `Update supplier #${req.params.id}`, req.ip, req.headers['user-agent']);

    req.flash('success', `Supplier "${vendor_name.trim()}" berhasil diperbarui.`);
    res.redirect('/master-supplier');
  } catch (err) { next(err); }
};

// ─── Delete ───────────────────────────────────────────────────────────────────
exports.destroy = async (req, res, next) => {
  try {
    // Attempt deletion
    await db.query('DELETE FROM vendors WHERE vendor_id = ?', [req.params.id]);

    await reportService.logActivity(req.session.userId, 'delete_supplier',
      `Hapus supplier #${req.params.id}`, req.ip, req.headers['user-agent']);

    req.flash('success', 'Supplier berhasil dihapus.');
    res.redirect('/master-supplier');
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      req.flash('error', 'Supplier tidak dapat dihapus karena sudah terhubung dengan data lain (misal, inventory/BA). Silakan nonaktifkan status supplier saja.');
      res.redirect('/master-supplier');
    } else {
      next(err);
    }
  }
};
