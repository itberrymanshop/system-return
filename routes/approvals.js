'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/approvalsController');
const { requireRole } = require('../middleware/auth');

const canApprove = requireRole(['admin', 'manager', 'inspector']);
const adminOnly  = requireRole('admin');

// Pending approvals
router.get('/pending',              canApprove, ctrl.pending);
router.post('/:id/approve',         canApprove, ctrl.processApproval);

// Approval matrix
router.get('/matrix',               canApprove, ctrl.matrix);
router.post('/matrix/create',       adminOnly,  ctrl.createRule);
router.post('/matrix/:id/update',   adminOnly,  ctrl.updateRule);
router.post('/matrix/:id/delete',   adminOnly,  ctrl.deleteRule);

// Decision tree
router.get('/decision-tree',              canApprove, ctrl.decisionTree);
router.post('/decision-tree/create',      adminOnly,  ctrl.createDecisionRule);
router.post('/decision-tree/:id/update',  adminOnly,  ctrl.updateDecisionRule);
router.post('/decision-tree/:id/delete',  adminOnly,  ctrl.deleteDecisionRule);

module.exports = router;
