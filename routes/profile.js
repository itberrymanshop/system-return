'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/profileController');
const { requireLogin } = require('../middleware/auth');

router.get('/',                  requireLogin, ctrl.show);
router.post('/update',           requireLogin, ctrl.update);
router.post('/change-password',  requireLogin, ctrl.changePassword);

module.exports = router;
