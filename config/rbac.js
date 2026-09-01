'use strict';

/**
 * RBAC – menu keys, labels, and default role permissions.
 * Admin role always has access to every menu (enforced in rbacService).
 */

const MENUS = {
  dashboard        : { label: 'Dashboard',                 group: 'main' },
  returns          : { label: 'Returns',                   group: 'main' },
  returns_create   : { label: 'Returns → New Return',      group: 'returns' },
  returns_inbound  : { label: 'Returns → Inbound',         group: 'returns' },
  returns_inspect  : { label: 'Returns → Inspection Queue',group: 'returns' },
  sorting          : { label: 'Sorting',                   group: 'main' },
  perbaikan        : { label: 'Perbaikan',                 group: 'main' },
  perbaikan_proses : { label: 'Perbaikan → Proses Perbaikan', group: 'perbaikan' },
  recovery         : { label: 'Recovery',                  group: 'main' },
  recovery_fat     : { label: 'Laporan Penjualan → Write Off', group: 'recovery' },
  inventory        : { label: 'Inventory',                 group: 'main' },
  master_barang    : { label: 'Master Barang',              group: 'main' },
  master_expedisi  : { label: 'Master Expedisi',            group: 'main' },
  master_supplier  : { label: 'Master Supplier',            group: 'main' },
  ba               : { label: 'Berita Acara',              group: 'main' },
  paket_terkirim   : { label: 'Master Paket Terkirim',     group: 'main' },
  approvals        : { label: 'Approvals',                 group: 'main' },
  approvals_matrix : { label: 'Approvals → Matrix & Tree', group: 'approvals' },
  reports          : { label: 'Reports',                   group: 'main' },
  admin_panel      : { label: 'Admin Panel',               group: 'admin' },
  admin_rbac       : { label: 'Admin → RBAC / Hak Akses',  group: 'admin' },
};

const ROLES = [
  'admin',
  'manager',
  'admin_retur',
  'admin_sorting',
  'staff_recover',
  'purchasing',
  'sales',
];

/**
 * Default permissions used to seed the database.
 * Each key maps to an array of roles that are allowed.
 * Admin is always added by the service layer.
 */
const DEFAULT_PERMISSIONS = {
  dashboard        : ['admin','manager','admin_retur','admin_sorting','staff_recover','purchasing'],
  returns          : ['admin','manager','admin_retur','admin_sorting','staff_recover','purchasing'],
  returns_create   : ['admin','manager','admin_retur','admin_sorting','staff_recover','purchasing'],
  returns_inbound  : ['admin','manager','admin_retur','admin_sorting','staff_recover','purchasing'],
  returns_inspect  : ['admin','manager','admin_retur','admin_sorting','staff_recover','purchasing'],
  sorting          : ['admin','manager','admin_sorting','admin_retur'],
  perbaikan        : ['admin','manager','admin_sorting','admin_retur'],
  perbaikan_proses : ['admin','manager','admin_sorting','admin_retur'],
  recovery         : ['admin','manager','staff_recover','admin_retur','purchasing'],
  recovery_fat     : ['admin','manager','purchasing'],
  inventory        : ['admin','manager','admin_retur','staff_recover','admin_sorting','purchasing'],
  master_barang    : ['admin','manager','admin_retur','admin_sorting','staff_recover','purchasing'],
  master_expedisi  : ['admin','manager','admin_retur','admin_sorting','staff_recover','purchasing'],
  master_supplier  : ['admin','manager','admin_retur','admin_sorting','staff_recover','purchasing'],
  ba               : ['admin','manager','staff_recover','admin_retur','purchasing'],
  paket_terkirim   : ['admin','manager','admin_retur','admin_sorting','staff_recover','purchasing'],
  approvals        : ['admin','manager','purchasing','admin_retur','admin_sorting','staff_recover'],
  approvals_matrix : ['admin','manager'],
  reports          : ['admin','manager','admin_retur','admin_sorting','staff_recover','purchasing'],
  admin_panel      : ['admin'],
  admin_rbac       : ['admin'],
};

module.exports = { MENUS, ROLES, DEFAULT_PERMISSIONS };
