'use strict';
const db = require('../config/database');

async function check() {
  try {
    const [rows] = await db.query('SELECT DISTINCT source_type FROM returns');
    console.log('Current source_type values in returns table:', rows);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

check();
