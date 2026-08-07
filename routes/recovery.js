'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/recoveryController');
const { requireLogin, requireRole } = require('../middleware/auth');

const canRecover = requireRole(['admin', 'manager', 'staff_recover', 'admin_retur']);
const canFAT     = requireRole(['admin', 'manager', 'purchasing']);

router.get('/',                   canRecover, ctrl.queue);
router.get('/fat-approvals',      canFAT,     ctrl.pendingApprovals);
router.post('/fat-review',        canFAT,     ctrl.reviewPricing);
router.get('/item/:itemId',       canRecover, ctrl.viewItem);
router.get('/:id',                canRecover, ctrl.view);
router.post('/bulk-submit-pricing', canRecover, ctrl.bulkSubmitPricing);
router.post('/bulk-write-off',      canRecover, ctrl.bulkWriteOff);
router.post('/bulk-complete',       canRecover, ctrl.bulkComplete);
router.post('/:id/submit-pricing', canRecover, ctrl.submitPricing);
router.post('/:id/update-location', canRecover, ctrl.updateLocation);
router.post('/:id/record-sale',   canRecover, ctrl.recordSale);

module.exports = router;
