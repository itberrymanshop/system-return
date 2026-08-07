'use strict';
const config      = require('../config/config');
const rbacService = require('../services/rbacService');
const dateHelper  = require('../utils/dateHelper');

/**
 * Adds session-based locals to every response.
 * Injects canAccess(menuKey) helper for use in EJS templates.
 */
async function setLocals(req, res, next) {
  try {
    res.locals.user = req.session.userId
      ? {
          id         : req.session.userId,
          username   : req.session.username,
          fullName   : req.session.fullName,
          role       : req.session.userRole,
          department : req.session.department
        }
      : null;

    res.locals.isLoggedIn = !!req.session.userId;

    // ── Helpers available inside every EJS view ──────────────────────────────
    res.locals.formatCurrency = (amount) => {
      const num = parseFloat(amount) || 0;
      return 'Rp\u00a0' + num.toLocaleString('id-ID', { minimumFractionDigits: 0 });
    };

    res.locals.formatDate = dateHelper.formatDate;

    res.locals.formatDateTime = dateHelper.formatDateTime;

    res.locals.formatDateInput = dateHelper.formatDateInput;

    res.locals.calculateAging = (returnDate) => {
      const ms = Date.now() - new Date(returnDate).getTime();
      return Math.floor(ms / 86400000);
    };

    res.locals.getAgingClass = (days) => {
      if (days >= config.AGING.CRITICAL) return 'danger';
      if (days >= config.AGING.WARNING)  return 'warning';
      if (days >= config.AGING.NORMAL)   return 'info';
      return 'success';
    };

    res.locals.getStatusBadge = (status) => {
      const map = {
        Inbound         : 'secondary',
        Sorting         : 'info',
        Rekondisi       : 'primary',
        Refurbish       : 'dark',
        Write_Off       : 'danger',
        Pricing         : 'info',
        Recovery        : 'success',
        Completed       : 'dark',
        Rejected        : 'danger',
        Supplier_Return : 'secondary',
        // legacy
        Pending         : 'secondary',
        Inspecting      : 'info',
        Approved        : 'success',
        Processing      : 'primary'
      };
      const cls   = map[status] || 'secondary';
      const label = status ? status.replace(/_/g, ' ') : status;
      return `<span class="badge bg-${cls}">${label}</span>`;
    };

    res.locals.getPriorityBadge = (priority) => {
      const map = { low: 'success', medium: 'warning', high: 'danger', urgent: 'dark' };
      const cls = map[priority] || 'secondary';
      return `<span class="badge bg-${cls} text-capitalize">${priority}</span>`;
    };

    res.locals.formatCategory = (category, defaultText = '-') => {
      if (!category) return defaultText;
      return category
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };

    res.locals.formatSourceType = (sourceType, defaultText = '-') => {
      if (!sourceType) return defaultText;
      const map = {
        retur_penjualan_mp: 'Retur Penjualan MP',
        retur_penjualan_grosir: 'Retur Penjualan Grosir',
        retur_internal_qc: 'Retur Internal (QC)',
        external_expedisi: 'Retur Penjualan MP',
        internal_grosir: 'Retur Penjualan Grosir',
        internal_mp: 'Retur Internal (QC)'
      };
      return map[sourceType] || sourceType
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };

    res.locals.hasRole = (roles) => {
      if (!req.session.userRole) return false;
      const allowed = Array.isArray(roles) ? roles : [roles];
      return allowed.includes(req.session.userRole);
    };

    // ── RBAC: canAccess(menuKey) – driven by role_permissions table ──────────
    const role        = req.session.userRole || null;
    const permissions = req.session.userId ? await rbacService.getPermissions() : {};

    res.locals.canAccess = (menuKey) => {
      if (!role) return false;
      if (role === 'admin') return true;
      return permissions[menuKey] ? permissions[menuKey].has(role) : false;
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Redirect to login if not authenticated.
 */
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/auth/login');
  }
  next();
}

/**
 * Returns middleware that checks the user's role.
 * @param {string|string[]} roles - Allowed role(s).
 */
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.session.userId) {
      req.flash('error', 'Please log in to continue.');
      return res.redirect('/auth/login');
    }
    const allowed = Array.isArray(roles) ? roles : [roles];
    if (!allowed.includes(req.session.userRole)) {
      req.flash('error', 'You do not have permission to access that page.');
      return res.redirect('/dashboard');
    }
    next();
  };
}

module.exports = { setLocals, requireLogin, requireRole };
