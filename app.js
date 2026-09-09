'use strict';
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const morgan = require('morgan');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const config = require('./config/config');
const { setLocals } = require('./middleware/auth');
const i18n = require('./middleware/i18n');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// ─── View Engine ─────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// ─── Session ──────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'default-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// ─── Flash Messages ───────────────────────────────────────────────────────────
app.use(flash());

// ─── i18n Localization ────────────────────────────────────────────────────────
app.use(i18n);

// ─── Global View Locals ───────────────────────────────────────────────────────
app.use(setLocals);
app.use((req, res, next) => {
  res.locals.appName    = config.APP_NAME;
  res.locals.appVersion = config.APP_VERSION;
  res.locals.success    = req.flash('success');
  res.locals.error      = req.flash('error');
  res.locals.warning    = req.flash('warning');
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/returns', require('./routes/returns'));
app.use('/approvals', require('./routes/approvals'));
app.use('/reports', require('./routes/reports'));
app.use('/admin', require('./routes/admin'));
app.use('/sla', require('./routes/sla'));
app.use('/profile', require('./routes/profile'));
app.use('/sorting', require('./routes/sorting'));
app.use('/perbaikan', require('./routes/perbaikan'));
app.use('/recovery', require('./routes/recovery'));
app.use('/inventory', require('./routes/inventory'));
app.use('/master-barang', require('./routes/masterBarang'));
app.use('/master-expedisi', require('./routes/masterExpedisi'));
app.use('/master-supplier', require('./routes/masterSupplier'));
app.use('/ba', require('./routes/ba'));
app.use('/master-paket-terkirim', require('./routes/paketTerkirim'));

// ─── Suppress noisy browser/tooling probe requests ────────────────────────────
app.get('/.well-known/*', (req, res) => res.status(204).end());

// ─── Error Handlers ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
