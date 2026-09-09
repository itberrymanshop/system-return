'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/reportsController');
const { requireLogin } = require('../middleware/auth');

router.get('/summary',      requireLogin, ctrl.summary);
router.get('/aging',        requireLogin, ctrl.aging);
router.get('/value-impact', requireLogin, ctrl.valueImpact);
router.get('/analysis',     requireLogin, ctrl.analysis);

module.exports = router;
