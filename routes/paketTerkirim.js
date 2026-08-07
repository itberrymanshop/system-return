'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/paketTerkirimController');
const { requireLogin, requireRole } = require('../middleware/auth');

const canView = requireRole(['admin', 'manager', 'admin_retur', 'admin_sorting', 'staff_recover', 'purchasing']);
const canManage = requireRole(['admin', 'manager', 'admin_retur']);

router.get('/', requireLogin, canView, ctrl.index);
router.get('/create', requireLogin, canManage, ctrl.createForm);
router.post('/', requireLogin, canManage, ctrl.store);
router.get('/:id/edit', requireLogin, canManage, ctrl.editForm);
router.put('/:id', requireLogin, canManage, ctrl.update);
router.delete('/:id', requireLogin, canManage, ctrl.destroy);

module.exports = router;
