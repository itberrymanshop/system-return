'use strict';
const router = require('express').Router();
const ctrl = require('../controllers/baController');
const { requireLogin, requireRole } = require('../middleware/auth');

const canView = requireRole(['admin', 'manager', 'admin_retur', 'staff_recover', 'purchasing']);
const canCreate = requireRole(['admin', 'manager', 'staff_recover', 'admin_retur']);
const canAdmin = requireRole(['admin', 'manager']);

// Berita Acara – static routes first
router.get('/', canView, ctrl.list);
router.get('/create', canCreate, ctrl.createForm);
router.post('/create', canCreate, ctrl.create);
router.get('/export-all', canView, ctrl.exportAll);
router.get('/export-supplier-lokal', canView, ctrl.exportSupplierLokal);

// Vendor Management – must come before /:id to avoid "vendors" matching as an id
router.get('/vendors', canView, ctrl.vendorList);
router.post('/vendors/create', canCreate, ctrl.createVendor);
router.post('/vendors/:id/update', canCreate, ctrl.updateVendor);

// Dynamic BA routes
router.get('/:id/export-excel', canView,   ctrl.exportExcel);
router.get('/:id',           canView,   ctrl.view);
router.post('/:id/submit', canCreate, ctrl.submitForSigning);
router.get('/:id/sign', canView, ctrl.signForm);
router.post('/:id/sign', canView, ctrl.saveSign);
router.post('/:id/void', canAdmin, ctrl.void);
router.post('/:id/notes', canView, ctrl.addNote);
router.post('/:id/notes/:noteId/edit', canView, ctrl.editNote);
router.post('/:id/notes/:noteId/delete', canView, ctrl.deleteNote);

module.exports = router;
