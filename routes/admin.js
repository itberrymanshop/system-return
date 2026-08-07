'use strict';
const router    = require('express').Router();
const ctrl      = require('../controllers/adminController');
const rbacCtrl  = require('../controllers/rbacController');
const { requireRole } = require('../middleware/auth');

const adminOnly = requireRole('admin');

// Users management
router.get('/users',                    adminOnly, ctrl.users);
router.post('/users/create',            adminOnly, ctrl.createUser);
router.post('/users/update',            adminOnly, ctrl.updateUser);
router.post('/users/reset-password',    adminOnly, ctrl.resetPassword);
router.post('/users/:id/delete',        adminOnly, ctrl.deleteUser);

// Activity logs
router.get('/logs',                     adminOnly, ctrl.logs);

// RBAC – role-based menu permissions
router.get('/rbac',                     adminOnly, rbacCtrl.index);
router.post('/rbac',                    adminOnly, rbacCtrl.save);

module.exports = router;
