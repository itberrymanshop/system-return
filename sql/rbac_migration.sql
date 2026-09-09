-- RBAC: Role-Based Access Control – Menu Permissions
-- Run this migration once against return_management_db

CREATE TABLE IF NOT EXISTS role_permissions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  role       VARCHAR(50)  NOT NULL,
  menu_key   VARCHAR(50)  NOT NULL,
  is_allowed TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_menu (role, menu_key),
  INDEX idx_role    (role),
  INDEX idx_menu    (menu_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC – per-role menu access flags';

-- Default permissions (admin always has all access – enforced at app level)
INSERT IGNORE INTO role_permissions (role, menu_key, is_allowed) VALUES
  -- dashboard
  ('admin','dashboard',1),('manager','dashboard',1),('admin_retur','dashboard',1),
  ('admin_sorting','dashboard',1),('staff_recover','dashboard',1),('purchasing','dashboard',1),
  -- returns
  ('admin','returns',1),('manager','returns',1),('admin_retur','returns',1),
  ('admin_sorting','returns',1),('staff_recover','returns',1),('purchasing','returns',1),
  -- returns_create
  ('admin','returns_create',1),('manager','returns_create',1),('admin_retur','returns_create',1),
  ('admin_sorting','returns_create',1),('staff_recover','returns_create',1),('purchasing','returns_create',1),
  -- returns_inbound
  ('admin','returns_inbound',1),('manager','returns_inbound',1),('admin_retur','returns_inbound',1),
  ('admin_sorting','returns_inbound',1),('staff_recover','returns_inbound',1),('purchasing','returns_inbound',1),
  -- returns_inspect
  ('admin','returns_inspect',1),('manager','returns_inspect',1),('admin_retur','returns_inspect',1),
  ('admin_sorting','returns_inspect',1),('staff_recover','returns_inspect',1),('purchasing','returns_inspect',1),
  -- sorting
  ('admin','sorting',1),('manager','sorting',1),('admin_retur','sorting',1),
  ('admin_sorting','sorting',1),('staff_recover','sorting',0),('purchasing','sorting',0),
  -- recovery
  ('admin','recovery',1),('manager','recovery',1),('admin_retur','recovery',1),
  ('admin_sorting','recovery',0),('staff_recover','recovery',1),('purchasing','recovery',1),
  -- recovery_fat
  ('admin','recovery_fat',1),('manager','recovery_fat',1),('admin_retur','recovery_fat',0),
  ('admin_sorting','recovery_fat',0),('staff_recover','recovery_fat',0),('purchasing','recovery_fat',1),
  -- inventory
  ('admin','inventory',1),('manager','inventory',1),('admin_retur','inventory',1),
  ('admin_sorting','inventory',1),('staff_recover','inventory',1),('purchasing','inventory',1),
  -- ba
  ('admin','ba',1),('manager','ba',1),('admin_retur','ba',1),
  ('admin_sorting','ba',0),('staff_recover','ba',1),('purchasing','ba',1),
  -- approvals
  ('admin','approvals',1),('manager','approvals',1),('admin_retur','approvals',1),
  ('admin_sorting','approvals',1),('staff_recover','approvals',1),('purchasing','approvals',1),
  -- approvals_matrix
  ('admin','approvals_matrix',1),('manager','approvals_matrix',1),('admin_retur','approvals_matrix',0),
  ('admin_sorting','approvals_matrix',0),('staff_recover','approvals_matrix',0),('purchasing','approvals_matrix',0),
  -- reports
  ('admin','reports',1),('manager','reports',1),('admin_retur','reports',1),
  ('admin_sorting','reports',1),('staff_recover','reports',1),('purchasing','reports',1),
  -- admin_panel
  ('admin','admin_panel',1),('manager','admin_panel',0),('admin_retur','admin_panel',0),
  ('admin_sorting','admin_panel',0),('staff_recover','admin_panel',0),('purchasing','admin_panel',0),
  -- admin_rbac
  ('admin','admin_rbac',1),('manager','admin_rbac',0),('admin_retur','admin_rbac',0),
  ('admin_sorting','admin_rbac',0),('staff_recover','admin_rbac',0),('purchasing','admin_rbac',0);
