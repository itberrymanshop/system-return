'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/masterSupplierController');
const { requireLogin, requireRole } = require('../middleware/auth');

const canView   = requireRole(['admin', 'manager', 'admin_retur', 'admin_sorting', 'staff_recover', 'purchasing']);
const canManage = requireRole(['admin', 'manager', 'admin_retur']);

router.get('/',            requireLogin, canView,   ctrl.index);
router.post('/',           requireLogin, canManage, ctrl.store);
router.put('/:id',         requireLogin, canManage, ctrl.update);
router.delete('/:id',      requireLogin, canManage, ctrl.destroy);

module.exports = router;
