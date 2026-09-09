'use strict';
const bcrypt      = require('bcryptjs');
const userService = require('../services/userService');
const reportService = require('../services/reportService');

exports.show = async (req, res, next) => {
  try {
    const user = await userService.findById(req.session.userId);
    res.render('profile/index', { title: 'My Profile', profileUser: user });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const { email, full_name } = req.body;
    await userService.updateProfile(req.session.userId, {
      email,
      fullName: full_name
    });
    req.session.fullName = full_name;
    await reportService.logActivity(
      req.session.userId, 'profile_update', 'User updated their profile',
      req.ip, req.headers['user-agent']
    );
    req.flash('success', 'Profile updated successfully.');
    res.redirect('/profile');
  } catch (err) { next(err); }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;

    if (new_password !== confirm_password) {
      req.flash('error', 'New passwords do not match.');
      return res.redirect('/profile');
    }
    if (new_password.length < 6) {
      req.flash('error', 'New password must be at least 6 characters.');
      return res.redirect('/profile');
    }

    const user = await userService.findById(req.session.userId);
    const valid = await bcrypt.compare(current_password, user.password);

    if (!valid) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/profile');
    }

    await userService.resetPassword(req.session.userId, new_password);
    await reportService.logActivity(
      req.session.userId, 'password_change', 'User changed their password',
      req.ip, req.headers['user-agent']
    );
    req.flash('success', 'Password changed successfully.');
    res.redirect('/profile');
  } catch (err) { next(err); }
};
