/**
 * DEPRECATED: File-based database (data/database.json & /tmp/ijro_database.json)
 * has been permanently removed and replaced with PostgreSQL.
 * 
 * All data access is now handled through server/postgres.js
 */
module.exports = require('./postgres');
