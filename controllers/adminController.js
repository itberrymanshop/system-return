'use strict';
const userService   = require('../services/userService');
const reportService = require('../services/reportService');
const db            = require('../config/database');

// ─── Users ────────────────────────────────────────────────────────────────────
exports.users = async (req, res, next) => {
  try {
    const users = await userService.getAllUsers();
    res.render('admin/users', { title: 'User Management', users });
  } catch (err) { next(err); }
};

exports.createUser = async (req, res, next) => {
  try {
    const { username, email, full_name, role, department, password, is_active } = req.body;
    await userService.createUser({
      username, email,
      fullName   : full_name,
      role, department,
      password,
      isActive   : is_active === '1'
    });
    await reportService.logActivity(
      req.session.userId, 'admin_create_user', `Created user: ${username}`,
      req.ip, req.headers['user-agent']
    );
    req.flash('success', 'User created successfully.');
  } catch (err) {
    req.flash('error', err.message || 'Failed to create user.');
  }
  res.redirect('/admin/users');
};

exports.updateUser = async (req, res, next) => {
  try {
    const { user_id, email, full_name, role, department, is_active } = req.body;
    await userService.updateUser(parseInt(user_id), {
      email,
      fullName : full_name,
      role, department,
      isActive : is_active === '1'
    });
    req.flash('success', 'User updated successfully.');
  } catch (err) {
    req.flash('error', err.message || 'Failed to update user.');
  }
  res.redirect('/admin/users');
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { user_id, new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters.');
      return res.redirect('/admin/users');
    }
    await userService.resetPassword(parseInt(user_id), new_password);
    req.flash('success', 'Password reset successfully.');
  } catch (err) {
    req.flash('error', 'Failed to reset password.');
  }
  res.redirect('/admin/users');
};

exports.deleteUser = async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.session.userId) {
      req.flash('error', 'You cannot delete your own account.');
      return res.redirect('/admin/users');
    }
    await userService.deleteUser(userId);
    req.flash('success', 'User deactivated successfully.');
  } catch (err) {
    req.flash('error', 'Failed to deactivate user.');
  }
  res.redirect('/admin/users');
};

// ─── Activity Logs ────────────────────────────────────────────────────────────
exports.logs = async (req, res, next) => {
  try {
    const logs  = await reportService.getActivityLogs(req.query);
    const users = await userService.getAllUsers();
    const [actionTypes] = await db.query(
      'SELECT DISTINCT action_type FROM activity_logs ORDER BY action_type'
    );
    res.render('admin/logs', {
      title: 'Activity Logs',
      logs,
      users,
      actionTypes,
      filters: req.query
    });
  } catch (err) { next(err); }
};
