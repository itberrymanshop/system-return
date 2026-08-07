'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/inventoryController');
const { requireLogin, requireRole } = require('../middleware/auth');

const canView  = requireRole(['admin', 'manager', 'admin_retur', 'staff_recover', 'admin_sorting', 'purchasing']);

router.get('/',                       canView, ctrl.index);
router.get('/sales-report',           canView, ctrl.salesReport);
router.get('/category/:category',     canView, ctrl.byCategory);

module.exports = router;
