const mysql = require('mysql2/promise');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const mysqlConfig = process.env.MYSQL_URL || process.env.DATABASE_URL || {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'garageflow',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 1500
};

const mysqlPool = mysql.createPool(mysqlConfig);

let useSqliteFallback = false;
let sqliteDb = null;

function initSqliteFallback() {
  if (sqliteDb) return sqliteDb;
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'database', 'garageflow_local.sqlite');
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA foreign_keys = ON');

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      fullname TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'mechanic',
      phone TEXT,
      skills TEXT DEFAULT NULL,
      status TEXT DEFAULT 'active',
      salary_type TEXT DEFAULT 'daily',
      salary_rate REAL DEFAULT 500.00,
      overtime_rate REAL DEFAULT 60.00,
      reset_token TEXT DEFAULT NULL,
      reset_expires TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fullname TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT,
      line_id TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      license_plate TEXT UNIQUE NOT NULL,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      year INTEGER,
      color TEXT,
      vin TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      mechanic_id INTEGER,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      estimated_cost REAL DEFAULT 0.00,
      actual_cost REAL DEFAULT 0.00,
      estimated_days INTEGER DEFAULT NULL,
      estimated_completion_date TEXT DEFAULT NULL,
      car_photo_before TEXT,
      car_photo_after TEXT,
      warranty_expire_date TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (mechanic_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_name TEXT NOT NULL,
      part_number TEXT UNIQUE NOT NULL,
      category TEXT DEFAULT NULL,
      stock_qty INTEGER NOT NULL DEFAULT 0,
      min_qty INTEGER NOT NULL DEFAULT 5,
      cost_price REAL NOT NULL DEFAULT 0.00,
      sell_price REAL NOT NULL DEFAULT 0.00,
      supplier TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS finances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_id INTEGER DEFAULT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT DEFAULT NULL,
      status TEXT DEFAULT 'paid',
      installment_terms TEXT DEFAULT NULL,
      description TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS repair_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      updated_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repair_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_id INTEGER NOT NULL,
      part_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      sell_price REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
      FOREIGN KEY (part_id) REFERENCES inventory(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      clock_in TEXT DEFAULT NULL,
      clock_out TEXT DEFAULT NULL,
      ot_hours REAL DEFAULT 0.00,
      status TEXT DEFAULT 'present',
      notes TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE (user_id, work_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      \`key\` TEXT UNIQUE NOT NULL,
      value TEXT DEFAULT NULL,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  const countRow = sqliteDb.prepare('SELECT COUNT(*) AS cnt FROM users').get();
  if (!countRow || countRow.cnt === 0) {
    const ownerHash = bcrypt.hashSync('owner123', 10);
    const mechHash = bcrypt.hashSync('mechanic123', 10);
    const adminHash = bcrypt.hashSync('admin123', 10);
    const staffHash = bcrypt.hashSync('123456', 10);
    const today = new Date().toISOString().split('T')[0];

    sqliteDb.prepare(`
      INSERT INTO users (username, password, fullname, role, phone, skills, status, salary_type, salary_rate, overtime_rate)
      VALUES
      ('owner', ?, 'สมชาย รักดี (เจ้าของอู่)', 'owner', '0812345678', 'บริหารจัดการ, ตรวจสอบสภาพรถขั้นสูง', 'active', 'monthly', 35000, 100),
      ('mechanic', ?, 'สมศักดิ์ ช่างเหล็ก (ช่างใหญ่)', 'mechanic', '0898765432', 'ซ่อมเครื่องยนต์ดีเซล-เบนซิน, ระบบช่วงล่าง', 'active', 'daily', 600, 80),
      ('admin', ?, 'ผู้ดูแลระบบ (Admin)', 'owner', '0811112222', 'บริหารจัดการระบบ', 'active', 'monthly', 30000, 100),
      ('reception', ?, 'พิมพ์ใจ บริการดี (ต้อนรับ)', 'receptionist', '0822223333', 'รับรถ, ประสานงานลูกค้า, ออกบิล', 'active', 'monthly', 15000, 60),
      ('stock', ?, 'เกรียงไกร คลังเป๊ะ (อะไหล่)', 'inventory', '0833334444', 'จัดการสต็อกอะไหล่, จัดซื้อ', 'active', 'daily', 500, 60)
    `).run(ownerHash, mechHash, adminHash, staffHash, staffHash);

    sqliteDb.exec(`
      INSERT INTO customers (fullname, phone, email, address) VALUES
      ('วิชัย รวยรุ่ง', '0823456789', 'wichai@email.com', '123/45 ถนนพัฒนาการ แขวงสวนหลวง เขตสวนหลวง กรุงเทพฯ'),
      ('นารี อ่อนหวาน', '0834567890', 'naree@email.com', '99/9 หมู่ 3 ถนนวิภาวดีรังสิต แขวงตลาดบางเขน เขตหลักสี่ กรุงเทพฯ'),
      ('มานะ อดทน', '0845678901', 'mana@email.com', '456 ถนนลาดพร้าว แขวงจอมพล เขตจตุจักร กรุงเทพฯ');

      INSERT INTO vehicles (customer_id, license_plate, brand, model, year, color, vin) VALUES
      (1, 'กก 1234 กรุงเทพมหานคร', 'Toyota', 'Camry', 2020, 'ดำ', 'MRHAC32L00012345'),
      (2, 'รน 5678 นนทบุรี', 'Honda', 'Civic', 2021, 'ขาว', 'JHMCY23K00056789'),
      (3, 'วว 9999 เชียงใหม่', 'Mazda', 'Mazda 3', 2019, 'แดง', 'JM1BP34M00099999');

      INSERT INTO repairs (vehicle_id, customer_id, mechanic_id, description, status, estimated_cost, actual_cost, estimated_days) VALUES
      (1, 1, 2, 'เปลี่ยนน้ำมันเครื่อง, ผ้าเบรคหน้า และเช็คระยะ 80,000 กม.', 'pending', 3500.00, 0.00, 1),
      (2, 2, 2, 'เครื่องยนต์มีเสียงดังผิดปกติและแอร์ไม่เย็น', 'repairing', 8500.00, 3000.00, 2),
      (3, 3, 2, 'ซ่อมสีและตัวถังบริเวณกันชนท้าย', 'ready', 5000.00, 5000.00, 3);

      INSERT INTO inventory (part_name, part_number, category, stock_qty, min_qty, cost_price, sell_price, supplier) VALUES
      ('น้ำมันเครื่องสังเคราะห์แท้ 4L', 'OIL-SYN-4L', 'ของเหลว', 20, 5, 800.00, 1200.00, 'PTT Lubricants Co., Ltd.'),
      ('กรองน้ำมันเครื่อง Toyota', 'FIL-TOY-001', 'ไส้กรอง', 50, 10, 120.00, 220.00, 'Denso Thailand'),
      ('ผ้าเบรคหน้า Toyota Camry', 'BRK-TOY-002', 'ระบบเบรก', 15, 3, 1100.00, 1800.00, 'Bendix Thailand'),
      ('น้ำยาแอร์ R134a', 'COL-R134A', 'ของเหลว', 2, 5, 500.00, 850.00, 'Cooling Parts Corp.'),
      ('หัวเทียน Honda Civic', 'PLG-HON-003', 'ระบบไฟ', 40, 5, 80.00, 150.00, 'NGK Spark Plugs');
    `);

    sqliteDb.prepare(`
      INSERT INTO finances (repair_id, type, amount, payment_method, status, description, transaction_date) VALUES
      (3, 'income', 5000.00, 'transfer', 'paid', 'ค่าซ่อมสีและตัวถังกันชนท้ายรถมาสด้ารุ่น 3 (ทะเบียน วว 9999)', ?),
      (2, 'income', 3000.00, 'qr', 'pending', 'มัดจำซ่อมแอร์และเครื่องยนต์ Honda Civic (ทะเบียน รน 5678)', ?),
      (NULL, 'expense', 1500.00, 'transfer', 'paid', 'สั่งซื้ออะไหล่ผ้าเบรคและกรองน้ำมันเครื่องเข้าคลัง', ?),
      (NULL, 'expense', 800.00, 'cash', 'paid', 'ค่าน้ำค่าไฟของอู่ประจำเดือน', ?)
    `).run(today, today, today, today);

    sqliteDb.exec(`
      INSERT INTO repair_logs (repair_id, status, notes, updated_by) VALUES
      (1, 'pending', 'ลงทะเบียนรับรถ รอการตรวจสภาพโดยละเอียด', 1),
      (2, 'pending', 'รับรถเรียบร้อย รอช่างประเมินอาการแอร์ไม่เย็น', 1),
      (2, 'inspecting', 'ตรวจเช็คคอมเพรสเซอร์แอร์ พบรอยรั่วและแบริ่งหลวม', 2),
      (2, 'repairing', 'อยู่ระหว่างเบิกคอมเพรสเซอร์แอร์ใหม่และถอดเปลี่ยน', 2),
      (3, 'pending', 'ลงทะเบียนรับรถซ่อมสีกันชนท้าย', 1),
      (3, 'repairing', 'ขัดเตรียมพื้นผิวและพ่นสีใหม่เรียบร้อย', 2),
      (3, 'ready', 'สีแห้งสนิท ล้างทำความสะอาดรถ พร้อมส่งมอบ', 2);

      INSERT INTO audit_logs (user_id, action, details) VALUES
      (1, 'system_init', 'ระบบเริ่มต้นทำงานฐานข้อมูลเรียบร้อย'),
      (1, 'login', 'เจ้าของอู่ สมชาย รักดี เข้าสู่ระบบ');

      INSERT OR IGNORE INTO settings (\`key\`, value) VALUES
      ('line_notify_token', ''),
      ('line_channel_token', ''),
      ('line_channel_secret', ''),
      ('promptpay_number', '0812345678'),
      ('promptpay_name', 'บีที ออโต้ เซอร์วิส (GarageFlow)');
    `);

    sqliteDb.prepare(`
      INSERT OR IGNORE INTO attendances (user_id, work_date, clock_in, clock_out, ot_hours, status, notes)
      VALUES (2, ?, ?, ?, 2.0, 'present', 'เข้างานปกติ + OT ซ่อมแอร์เร่งด่วน')
    `).run(today, `${today} 08:15:00`, `${today} 19:30:00`);
  }

  return sqliteDb;
}

function translateSqlForSqlite(sql) {
  let s = sql.trim();

  if (/^ALTER\s+TABLE\s+/i.test(s) && /\bMODIFY\s+COLUMN\b/i.test(s)) {
    return { noop: true };
  }

  if (/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(settings|attendances)\b/i.test(s)) {
    return { noop: true };
  }

  if (/^ALTER\s+TABLE\s+/i.test(s) && /\bADD\s+COLUMN\b/i.test(s)) {
    s = s
      .replace(/ENUM\([^)]+\)/gi, 'TEXT')
      .replace(/VARCHAR\(\d+\)/gi, 'TEXT')
      .replace(/DECIMAL\(\d+\s*,\s*\d+\)/gi, 'REAL')
      .replace(/DATETIME/gi, 'TEXT');
    return { sql: s, ignoreError: true };
  }

  const showCreateMatch = s.match(/^SHOW\s+CREATE\s+TABLE\s+[`"]?(\w+)[`"]?/i);
  if (showCreateMatch) {
    return { showCreateTable: showCreateMatch[1] };
  }

  s = s.replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT OR IGNORE INTO');
  s = s.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+value\s*=\s*\?/gi, 'ON CONFLICT(`key`) DO UPDATE SET value = ?');
  s = s.replace(/DATE_SUB\s*\(\s*(?:CURDATE\(\)|CURRENT_DATE\(\))\s*,\s*INTERVAL\s+(\d+)\s+MONTH\s*\)/gi, "date('now', 'localtime', '-$1 months')");
  s = s.replace(/DATE_ADD\s*\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+MINUTE\s*\)/gi, "datetime('now', 'localtime', '+$1 minutes')");
  s = s.replace(/CURDATE\(\)/gi, "date('now', 'localtime')");
  s = s.replace(/CURRENT_DATE\(\)/gi, "date('now', 'localtime')");
  s = s.replace(/NOW\(\)/gi, "datetime('now', 'localtime')");
  s = s.replace(/DATE_FORMAT\s*\(\s*([^,]+?)\s*,\s*'([^']+)'\s*\)/gi, "strftime('$2', $1)");
  s = s.replace(/MONTH\s*\(\s*([^)]+?)\s*\)/gi, "CAST(strftime('%m', $1) AS INTEGER)");
  s = s.replace(/YEAR\s*\(\s*([^)]+?)\s*\)/gi, "CAST(strftime('%Y', $1) AS INTEGER)");

  return { sql: s };
}

function executeSqliteQuery(sql, params = []) {
  const db = initSqliteFallback();
  const translated = translateSqlForSqlite(sql);

  if (translated.noop) {
    return [[], []];
  }

  if (translated.showCreateTable) {
    const tbl = translated.showCreateTable;
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(tbl);
    return [[{ Table: tbl, 'Create Table': row ? row.sql : `CREATE TABLE ${tbl} ()` }], []];
  }

  const cleanParams = (params || []).map(p => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString().slice(0, 19).replace('T', ' ');
    return p;
  });

  try {
    const stmt = db.prepare(translated.sql);
    if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(translated.sql)) {
      const rawRows = stmt.all(...cleanParams);
      const plainRows = rawRows.map(r => ({ ...r }));
      return [plainRows, []];
    } else {
      const info = stmt.run(...cleanParams);
      return [{
        insertId: Number(info.lastInsertRowid || 0),
        affectedRows: Number(info.changes || 0)
      }, []];
    }
  } catch (err) {
    if (translated.ignoreError) {
      return [[], []];
    }
    throw err;
  }
}

async function query(sql, params = []) {
  if (!useSqliteFallback) {
    try {
      return await mysqlPool.query(sql, params);
    } catch (err) {
      if (err && (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ENOTFOUND' || err.code === 'ER_BAD_DB_ERROR' || !err.sqlState)) {
        useSqliteFallback = true;
        console.log('[Database] MySQL is offline. Automatically switched to built-in SQLite engine (database/garageflow_local.sqlite).');
        return executeSqliteQuery(sql, params);
      }
      throw err;
    }
  }
  return executeSqliteQuery(sql, params);
}

async function getConnection() {
  if (!useSqliteFallback) {
    try {
      return await mysqlPool.getConnection();
    } catch (err) {
      useSqliteFallback = true;
      console.log('[Database] MySQL is offline. Automatically switched to built-in SQLite engine (database/garageflow_local.sqlite).');
    }
  }

  const db = initSqliteFallback();
  let inTx = false;
  return {
    query: async (sql, params = []) => executeSqliteQuery(sql, params),
    beginTransaction: async () => {
      if (!inTx) {
        db.exec('BEGIN');
        inTx = true;
      }
    },
    commit: async () => {
      if (inTx) {
        db.exec('COMMIT');
        inTx = false;
      }
    },
    rollback: async () => {
      if (inTx) {
        try { db.exec('ROLLBACK'); } catch (e) {}
        inTx = false;
      }
    },
    release: () => {
      if (inTx) {
        try { db.exec('ROLLBACK'); } catch (e) {}
        inTx = false;
      }
    }
  };
}

module.exports = {
  query,
  getConnection
};
