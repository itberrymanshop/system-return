-- Return Management System Database Schema
-- Last Updated: 2026-03-10

CREATE DATABASE IF NOT EXISTS return_management_db;
USE return_management_db;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    role ENUM('admin', 'manager', 'inspector', 'warehouse', 'viewer') NOT NULL DEFAULT 'viewer',
    department VARCHAR(50),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Returns main table
CREATE TABLE IF NOT EXISTS returns (
    return_id INT AUTO_INCREMENT PRIMARY KEY,
    return_number VARCHAR(50) UNIQUE NOT NULL,
    return_date DATE NOT NULL,
    customer_name VARCHAR(100),
    customer_contact VARCHAR(50),
    source_type ENUM('customer', 'supplier', 'internal', 'warehouse') NOT NULL,
    return_reason TEXT,
    return_category ENUM('baik','kurang_part','packaging_rusak','pecah') DEFAULT NULL,
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    current_status VARCHAR(50) DEFAULT 'Pending',
    total_items INT DEFAULT 0,
    total_value DECIMAL(15, 2) DEFAULT 0.00,
    pic_user_id INT,
    inspector_user_id INT,
    approver_user_id INT,
    approved_date DATETIME,
    completed_date DATETIME,
    notes TEXT,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pic_user_id) REFERENCES users(user_id),
    FOREIGN KEY (inspector_user_id) REFERENCES users(user_id),
    FOREIGN KEY (approver_user_id) REFERENCES users(user_id),
    FOREIGN KEY (created_by) REFERENCES users(user_id),
    INDEX idx_return_number (return_number),
    INDEX idx_return_date (return_date),
    INDEX idx_current_status (current_status),
    INDEX idx_pic (pic_user_id),
    INDEX idx_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Return items table (per-item tracking)
CREATE TABLE IF NOT EXISTS return_items (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    return_id INT NOT NULL,
    item_code VARCHAR(100),
    item_name VARCHAR(200) NOT NULL,
    item_description TEXT,
    serial_number VARCHAR(100),
    batch_number VARCHAR(100),
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) DEFAULT 0.00,
    total_price DECIMAL(15, 2) DEFAULT 0.00,
    condition_received ENUM('good', 'damaged', 'defective', 'incomplete') DEFAULT 'good',
    return_category ENUM('baik','kurang_part','packaging_rusak','pecah') DEFAULT NULL,
    inspection_result ENUM('accept', 'reject', 'rework', 'pending') DEFAULT 'pending',
    inspection_notes TEXT,
    disposition ENUM('restock', 'repair', 'scrap', 'return_to_supplier', 'pending') DEFAULT 'pending',
    location VARCHAR(100),
    inspected_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (return_id) REFERENCES returns(return_id) ON DELETE CASCADE,
    INDEX idx_return_id (return_id),
    INDEX idx_item_code (item_code),
    INDEX idx_serial_number (serial_number),
    INDEX idx_inspection_result (inspection_result),
    INDEX idx_disposition (disposition)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Return status history
CREATE TABLE IF NOT EXISTS return_status_history (
    history_id INT AUTO_INCREMENT PRIMARY KEY,
    return_id INT NOT NULL,
    from_status VARCHAR(50),
    to_status VARCHAR(50) NOT NULL,
    changed_by INT NOT NULL,
    change_reason TEXT,
    comments TEXT,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (return_id) REFERENCES returns(return_id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(user_id),
    INDEX idx_return_id (return_id),
    INDEX idx_changed_at (changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Approval matrix
CREATE TABLE IF NOT EXISTS approval_matrix (
    approval_id INT AUTO_INCREMENT PRIMARY KEY,
    rule_name VARCHAR(100) NOT NULL,
    return_category VARCHAR(50),
    min_value DECIMAL(15, 2) DEFAULT 0.00,
    max_value DECIMAL(15, 2),
    priority VARCHAR(20),
    required_role VARCHAR(50) NOT NULL,
    approval_level INT DEFAULT 1,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (return_category),
    INDEX idx_role (required_role),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Decision tree rules
CREATE TABLE IF NOT EXISTS decision_tree (
    decision_id INT AUTO_INCREMENT PRIMARY KEY,
    rule_name VARCHAR(100) NOT NULL,
    condition_type VARCHAR(50) NOT NULL,
    condition_field VARCHAR(50) NOT NULL,
    condition_operator ENUM('=', '!=', '>', '<', '>=', '<=', 'IN', 'LIKE') NOT NULL,
    condition_value VARCHAR(255) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    action_value VARCHAR(255) NOT NULL,
    priority_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_condition_type (condition_type),
    INDEX idx_priority (priority_order),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Return attachments
CREATE TABLE IF NOT EXISTS return_attachments (
    attachment_id INT AUTO_INCREMENT PRIMARY KEY,
    return_id INT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type VARCHAR(50),
    file_size INT,
    uploaded_by INT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (return_id) REFERENCES returns(return_id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(user_id),
    INDEX idx_return_id (return_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Comments/notes table
CREATE TABLE IF NOT EXISTS return_comments (
    comment_id INT AUTO_INCREMENT PRIMARY KEY,
    return_id INT NOT NULL,
    user_id INT NOT NULL,
    comment_text TEXT NOT NULL,
    is_internal TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (return_id) REFERENCES returns(return_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    INDEX idx_return_id (return_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert default admin user (password: admin123)
INSERT INTO users (username, password, full_name, email, role, department) VALUES
('admin', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'System Administrator', 'admin@example.com', 'admin', 'IT'),
('manager1', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'John Manager', 'manager@example.com', 'manager', 'Operations'),
('inspector1', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Jane Inspector', 'inspector@example.com', 'inspector', 'Quality Control'),
('warehouse1', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Bob Warehouse', 'warehouse@example.com', 'warehouse', 'Warehouse');

-- Insert default approval matrix rules
INSERT INTO approval_matrix (rule_name, return_category, min_value, max_value, required_role, approval_level, is_active) VALUES
('Low Value General', NULL, 0, 1000, 'inspector', 1, 1),
('Medium Value General', NULL, 1000, 5000, 'manager', 2, 1),
('High Value General', NULL, 5000, NULL, 'admin', 3, 1),
('Damaged Items', 'damaged', 0, NULL, 'inspector', 1, 1),
('Defective Items', 'defective', 0, NULL, 'manager', 2, 1);

-- Insert sample decision tree rules
INSERT INTO decision_tree (rule_name, condition_type, condition_field, condition_operator, condition_value, action_type, action_value, priority_order, is_active, description) VALUES
('High Priority Urgent', 'priority_check', 'priority', '=', 'urgent', 'assign_pic', 'manager', 1, 1, 'Urgent returns assigned to manager immediately'),
('High Value Approval', 'value_check', 'total_value', '>', '5000', 'require_approval', 'admin', 2, 1, 'Returns over 5000 require admin approval'),
('Damaged to Inspector', 'category_check', 'return_category', '=', 'damaged', 'assign_inspector', 'inspector', 3, 1, 'Damaged items routed to inspector'),
('Expired Items Route', 'category_check', 'return_category', '=', 'expired', 'set_disposition', 'scrap', 4, 1, 'Expired items default to scrap disposition');
