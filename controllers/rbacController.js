'use strict';

const rbacService   = require('../services/rbacService');
const reportService = require('../services/reportService');
const { MENUS, ROLES } = require('../config/rbac');

// ─── Show RBAC permission matrix ─────────────────────────────────────────────
exports.index = async (req, res, next) => {
  try {
    const matrix = await rbacService.getPermissionMatrix();
    res.render('admin/rbac', {
      title  : 'RBAC – Hak Akses Menu',
      matrix,
      MENUS,
      ROLES,
    });
  } catch (err) { next(err); }
};

// ─── Save updated permission matrix ──────────────────────────────────────────
exports.save = async (req, res, next) => {
  try {
    await rbacService.savePermissions(req.body);
    await reportService.logActivity(
      req.session.userId,
      'rbac_update',
      'Updated RBAC menu permissions',
      req.ip,
      req.headers['user-agent']
    );
    req.flash('success', 'Hak akses menu berhasil disimpan.');
  } catch (err) {
    req.flash('error', err.message || 'Gagal menyimpan hak akses.');
  }
  res.redirect('/admin/rbac');
};
