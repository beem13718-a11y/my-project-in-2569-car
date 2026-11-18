const db = require('../config/db');


const getAllFinances = async (req, res) => {
  let dateFrom = req.query.date_from || '';
  let dateTo = req.query.date_to || '';
  const period = req.query.period || '';
  const filterOption = req.query.filter_option || '';
  const search = req.query.search || '';


  let type = '';
  let status = '';
  let paymentMethod = '';
  if (filterOption) {
    const [key, val] = filterOption.split(':');
    if (key === 'type') type = val;
    if (key === 'status') status = val;
    if (key === 'method') paymentMethod = val;
  }


  if (period) {
    const today = new Date();

    const formatDate = (date) => {
      const offset = date.getTimezoneOffset();
      const localDate = new Date(date.getTime() - (offset * 60 * 1000));
      return localDate.toISOString().split('T')[0];
    };

    if (period === 'today') {
      const todayStr = formatDate(today);
      dateFrom = todayStr;
      dateTo = todayStr;
    } else if (period === 'this_week') {
      const day = today.getDay();

      const diffToMonday = today.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(today.setDate(diffToMonday));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      
      dateFrom = formatDate(monday);
      dateTo = formatDate(sunday);
    } else if (period === 'this_month') {
      const y = today.getFullYear();
      const m = today.getMonth();
      const firstDay = new Date(y, m, 1);
      const lastDay = new Date(y, m + 1, 0);
      
      dateFrom = formatDate(firstDay);
      dateTo = formatDate(lastDay);
    } else if (period === 'this_quarter') {
      const y = today.getFullYear();
      const m = today.getMonth();
      const qStartMonth = Math.floor(m / 3) * 3;
      const firstDay = new Date(y, qStartMonth, 1);
      const lastDay = new Date(y, qStartMonth + 3, 0);
      
      dateFrom = formatDate(firstDay);
      dateTo = formatDate(lastDay);
    }
  }

  try {

    let sql = `
      SELECT f.*, r.id AS repair_code, v.license_plate, c.fullname AS customer_name, c.phone AS customer_phone 
      FROM finances f
      LEFT JOIN repairs r ON f.repair_id = r.id
      LEFT JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN customers c ON r.customer_id = c.id
      WHERE 1=1
    `;
    const params = [];


    if (type) {
      sql += ' AND f.type = ?';
      params.push(type);
    }


    if (status) {
      sql += ' AND f.status = ?';
      params.push(status);
    }


    if (paymentMethod) {
      sql += ' AND f.payment_method = ?';
      params.push(paymentMethod);
    }


    if (dateFrom) {
      sql += ' AND f.transaction_date >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ' AND f.transaction_date <= ?';
      params.push(dateTo);
    }


    if (search) {
      sql += ` AND (
        f.id = ? 
        OR c.fullname LIKE ? 
        OR c.phone LIKE ? 
        OR v.license_plate LIKE ? 
        OR f.description LIKE ?
      )`;
      const searchLike = `%${search}%`;
      const searchInt = parseInt(search) || 0;
      params.push(searchInt, searchLike, searchLike, searchLike, searchLike);
    }

    sql += ' ORDER BY f.transaction_date DESC, f.id DESC';

    const [rows] = await db.query(sql, params);


    let totalIncome = 0;
    let totalExpense = 0;
    let totalPending = 0;
    let totalCancelled = 0;

    rows.forEach(t => {
      const amt = parseFloat(t.amount) || 0;
      if (t.type === 'income') {
        if (t.status === 'paid') {
          totalIncome += amt;
        } else if (t.status === 'pending' || t.status === 'installment') {
          totalPending += amt;
        } else if (t.status === 'cancelled') {
          totalCancelled += amt;
        }
      } else if (t.type === 'expense') {

        totalExpense += amt;
      }
    });

    const netProfit = totalIncome - totalExpense;


    let cashSum = 0, transferSum = 0, qrSum = 0;
    rows.forEach(t => {
      if (t.status === 'paid' && t.type === 'income') {
        const amt = parseFloat(t.amount) || 0;
        if (t.payment_method === 'cash') cashSum += amt;
        else if (t.payment_method === 'transfer') transferSum += amt;
        else if (t.payment_method === 'qr') qrSum += amt;
      }
    });


    const [pendingPayments] = await db.query(`
      SELECT r.id, r.actual_cost, v.license_plate, c.fullname AS owner_name 
      FROM repairs r
      JOIN vehicles v ON r.vehicle_id = v.id
      JOIN customers c ON r.customer_id = c.id
      WHERE r.status = 'ready' AND r.id NOT IN (SELECT DISTINCT repair_id FROM finances WHERE type = 'income' AND repair_id IS NOT NULL)
      ORDER BY r.id DESC
    `);


    const d1 = new Date(dateFrom);
    const d2 = new Date(dateTo);
    const timeDiff = Math.abs(d2.getTime() - d1.getTime());
    const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));

    let trendQuery = '';
    let trendParams = [dateFrom + ' 00:00:00', dateTo + ' 23:59:59'];

    if (diffDays <= 1) {

      trendQuery = `
        SELECT DATE_FORMAT(transaction_date, '%H:00') AS label,
               SUM(CASE WHEN type = 'income' AND status = 'paid' THEN amount ELSE 0 END) AS income,
               SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
        FROM finances
        WHERE transaction_date >= ? AND transaction_date <= ?
        GROUP BY label
        ORDER BY label ASC
      `;
    } else if (diffDays <= 31) {

      trendQuery = `
        SELECT DATE_FORMAT(transaction_date, '%d/%m') AS label,
               SUM(CASE WHEN type = 'income' AND status = 'paid' THEN amount ELSE 0 END) AS income,
               SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
        FROM finances
        WHERE transaction_date >= ? AND transaction_date <= ?
        GROUP BY label
        ORDER BY MIN(transaction_date) ASC
      `;
    } else {

      trendQuery = `
        SELECT DATE_FORMAT(transaction_date, '%m/%Y') AS label,
               SUM(CASE WHEN type = 'income' AND status = 'paid' THEN amount ELSE 0 END) AS income,
               SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
        FROM finances
        WHERE transaction_date >= ? AND transaction_date <= ?
        GROUP BY label
        ORDER BY MIN(transaction_date) ASC
      `;
    }

    const [chartHistory] = await db.query(trendQuery, trendParams);

    const chartLabels = [];
    const chartIncome = [];
    const chartExpense = [];

    const monthNamesThai = {
      '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.', '05': 'พ.ค.', '06': 'มิ.ย.',
      '07': 'ก.ค.', '08': 'ส.ค.', '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.'
    };

    chartHistory.forEach(h => {
      let lbl = h.label;
      if (lbl.includes('/')) {
        const parts = lbl.split('/');
        if (parts[1] && parts[1].length === 4) {

          lbl = `${monthNamesThai[parts[0]] || parts[0]} ${parts[1].substring(2)}`;
        }
      }
      chartLabels.push(lbl);
      chartIncome.push(parseFloat(h.income) || 0);
      chartExpense.push(parseFloat(h.expense) || 0);
    });

    if (chartLabels.length === 0) {
      chartLabels.push('ไม่มีรายการ');
      chartIncome.push(0);
      chartExpense.push(0);
    }

    res.render('finance/index', {
      title: 'การเงินอู่ซ่อม',
      activePage: 'finances',
      transactions: rows,
      pendingPayments: pendingPayments,
      summary: {
        income: totalIncome,
        expense: totalExpense,
        pending: totalPending,
        cancelled: totalCancelled,
        profit: netProfit
      },
      charts: {
        labels: JSON.stringify(chartLabels),
        income: JSON.stringify(chartIncome),
        expense: JSON.stringify(chartExpense),
        methods: JSON.stringify([cashSum, transferSum, qrSum])
      },
      filters: {
        type: type,
        status: status,
        paymentMethod: paymentMethod,
        search: search,
        dateFrom: dateFrom,
        dateTo: dateTo,
        period: period,
        filterOption: filterOption
      }
    });
  } catch (err) {
    console.error('Get Finance Error:', err);
    res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถดึงข้อมูลบัญชีและการเงินได้' });
  }
};


const recordIncome = async (req, res) => {
  const { repair_id, payment_method, status, installment_terms } = req.body;

  if (!repair_id || !payment_method) {
    return res.status(400).json({ success: false, message: 'กรุณาเลือกใบซ่อมและช่องทางการชำระเงิน' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();


    const [[repair]] = await conn.query(`
      SELECT r.*, v.license_plate, c.fullname AS owner_name 
      FROM repairs r
      JOIN vehicles v ON r.vehicle_id = v.id
      JOIN customers c ON r.customer_id = c.id
      WHERE r.id = ?
    `, [repair_id]);

    if (!repair) throw new Error('ไม่พบใบสั่งซ่อมที่เลือก');
    if (repair.status !== 'ready') throw new Error('ใบสั่งซ่อมนี้ไม่อยู่ในสถานะที่สามารถรับชำระเงินได้ (กรุณาปิดงานก่อน)');

    const actualCost = parseFloat(repair.actual_cost);
    if (actualCost <= 0) throw new Error('ค่าบริการซ่อมจริงต้องมากกว่า 0 บาท');

    const paymentStatus = (status && ['paid', 'installment', 'pending'].includes(status)) ? status : 'paid';
    const terms = paymentStatus === 'installment' ? (installment_terms || null) : null;


    const insertSql = `
      INSERT INTO finances (repair_id, type, amount, payment_method, status, installment_terms, description, transaction_date) 
      VALUES (?, 'income', ?, ?, ?, ?, ?, ?)
    `;
    const desc = `ชำระเงินค่าบริการซ่อมรถทะเบียน ${repair.license_plate} (ใบสั่งซ่อม #${repair.id})`;
    const currentDate = new Date().toISOString().split('T')[0];

    await conn.query(insertSql, [repair_id, actualCost, payment_method, paymentStatus, terms, desc, currentDate]);


    await conn.query("UPDATE repairs SET status = 'completed' WHERE id = ?", [repair_id]);


    const methodText = payment_method === 'cash' ? 'เงินสด' : payment_method === 'transfer' ? 'โอนผ่านบัญชีธนาคาร' : 'QR Code';
    await conn.query(`
      INSERT INTO repair_logs (repair_id, status, notes, updated_by) 
      VALUES (?, 'completed', ?, ?)
    `, [repair_id, `รับชำระเงินจำนวน ${actualCost.toLocaleString()} บาท ผ่านช่องทาง [${methodText}] และเปลี่ยนสถานะเป็นส่งมอบรถเรียบร้อย`, req.session.user.id]);

    await conn.commit();
    res.json({ success: true, message: 'รับชำระเงินและส่งมอบรถคืนลูกค้าเรียบร้อยแล้ว!' });
  } catch (err) {
    await conn.rollback();
    console.error('Record Income Error:', err);
    res.status(500).json({ success: false, message: err.message || 'เกิดข้อผิดพลาดในการบันทึกรับเงิน' });
  } finally {
    conn.release();
  }
};


const recordExpense = async (req, res) => {
  const { amount, description, payment_method, transaction_date } = req.body;

  if (!amount || !description || !payment_method || !transaction_date) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลรายจ่ายให้ครบถ้วน' });
  }

  try {
    const sql = `
      INSERT INTO finances (type, amount, payment_method, status, description, transaction_date) 
      VALUES ('expense', ?, ?, 'paid', ?, ?)
    `;
    await db.query(sql, [
      parseFloat(amount),
      payment_method,
      description,
      transaction_date
    ]);

    res.json({ success: true, message: 'บันทึกรายจ่ายเข้าระบบสำเร็จ' });
  } catch (err) {
    console.error('Record Expense Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดทางเทคนิคในการบันทึกรายจ่าย' });
  }
};


const settlePayment = async (req, res) => {
  const { id } = req.params;
  const { payment_method } = req.body;

  try {
    const [[tx]] = await db.query('SELECT * FROM finances WHERE id = ?', [id]);
    if (!tx) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการธุรกรรมนี้' });
    }
    if (tx.status === 'paid') {
      return res.status(400).json({ success: false, message: 'รายการนี้ชำระเงินเรียบร้อยแล้ว' });
    }

    const method = ['cash', 'transfer', 'qr'].includes(payment_method) ? payment_method : (tx.payment_method || 'qr');
    await db.query("UPDATE finances SET status = 'paid', payment_method = ? WHERE id = ?", [method, id]);

    if (tx.repair_id) {
      await db.query("UPDATE repairs SET status = 'completed' WHERE id = ? AND status = 'ready'", [tx.repair_id]);
      const methodLabel = method === 'cash' ? 'เงินสด' : method === 'transfer' ? 'โอนเงิน' : 'QR PromptPay';
      await db.query(
        'INSERT INTO repair_logs (repair_id, status, notes, updated_by) VALUES (?, ?, ?, ?)',
        [tx.repair_id, 'completed', `ปิดยอดรับชำระเงินจำนวน ${parseFloat(tx.amount).toLocaleString()} บาท ผ่าน [${methodLabel}]`, req.session.user.id]
      );
    }

    res.json({ success: true, message: `ปิดยอดรับชำระเงินจำนวน ${parseFloat(tx.amount).toLocaleString()} บาท เรียบร้อยแล้ว!` });
  } catch (err) {
    console.error('Settle Payment Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการปิดยอดชำระเงิน' });
  }
};


const exportFinancesCsv = async (req, res) => {
  const dateFrom = req.query.date_from || '';
  const dateTo = req.query.date_to || '';
  const filterOption = req.query.filter_option || '';
  const search = req.query.search || '';

  let type = '';
  let status = '';
  let paymentMethod = '';
  if (filterOption) {
    const [key, val] = filterOption.split(':');
    if (key === 'type') type = val;
    if (key === 'status') status = val;
    if (key === 'method') paymentMethod = val;
  }

  try {
    let sql = `
      SELECT f.*, v.license_plate, c.fullname AS customer_name
      FROM finances f
      LEFT JOIN repairs r ON f.repair_id = r.id
      LEFT JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN customers c ON r.customer_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (type) { sql += ' AND f.type = ?'; params.push(type); }
    if (status) { sql += ' AND f.status = ?'; params.push(status); }
    if (paymentMethod) { sql += ' AND f.payment_method = ?'; params.push(paymentMethod); }
    if (dateFrom) { sql += ' AND f.transaction_date >= ?'; params.push(dateFrom); }
    if (dateTo) { sql += ' AND f.transaction_date <= ?'; params.push(dateTo); }
    if (search) {
      sql += ' AND (f.id = ? OR c.fullname LIKE ? OR c.phone LIKE ? OR v.license_plate LIKE ? OR f.description LIKE ?)';
      const s = `%${search}%`;
      params.push(parseInt(search) || 0, s, s, s, s);
    }
    sql += ' ORDER BY f.transaction_date DESC, f.id DESC';

    const [rows] = await db.query(sql, params);

    const escapeCsv = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
    const headers = ['เลขที่เอกสาร', 'วันที่', 'ประเภท', 'รายละเอียด', 'ทะเบียนรถ', 'ลูกค้า', 'วิธีชำระเงิน', 'สถานะ', 'จำนวนเงิน (บาท)'];
    const lines = [headers.map(escapeCsv).join(',')];

    rows.forEach(t => {
      const docNo = `#INV-${t.repair_id ? t.repair_id : 'GEN-' + t.id}`;
      const dateStr = new Date(t.transaction_date).toLocaleDateString('th-TH');
      const typeStr = t.type === 'income' ? 'รายรับ' : 'รายจ่าย';
      const methodStr = t.payment_method === 'cash' ? 'เงินสด' : t.payment_method === 'transfer' ? 'โอนเงิน' : 'QR Code';
      const statusMap = { paid: 'ชำระแล้ว', pending: 'ค้างชำระ', installment: 'ผ่อนชำระ', cancelled: 'ยกเลิก' };
      const amtStr = (t.type === 'income' ? '' : '-') + parseFloat(t.amount || 0).toFixed(2);

      lines.push([
        docNo,
        dateStr,
        typeStr,
        t.description || '-',
        t.license_plate || '-',
        t.customer_name || '-',
        methodStr,
        statusMap[t.status] || t.status,
        amtStr
      ].map(escapeCsv).join(','));
    });

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const filename = `garageflow_finances_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Export Finance CSV Error:', err);
    res.status(500).send('เกิดข้อผิดพลาดในการส่งออกไฟล์รายงานการเงิน');
  }
};

module.exports = {
  getAllFinances,
  recordIncome,
  recordExpense,
  settlePayment,
  exportFinancesCsv
};
