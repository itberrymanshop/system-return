'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/sortingController');
const { requireLogin, requireRole } = require('../middleware/auth');

const canSort = requireRole(['admin', 'manager', 'admin_sorting', 'admin_retur']);

router.get('/',                  canSort, ctrl.queue);
router.post('/bulk',             canSort, ctrl.bulkProcess);
router.get('/:id',               canSort, ctrl.process);
router.post('/:id/confirm-inbound', canSort, ctrl.confirmInbound);
router.post('/:id/items/:itemId/qc', canSort, ctrl.saveItemQC);
router.post('/:id/categorize',   canSort, ctrl.categorize);

module.exports = router;
