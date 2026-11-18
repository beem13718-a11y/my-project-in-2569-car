const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./config/db');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;


app.use(helmet({
  contentSecurityPolicy: false
}));


app.use(session({
  secret: process.env.SESSION_SECRET || 'garageflow-secret-key-12345',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  } 
}));


app.use(express.urlencoded({ extended: true }));
app.use(express.json());


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


app.use(express.static(path.join(__dirname, 'public')));


app.use((req, res, next) => {
app.set('trust proxy', 1);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.locals.user = req.session.user || null;
  if (req.path === '/robots.txt') {
    res.type('text/plain');
    return res.send('User-agent: *\nDisallow: /\n');
  }
  const requiredKey = (process.env.SHOP_ACCESS_KEY || '').trim();
  if (requiredKey && req.path !== '/health' && req.path !== '/webhook' && req.path !== '/line/webhook') {
    if (req.query.k && req.query.k === requiredKey) {
      req.session.linkAuthorized = true;
      return res.redirect(req.path);
    }
    if (req.path === `/s/${requiredKey}`) {
      req.session.linkAuthorized = true;
      return res.redirect('/');
    }
    if (!req.session || (!req.session.linkAuthorized && !req.session.user)) {
      return res.status(403).send(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>เฉพาะผู้ที่มีลิงก์ของอู่เท่านั้น</title><style>body{background:#090d16;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}.box{background:#111827;border:1px solid #1e293b;border-radius:16px;padding:32px;max-width:400px;width:100%;text-align:center}input{width:100%;padding:10px 14px;border-radius:10px;border:1px solid #334155;background:#090d16;color:#fff;margin:14px 0;box-sizing:border-box}button{width:100%;padding:10px;border-radius:10px;border:none;background:#0ea5e9;color:#090d16;font-weight:bold;cursor:pointer}</style></head><body><div class="box"><h3>🔒 เฉพาะผู้ที่มีลิงก์เว็บของอู่เท่านั้น</h3><p style="color:#94a3b8;font-size:0.9rem">กรุณาเข้าใช้งานผ่านลิงก์เฉพาะของอู่สมาร์ทการาจ หรือกรอกรหัสลิงก์ด้านล่าง</p><form method="GET" action="/"><input type="password" name="k" placeholder="กรอกรหัสลิงก์เข้าเว็บ..." required><button type="submit">เข้าสู่เว็บไซต์</button></form></div></body></html>`);
    }
  }
  next();
});


const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/auth/login');
};


const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const customerRoutes = require('./routes/customerRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const mechanicRoutes = require('./routes/mechanicRoutes');
const repairRoutes = require('./routes/repairRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const financeRoutes = require('./routes/financeRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const systemRoutes = require('./routes/systemRoutes');
const qrRoutes = require('./routes/qrRoutes');

const systemController = require('./controllers/systemController');


const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100
});

app.post('/line/webhook', webhookLimiter, systemController.lineWebhook);
app.post('/webhook', webhookLimiter, systemController.lineWebhook);
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/customers', customerRoutes);
app.use('/vehicles', vehicleRoutes);
app.use('/mechanics', mechanicRoutes);
app.use('/repairs', repairRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/finances', financeRoutes);
app.use('/attendance', attendanceRoutes);
app.use('/settings', systemRoutes);
app.use('/api/qr', qrRoutes);
app.use('/qr', qrRoutes);

app.get(['/public/track', '/track'], async (req, res) => {
  const queryPlate = (req.query.plate || '').trim();
  let repairs = [];
  if (queryPlate) {
    try {
      const cleanPlate = queryPlate.replace(/\s+/g, '');
      const [rows] = await db.query(`
        SELECT r.*, v.license_plate, v.brand, v.model, v.color, u.fullname AS mechanic_name
        FROM repairs r
        JOIN vehicles v ON r.vehicle_id = v.id
        LEFT JOIN users u ON r.mechanic_id = u.id
        WHERE v.license_plate LIKE ? OR REPLACE(v.license_plate, ' ', '') LIKE ?
        ORDER BY r.id DESC LIMIT 10
      `, [`%${queryPlate}%`, `%${cleanPlate}%`]);

      for (const r of rows) {
        const [parts] = await db.query(`
          SELECT rp.*, i.part_name
          FROM repair_parts rp
          JOIN inventory i ON rp.part_id = i.id
          WHERE rp.repair_id = ?
        `, [r.id]);
        r.parts = parts;
      }
      repairs = rows;
    } catch (err) {
      console.error('Public Track Error:', err);
    }
  }
  res.render('track', {
    title: 'ตรวจสอบสถานะงานซ่อม',
    queryPlate: queryPlate,
    repairs: repairs
  });
});

app.get(['/', '/home'], async (req, res) => {
  const defaultShopReviews = [
    {
      name: 'คุณวิชัย รวยรุ่ง',
      car: 'Toyota Camry • เช็กระยะ & เปลี่ยนผ้าเบรก',
      rating: 5,
      comment: 'บริการดีมากครับ ช่างอธิบายอาการชัดเจน มีรูปถ่ายก่อนและหลังซ่อมให้ดูผ่านหน้าเว็บได้เลย ราคาไม่แพง',
      date: '15 พ.ย. 2569'
    },
    {
      name: 'คุณนารี อ่อนหวาน',
      car: 'Honda Civic • ซ่อมระบบแอร์รถยนต์',
      rating: 5,
      comment: 'แอร์เย็นฉ่ำเหมือนรถป้ายแดงเลยค่ะ ชอบตรงที่มีแจ้งเตือนผ่าน LINE ตลอดว่าซ่อมถึงขั้นตอนไหนแล้ว ไม่ต้องคอยโทรตาม',
      date: '16 พ.ย. 2569'
    },
    {
      name: 'คุณมานะ อดทน',
      car: 'Mazda 3 • ซ่อมสีและตัวถังกันชนท้าย',
      rating: 5,
      comment: 'งานสีเนียนมาก สีตรงรุ่นเป๊ะ ตอนรับรถสแกนจ่ายผ่าน QR พร้อมเพย์ในบิลสะดวกสุดๆ แนะนำอู่นี้เลยครับ',
      date: '18 พ.ย. 2569'
    }
  ];
  let reviews = [...defaultShopReviews];
  try {
    const [rows] = await db.query("SELECT value FROM settings WHERE `key` = 'customer_reviews'");
    if (rows.length > 0 && rows[0].value) {
      const parsed = JSON.parse(rows[0].value);
      if (Array.isArray(parsed) && parsed.length > 0) {
        reviews = parsed;
      }
    }
  } catch (e) {}
  res.render('home', {
    title: 'สมาร์ทการาจ (SmartGarage) - ศูนย์ซ่อมบำรุงรถยนต์ครบวงจร',
    reviews: reviews,
    reviewSuccess: req.query.review_added === '1'
  });
});

app.post('/reviews/add', async (req, res) => {
  const { name, car, rating, comment } = req.body;
  if (name && comment) {
    try {
      const [rows] = await db.query("SELECT value FROM settings WHERE `key` = 'customer_reviews'");
      let reviews = [];
      if (rows.length > 0 && rows[0].value) {
        reviews = JSON.parse(rows[0].value) || [];
      }
      reviews.unshift({
        name: name.trim(),
        car: (car || 'ลูกค้าทั่วไป').trim(),
        rating: Math.min(5, Math.max(1, parseInt(rating) || 5)),
        comment: comment.trim(),
        date: new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
      });
      const jsonStr = JSON.stringify(reviews.slice(0, 15));
      await db.query(
        "INSERT INTO settings (`key`, value) VALUES ('customer_reviews', ?) ON DUPLICATE KEY UPDATE value = ?",
        [jsonStr, jsonStr]
      );
    } catch (e) {
      console.error('Add Review Error:', e);
    }
  }
  res.redirect('/?review_added=1#reviews');
});

app.get('/old-home', (req, res) => {
  res.redirect('/dashboard');
});

app.get('/reports', isAuthenticated, (req, res) => {
  res.redirect('/finances');
});

app.get('/notifications', isAuthenticated, async (req, res) => {
  try {
    const [lowStockItems] = await db.query('SELECT * FROM inventory WHERE stock_qty <= min_qty ORDER BY stock_qty ASC LIMIT 20');
    const [pendingFinances] = await db.query("SELECT * FROM finances WHERE type = 'income' AND status IN ('pending', 'installment') ORDER BY transaction_date DESC LIMIT 20");
    const [recentLogs] = await db.query(`
      SELECT rl.*, v.license_plate, u.fullname AS updated_by_name
      FROM repair_logs rl
      JOIN repairs r ON rl.repair_id = r.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN users u ON rl.updated_by = u.id
      ORDER BY rl.created_at DESC LIMIT 25
    `);
    res.render('notifications', {
      title: 'ระบบแจ้งเตือนและความเคลื่อนไหว',
      activePage: 'notifications',
      lowStockItems: lowStockItems,
      pendingFinances: pendingFinances,
      recentLogs: recentLogs
    });
  } catch (err) {
    console.error('Notifications Error:', err);
    res.status(500).render('error', {
      title: 'เกิดข้อผิดพลาด',
      message: 'ไม่สามารถดึงข้อมูลการแจ้งเตือนได้'
    });
  }
});


app.get('/health', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT 1 + 1 AS solution');
    res.json({ status: 'ok', message: 'Database connected successfully!', solution: rows[0].solution });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Database connection failed', error: err.message });
  }
});


(async () => {
  try {
    await db.query(`
      ALTER TABLE finances 
      MODIFY COLUMN status ENUM('pending', 'paid', 'cancelled', 'installment') DEFAULT 'paid'
    `);
    console.log('[Migration] Table finances modified successfully to support installment status.');
  } catch (err) {
    console.error('[Migration Error] Failed to alter table finances:', err.message);
  }

  try {
    await db.query(`
      ALTER TABLE finances 
      ADD COLUMN installment_terms VARCHAR(50) DEFAULT NULL
    `);
    console.log('[Migration] Column installment_terms added to table finances.');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('[Migration Error] Failed to add column installment_terms:', err.message);
    }
  }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(100) UNIQUE NOT NULL,
        value TEXT DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await db.query("INSERT IGNORE INTO settings (\`key\`, value) VALUES ('line_notify_token', '')");
    await db.query("INSERT IGNORE INTO settings (\`key\`, value) VALUES ('line_channel_token', '')");
    await db.query("INSERT IGNORE INTO settings (\`key\`, value) VALUES ('line_channel_secret', '')");
    console.log('[Migration] Table settings created and seeded.');
  } catch (err) {
    console.error('[Migration Error] Failed to create settings table:', err.message);
  }

  try {
    await db.query(`
      ALTER TABLE customers 
      ADD COLUMN line_id VARCHAR(100) DEFAULT NULL
    `);
    console.log('[Migration] Column line_id added to table customers.');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.error('[Migration Error] Failed to add column line_id to customers:', err.message);
    }
  }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS attendances (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        work_date DATE NOT NULL,
        clock_in DATETIME DEFAULT NULL,
        clock_out DATETIME DEFAULT NULL,
        status ENUM('present', 'late', 'leave_sick', 'leave_business', 'leave_vacation', 'absent') DEFAULT 'present',
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_date (user_id, work_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[Migration] Table attendances checked/created successfully.');
  } catch (err) {
    console.error('[Migration Error] Failed to create attendances table:', err.message);
  }


  try {
    await db.query(`
      ALTER TABLE users 
      MODIFY COLUMN role ENUM('owner', 'mechanic', 'receptionist', 'inventory') NOT NULL
    `);
    console.log('[Migration] Column role in table users expanded to include receptionist & inventory.');
  } catch (err) {
    console.error('[Migration Error] Failed to alter role column in users:', err.message);
  }

  try {
    await db.query("ALTER TABLE users ADD COLUMN salary_type ENUM('daily', 'monthly') DEFAULT 'daily'");
    console.log('[Migration] Column salary_type added to table users.');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[Migration Error] salary_type:', err.message);
  }

  try {
    await db.query("ALTER TABLE users ADD COLUMN salary_rate DECIMAL(10, 2) DEFAULT 500.00");
    console.log('[Migration] Column salary_rate added to table users.');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[Migration Error] salary_rate:', err.message);
  }

  try {
    await db.query("ALTER TABLE users ADD COLUMN overtime_rate DECIMAL(10, 2) DEFAULT 60.00");
    console.log('[Migration] Column overtime_rate added to table users.');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[Migration Error] overtime_rate:', err.message);
  }

  try {
    await db.query("ALTER TABLE users ADD COLUMN reset_token VARCHAR(100) DEFAULT NULL");
    console.log('[Migration] Column reset_token added to table users.');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[Migration Error] reset_token:', err.message);
  }

  try {
    await db.query("ALTER TABLE users ADD COLUMN reset_expires DATETIME DEFAULT NULL");
    console.log('[Migration] Column reset_expires added to table users.');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[Migration Error] reset_expires:', err.message);
  }

  try {
    await db.query("ALTER TABLE attendances ADD COLUMN ot_hours DECIMAL(4, 2) DEFAULT 0.00");
    console.log('[Migration] Column ot_hours added to table attendances.');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[Migration Error] ot_hours:', err.message);
  }
})();


app.use((err, req, res, next) => {
  console.error('[Global Error]', err.stack);
  res.status(500);

  if (req.xhr || req.headers.accept.indexOf('json') > -1) {
    return res.json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' });
  }

  res.render('error', { 
    title: 'Server Error', 
    message: 'เกิดข้อผิดพลาดทางเทคนิคภายในระบบ (500 Internal Server Error)' 
  });
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(` GarageFlow Server is running on port ${PORT}`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(` Health check: http://localhost:${PORT}/health`);
  console.log(`==================================================`);
});
