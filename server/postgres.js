require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { parseDateComponents, normalizeDateStr, calculateDelayDays } = require('./utils/date');
const { determineTaskStatus, computeTaskStatus } = require('./utils/status');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('========================================================================');
  console.error('[CRITICAL DATABASE CONFIGURATION ERROR]');
  console.error('DATABASE_URL environment variable is missing.');
  console.error('The application requires a real PostgreSQL database (e.g. Supabase).');
  console.error('Production data will NEVER fall back to local JSON or sample files.');
  console.error('Please configure DATABASE_URL in your environment or .env file.');
  console.error('========================================================================');
}

// Configure PostgreSQL connection pool
let pool = null;
if (DATABASE_URL) {
  const isLocal = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1');
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on('error', (err) => {
    console.error('[PostgreSQL Pool Error]:', err.message);
  });
}

/**
 * Asserts database connection is properly configured.
 * Throws a clean, safe error if DATABASE_URL is missing.
 */
function assertDatabaseConfigured() {
  if (!pool || !DATABASE_URL) {
    const error = new Error('Ma’lumotlar bazasi ulanishi sozlanmagan. Iltimos, DATABASE_URL parametrini tekshiring.');
    error.status = 500;
    error.isDbConfigError = true;
    throw error;
  }
}

/**
 * Execute a SQL query on the pool
 */
async function query(text, params = []) {
  assertDatabaseConfigured();
  return pool.query(text, params);
}

/**
 * Execute work inside an isolated database transaction
 */
async function withTransaction(callback) {
  assertDatabaseConfigured();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      console.error('[PostgreSQL Rollback Error]:', rbErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Automatically initializes database schema if tables do not exist yet.
 */
let schemaInitPromise = null;
async function ensureSchema() {
  if (!pool) return;
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    try {
      // 1. Users
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(64) PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          full_name VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'viewer' NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // 2. Departments
      await pool.query(`
        CREATE TABLE IF NOT EXISTS departments (
          id VARCHAR(64) PRIMARY KEY,
          leader_id INTEGER UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          head_name VARCHAR(255) NOT NULL,
          head_title VARCHAR(255) DEFAULT 'Mas’ul rahbar',
          photo TEXT DEFAULT '',
          status VARCHAR(50) DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_departments_leader_id ON departments(leader_id);
      `);

      // 3. Tasks
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id VARCHAR(64) PRIMARY KEY,
          task_number VARCHAR(100),
          leader_id INTEGER,
          doc_number_and_date TEXT,
          doc_type VARCHAR(100),
          task_type VARCHAR(100),
          title TEXT NOT NULL,
          department_id VARCHAR(64) REFERENCES departments(id) ON DELETE SET NULL,
          department_name VARCHAR(255),
          responsible_person VARCHAR(255),
          deadline DATE,
          status VARCHAR(50) NOT NULL,
          completed_date TIMESTAMPTZ,
          delay_days INTEGER DEFAULT 0,
          notes TEXT DEFAULT '',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_department_id ON tasks(department_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
        CREATE INDEX IF NOT EXISTS idx_tasks_leader_id ON tasks(leader_id);
      `);

      // 4. Settings
      await pool.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key VARCHAR(100) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // 5. Imports
      await pool.query(`
        CREATE TABLE IF NOT EXISTS imports (
          id VARCHAR(64) PRIMARY KEY,
          filename VARCHAR(255) NOT NULL,
          imported_at TIMESTAMPTZ DEFAULT NOW(),
          imported_by VARCHAR(100),
          row_count INTEGER DEFAULT 0,
          status VARCHAR(50) DEFAULT 'success',
          version INTEGER DEFAULT 1,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_imports_version ON imports(version DESC);
      `);

      // Seed default settings if empty
      const settingsRes = await pool.query(`SELECT value FROM settings WHERE key = 'app_settings'`);
      if (settingsRes.rows.length === 0) {
        const defaultSettings = {
          orgName: "«ISSIQLIK ELEKTR STANSIYALARI» AJ",
          subOrgName: "Monitoring axborot tizimi",
          systemTitle: "Ijro intizomi monitoring tizimi",
          logoUrl: "/images/ies_logo.svg",
          lastUpdated: new Date().toISOString()
        };
        await pool.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ('app_settings', $1, NOW())`,
          [JSON.stringify(defaultSettings)]
        );
      }

      // Seed default admin user if empty
      const usersRes = await pool.query(`SELECT id FROM users LIMIT 1`);
      if (usersRes.rows.length === 0) {
        const salt = bcrypt.genSaltSync(10);
        const adminHash = bcrypt.hashSync('admin123', salt);
        const viewerHash = bcrypt.hashSync('viewer123', salt);

        await pool.query(`
          INSERT INTO users (id, username, password_hash, full_name, role) VALUES
          ($1, 'admin', $2, 'Bosh Administrator', 'admin'),
          ($3, 'viewer', $4, 'Kuzatuvchi Operator', 'viewer')
        `, [crypto.randomUUID(), adminHash, crypto.randomUUID(), viewerHash]);
      }

      console.log('[PostgreSQL] Database schema verified successfully.');
    } catch (err) {
      console.error('[PostgreSQL Schema Init Error]:', err.message);
      throw err;
    }
  })();

  return schemaInitPromise;
}

// Auto-run schema check if pool exists
if (pool) {
  ensureSchema().catch((err) => {
    console.error('[PostgreSQL Init Failed]:', err.message);
  });
}

// ==============================================================
// DATA ACCESS & BUSINESS LOGIC METHODS
// ==============================================================

/**
 * Recalculates and synchronizes overdue/in_progress status for all tasks in database.
 * Pure business logic:
 * - If completed -> completed
 * - Else if deadline < today's date -> overdue
 * - Else -> in_progress
 */
async function syncDatabaseTasksStatus() {
  await ensureSchema();
  const today = normalizeDateStr(new Date());

  // Set overdue: deadline strictly in the past and status is not completed
  await query(`
    UPDATE tasks
    SET status = 'overdue',
        delay_days = GREATEST(1, CURRENT_DATE - deadline),
        updated_at = NOW()
    WHERE status != 'completed'
      AND deadline IS NOT NULL
      AND deadline < CURRENT_DATE
      AND (status != 'overdue' OR delay_days != GREATEST(1, CURRENT_DATE - deadline));
  `);

  // Set in_progress: deadline is today or in future, but had been incorrectly marked overdue
  await query(`
    UPDATE tasks
    SET status = 'in_progress',
        delay_days = 0,
        updated_at = NOW()
    WHERE status = 'overdue'
      AND deadline IS NOT NULL
      AND deadline >= CURRENT_DATE;
  `);
}

/**
 * Returns overall dashboard summary statistics from the persistent database
 */
async function getStats() {
  await ensureSchema();
  await syncDatabaseTasksStatus();

  const countsRes = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue,
      COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress
    FROM tasks;
  `);

  const settingsRes = await query(`SELECT value FROM settings WHERE key = 'app_settings'`);
  const settings = settingsRes.rows[0] ? settingsRes.rows[0].value : {};

  const row = countsRes.rows[0] || { total: 0, completed: 0, overdue: 0, in_progress: 0 };

  return {
    totalTasks: row.total,
    completedTasks: row.completed,
    overdueTasks: row.overdue,
    inProgressTasks: row.in_progress,
    lastUpdated: settings.lastUpdated || new Date().toISOString()
  };
}

/**
 * Returns department statistics for the dashboard cards and carousel
 */
async function getDepartmentOverdueStats(page = 1, pageSize = 3, onlyOverdue = true) {
  await ensureSchema();
  await syncDatabaseTasksStatus();

  // Aggregate stats per department directly in PostgreSQL
  const deptsRes = await query(`
    SELECT
      d.id,
      d.leader_id AS "leaderId",
      d.name,
      d.head_name AS "headName",
      d.head_title AS "headTitle",
      d.photo,
      d.status,
      d.updated_at AS "updatedAt",
      COUNT(t.id)::int AS "totalTasks",
      COUNT(t.id) FILTER (WHERE t.status = 'overdue')::int AS "overdueCount",
      COUNT(t.id) FILTER (WHERE t.status = 'in_progress')::int AS "inProgressCount",
      COUNT(t.id) FILTER (WHERE t.status = 'completed')::int AS "completedCount"
    FROM departments d
    LEFT JOIN tasks t ON t.department_id = d.id
    GROUP BY d.id, d.leader_id, d.name, d.head_name, d.head_title, d.photo, d.status, d.updated_at
    ORDER BY "overdueCount" DESC, d.leader_id ASC, d.name ASC;
  `);

  let items = deptsRes.rows;
  if (onlyOverdue) {
    items = items.filter(d => d.overdueCount > 0);
  }

  const total = items.length;
  const limit = Math.max(1, parseInt(pageSize) || 3);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(Math.max(1, parseInt(page) || 1), totalPages);

  const startIndex = (currentPage - 1) * limit;
  const paginatedItems = items.slice(startIndex, startIndex + limit);

  return {
    items: paginatedItems,
    allItems: items, // All items for seamless client-side carousel rotation
    total,
    page: currentPage,
    pageSize: limit,
    totalPages
  };
}

/**
 * Get system settings
 */
async function getSettings() {
  await ensureSchema();
  const res = await query(`SELECT value FROM settings WHERE key = 'app_settings'`);
  if (res.rows.length > 0) {
    return res.rows[0].value;
  }
  return {
    orgName: "«ISSIQLIK ELEKTR STANSIYALARI» AJ",
    subOrgName: "Monitoring axborot tizimi",
    systemTitle: "Ijro intizomi monitoring tizimi",
    logoUrl: "/images/ies_logo.svg",
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Update system settings
 */
async function updateSettings(newSettings) {
  await ensureSchema();
  const current = await getSettings();
  const merged = { ...current, ...newSettings, lastUpdated: new Date().toISOString() };

  await query(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('app_settings', $1, NOW())
    ON CONFLICT (key) DO UPDATE
    SET value = $1, updated_at = NOW()
  `, [JSON.stringify(merged)]);

  return merged;
}

/**
 * Query tasks with filters, search and pagination
 */
async function getTasks({ status, departmentId, search, page = 1, pageSize = 20 }) {
  await ensureSchema();
  await syncDatabaseTasksStatus();

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (status && status !== 'all') {
    conditions.push(`t.status = $${paramIdx++}`);
    params.push(status);
  }

  if (departmentId && departmentId !== 'all') {
    conditions.push(`t.department_id = $${paramIdx++}`);
    params.push(departmentId);
  }

  if (search && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`;
    conditions.push(`(
      LOWER(t.task_number) LIKE $${paramIdx} OR
      LOWER(t.title) LIKE $${paramIdx} OR
      LOWER(t.doc_number_and_date) LIKE $${paramIdx} OR
      LOWER(t.responsible_person) LIKE $${paramIdx} OR
      LOWER(t.department_name) LIKE $${paramIdx} OR
      LOWER(t.doc_type) LIKE $${paramIdx} OR
      LOWER(t.task_type) LIKE $${paramIdx}
    )`);
    params.push(q);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countRes = await query(`SELECT COUNT(*)::int AS total FROM tasks t ${whereClause}`, params);
  const total = countRes.rows[0].total;

  const p = Math.max(1, parseInt(page) || 1);
  const limit = Math.max(1, parseInt(pageSize) || 20);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const offset = (p - 1) * limit;

  // Order: overdue first by delay days desc, then deadline asc
  const listQuery = `
    SELECT
      t.id,
      t.task_number AS "taskNumber",
      t.leader_id AS "leaderId",
      t.doc_number_and_date AS "docNumberAndDate",
      t.doc_type AS "docType",
      t.task_type AS "taskType",
      t.title,
      t.department_id AS "departmentId",
      t.department_name AS "departmentName",
      t.responsible_person AS "responsiblePerson",
      TO_CHAR(t.deadline, 'YYYY-MM-DD') AS deadline,
      t.status,
      t.status AS "computedStatus",
      t.completed_date AS "completedDate",
      t.delay_days AS "delayDays",
      t.notes,
      t.created_at AS "createdAt",
      t.updated_at AS "updatedAt"
    FROM tasks t
    ${whereClause}
    ORDER BY
      CASE WHEN t.status = 'overdue' THEN 1 WHEN t.status = 'in_progress' THEN 2 ELSE 3 END ASC,
      t.delay_days DESC,
      t.deadline ASC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++};
  `;

  params.push(limit, offset);
  const listRes = await query(listQuery, params);

  return {
    items: listRes.rows,
    total,
    page: p,
    pageSize: limit,
    totalPages
  };
}

/**
 * Get single task by ID
 */
async function getTaskById(id) {
  await ensureSchema();
  const res = await query(`
    SELECT
      t.id,
      t.task_number AS "taskNumber",
      t.leader_id AS "leaderId",
      t.doc_number_and_date AS "docNumberAndDate",
      t.doc_type AS "docType",
      t.task_type AS "taskType",
      t.title,
      t.department_id AS "departmentId",
      t.department_name AS "departmentName",
      t.responsible_person AS "responsiblePerson",
      TO_CHAR(t.deadline, 'YYYY-MM-DD') AS deadline,
      t.status,
      t.status AS "computedStatus",
      t.completed_date AS "completedDate",
      t.delay_days AS "delayDays",
      t.notes,
      t.created_at AS "createdAt",
      t.updated_at AS "updatedAt"
    FROM tasks t
    WHERE t.id = $1
  `, [id]);

  return res.rows[0] || null;
}

/**
 * Create a new task manually in admin panel
 */
async function createTask(data) {
  await ensureSchema();
  const id = crypto.randomUUID();
  const deadlineStr = normalizeDateStr(data.deadline);
  const status = determineTaskStatus(data.status, deadlineStr, data.completedDate);
  const delayDays = status === 'overdue' ? calculateDelayDays(deadlineStr) : 0;

  const res = await query(`
    INSERT INTO tasks (
      id, task_number, leader_id, doc_number_and_date, doc_type, task_type,
      title, department_id, department_name, responsible_person,
      deadline, status, completed_date, delay_days, notes, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14, $15, NOW(), NOW()
    ) RETURNING *;
  `, [
    id,
    data.taskNumber || '',
    data.leaderId || null,
    data.docNumberAndDate || data.taskNumber || '',
    data.docType || 'Hujjat',
    data.taskType || 'Ijro topshirig‘i',
    data.title.trim(),
    data.departmentId || null,
    data.departmentName || '',
    data.responsiblePerson || '',
    deadlineStr,
    status,
    status === 'completed' ? (data.completedDate || new Date().toISOString()) : null,
    delayDays,
    data.notes || ''
  ]);

  await updateSettings({ lastUpdated: new Date().toISOString() });
  return res.rows[0];
}

/**
 * Update an existing task
 */
async function updateTask(id, data) {
  await ensureSchema();
  const current = await getTaskById(id);
  if (!current) return null;

  const deadlineStr = data.deadline !== undefined ? normalizeDateStr(data.deadline) : current.deadline;
  const status = data.status !== undefined
    ? determineTaskStatus(data.status, deadlineStr, data.completedDate)
    : determineTaskStatus(current.status, deadlineStr, current.completedDate);
  const delayDays = status === 'overdue' ? calculateDelayDays(deadlineStr) : 0;

  const res = await query(`
    UPDATE tasks SET
      task_number = COALESCE($2, task_number),
      doc_number_and_date = COALESCE($3, doc_number_and_date),
      doc_type = COALESCE($4, doc_type),
      task_type = COALESCE($5, task_type),
      title = COALESCE($6, title),
      department_id = COALESCE($7, department_id),
      department_name = COALESCE($8, department_name),
      responsible_person = COALESCE($9, responsible_person),
      deadline = $10,
      status = $11,
      completed_date = $12,
      delay_days = $13,
      notes = COALESCE($14, notes),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `, [
    id,
    data.taskNumber,
    data.docNumberAndDate,
    data.docType,
    data.taskType,
    data.title ? data.title.trim() : null,
    data.departmentId,
    data.departmentName,
    data.responsiblePerson,
    deadlineStr,
    status,
    status === 'completed' ? (data.completedDate || new Date().toISOString()) : null,
    delayDays,
    data.notes
  ]);

  await updateSettings({ lastUpdated: new Date().toISOString() });
  return res.rows[0];
}

/**
 * Delete a single task
 */
async function deleteTask(id) {
  await ensureSchema();
  const res = await query(`DELETE FROM tasks WHERE id = $1 RETURNING id;`, [id]);
  if (res.rows.length > 0) {
    await updateSettings({ lastUpdated: new Date().toISOString() });
    return true;
  }
  return false;
}

/**
 * Delete all tasks completely
 */
async function clearAllTasks() {
  await ensureSchema();
  const res = await query(`DELETE FROM tasks RETURNING id;`);
  await updateSettings({ lastUpdated: new Date().toISOString() });
  return res.rows.length;
}

/**
 * Returns all departments
 */
async function getDepartments() {
  await ensureSchema();
  await syncDatabaseTasksStatus();

  const res = await query(`
    SELECT
      d.id,
      d.leader_id AS "leaderId",
      d.name,
      d.head_name AS "headName",
      d.head_title AS "headTitle",
      d.photo,
      d.status,
      d.created_at AS "createdAt",
      d.updated_at AS "updatedAt",
      COUNT(t.id)::int AS "totalTasks",
      COUNT(t.id) FILTER (WHERE t.status = 'overdue')::int AS "overdueCount"
    FROM departments d
    LEFT JOIN tasks t ON t.department_id = d.id
    GROUP BY d.id, d.leader_id, d.name, d.head_name, d.head_title, d.photo, d.status, d.created_at, d.updated_at
    ORDER BY "overdueCount" DESC, d.leader_id ASC;
  `);

  return res.rows;
}

/**
 * Get next sequential leader ID
 */
async function getNextLeaderId() {
  await ensureSchema();
  const res = await query(`SELECT COALESCE(MAX(leader_id), 100) + 1 AS next_id FROM departments;`);
  return res.rows[0].next_id;
}

/**
 * Create a new department
 */
async function createDepartment(data) {
  await ensureSchema();
  const id = crypto.randomUUID();
  let leaderId = parseInt(data.leaderId, 10);
  if (isNaN(leaderId) || leaderId <= 0) {
    leaderId = await getNextLeaderId();
  }

  const res = await query(`
    INSERT INTO departments (
      id, leader_id, name, head_name, head_title, photo, status, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    RETURNING
      id, leader_id AS "leaderId", name, head_name AS "headName",
      head_title AS "headTitle", photo, status, created_at AS "createdAt", updated_at AS "updatedAt";
  `, [
    id,
    leaderId,
    data.name.trim(),
    data.headName.trim(),
    (data.headTitle || 'Mas’ul rahbar').trim(),
    data.photo || '',
    data.status || 'active'
  ]);

  return res.rows[0];
}

/**
 * Update an existing department
 */
async function updateDepartment(id, data) {
  await ensureSchema();
  const current = await query(`SELECT * FROM departments WHERE id = $1`, [id]);
  if (current.rows.length === 0) return null;
  const dept = current.rows[0];

  let leaderId = dept.leader_id;
  if (data.leaderId !== undefined && String(data.leaderId).trim() !== '') {
    const parsed = parseInt(data.leaderId, 10);
    if (!isNaN(parsed) && parsed > 0) leaderId = parsed;
  }

  const name = data.name !== undefined ? data.name.trim() : dept.name;
  const headName = data.headName !== undefined ? data.headName.trim() : dept.head_name;
  const headTitle = data.headTitle !== undefined ? data.headTitle.trim() : dept.head_title;
  const photo = data.photo !== undefined ? data.photo : dept.photo;
  const status = data.status !== undefined ? data.status : dept.status;

  const res = await query(`
    UPDATE departments SET
      leader_id = $2,
      name = $3,
      head_name = $4,
      head_title = $5,
      photo = $6,
      status = $7,
      updated_at = NOW()
    WHERE id = $1
    RETURNING
      id, leader_id AS "leaderId", name, head_name AS "headName",
      head_title AS "headTitle", photo, status, created_at AS "createdAt", updated_at AS "updatedAt";
  `, [id, leaderId, name, headName, headTitle, photo, status]);

  // Synchronize department name and head name into linked tasks
  await query(`
    UPDATE tasks SET
      department_name = $2,
      responsible_person = $3,
      leader_id = $4,
      updated_at = NOW()
    WHERE department_id = $1
  `, [id, name, headName, leaderId]);

  return res.rows[0];
}

/**
 * Delete a department
 */
async function deleteDepartment(id) {
  await ensureSchema();
  const tasksCheck = await query(`SELECT COUNT(*)::int AS count FROM tasks WHERE department_id = $1`, [id]);
  if (tasksCheck.rows[0].count > 0) {
    const err = new Error('Ushbu boshqarmaga biriktirilgan topshiriqlar mavjud. Avval ularni boshqa boshqarmaga ko‘chiring yoki o‘chiring.');
    err.status = 400;
    throw err;
  }

  const res = await query(`DELETE FROM departments WHERE id = $1 RETURNING *;`, [id]);
  return res.rows.length > 0 ? res.rows[0] : null;
}

/**
 * Users management
 */
async function getUsers() {
  await ensureSchema();
  const res = await query(`
    SELECT id, username, full_name AS "fullName", role, created_at AS "createdAt"
    FROM users
    ORDER BY created_at ASC;
  `);
  return res.rows;
}

async function getUserByUsername(username) {
  await ensureSchema();
  const res = await query(`
    SELECT id, username, password_hash AS "passwordHash", full_name AS "fullName", role, created_at AS "createdAt"
    FROM users
    WHERE LOWER(username) = LOWER($1);
  `, [username.trim()]);
  return res.rows[0] || null;
}

async function createUser(data) {
  await ensureSchema();
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(data.password, salt);
  const id = crypto.randomUUID();

  const res = await query(`
    INSERT INTO users (id, username, password_hash, full_name, role, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    RETURNING id, username, full_name AS "fullName", role, created_at AS "createdAt";
  `, [id, data.username.trim().toLowerCase(), hash, data.fullName.trim(), data.role || 'viewer']);

  return res.rows[0];
}

async function updateUser(id, data) {
  await ensureSchema();
  const updates = [];
  const params = [id];
  let pIdx = 2;

  if (data.username) {
    updates.push(`username = $${pIdx++}`);
    params.push(data.username.trim().toLowerCase());
  }
  if (data.fullName) {
    updates.push(`full_name = $${pIdx++}`);
    params.push(data.fullName.trim());
  }
  if (data.role) {
    updates.push(`role = $${pIdx++}`);
    params.push(data.role);
  }
  if (data.password && data.password.trim()) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(data.password.trim(), salt);
    updates.push(`password_hash = $${pIdx++}`);
    params.push(hash);
  }

  if (updates.length === 0) return null;

  updates.push(`updated_at = NOW()`);
  const res = await query(`
    UPDATE users SET ${updates.join(', ')}
    WHERE id = $1
    RETURNING id, username, full_name AS "fullName", role, created_at AS "createdAt";
  `, params);

  return res.rows[0] || null;
}

async function deleteUser(id) {
  await ensureSchema();
  const res = await query(`DELETE FROM users WHERE id = $1 RETURNING id;`, [id]);
  return res.rows.length > 0;
}

/**
 * Returns latest imports history
 */
async function getImportsHistory() {
  await ensureSchema();
  const res = await query(`
    SELECT
      id,
      filename,
      imported_at AS "importedAt",
      imported_by AS "importedBy",
      row_count AS "rowCount",
      status,
      version,
      created_at AS "createdAt"
    FROM imports
    ORDER BY version DESC
    LIMIT 20;
  `);
  return res.rows;
}

module.exports = {
  pool,
  query,
  withTransaction,
  ensureSchema,
  assertDatabaseConfigured,
  syncDatabaseTasksStatus,
  getStats,
  getDepartmentOverdueStats,
  getSettings,
  updateSettings,
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  clearAllTasks,
  getDepartments,
  getNextLeaderId,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getUsers,
  getUserByUsername,
  createUser,
  updateUser,
  deleteUser,
  getImportsHistory
};
