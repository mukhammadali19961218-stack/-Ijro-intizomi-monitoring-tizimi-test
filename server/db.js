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
  const dmY = str.match(/^(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{4})/);
  if (dmY) {
    return new Date(parseInt(dmY[3], 10), parseInt(dmY[2], 10) - 1, parseInt(dmY[1], 10));
  }
  const Ymd = str.match(/^(\d{4})[\.\/-](\d{1,2})[\.\/-](\d{1,2})/);
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

function calculateDelayDays(deadlineStr, completedDateStr = null) {
  if (!deadlineStr) return 0;
  const deadlineDate = parseDateComponents(deadlineStr);
  if (!deadlineDate) return 0;
  
  const compareDateRaw = completedDateStr ? parseDateComponents(completedDateStr) : new Date();
  if (!compareDateRaw) return 0;
  const compareMidnight = new Date(compareDateRaw.getFullYear(), compareDateRaw.getMonth(), compareDateRaw.getDate());
  
  const diffTime = compareMidnight.getTime() - deadlineDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}

function determineStatus(rawStatus, deadlineStr, completedDateStr = null) {
  if (completedDateStr) return 'completed';
  const norm = String(rawStatus || '').toLowerCase();
  if (norm.includes('bajarilgan') || norm.includes('bajarildi') || norm === 'completed') {
    return 'completed';
  }
  if (norm.includes('o‘tgan') || norm.includes("o'tgan") || norm.includes('kechikkan') || norm === 'overdue') {
    return 'overdue';
  }
  // Check deadline
  if (deadlineStr) {
    const deadlineDate = parseDateComponents(deadlineStr);
    if (deadlineDate) {
      const today = new Date();
      const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (todayMidnight > deadlineDate) {
        return 'overdue';
      }
    }
  }
  return 'in_progress';
}

class Database {
  constructor() {
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

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(raw);
        
        // Ensure all departments have sequential leaderId
        let updated = false;
        let maxId = 100;
        this.data.departments.forEach(d => {
          const num = parseInt(d.leaderId, 10);
          if (!isNaN(num) && num > maxId) maxId = num;
        });
        this.data.departments.forEach(d => {
          if (!d.leaderId) {
            maxId++;
            d.leaderId = maxId;
            updated = true;
          }
        });
        if (updated) this.save();

        console.log(`Database loaded: ${this.data.tasks.length} tasks, ${this.data.departments.length} departments.`);
      } else {
        console.log('Database file not found, initializing with seed data...');
        this.seedInitialData();
        this.save();
      }
    } catch (err) {
      console.error('Error loading database:', err.message);
      this.seedInitialData();
      this.save();
    }
  }

  getNextLeaderId() {
    let maxId = 100;
    if (this.data && this.data.departments) {
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
      const dir = path.dirname(DB_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tempFile = DB_FILE + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempFile, DB_FILE);
    } catch (err) {
      console.error('Error saving database:', err.message);
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

    // 2. Discover available portraits
    let availablePhotos = [];
    if (fs.existsSync(PORTRAITS_DIR)) {
      availablePhotos = fs.readdirSync(PORTRAITS_DIR);
    }

    // 3. Read seed Excel if available
    const possibleExcelFiles = [
      'C:\\Users\\Hp\\Downloads\\ijro_topshiriqlar (1).xlsx',
      'C:\\Users\\Hp\\Downloads\\ijro_topshiriqlar.xlsx',
      'C:\\Users\\Hp\\Desktop\\ijro 1.xlsx'
    ];
    let seedExcelPath = possibleExcelFiles.find(p => fs.existsSync(p));

    const departmentsMap = new Map();
    const tasksList = [];

    // Pre-populate core 3 departments from screenshot with accurate portraits
    const coreDepartments = [
      {
        name: "Xodimlar bilan ishlash boshqarmasi",
        headName: "TURG'UNOVA FERUZA ABDURAHIMOVNA",
        photo: "/uploads/portraits/TURG'UNOVA FERUZA ABDURAHIMOVNA.jpg"
      },
      {
        name: "Xalqaro aloqalar va investitsiyalarni jalb qilish boshqarmasi",
        headName: "DJURAYEV ALISHER MIRZAMAHKAMOVICH",
        photo: "/uploads/portraits/DJURAYEV ALISHER MIRZAMAHKAMOVICH.jpg"
      },
      {
        name: "Uskunalarni ta'mirlash, mahalliylashtirish va kooperatsiyani kengaytirish boshqarmasi",
        headName: "MIRZAYEV IKROM MELSOVICH",
        photo: "/uploads/portraits/MIRZAYEV IKROM MELSOVICH.jpg"
      }
    ];

    coreDepartments.forEach(cd => {
      const id = crypto.randomUUID();
      departmentsMap.set(cd.name.toLowerCase().replace(/['`’]/g, ''), {
        id,
        name: cd.name,
        headName: cd.headName,
        headTitle: "Mas’ul rahbar",
        photo: cd.photo,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });

    if (seedExcelPath) {
      try {
        console.log('Seeding from Excel:', seedExcelPath);
        const wb = XLSX.readFile(seedExcelPath);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet);

        rows.forEach((row, idx) => {
          const deptName = String(row['Mas’ul boshqarma'] || row['Lavozimi'] || 'Boshqa boshqarma').trim();
          if (!deptName || deptName === '-') return;

          const headName = String(row['Mas’ul ijrochi'] || row['Ma\'sul xodim'] || '').trim();
          const deptKey = deptName.toLowerCase().replace(/['`’]/g, '');

          let dept = departmentsMap.get(deptKey);
          if (!dept) {
            // Find portrait matching headName
            let matchedPhoto = '';
            if (headName) {
              const normHead = headName.toLowerCase().replace(/['`’]/g, '');
              const headParts = normHead.split(/\s+/).filter(p => p.length >= 4);
              const foundFile = availablePhotos.find(file => {
                const normFile = file.toLowerCase().replace(/['`’]/g, '');
                return headParts.some(hp => normFile.includes(hp));
              });
              if (foundFile) {
                matchedPhoto = `/uploads/portraits/${foundFile}`;
              }
            }

            dept = {
              id: crypto.randomUUID(),
              name: deptName,
              headName: headName || 'Mas’ul xodim',
              headTitle: "Mas’ul rahbar",
              photo: matchedPhoto,
              status: "active",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            departmentsMap.set(deptKey, dept);
          }

          const rawDate = row['Ijro muddati'] || row['Topshiriq muddati'];
          const deadline = parseTaskDate(rawDate);
          const rawStatus = row['Holati'] || '';
          const status = determineStatus(rawStatus, deadline);
          const delayDays = calculateDelayDays(deadline);

          const taskNumber = String(row['Topshiriq mazmuni'] || row['Hujjat raqami va sanasi'] || row['Topshiriq ID'] || `T-${idx + 1}`).trim();
          const docType = String(row['Hujjat turi'] || 'Hujjat').trim();
          const taskType = String(row['Topshiriq turi'] || 'Ijro topshirig‘i').trim();
          const notes = String(row['Izoh'] || '').trim();

          tasksList.push({
            id: crypto.randomUUID(),
            taskNumber: `№${idx + 1}`,
            docNumberAndDate: taskNumber,
            taskType,
            docType,
            title: taskNumber,
            departmentId: dept.id,
            departmentName: dept.name,
            responsiblePerson: headName || dept.headName,
            deadline: deadline || '2026-10-30',
            status,
            completedDate: status === 'completed' ? new Date().toISOString() : null,
            delayDays: status === 'overdue' ? (delayDays || 1) : 0,
            notes,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        });

      } catch (err) {
        console.error('Failed to parse seed Excel:', err.message);
      }
    }

    this.data.departments = Array.from(departmentsMap.values());
    this.data.tasks = tasksList;
    console.log(`Seeded ${this.data.departments.length} departments and ${this.data.tasks.length} tasks.`);
  }

  // --- Statistics Calculation Methods ---
  getStats() {
    let totalTasks = this.data.tasks.length;
    let inProgressTasks = 0;
    let overdueTasks = 0;
    let completedTasks = 0;

    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    this.data.tasks.forEach(task => {
      // Dynamic overdue check if not completed
      let status = task.status;
      if (status !== 'completed') {
        if (task.deadline) {
          const dMidnight = parseDateComponents(task.deadline);
          if (dMidnight) {
            if (todayMidnight > dMidnight) {
              status = 'overdue';
            } else {
              status = 'in_progress';
            }
          }
        }
      }

      if (status === 'completed') {
        completedTasks++;
      } else if (status === 'overdue') {
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
    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

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
        let status = task.status;
        if (status !== 'completed' && task.deadline) {
          const dMidnight = parseDateComponents(task.deadline);
          if (dMidnight) {
            if (todayMidnight > dMidnight) {
              status = 'overdue';
            } else {
              status = 'in_progress';
            }
          }
        }

        if (status === 'completed') {
          deptStat.completedCount++;
        } else if (status === 'overdue') {
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
  determineStatus
};
