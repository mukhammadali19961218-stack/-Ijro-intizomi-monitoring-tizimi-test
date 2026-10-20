-- ==============================================================
-- IJRO INTIZOMI MONITORING TIZIMI - POSTGRESQL SCHEMA
-- Compatible with Supabase, Neon, AWS RDS, and local PostgreSQL
-- ==============================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'viewer' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. DEPARTMENTS TABLE
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

-- 3. TASKS TABLE (Active dataset)
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

-- 4. SETTINGS TABLE
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. IMPORTS HISTORY TABLE
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
