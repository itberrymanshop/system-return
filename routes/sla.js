'use strict';
const router = require('express').Router();
const slaController = require('../controllers/slaController');

// SLA Configurations CRUD
router.get('/', slaController.index);
router.get('/create', slaController.createForm);
router.post('/', slaController.create);
router.get('/:id/edit', slaController.editForm);
router.put('/:id', slaController.update);
router.delete('/:id', slaController.delete);

// SLA Reports & Monitoring
router.get('/report/breaches', slaController.breachesReport);
router.get('/report/summary', slaController.summaryReport);

module.exports = router;
