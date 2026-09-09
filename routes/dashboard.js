'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/dashboardController');
const { requireLogin } = require('../middleware/auth');

router.get('/', requireLogin, ctrl.index);

module.exports = router;
