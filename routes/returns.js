'use strict';
const router = require('express').Router();
const path   = require('path');
const multer = require('multer');
const ctrl   = require('../controllers/returnsController');
const { requireLogin, requireRole } = require('../middleware/auth');

const canEdit    = requireRole(['admin', 'manager', 'admin_retur']);
const canInspect = requireRole(['admin', 'manager', 'admin_sorting', 'admin_retur', 'staff_recover']);

// ─── Multer for item photo uploads ───────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/returns/'),
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, suffix + path.extname(file.originalname).toLowerCase());
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|gif|webp)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, png, gif, webp) are allowed.'));
    }
  }
});

// ─── Multer for Excel manifest uploads ─────────────────────────────────────────
const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'manifest-' + Date.now() + ext);
  }
});
const uploadExcel = multer({
  storage: excelStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || 
        file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed.'));
    }
  }
});

// List & queues
router.get('/',            requireLogin,  ctrl.list);
router.get('/pending',     requireLogin,  ctrl.pending);
// router.get('/inspection',  canInspect,    ctrl.inspection);

// Create & Upload Manifests
router.get('/manifests',           requireLogin,  ctrl.manifestsList);
router.post('/manifests/create',   requireLogin,  ctrl.createManifest);
router.post('/manifests/upload',   requireLogin,  uploadExcel.single('manifest_file'), ctrl.handleUpload);
router.get('/manifests/template',  requireLogin,  ctrl.downloadTemplate);
router.get('/manifests/export',    requireLogin,  ctrl.exportManifests);
router.post('/manifests/delete-all-pending', requireLogin, ctrl.deleteAllPendingManifests);
router.get('/manifests/:id/items', requireLogin,  ctrl.getManifestItems);
const canCheckManifestItem = requireRole(['admin', 'manager', 'purchasing', 'sales', 'admin_retur', 'admin_sorting', 'staff_recover', 'warehouse', 'inspector']);
router.post('/manifests/items/:itemId/toggle-check', canCheckManifestItem, ctrl.toggleManifestItemCheck);
router.post('/manifests/:id/toggle-check', canCheckManifestItem, ctrl.toggleManifestCheck);
router.post('/manifests/:id/toggle-pic-check', canCheckManifestItem, ctrl.toggleManifestPicCheck);
router.post('/manifests/:id/update', requireLogin, ctrl.updateManifest);
router.post('/manifests/:id/delete', requireLogin, ctrl.deleteManifest);

// Banding MP Routes
router.post('/manifests/banding/create',      requireLogin, ctrl.createBandingMP);
router.post('/manifests/banding/:id/update',  requireLogin, ctrl.updateBandingMP);
router.post('/manifests/banding/:id/delete',  requireLogin, ctrl.deleteBandingMP);
router.post('/manifests/banding/:id/toggle-pic-check', canCheckManifestItem, ctrl.toggleBandingPicCheck);

// Redirect old upload path
router.get('/upload',              requireLogin,  (req, res) => res.redirect('/returns/manifests'));
router.post('/upload',             requireLogin,  uploadExcel.single('manifest_file'), ctrl.handleUpload);

router.get('/api/manifest-lookup', requireLogin,  ctrl.lookupManifest);

router.get('/create',      requireLogin,               ctrl.createForm);
router.post('/create',     requireLogin, upload.any(), ctrl.create);

router.get('/item/:id',    requireLogin,  ctrl.viewItem);
router.post('/item/:id/delete', canEdit, ctrl.deleteInboundItem);

// Single return (must come after named paths)
router.get('/:id',         requireLogin,  ctrl.view);
router.get('/:id/edit',    canEdit,               ctrl.editForm);
router.post('/:id/edit',   canEdit, upload.any(), ctrl.update);
router.post('/:id/status', requireLogin,  ctrl.updateStatus);
router.post('/:id/comment',requireLogin,  ctrl.addComment);
router.post('/:id/inspect',canInspect,    ctrl.updateItemInspection);

module.exports = router;
