const XLSX = require('xlsx');
const crypto = require('crypto');
const { withTransaction, getNextLeaderId, ensureSchema } = require('./postgres');
const { parseDateComponents, normalizeDateStr, calculateDelayDays } = require('./utils/date');
const { determineTaskStatus, computeTaskStatus } = require('./utils/status');

/**
 * Advanced column extractor with Latin, Cyrillic and whitespace/punctuation resilience
 */
function getColValue(row, aliases) {
  const rowKeys = Object.keys(row);
  const clean = str => String(str || '').toLowerCase().replace(/[\s\r\n_.\-—–'"`’‘/№#]/g, '');

  // 1. Direct normalized match
  for (const alias of aliases) {
    const cleanAlias = clean(alias);
    if (!cleanAlias) continue;
    const foundKey = rowKeys.find(k => {
      const ck = clean(k);
      return ck && ck === cleanAlias;
    });
    if (foundKey && String(row[foundKey]).trim() !== '') {
      return String(row[foundKey]).trim();
    }
  }

  // 2. Substring match for compound titles
  for (const alias of aliases) {
    const cleanAlias = clean(alias);
    if (!cleanAlias || cleanAlias.length < 4) continue;
    const foundKey = rowKeys.find(k => {
      const ck = clean(k);
      if (!ck || ck.length < 4) return false;
      return ck.includes(cleanAlias) || cleanAlias.includes(ck);
    });
    if (foundKey && String(row[foundKey]).trim() !== '') {
      return String(row[foundKey]).trim();
    }
  }

  return '';
}

/**
 * Validates and parses an uploaded Excel buffer into clean tasks and departments
 */
function parseAndValidateExcel(buffer, originalFilename = 'data.xlsx') {
  if (!buffer || buffer.length === 0) {
    throw new Error('Yuklangan Excel fayli bo‘sh.');
  }

  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    throw new Error('Excel faylini o‘qib bo‘lmadi: fayl buzilgan yoki formati noto‘g‘ri.');
  }

  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error('Excel faylida biron bir varaq (sheet) topilmadi.');
  }

  // Pick the best sheet: look for sheets containing tasks keywords, or pick the one with most rows
  let selectedSheetName = wb.SheetNames[0];
  const preferredSheet = wb.SheetNames.find(s => {
    const lower = s.toLowerCase();
    return lower.includes('топшириқ') || lower.includes('topshiriq') || lower.includes('ijro') || lower.includes('jadval');
  });

  if (preferredSheet) {
    selectedSheetName = preferredSheet;
  } else {
    let maxRows = 0;
    for (const sName of wb.SheetNames) {
      const s = wb.Sheets[sName];
      if (s && s['!ref']) {
        const range = XLSX.utils.decode_range(s['!ref']);
        const rowCount = range.e.r - range.s.r + 1;
        if (rowCount > maxRows) {
          maxRows = rowCount;
          selectedSheetName = sName;
        }
      }
    }
  }

  const sheet = wb.Sheets[selectedSheetName];
  if (!sheet || !sheet['!ref']) {
    throw new Error(`«${selectedSheetName}» varag‘i bo‘sh yoki yaroqsiz.`);
  }

  // Locate header row dynamically
  const rawMatrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rawMatrix || rawMatrix.length === 0) {
    throw new Error('Excel faylida ma’lumot topilmadi.');
  }

  const headerKeywords = [
    'topshiriq', 'топшириқ', 'boshqarma', 'бошқарма', 'ijro', 'ижро',
    'muddat', 'муддат', 'rahbar', 'раҳбар', 'hujjat', 'ҳужжат', 't/r', '№',
    'id', 'fish', 'фиш', 'masul', 'mas’ul', 'mas\'ul', 'масъул', 'xodim', 'ходим', 'hodim'
  ];

  let headerRowIndex = 0;
  let maxKeywordMatches = 0;

  for (let r = 0; r < Math.min(rawMatrix.length, 15); r++) {
    const row = rawMatrix[r];
    if (!Array.isArray(row)) continue;
    const joined = row.map(cell => String(cell || '').toLowerCase()).join(' ');
    let matches = 0;
    for (const kw of headerKeywords) {
      if (joined.includes(kw)) matches++;
    }
    if (matches > maxKeywordMatches && matches >= 2) {
      maxKeywordMatches = matches;
      headerRowIndex = r;
    }
  }

  const rawRows = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: '' });
  if (!rawRows || rawRows.length === 0) {
    throw new Error('Excel faylidan topshiriqlar qatorlari topilmadi.');
  }

  const parsedItems = [];
  const errors = [];
  const today = new Date();

  rawRows.forEach((row, idx) => {
    const rowNum = headerRowIndex + idx + 2; // 1-indexed row number in Excel

    // Extract fields
    const rawLeaderId = getColValue(row, [
      'Rahbar ID', 'Раҳбар ID', 'Rahbar ID raqami', 'Раҳбар ID рақами', 'Rahbar IDsi', 'Rahbar_ID',
      'Leader ID', 'Leader_ID', 'LeaderID', 'Mas’ul ID', 'Масъул ID', 'Mas\'ul ID', 'Masul ID',
      'Xodim ID', 'Ходим ID', 'Hodim ID', 'Tabel raqami', 'Табел рақами', 'Tabel', 'Табел', 'ID raqam', 'ID'
    ]).replace(/^#/, '');

    const deptName = getColValue(row, [
      'Mas’ul boshqarma', 'Масъул бошқарма', 'Mas\'ul boshqarma', 'Masul boshqarma',
      'Boshqarma nomi', 'Бошқарма номи', 'Boshqarma', 'Бошқарма',
      'Bo‘lim', 'Бўлим', 'Bo\'lim', 'Bolim', 'Болим',
      'Boshqarma / Bo‘lim', 'Tashkilot', 'Ташкилот', 'Tarkibiy tuzilma', 'Таркибий тузилма', 'Lavozimi'
    ]);

    const headName = getColValue(row, [
      'Mas’ul ijrochi', 'Масъул ижрочи', 'Mas\'ul ijrochi', 'Masul ijrochi',
      'Mas’ul rahbar', 'Масъул раҳбар', 'Mas\'ul rahbar',
      'Mas’ul xodim', 'Масъул ходим', 'Mas\'ul xodim', 'Ijrochi', 'Ижрочи',
      'Mas’ul', 'Масъул', 'Mas\'ul', 'Masul',
      'Rahbar', 'Раҳбар', 'Rahbar F.I.SH', 'Раҳбар Ф.И.Ш',
      'F.I.SH.', 'Ф.И.Ш.', 'F.I.SH', 'Ф.И.Ш', 'FISH', 'ФИШ',
      'F.I.O.', 'Ф.И.О.', 'F.I.O', 'Ф.И.О', 'FIO', 'ФИО',
      'Xodim F.I.SH', 'Ходим Ф.И.Ш', 'Hodim F.I.SH', 'Xodim', 'Ходим', 'Hodim'
    ]);

    const title = getColValue(row, [
      'Topshiriq mazmuni', 'Топшириқ мазмуни', 'Topshiriq matni', 'Топшириқ матни',
      'Topshiriq', 'Топшириқ', 'Mazmuni', 'Мазмуни', 'Ijro mazmuni', 'Ижро мазмуни',
      'Hujjat raqami va sanasi', 'Ҳужжат рақами va санаси', 'Hujjat raqami', 'Ҳужжат рақами',
      'Hujjat', 'Ҳужжат', 'Topshiriq qisqacha mazmuni'
    ]);

    // Completely empty row check -> ignore
    if (!rawLeaderId && (!deptName || deptName === '-') && !headName && !title) {
      return;
    }

    let taskNumber = getColValue(row, [
      'Topshiriq ID', 'Топшириқ ID', 'Topshiriq raqami', 'Топшириқ рақами', 'Topshiriq №', 'Топшириқ №',
      '№', 'T/r', 'Т/р', 'T/r.', 'Т/р.', 'TR', 'Tartib raqam', 'Raqami', 'Рақами'
    ]);
    if (!taskNumber) taskNumber = `№${parsedItems.length + 1}`;

    const rawDate = getColValue(row, [
      'Ijro muddati', 'Ижро муддати', 'Topshiriq muddati', 'Топшириқ муддати',
      'Muddati', 'Муддати', 'Muddat', 'Муддат', 'Belgilangan muddat', 'Белгиланган муддат',
      'Ijro sanasi', 'Ижро санаси', 'Sana', 'Сана', 'Yakunlash sanasi', 'Якунлаш санаси', 'Berilgan sana'
    ]);

    const rawCompletedDate = getColValue(row, [
      'Bajarilgan sana', 'Бажарилган сана', 'Haqiqiy ijro sanasi', 'Yakunlangan sana', 'Bajarilgan vaqt', 'Tamomlangan sana'
    ]);

    const deadline = normalizeDateStr(rawDate);
    const completedDate = normalizeDateStr(rawCompletedDate);

    // Validate deadline
    if (!deadline && rawDate) {
      errors.push(`Excel faylida ${rowNum}-qator: ijro muddati («${rawDate}») noto‘g‘ri formatda.`);
    }

    const rawStatus = getColValue(row, ['Holati', 'Ҳолати', 'Holat', 'Ҳолат', 'Status', 'Статус', 'Ijro holati', 'Ижро ҳолати', 'Natija', 'Натижа']);
    const status = determineTaskStatus(rawStatus, deadline, completedDate, today);
    const delayDays = status === 'overdue' ? calculateDelayDays(deadline, completedDate, today) : 0;

    const docType = getColValue(row, ['Hujjat turi', 'Ҳужжат тури', 'Turi', 'Тури', 'Hujjat', 'Ҳужжат']) || 'Hujjat';
    const taskType = getColValue(row, ['Topshiriq turi', 'Топшириқ тури', 'Topshiriq yo‘nalishi', 'Topshiriq toifasi']) || 'Ijro topshirig‘i';
    const notes = getColValue(row, ['Izoh', 'Изоҳ', 'Qayd', 'Қайд', 'Izohlar', 'Eslatma', 'Эслатма']);

    parsedItems.push({
      rowNum,
      rawLeaderId,
      deptName: deptName && deptName !== '-' ? deptName : '',
      headName,
      title: title || `Topshiriq #${parsedItems.length + 1}`,
      taskNumber,
      docType,
      taskType,
      deadline: deadline || normalizeDateStr(today),
      status,
      completedDate: status === 'completed' ? (completedDate ? `${completedDate}T00:00:00Z` : new Date().toISOString()) : null,
      delayDays,
      notes
    });
  });

  if (errors.length > 0) {
    // Return the first 3 errors to keep user message clean and actionable
    const errMsg = errors.slice(0, 3).join(' ');
    throw new Error(errMsg);
  }

  if (parsedItems.length === 0) {
    throw new Error('Excel faylidan birorta ham topshiriq o‘qib bo‘lmadi. Ustunlar nomini tekshiring.');
  }

  return parsedItems;
}

/**
 * ATOMIC EXCEL IMPORT TRANSACTION:
 * 1. Validate and parse Excel
 * 2. BEGIN TRANSACTION
 * 3. Delete existing tasks dataset (DELETE FROM tasks)
 * 4. Resolve & upsert departments (preserve existing department photos!)
 * 5. Insert all new tasks
 * 6. Record in imports table (version, filename, count, user)
 * 7. Update settings lastUpdated
 * 8. COMMIT
 * 
 * If anything fails, automatic ROLLBACK ensures previous dataset is 100% untouched.
 */
async function importExcelAtomic({ buffer, filename = 'data.xlsx', importedBy = 'admin' }) {
  await ensureSchema();

  // 1. Validate & Parse outside transaction so bad files fail fast without touching DB
  const parsedItems = parseAndValidateExcel(buffer, filename);

  return withTransaction(async (client) => {
    // 2. Fetch existing departments to match and preserve photos
    const existingDeptsRes = await client.query(`
      SELECT id, leader_id AS "leaderId", name, head_name AS "headName", head_title AS "headTitle", photo
      FROM departments;
    `);
    const existingDepts = existingDeptsRes.rows;

    const deptMapById = new Map();
    const deptMapByName = new Map();
    const deptMapByHead = new Map();

    existingDepts.forEach(d => {
      if (d.leaderId) deptMapById.set(String(d.leaderId), d);
      deptMapByName.set(d.name.toLowerCase().replace(/['`’‘]/g, '').trim(), d);
      if (d.headName && d.headName.length > 5) {
        deptMapByHead.set(d.headName.toLowerCase().replace(/['`’‘]/g, '').trim(), d);
      }
    });

    // 3. Atomically delete all old tasks
    await client.query(`DELETE FROM tasks;`);

    // Helper to get max leaderId
    let maxLeaderId = 100;
    existingDepts.forEach(d => {
      if (d.leaderId > maxLeaderId) maxLeaderId = d.leaderId;
    });

    let addedDeptsCount = 0;
    let updatedDeptsCount = 0;

    // Resolve departments
    const resolvedTasks = [];

    for (const item of parsedItems) {
      let dept = null;

      if (item.rawLeaderId) {
        dept = deptMapById.get(String(item.rawLeaderId));
      }

      if (!dept && item.deptName) {
        const normDName = item.deptName.toLowerCase().replace(/['`’‘]/g, '').trim();
        dept = deptMapByName.get(normDName);
      }

      if (!dept && item.headName && item.headName.length > 5) {
        const normHName = item.headName.toLowerCase().replace(/['`’‘]/g, '').trim();
        dept = deptMapByHead.get(normHName);
      }

      if (dept) {
        // Update department name or headName if updated in Excel, BUT PRESERVE PHOTO!
        let changed = false;
        if (item.deptName && item.deptName !== '-' && dept.name !== item.deptName) {
          dept.name = item.deptName;
          changed = true;
        }
        if (item.headName && dept.headName !== item.headName) {
          dept.headName = item.headName;
          changed = true;
        }
        if (changed) {
          await client.query(`
            UPDATE departments SET name = $2, head_name = $3, updated_at = NOW()
            WHERE id = $1
          `, [dept.id, dept.name, dept.headName]);
          updatedDeptsCount++;
        }
      } else {
        // Create new department
        maxLeaderId++;
        const newLeaderId = item.rawLeaderId && /^\d+$/.test(item.rawLeaderId)
          ? parseInt(item.rawLeaderId, 10)
          : maxLeaderId;

        const newId = crypto.randomUUID();
        const dName = item.deptName || `Boshqarma #${newLeaderId}`;
        const hName = item.headName || 'Mas’ul rahbar';

        const insertDeptRes = await client.query(`
          INSERT INTO departments (id, leader_id, name, head_name, head_title, photo, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 'Mas’ul rahbar', '', 'active', NOW(), NOW())
          RETURNING id, leader_id AS "leaderId", name, head_name AS "headName", head_title AS "headTitle", photo;
        `, [newId, newLeaderId, dName, hName]);

        dept = insertDeptRes.rows[0];
        deptMapById.set(String(dept.leaderId), dept);
        deptMapByName.set(dept.name.toLowerCase().replace(/['`’‘]/g, '').trim(), dept);
        deptMapByHead.set(dept.headName.toLowerCase().replace(/['`’‘]/g, '').trim(), dept);
        addedDeptsCount++;
      }

      resolvedTasks.push({
        id: crypto.randomUUID(),
        taskNumber: item.taskNumber,
        leaderId: dept.leaderId,
        docNumberAndDate: item.title || item.taskNumber,
        docType: item.docType,
        taskType: item.taskType,
        title: item.title,
        departmentId: dept.id,
        departmentName: dept.name,
        responsiblePerson: item.headName || dept.headName,
        deadline: item.deadline,
        status: item.status,
        completedDate: item.completedDate,
        delayDays: item.delayDays,
        notes: item.notes
      });
    }

    // 4. Batch insert tasks into PostgreSQL
    for (const t of resolvedTasks) {
      await client.query(`
        INSERT INTO tasks (
          id, task_number, leader_id, doc_number_and_date, doc_type, task_type,
          title, department_id, department_name, responsible_person,
          deadline, status, completed_date, delay_days, notes, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14, $15, NOW(), NOW()
        )
      `, [
        t.id,
        t.taskNumber,
        t.leaderId,
        t.docNumberAndDate,
        t.docType,
        t.taskType,
        t.title,
        t.departmentId,
        t.departmentName,
        t.responsiblePerson,
        t.deadline,
        t.status,
        t.completedDate,
        t.delayDays,
        t.notes
      ]);
    }

    // 5. Version increment & Record import metadata
    const versionRes = await client.query(`SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM imports;`);
    const nextVersion = versionRes.rows[0].next_version;
    const importId = crypto.randomUUID();

    await client.query(`
      INSERT INTO imports (id, filename, imported_at, imported_by, row_count, status, version, created_at)
      VALUES ($1, $2, NOW(), $3, $4, 'success', $5, NOW());
    `, [importId, filename, importedBy, resolvedTasks.length, nextVersion]);

    // 6. Update system lastUpdated timestamp
    const nowIso = new Date().toISOString();
    await client.query(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('app_settings', $1, NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = jsonb_set(settings.value, '{lastUpdated}', $2), updated_at = NOW();
    `, [JSON.stringify({ lastUpdated: nowIso }), JSON.stringify(nowIso)]);

    // 7. Calculate final stats
    const overdueCount = resolvedTasks.filter(t => t.status === 'overdue').length;
    const inProgressCount = resolvedTasks.filter(t => t.status === 'in_progress').length;
    const completedCount = resolvedTasks.filter(t => t.status === 'completed').length;

    return {
      success: true,
      importId,
      filename,
      version: nextVersion,
      importedCount: resolvedTasks.length,
      totalTasks: resolvedTasks.length,
      overdueTasks: overdueCount,
      inProgressTasks: inProgressCount,
      completedTasks: completedCount,
      addedDeptsCount,
      updatedDeptsCount,
      importedAt: nowIso,
      message: `Muvaffaqiyatli import qilindi: ${resolvedTasks.length} ta topshiriq (Versiya: #${nextVersion}). Barcha eski topshiriqlar va ularning hisoboti to‘liq yangilandi.`
    };
  });
}

module.exports = {
  parseAndValidateExcel,
  importExcelAtomic
};
