const XLSX = require('xlsx');

/**
 * Parses diverse date inputs (Excel serial number, DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD, JS Date)
 * into a standard JS Date object at local midnight in Uzbekistan (UTC+5).
 */
function parseDateComponents(dateVal) {
  if (!dateVal) return null;

  // 1. Direct JS Date object
  if (dateVal instanceof Date) {
    if (isNaN(dateVal.getTime())) return null;
    return new Date(dateVal.getFullYear(), dateVal.getMonth(), dateVal.getDate());
  }

  // 2. Excel numeric date serial
  if (typeof dateVal === 'number') {
    const parsed = XLSX.SSF.parse_date_code(dateVal);
    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
  }

  const str = String(dateVal).trim();
  if (!str) return null;

  // 3. String numeric date serial (e.g. "45580")
  if (/^\d{4,5}$/.test(str)) {
    const num = parseInt(str, 10);
    if (num > 30000 && num < 70000) {
      const parsed = XLSX.SSF.parse_date_code(num);
      if (parsed) {
        return new Date(parsed.y, parsed.m - 1, parsed.d);
      }
    }
  }

  // 4. DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  const dmY = str.match(/^(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{4})/);
  if (dmY) {
    const d = parseInt(dmY[1], 10);
    const m = parseInt(dmY[2], 10) - 1;
    const y = parseInt(dmY[3], 10);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // 5. YYYY-MM-DD or YYYY/MM/DD
  const Ymd = str.match(/^(\d{4})[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})/);
  if (Ymd) {
    const y = parseInt(Ymd[1], 10);
    const m = parseInt(Ymd[2], 10) - 1;
    const d = parseInt(Ymd[3], 10);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // 6. Generic ISO / Date string fallback
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }

  return null;
}

/**
 * Normalizes date to 'YYYY-MM-DD' string format for consistent database storage.
 */
function normalizeDateStr(dateVal) {
  const d = parseDateComponents(dateVal);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Calculates delay in days between deadline and comparison date (completedDate or today).
 */
function calculateDelayDays(deadlineStr, completedDateStr = null, baseDate = new Date()) {
  if (!deadlineStr) return 0;
  const deadlineDate = parseDateComponents(deadlineStr);
  if (!deadlineDate) return 0;

  const compareDateRaw = completedDateStr ? parseDateComponents(completedDateStr) : baseDate;
  if (!compareDateRaw) return 0;
  const compareMidnight = new Date(compareDateRaw.getFullYear(), compareDateRaw.getMonth(), compareDateRaw.getDate());

  const diffTime = compareMidnight.getTime() - deadlineDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}

module.exports = {
  parseDateComponents,
  normalizeDateStr,
  calculateDelayDays
};
