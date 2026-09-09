'use strict';
const router = require('express').Router();
const multer = require('multer');
const ctrl   = require('../controllers/masterBarangController');
const { requireLogin, requireRole } = require('../middleware/auth');

// XLSX upload stored in memory (no disk file needed)
const upload = multer({
  storage : multer.memoryStorage(),
  limits  : { fileSize: 5 * 1024 * 1024 },   // 5 MB max
  fileFilter(req, file, cb) {
    const isExcel = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.mimetype === 'application/vnd.ms-excel' ||
                    file.originalname.endsWith('.xlsx') ||
                    file.originalname.endsWith('.xls');
    if (isExcel) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file Excel (.xlsx, .xls) yang diperbolehkan.'));
    }
  }
});

const canView   = requireRole(['admin', 'manager', 'admin_retur', 'admin_sorting', 'staff_recover', 'purchasing']);
const canManage = requireRole(['admin', 'manager', 'admin_retur']);

router.get('/api/search',    requireLogin,             ctrl.apiSearch);
router.get('/',              requireLogin, canView,   ctrl.index);
router.get('/export-xlsx',   requireLogin, canView,   ctrl.exportXLSX);
router.get('/create',        requireLogin, canManage, ctrl.createForm);
router.post('/',             requireLogin, canManage, ctrl.store);
router.get('/:id/edit',      requireLogin, canManage, ctrl.editForm);
router.put('/:id',           requireLogin, canManage, ctrl.update);
router.delete('/:id',        requireLogin, canManage, ctrl.destroy);
router.post('/upload-xlsx',  requireLogin, canManage, upload.single('xlsx_file'), ctrl.uploadXLSX);
router.get('/upload-progress/:taskId', requireLogin, canManage, ctrl.getUploadProgress);

module.exports = router;
