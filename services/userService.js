'use strict';
const db = require('../config/database');
const bcrypt = require('bcryptjs');

/**
 * Find a user by username (active users only).
 */
async function findByUsername(username) {
  const [rows] = await db.query(
    'SELECT * FROM users WHERE username = ? AND is_active = 1',
    [username]
  );
  return rows[0] || null;
}

/**
 * Find a user by ID.
 */
async function findById(id) {
  const [rows] = await db.query(
    'SELECT * FROM users WHERE user_id = ?',
    [id]
  );
  return rows[0] || null;
}

/**
 * Get all active users.
 */
async function getAllUsers() {
  const [rows] = await db.query(
    `SELECT user_id, username, full_name, email, role, department,
            is_active, created_at, last_login
     FROM users ORDER BY full_name ASC`
  );
  return rows;
}

/**
 * Create a new user.
 */
async function createUser({ username, email, fullName, role, department, password, isActive }) {
  // Ensure username is unique
  const [existing] = await db.query(
    'SELECT user_id FROM users WHERE username = ?', [username]
  );
  if (existing.length > 0) {
    throw new Error('Username already exists');
  }
  const hash = await bcrypt.hash(password, 12);
  const [result] = await db.query(
    `INSERT INTO users (username, email, full_name, role, department, password, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [username, email, fullName, role, department || null, hash, isActive ? 1 : 0]
  );
  return result.insertId;
}

/**
 * Update user details (no password change here).
 */
async function updateUser(userId, { email, fullName, role, department, isActive }) {
  await db.query(
    `UPDATE users SET email = ?, full_name = ?, role = ?, department = ?, is_active = ?
     WHERE user_id = ?`,
    [email, fullName, role, department || null, isActive ? 1 : 0, userId]
  );
}

/**
 * Reset (or change) a user's password.
 */
async function resetPassword(userId, newPassword) {
  const hash = await bcrypt.hash(newPassword, 12);
  await db.query(
    'UPDATE users SET password = ?, last_password_change = NOW() WHERE user_id = ?',
    [hash, userId]
  );
}

/**
 * Update a user's own profile (safe subset).
 */
async function updateProfile(userId, { email, fullName }) {
  await db.query(
    'UPDATE users SET email = ?, full_name = ? WHERE user_id = ?',
    [email, fullName, userId]
  );
}

/**
 * Soft-delete a user (mark as inactive).
 */
async function deleteUser(userId) {
  await db.query(
    'UPDATE users SET is_active = 0 WHERE user_id = ?',
    [userId]
  );
}

/**
 * Stamp last login time.
 */
async function touchLastLogin(userId) {
  await db.query(
    'UPDATE users SET last_login = NOW() WHERE user_id = ?',
    [userId]
  );
}

/**
 * Get active users by role.
 */
async function getUsersByRole(role) {
  const [rows] = await db.query(
    'SELECT user_id, full_name, email FROM users WHERE role = ? AND is_active = 1',
    [role]
  );
  return rows;
}

module.exports = {
  findByUsername,
  findById,
  getAllUsers,
  createUser,
  updateUser,
  resetPassword,
  updateProfile,
  deleteUser,
  touchLastLogin,
  getUsersByRole
};
