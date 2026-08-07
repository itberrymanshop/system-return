'use strict';

const db                                        = require('../config/database');
const { MENUS, ROLES, DEFAULT_PERMISSIONS }     = require('../config/rbac');

const CACHE_TTL = 60_000; // ms – re-read from DB at most once per minute

let _cache     = null;
let _cacheTime = 0;

// ─── Initialise table ─────────────────────────────────────────────────────────
async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      role       VARCHAR(50)  NOT NULL,
      menu_key   VARCHAR(50)  NOT NULL,
      is_allowed TINYINT(1)   NOT NULL DEFAULT 1,
      updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_role_menu (role, menu_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// ─── Seed default permissions on first run / updates ────────────────────────────
async function seedDefaults() {
  await ensureTable();

  const rows = [];
  for (const menuKey of Object.keys(MENUS)) {
    const allowed = DEFAULT_PERMISSIONS[menuKey] || [];
    for (const role of ROLES) {
      rows.push([role, menuKey, allowed.includes(role) ? 1 : 0]);
    }
  }
  if (rows.length === 0) return;

  await db.query(
    'INSERT IGNORE INTO role_permissions (role, menu_key, is_allowed) VALUES ?',
    [rows]
  );
}

// ─── Load permissions (with in-memory cache) ──────────────────────────────────
async function getPermissions() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  await ensureTable();

  // Seed if empty
  const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM role_permissions');
  if (cnt === 0) await seedDefaults();

  const [rows] = await db.query(
    'SELECT role, menu_key, is_allowed FROM role_permissions'
  );

  // Build map: menuKey → Set of allowed roles
  const perms = {};
  for (const key of Object.keys(MENUS)) {
    perms[key] = new Set(['admin']); // admin always has access to everything
  }
  for (const { role, menu_key, is_allowed } of rows) {
    if (is_allowed && perms[menu_key] !== undefined) {
      perms[menu_key].add(role);
    }
  }

  _cache     = perms;
  _cacheTime = now;
  return perms;
}

/**
 * Check whether a role can access a given menu key.
 * Admin always returns true.
 */
async function canRoleAccess(role, menuKey) {
  if (!role) return false;
  if (role === 'admin') return true;
  const perms = await getPermissions();
  return perms[menuKey] ? perms[menuKey].has(role) : false;
}

/**
 * Return the full matrix for the admin UI:
 * { menuKey: { role: boolean } }
 */
async function getPermissionMatrix() {
  await ensureTable();
  const [rows] = await db.query(
    'SELECT role, menu_key, is_allowed FROM role_permissions'
  );

  const matrix = {};
  for (const key of Object.keys(MENUS)) {
    matrix[key] = {};
    for (const role of ROLES) {
      matrix[key][role] = role === 'admin'; // admin always true
    }
  }
  for (const { role, menu_key, is_allowed } of rows) {
    if (matrix[menu_key] && ROLES.includes(role)) {
      matrix[menu_key][role] = role === 'admin' ? true : !!is_allowed;
    }
  }
  return matrix;
}

/**
 * Persist a full permission matrix update from the admin UI.
 * @param {Object} formData - flat object from req.body
 *   Keys have the form "perm_<menuKey>_<role>" with value "1" when checked.
 */
async function savePermissions(formData) {
  await ensureTable();

  const upserts = [];
  for (const menuKey of Object.keys(MENUS)) {
    for (const role of ROLES) {
      if (role === 'admin') continue; // admin is immutable
      const key       = `perm_${menuKey}_${role}`;
      const isAllowed = formData[key] === '1' ? 1 : 0;
      upserts.push([role, menuKey, isAllowed]);
    }
  }

  for (const [role, menuKey, isAllowed] of upserts) {
    await db.query(
      `INSERT INTO role_permissions (role, menu_key, is_allowed) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE is_allowed = VALUES(is_allowed)`,
      [role, menuKey, isAllowed]
    );
  }

  clearCache();
}

function clearCache() {
  _cache     = null;
  _cacheTime = 0;
}

module.exports = {
  ensureTable,
  seedDefaults,
  getPermissions,
  canRoleAccess,
  getPermissionMatrix,
  savePermissions,
  clearCache,
};
