const bcrypt = require('bcryptjs');
const db = require('../config/db');

const getAllMechanics = async (req, res) => {
  const search = req.query.search || '';
  const status = req.query.status || '';
  const role = req.query.role || '';
  const selectedMonth = req.query.month || new Date().toISOString().slice(0, 7);

  try {
    let sql = `
      SELECT u.*,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present_days,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) AS late_days,
        COUNT(CASE WHEN a.status LIKE 'leave%' THEN 1 END) AS leave_days,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) AS absent_days,
        COUNT(CASE WHEN a.status IN ('present', 'late') THEN 1 END) AS work_days,
        COALESCE(SUM(a.ot_hours), 0) AS total_ot_hours
      FROM users u
      LEFT JOIN attendances a ON u.id = a.user_id AND DATE_FORMAT(a.work_date, '%Y-%m') = ?
      WHERE u.role != 'owner'
    `;
    const params = [selectedMonth];

    if (search) {
      sql += ' AND (u.fullname LIKE ? OR u.phone LIKE ? OR u.username LIKE ?)';
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam);
    }

    if (status) {
      sql += ' AND u.status = ?';
      params.push(status);
    }

    if (role) {
      sql += ' AND u.role = ?';
      params.push(role);
    }

    sql += ' GROUP BY u.id ORDER BY u.id DESC';

    const [rows] = await db.query(sql, params);

    const mechanicsWithWages = rows.map(m => {
      let baseWage = 0;
      const rate = parseFloat(m.salary_rate || 0);
      const otRate = parseFloat(m.overtime_rate || 60);
      const workedDays = parseInt(m.work_days || 0);
      const absentDays = parseInt(m.absent_days || 0);
      const totalOtHours = parseFloat(m.total_ot_hours || 0);

      if (m.salary_type === 'daily') {
        baseWage = workedDays * rate;
      } else {

        const dailyDeduct = rate / 30;
        baseWage = Math.max(0, rate - (absentDays * dailyDeduct));
      }

      const otWage = totalOtHours * otRate;
      const totalWage = Math.round(baseWage + otWage);

      return {
        ...m,
        baseWage: Math.round(baseWage),
        totalOtHours: parseFloat(totalOtHours.toFixed(2)),
        otWage: Math.round(otWage),
        estimatedWage: totalWage
      };
    });

    res.render('mechanics/index', {
      title: 'ข้อมูลพนักงาน & สรุปวันทำงาน ค่าจ้าง และค่าล่วงเวลา (OT)',
      activePage: 'mechanics',
      mechanics: mechanicsWithWages,
      selectedMonth: selectedMonth,
      search: search,
      status: status,
      role: role
    });
  } catch (err) {
    console.error('Get Staff Error:', err);
    res.status(500).render('error', {
      title: 'เกิดข้อผิดพลาด',
      message: 'ไม่สามารถดึงข้อมูลพนักงานได้'
    });
  }
};

const addMechanic = async (req, res) => {
  const { username, password, fullname, role, phone, skills, salary_type, salary_rate, overtime_rate } = req.body;

  if (!username || !password || !fullname) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน' });
  }

  try {

    const [existing] = await db.query('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้งาน (Username) นี้มีในระบบแล้ว' });
    }

    const assignedRole = role || 'mechanic';
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `
      INSERT INTO users (username, password, fullname, role, phone, skills, status, salary_type, salary_rate, overtime_rate)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `;
    await db.query(sql, [
      username.trim(),
      hashedPassword,
      fullname.trim(),
      assignedRole,
      phone || null,
      skills || null,
      salary_type || 'daily',
      parseFloat(salary_rate || (salary_type === 'monthly' ? 15000 : 500)),
      parseFloat(overtime_rate || 60)
    ]);

    res.json({ success: true, message: `ลงทะเบียนพนักงานใหม่ [${assignedRole}] พร้อมตั้งค่าอัตราค่าจ้างและ OT สำเร็จ` });
  } catch (err) {
    console.error('Add Staff Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลงทะเบียนพนักงาน' });
  }
};

const editMechanic = async (req, res) => {
  const { id } = req.params;
  const { fullname, role, phone, skills, status, salary_type, salary_rate, overtime_rate } = req.body;

  if (!fullname || !status) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อและเลือกสถานะการทำงาน' });
  }

  try {
    const assignedRole = role || 'mechanic';
    const sql = `
      UPDATE users
      SET fullname = ?, role = ?, phone = ?, skills = ?, status = ?, salary_type = ?, salary_rate = ?, overtime_rate = ?
      WHERE id = ? AND role != 'owner'
    `;
    const [result] = await db.query(sql, [
      fullname.trim(),
      assignedRole,
      phone || null,
      skills || null,
      status,
      salary_type || 'daily',
      parseFloat(salary_rate || 500),
      parseFloat(overtime_rate || 60),
      id
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงานที่ต้องการแก้ไข' });
    }

    res.json({ success: true, message: 'แก้ไขข้อมูล อัตราค่าจ้าง และค่าล่วงเวลา (OT) สำเร็จ' });
  } catch (err) {
    console.error('Edit Staff Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูลพนักงาน' });
  }
};

const paySalary = async (req, res) => {
  const { mechanic_id, month, amount, ot_hours, note } = req.body;

  if (!mechanic_id || !amount) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุข้อมูลการจ่ายเงินให้ครบถ้วน' });
  }

  try {
    const [[staff]] = await db.query('SELECT fullname, role FROM users WHERE id = ?', [mechanic_id]);
    if (!staff) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' });
    }

    const payMonth = month || new Date().toISOString().slice(0, 7);
    const otDetail = ot_hours && parseFloat(ot_hours) > 0 ? ` (รวม OT ${ot_hours} ชม.)` : '';
    const title = `จ่ายค่าตอบแทน: คุณ ${staff.fullname} [${staff.role}] งวด ${payMonth}${otDetail}`;

    const sql = `
      INSERT INTO finances (type, amount, payment_method, status, description, transaction_date)
      VALUES ('expense', ?, 'transfer', 'paid', ?, CURRENT_DATE())
    `;
    await db.query(sql, [parseFloat(amount), note || title]);

    res.json({
      success: true,
      message: `บันทึกการจ่ายค่าตอบแทนจำนวน ${(parseFloat(amount)).toLocaleString()} บาท ลงในระบบบัญชีค่าใช้จ่ายสำเร็จ!`
    });
  } catch (err) {
    console.error('Pay Salary Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกการจ่ายเงิน: ' + err.message });
  }
};

const deleteMechanic = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.query("UPDATE users SET status = 'inactive' WHERE id = ? AND role != 'owner'", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' });
    }
    res.json({ success: true, message: 'ระงับสถานะพนักงานสำเร็จ' });
  } catch (err) {
    console.error('Delete Staff Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการระงับสถานะพนักงาน' });
  }
};

module.exports = {
  getAllMechanics,
  addMechanic,
  editMechanic,
  paySalary,
  deleteMechanic
};
