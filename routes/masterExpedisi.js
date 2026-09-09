'use strict';
const router = require('express').Router();
const multer = require('multer');
const ctrl   = require('../controllers/masterExpedisiController');
const { requireLogin, requireRole } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits : { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file CSV yang diperbolehkan.'));
    }
  }
});

const canView   = requireRole(['admin', 'manager', 'admin_retur', 'admin_sorting', 'staff_recover', 'purchasing']);
const canManage = requireRole(['admin', 'manager', 'admin_retur']);

router.get('/',            requireLogin, canView,   ctrl.index);
router.get('/create',      requireLogin, canManage, ctrl.createForm);
router.post('/',           requireLogin, canManage, ctrl.store);
router.get('/:id/edit',    requireLogin, canManage, ctrl.editForm);
router.put('/:id',         requireLogin, canManage, ctrl.update);
router.delete('/:id',      requireLogin, canManage, ctrl.destroy);
router.post('/upload-csv', requireLogin, canManage, upload.single('csv_file'), ctrl.uploadCSV);

module.exports = router;
