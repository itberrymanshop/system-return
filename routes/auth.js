'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/authController');

router.get('/login',  ctrl.showLogin);
router.post('/login', ctrl.login);
router.get('/logout', ctrl.logout);

module.exports = router;
