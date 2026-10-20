require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, ensureSchema, withTransaction } = require('../server/postgres');
const { normalizeDateStr, calculateDelayDays } = require('../server/utils/date');
const { determineTaskStatus } = require('../server/utils/status');

async function migrate() {
  console.log('====================================================');
  console.log('Database Initialization & Migration (PostgreSQL)');
  console.log('====================================================');

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is missing.');
    console.error('Usage: DATABASE_URL="postgresql://user:pass@host:5432/db" npm run migrate');
    process.exit(1);
  }

  // Find source fixture if exists
  let jsonPath = path.join(__dirname, '..', 'tests', 'fixtures', 'sample-database.json');
  if (!fs.existsSync(jsonPath)) {
    jsonPath = path.join(__dirname, '..', 'data', 'database.json');
  }

  let jsonData = null;
  if (fs.existsSync(jsonPath)) {
    console.log(`Reading seed fixture from: ${jsonPath}`);
    try {
      jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (err) {
      console.warn('Could not parse JSON fixture, skipping JSON migration:', err.message);
    }
  } else {
    console.log('No JSON fixture found. Initializing empty tables.');
  }

  console.log('Verifying PostgreSQL schema and indexes...');
  await ensureSchema();

  console.log('Running safe migration transaction...');
  const result = await withTransaction(async (client) => {
    // 1. Check existing records to guarantee safety
    const existingTasksRes = await client.query(`SELECT COUNT(*)::int AS count FROM tasks;`);
    const existingTasksCount = existingTasksRes.rows[0].count;

    const existingUsersRes = await client.query(`SELECT COUNT(*)::int AS count FROM users;`);
    const existingUsersCount = existingUsersRes.rows[0].count;

    const existingDeptsRes = await client.query(`SELECT COUNT(*)::int AS count FROM departments;`);
    const existingDeptsCount = existingDeptsRes.rows[0].count;

    let usersMigrated = 0;
    let deptsMigrated = 0;
    let tasksMigrated = 0;
    let tasksSkipped = false;

    // 2. Migrate Users (Safe: do not overwrite existing passwords or duplicate)
    if (jsonData && Array.isArray(jsonData.users)) {
      for (const u of jsonData.users) {
        await client.query(`
          INSERT INTO users (id, username, password_hash, full_name, role, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (username) DO NOTHING;
        `, [
          u.id || require('crypto').randomUUID(),
          u.username.toLowerCase().trim(),
          u.passwordHash,
          u.fullName,
          u.role || 'viewer',
          u.createdAt || new Date().toISOString()
        ]);
        usersMigrated++;
      }
    }

    // 3. Migrate Departments (Safe: upsert, preserve photo if existing in DB)
    if (jsonData && Array.isArray(jsonData.departments)) {
      for (const d of jsonData.departments) {
        await client.query(`
          INSERT INTO departments (id, leader_id, name, head_name, head_title, photo, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (leader_id) DO UPDATE
          SET name = EXCLUDED.name,
              head_name = EXCLUDED.head_name,
              head_title = EXCLUDED.head_title,
              photo = CASE WHEN departments.photo != '' THEN departments.photo ELSE EXCLUDED.photo END,
              status = EXCLUDED.status,
              updated_at = NOW();
        `, [
          d.id || require('crypto').randomUUID(),
          parseInt(d.leaderId, 10),
          d.name.trim(),
          d.headName.trim(),
          d.headTitle || 'Mas’ul rahbar',
          d.photo || '',
          d.status || 'active',
          d.createdAt || new Date().toISOString()
        ]);
        deptsMigrated++;
      }
    }

    // 4. Migrate Tasks ONLY IF database is empty!
    // NEVER overwrite or delete existing production tasks!
    if (existingTasksCount > 0) {
      console.log(`[SAFEGUARD] Database already contains ${existingTasksCount} active tasks.`);
      console.log(`[SAFEGUARD] Existing production tasks preserved without modification.`);
      tasksSkipped = true;
    } else if (jsonData && Array.isArray(jsonData.tasks) && jsonData.tasks.length > 0) {
      const today = new Date();
      for (const t of jsonData.tasks) {
        const deadlineStr = normalizeDateStr(t.deadline);
        const status = determineTaskStatus(t.status, deadlineStr, t.completedDate, today);
        const delayDays = status === 'overdue' ? calculateDelayDays(deadlineStr, t.completedDate, today) : 0;

        await client.query(`
          INSERT INTO tasks (
            id, task_number, leader_id, doc_number_and_date, doc_type, task_type,
            title, department_id, department_name, responsible_person,
            deadline, status, completed_date, delay_days, notes, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, NOW()
          );
        `, [
          t.id || require('crypto').randomUUID(),
          t.taskNumber || '',
          t.leaderId || null,
          t.docNumberAndDate || t.taskNumber || '',
          t.docType || 'Hujjat',
          t.taskType || 'Ijro topshirig‘i',
          t.title || 'Topshiriq',
          t.departmentId || null,
          t.departmentName || '',
          t.responsiblePerson || '',
          deadlineStr,
          status,
          status === 'completed' ? (t.completedDate || new Date().toISOString()) : null,
          delayDays,
          t.notes || '',
          t.createdAt || new Date().toISOString()
        ]);
        tasksMigrated++;
      }

      // Record initial import record if none exists
      const existingImports = await client.query(`SELECT COUNT(*)::int AS count FROM imports;`);
      if (existingImports.rows[0].count === 0) {
        await client.query(`
          INSERT INTO imports (id, filename, imported_at, imported_by, row_count, status, version, created_at)
          VALUES ($1, 'initial_fixture.json', NOW(), 'system_init', $2, 'success', 1, NOW());
        `, [require('crypto').randomUUID(), tasksMigrated]);
      }
    }

    // 5. Migrate Settings (Safe: preserve existing production settings)
    if (jsonData && jsonData.settings) {
      await client.query(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ('app_settings', $1, NOW())
        ON CONFLICT (key) DO NOTHING;
      `, [JSON.stringify(jsonData.settings)]);
    }

    return {
      existingTasksCount,
      usersMigrated,
      deptsMigrated,
      tasksMigrated,
      tasksSkipped
    };
  });

  console.log('====================================================');
  console.log('MIGRATION COMPLETED SUCCESSFULLY!');
  if (result.tasksSkipped) {
    console.log(`- Active production tasks: ${result.existingTasksCount} (preserved)`);
  } else {
    console.log(`- Initial tasks migrated: ${result.tasksMigrated}`);
  }
  console.log(`- Departments processed: ${result.deptsMigrated}`);
  console.log(`- Users processed: ${result.usersMigrated}`);
  console.log('====================================================');

  await pool.end();
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
