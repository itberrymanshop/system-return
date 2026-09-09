'use strict';
const bcrypt = require('bcryptjs');
const userService = require('../services/userService');
const reportService = require('../services/reportService');

exports.showLogin = (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Login', layout: false });
};

exports.login = async (req, res, next) => {
  const { username, password } = req.body;

  if (!username || !password) {
    req.flash('error', 'Please enter username and password.');
    return res.redirect('/auth/login');
  }

  try {
    const user = await userService.findByUsername(username.trim());
    
    if (!user) {
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/auth/login');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/auth/login');
    }

    req.session.userId     = user.user_id;
    req.session.username   = user.username;
    req.session.fullName   = user.full_name;
    req.session.userRole   = user.role;
    req.session.department = user.department;

    await userService.touchLastLogin(user.user_id);
    await reportService.logActivity(
      user.user_id, 'login', 'User logged in',
      req.ip, req.headers['user-agent']
    );

    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.logout = async (req, res) => {
  const userId = req.session.userId;
  if (userId) {
    await reportService.logActivity(
      userId, 'logout', 'User logged out',
      req.ip, req.headers['user-agent']
    );
  }
  req.session.destroy(() => res.redirect('/auth/login'));
};
