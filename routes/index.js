'use strict';
const router = require('express').Router();

// Redirect root to dashboard or login
router.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

// Route to switch language
router.get('/change-lang/:lang', (req, res) => {
  const lang = req.params.lang;
  if (['id', 'en'].includes(lang)) {
    req.session.lang = lang;
  }
  const backURL = req.header('Referer') || '/dashboard';
  res.redirect(backURL);
});

module.exports = router;
