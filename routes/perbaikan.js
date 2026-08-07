'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/perbaikanController');
const { requireLogin, requireRole } = require('../middleware/auth');

const canPerbaiki = requireRole(['admin', 'manager', 'admin_sorting', 'admin_retur']);

router.get('/',                  canPerbaiki, ctrl.perbaikanQueue);
router.post('/bulk',             canPerbaiki, ctrl.bulkUpdatePerbaikanStatus);
router.post('/:itemId',          canPerbaiki, ctrl.updatePerbaikanStatus);

module.exports = router;
