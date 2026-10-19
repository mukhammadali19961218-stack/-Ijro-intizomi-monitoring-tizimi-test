const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');

const DB_FILE = fs.existsSync(path.join(__dirname, '..', 'data', 'database.json'))
  ? path.join(__dirname, '..', 'data', 'database.json')
  : path.join(process.cwd(), 'data', 'database.json');
const PORTRAITS_DIR = fs.existsSync(path.join(__dirname, '..', 'public', 'uploads', 'portraits'))
  ? path.join(__dirname, '..', 'public', 'uploads', 'portraits')
  : path.join(process.cwd(), 'public', 'uploads', 'portraits');

// Helpers for date parsing
function parseDateComponents(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'number') {
    const dateObj = XLSX.SSF.parse_date_code(dateVal);
    if (dateObj) {
      return new Date(dateObj.y, dateObj.m - 1, dateObj.d);
    }
  }
  const str = String(dateVal).trim();
  if (/^\d{4,5}$/.test(str)) {
    const num = parseInt(str, 10);
    if (num > 30000 && num < 60000) {
      const dateObj = XLSX.SSF.parse_date_code(num);
      if (dateObj) {
        return new Date(dateObj.y, dateObj.m - 1, dateObj.d);
      }
    }
  }
  const dmY = str.match(/(\d{1,2})\s*[\.\/-]\s*(\d{1,2})\s*[\.\/-]\s*(\d{4})/);
  if (dmY) {
    return new Date(parseInt(dmY[3], 10), parseInt(dmY[2], 10) - 1, parseInt(dmY[1], 10));
  }
  const Ymd = str.match(/(\d{4})\s*[\.\/-]\s*(\d{1,2})\s*[\.\/-]\s*(\d{1,2})/);
  if (Ymd) {
    return new Date(parseInt(Ymd[1], 10), parseInt(Ymd[2], 10) - 1, parseInt(Ymd[3], 10));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseTaskDate(dateVal) {
  if (!dateVal) return null;
  const d = parseDateComponents(dateVal);
  if (d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return String(dateVal).trim();
}

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

function determineStatus(rawStatus, deadlineStr, completedDateStr = null, baseDate = new Date()) {
  if (completedDateStr) return 'completed';
  const norm = String(rawStatus || '').toLowerCase();
  if (
    norm.includes('bajarilgan') || norm.includes('bajarildi') || norm === 'completed' ||
    norm.includes('бажарилган') || norm.includes('бажарилди')
  ) {
    return 'completed';
  }
  if (
    norm.includes('o‘tgan') || norm.includes("o'tgan") || norm.includes('kechikkan') || norm === 'overdue' ||
    norm.includes('ўтган') || norm.includes('у́тган') || norm.includes('кечиккан') || norm.includes('муддати ўтган')
  ) {
    return 'overdue';
  }
  // Check deadline
  if (deadlineStr) {
    const deadlineDate = parseDateComponents(deadlineStr);
    if (deadlineDate) {
      const today = baseDate || new Date();
      const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (todayMidnight > deadlineDate) {
        return 'overdue';
      }
    }
  }
  return 'in_progress';
}

function computeTaskStatus(task, baseDate = new Date()) {
  if (task.completedDate || task.status === 'completed') {
    return { status: 'completed', delayDays: 0 };
  }

  const today = baseDate || new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let deadlineDate = null;
  if (task.deadline) {
    deadlineDate = parseDateComponents(task.deadline);
  }

  // 1. If deadline date has strictly passed
  if (deadlineDate && todayMidnight > deadlineDate) {
    const delay = calculateDelayDays(task.deadline, null, today);
    return {
      status: 'overdue',
      delayDays: delay > 0 ? delay : 1
    };
  }

  // 2. If explicitly designated as overdue (e.g. from Excel raw 'Holati' or manual admin update)
  const normRaw = String(task.status || '').toLowerCase();
  if (
    normRaw === 'overdue' || normRaw.includes('o‘tgan') || normRaw.includes("o'tgan") || normRaw.includes('kechikkan') ||
    normRaw.includes('ўтган') || normRaw.includes('у́тган') || normRaw.includes('кечиккан')
  ) {
    return {
      status: 'overdue',
      delayDays: (typeof task.delayDays === 'number' && task.delayDays > 0) ? task.delayDays : 1
    };
  }

  return {
    status: 'in_progress',
    delayDays: 0
  };
}

class Database {
  constructor() {
    this.lastLoadedMtime = 0;
    this.data = {
      users: [],
      departments: [],
      tasks: [],
      settings: {
        orgName: "O‘zbekiston Respublikasi Energetika Vazirligi",
        subOrgName: "«Issiqlik elektr stansiyalari» aksiyadorlik jamiyati",
        systemTitle: "Ijro intizomi monitoring tizimi",
        logoUrl: "/images/ies_logo.svg",
        tppLogoUrl: "/images/ies_logo.svg",
        autoRefreshInterval: 60,
        lastUpdated: new Date().toISOString()
      }
    };
    this.load();
  }

  ensureFreshData() {
    try {
      const tmpFile = path.join(require('os').tmpdir(), 'ijro_database.json');
      let newestDiskMtime = 0;
      if (fs.existsSync(DB_FILE)) {
        try { newestDiskMtime = Math.max(newestDiskMtime, fs.statSync(DB_FILE).mtimeMs); } catch (_) {}
      }
      if (fs.existsSync(tmpFile)) {
        try { newestDiskMtime = Math.max(newestDiskMtime, fs.statSync(tmpFile).mtimeMs); } catch (_) {}
      }

      // Only reload if an external process updated the disk file after our last load/save
      if (newestDiskMtime > (this.lastLoadedMtime + 100)) {
        this.load();
      }
    } catch (_) {}
  }

  load() {
    try {
      let loaded = false;
      const tmpFile = path.join(require('os').tmpdir(), 'ijro_database.json');

      let dbMtime = 0;
      let tmpMtime = 0;
      if (fs.existsSync(DB_FILE)) {
        try { dbMtime = fs.statSync(DB_FILE).mtimeMs; } catch (_) {}
      }
      if (fs.existsSync(tmpFile)) {
        try { tmpMtime = fs.statSync(tmpFile).mtimeMs; } catch (_) {}
      }

      // Prioritize the newer file between primary DB_FILE and tmpFile
      if (tmpMtime > dbMtime && fs.existsSync(tmpFile)) {
        try {
          const rawTmp = fs.readFileSync(tmpFile, 'utf8');
          this.data = JSON.parse(rawTmp);
          this.lastLoadedMtime = tmpMtime;
          loaded = true;
        } catch (_) {}
      }

      if (!loaded && fs.existsSync(DB_FILE)) {
        try {
          const raw = fs.readFileSync(DB_FILE, 'utf8');
          this.data = JSON.parse(raw);
          this.lastLoadedMtime = dbMtime;
          loaded = true;
        } catch (_) {}
      }

      if (!loaded && fs.existsSync(tmpFile)) {
        try {
          const rawTmp = fs.readFileSync(tmpFile, 'utf8');
          this.data = JSON.parse(rawTmp);
          this.lastLoadedMtime = tmpMtime;
          loaded = true;
        } catch (_) {}
      }

      if (!loaded) {
        console.log('Database file not found, initializing empty structure...');
        this.seedInitialData();
        this.save();
        loaded = true;
      }

      // Ensure sequential leaderId on all departments
      let maxId = 100;
      if (Array.isArray(this.data.departments)) {
        this.data.departments.forEach(d => {
          const num = parseInt(d.leaderId, 10);
          if (!isNaN(num) && num > maxId) maxId = num;
        });
        this.data.departments.forEach(d => {
          if (!d.leaderId) {
            maxId++;
            d.leaderId = maxId;
          }
        });
      }

      // Auto sync all tasks status according to deadlines & current date
      this.syncTasksStatus(false);

      console.log(`Database loaded: ${this.data.tasks ? this.data.tasks.length : 0} tasks, ${this.data.departments ? this.data.departments.length : 0} departments.`);
    } catch (err) {
      console.error('Error loading database:', err.message);
      if (!this.data || !Array.isArray(this.data.tasks)) {
        this.seedInitialData();
      }
    }
  }

  getNextLeaderId() {
    this.ensureFreshData();
    let maxId = 100;
    if (this.data && Array.isArray(this.data.departments)) {
      this.data.departments.forEach(d => {
        const num = parseInt(d.leaderId, 10);
        if (!isNaN(num) && num > maxId) maxId = num;
      });
    }
    return maxId + 1;
  }

  save() {
    try {
      this.data.settings.lastUpdated = new Date().toISOString();
      const content = JSON.stringify(this.data, null, 2);
      const nowMs = Date.now();
      let saved = false;

      // 1. Direct write to primary DB_FILE
      try {
        const dir = path.dirname(DB_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DB_FILE, content, 'utf8');
        try {
          this.lastLoadedMtime = fs.statSync(DB_FILE).mtimeMs;
        } catch (_) {
          this.lastLoadedMtime = nowMs;
        }
        saved = true;
      } catch (errPrimary) {
        console.warn('Primary DB_FILE write failed (read-only filesystem or locked):', errPrimary.message);
      }

      // 2. Backup write to tmpdir for serverless/ephemeral environments
      try {
        const tmpFile = path.join(require('os').tmpdir(), 'ijro_database.json');
        fs.writeFileSync(tmpFile, content, 'utf8');
        if (!saved) {
          try {
            this.lastLoadedMtime = fs.statSync(tmpFile).mtimeMs;
          } catch (_) {
            this.lastLoadedMtime = nowMs;
          }
        }
        saved = true;
      } catch (errTmp) {
        console.warn('Tmpdir backup write failed:', errTmp.message);
      }

      this.lastLoadedMtime = Math.max(this.lastLoadedMtime || 0, nowMs);
    } catch (err) {
      console.error('Error in save():', err.message);
    }
  }

  seedInitialData() {
    // 1. Setup Users
    const salt = bcrypt.genSaltSync(10);
    this.data.users = [
      {
        id: crypto.randomUUID(),
        username: 'admin',
        passwordHash: bcrypt.hashSync('admin123', salt),
        fullName: 'Bosh Administrator',
        role: 'admin',
        createdAt: new Date().toISOString()
      },
      {
        id: crypto.randomUUID(),
        username: 'viewer',
        passwordHash: bcrypt.hashSync('viewer123', salt),
        fullName: 'Kuzatuvchi Operator',
        role: 'viewer',
        createdAt: new Date().toISOString()
      }
    ];

    if (!Array.isArray(this.data.departments)) {
      this.data.departments = [];
    }
    if (!Array.isArray(this.data.tasks)) {
      this.data.tasks = [];
    }
  }

  syncTasksStatus(saveIfChanged = true) {
    let changed = false;
    const now = new Date();

    if (Array.isArray(this.data.tasks)) {
      this.data.tasks.forEach(task => {
        const computed = computeTaskStatus(task, now);
        if (task.status !== computed.status || task.delayDays !== computed.delayDays) {
          task.status = computed.status;
          task.delayDays = computed.delayDays;
          task.updatedAt = now.toISOString();
          changed = true;
        }
      });
    }

    if (changed && saveIfChanged) {
      this.save();
    }
    return changed;
  }

  // --- Statistics Calculation Methods ---
  getStats() {
    this.ensureFreshData();
    this.syncTasksStatus(true);

    let totalTasks = this.data.tasks.length;
    let inProgressTasks = 0;
    let overdueTasks = 0;
    let completedTasks = 0;

    this.data.tasks.forEach(task => {
      if (task.status === 'completed') {
        completedTasks++;
      } else if (task.status === 'overdue') {
        overdueTasks++;
      } else {
        inProgressTasks++;
      }
    });

    return {
      totalTasks,
      inProgressTasks,
      overdueTasks,
      completedTasks,
      lastUpdated: this.data.settings.lastUpdated
    };
  }

  getDepartmentOverdueStats(page = 1, pageSize = 3, onlyOverdue = true) {
    this.ensureFreshData();
    this.syncTasksStatus(true);

    // Compute stats per department
    const deptStatsMap = new Map();

    this.data.departments.forEach(dept => {
      deptStatsMap.set(dept.id, {
        id: dept.id,
        name: dept.name,
        headName: dept.headName,
        headTitle: dept.headTitle || "Mas’ul rahbar",
        leaderId: dept.leaderId || '',
        photo: dept.photo || '',
        status: dept.status || 'active',
        overdueCount: 0,
        inProgressCount: 0,
        completedCount: 0,
        totalTasks: 0
      });
    });

    this.data.tasks.forEach(task => {
      const deptStat = deptStatsMap.get(task.departmentId);
      if (deptStat) {
        deptStat.totalTasks++;
        if (task.status === 'completed') {
          deptStat.completedCount++;
        } else if (task.status === 'overdue') {
          deptStat.overdueCount++;
        } else {
          deptStat.inProgressCount++;
        }
      }
    });

    // Sort by overdueCount desc, then by name asc
    let sortedDepts = Array.from(deptStatsMap.values()).sort((a, b) => {
      if (b.overdueCount !== a.overdueCount) {
        return b.overdueCount - a.overdueCount;
      }
      return a.name.localeCompare(b.name, 'uz');
    });

    // If onlyOverdue is requested, exclude departments with 0 overdue tasks
    if (onlyOverdue) {
      sortedDepts = sortedDepts.filter(d => d.overdueCount > 0);
    }

    const totalDepts = sortedDepts.length;
    const totalPages = Math.max(1, Math.ceil(totalDepts / pageSize));
    const currentPage = Math.min(Math.max(1, parseInt(page) || 1), totalPages);

    const startIndex = (currentPage - 1) * pageSize;
    const items = sortedDepts.slice(startIndex, startIndex + pageSize);

    return {
      items,
      total: totalDepts,
      page: currentPage,
      pageSize,
      totalPages
    };
  }
}

const db = new Database();

module.exports = {
  db,
  parseDateComponents,
  parseTaskDate,
  calculateDelayDays,
  determineStatus,
  computeTaskStatus
};
