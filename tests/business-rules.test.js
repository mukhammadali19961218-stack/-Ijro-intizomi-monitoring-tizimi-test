const assert = require('assert');
const { parseDateComponents, normalizeDateStr, calculateDelayDays } = require('../server/utils/date');
const { determineTaskStatus, computeTaskStatus } = require('../server/utils/status');
const { parseAndValidateExcel } = require('../server/excel-importer');
const XLSX = require('xlsx');

console.log('--- Running Business Rules & Data Architecture Unit Tests ---');

// 1. DATE NORMALIZATION TESTS
console.log('1. Testing Date Normalization...');
{
  const d1 = normalizeDateStr('2026-11-20');
  assert.strictEqual(d1, '2026-11-20', 'YYYY-MM-DD should format to YYYY-MM-DD');

  const d2 = normalizeDateStr('20.11.2026');
  assert.strictEqual(d2, '2026-11-20', 'DD.MM.YYYY should format to YYYY-MM-DD');

  const d3 = normalizeDateStr('20/11/2026');
  assert.strictEqual(d3, '2026-11-20', 'DD/MM/YYYY should format to YYYY-MM-DD');

  // Excel serial date 46346 (~Nov 20, 2026)
  const d4 = normalizeDateStr(46346);
  assert.ok(d4 && d4.startsWith('2026-'), 'Excel serial date should parse correctly');

  const invalid = normalizeDateStr('not-a-date');
  assert.strictEqual(invalid, null, 'Invalid date string should return null');
}

// 2. STATUS CALCULATION TESTS
console.log('2. Testing Task Status Calculation & Business Rules...');
{
  const baseDate = new Date(2026, 9, 19); // 2026-10-19

  // TEST F: Future deadline MUST NOT be marked overdue
  const futureTask = {
    title: 'Kelajakdagi topshiriq',
    deadline: '2026-11-15',
    status: 'in_progress'
  };
  const computedFuture = computeTaskStatus(futureTask, baseDate);
  assert.strictEqual(computedFuture.status, 'in_progress', 'TEST F FAILED: Future deadline was marked overdue!');
  assert.strictEqual(computedFuture.delayDays, 0, 'Future task must have 0 delay days');

  // TEST F-2: Task had OLD 'overdue' status, but deadline is in the future
  const staleOverdueTask = {
    title: 'Eski muddati o‘tgan deyilgan, lekin muddati uzaytirilgan topshiriq',
    deadline: '2026-12-01',
    status: 'overdue',
    rawStatus: 'Muddati o‘tgan'
  };
  const computedFixed = computeTaskStatus(staleOverdueTask, baseDate);
  assert.strictEqual(computedFixed.status, 'in_progress', 'TEST F-2 FAILED: Stale overdue status was preserved despite future deadline!');
  assert.strictEqual(computedFixed.delayDays, 0);

  // TEST G: Past deadline MUST be marked overdue
  const pastTask = {
    title: 'Kechikkan topshiriq',
    deadline: '2026-10-10',
    status: 'in_progress'
  };
  const computedPast = computeTaskStatus(pastTask, baseDate);
  assert.strictEqual(computedPast.status, 'overdue', 'TEST G FAILED: Past deadline was not marked overdue!');
  assert.strictEqual(computedPast.delayDays, 9, 'Delay days should be 9 days');

  // TEST: Completed task with past deadline must be completed, not overdue
  const completedTask = {
    title: 'Bajarilgan topshiriq',
    deadline: '2026-09-01',
    status: 'completed',
    completedDate: '2026-09-01T10:00:00Z'
  };
  const computedCompleted = computeTaskStatus(completedTask, baseDate);
  assert.strictEqual(computedCompleted.status, 'completed', 'Completed task should stay completed');
  assert.strictEqual(computedCompleted.delayDays, 0, 'Completed task delay days must be 0');
}

// 3. EXCEL VALIDATION TESTS
console.log('3. Testing Excel File Validation...');
{
  // Test empty file
  assert.throws(() => {
    parseAndValidateExcel(Buffer.from([]), 'empty.xlsx');
  }, /bo‘sh/i, 'Empty buffer should throw validation error');

  // Test valid sample excel generation and parsing
  const wb = XLSX.utils.book_new();
  const sampleData = [
    {
      '№': 1,
      'Topshiriq ID': '№1001',
      'Rahbar ID': 101,
      'Mas’ul boshqarma': 'Xodimlar bilan ishlash boshqarmasi',
      'Mas’ul ijrochi': "TURG'UNOVA FERUZA ABDURAHIMOVNA",
      'Topshiriq mazmuni': 'Yangi topshiriq mazmuni',
      'Ijro muddati': '2026-11-30',
      'Holati': 'Bajarish jarayonida'
    },
    {
      '№': 2,
      'Topshiriq ID': '№1002',
      'Rahbar ID': 102,
      'Mas’ul boshqarma': 'Investitsiya boshqarmasi',
      'Mas’ul ijrochi': 'ALISHER MIRZAYEV',
      'Topshiriq mazmuni': 'Kechikkan topshiriq mazmuni',
      'Ijro muddati': '2026-09-01',
      'Holati': 'Bajarish jarayonida'
    }
  ];
  const ws = XLSX.utils.json_to_sheet(sampleData);
  XLSX.utils.book_append_sheet(wb, ws, 'Topshiriqlar');
  const validBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const parsed = parseAndValidateExcel(validBuffer, 'test.xlsx');
  assert.strictEqual(parsed.length, 2, 'Should parse exactly 2 valid tasks');
  assert.strictEqual(parsed[0].status, 'in_progress', 'First task should be in_progress (future deadline)');
  assert.strictEqual(parsed[1].status, 'overdue', 'Second task should be overdue (past deadline)');
}

// 4. DATABASE SAFETY ASSERTION
console.log('4. Testing Safe Failure on Missing Database...');
{
  const { assertDatabaseConfigured } = require('../server/postgres');
  if (!process.env.DATABASE_URL) {
    assert.throws(() => {
      assertDatabaseConfigured();
    }, /DATABASE_URL/i, 'Must fail safely without DATABASE_URL');
  }
}

// 5. JWT SECURITY ASSERTION (NO HARDCODED FALLBACK)
console.log('5. Testing Strict JWT_SECRET Enforcement...');
{
  const { getJwtSecret } = require('../server/middleware/auth');
  if (!process.env.JWT_SECRET) {
    assert.throws(() => {
      getJwtSecret();
    }, /JWT_SECRET/i, 'Must strictly throw when JWT_SECRET is missing');
  }
}

console.log('====================================================');
console.log('ALL UNIT TESTS PASSED SUCCESSFULLY!');
console.log('====================================================');
