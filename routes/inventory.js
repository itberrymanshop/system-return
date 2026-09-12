'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/inventoryController');
const { requireLogin, requireRole } = require('../middleware/auth');

const canView  = requireRole(['admin', 'manager', 'admin_retur', 'staff_recover', 'admin_sorting', 'purchasing']);
const canManage = requireRole(['admin', 'manager', 'admin_retur', 'staff_recover', 'admin_sorting']);

router.get('/',                       canView, ctrl.index);
router.get('/sales-report',           canView, ctrl.salesReport);
  router.get('/category/return_to_supplier/export', canView, ctrl.exportSupplierLokal);
  router.get('/category/write_off/export', canView, ctrl.exportWriteOff);
  router.get('/category/:category',     canView, ctrl.byCategory);

router.post('/cancel-supplier/:stockId', canManage, ctrl.cancelSupplierStock);
router.post('/cancel-supplier-bulk', canManage, ctrl.cancelSupplierStockBulk);
router.post('/change-category/:stockId', canManage, ctrl.changeCategory);
router.post('/bulk-change-category',     canManage, ctrl.bulkChangeCategory);

module.exports = router;

