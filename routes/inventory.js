'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/inventoryController');
const { requireLogin, requireRole } = require('../middleware/auth');

const canView  = requireRole(['admin', 'manager', 'admin_retur', 'staff_recover', 'admin_sorting', 'purchasing']);
const canManage = requireRole(['admin', 'manager', 'admin_retur', 'staff_recover', 'admin_sorting']);

router.get('/',                       canView, ctrl.index);
router.get('/sales-report',           canView, ctrl.salesReport);
router.get('/category/:category',     canView, ctrl.byCategory);
router.post('/change-category/:stockId', canManage, ctrl.changeCategory);
router.post('/bulk-change-category',     canManage, ctrl.bulkChangeCategory);

module.exports = router;

