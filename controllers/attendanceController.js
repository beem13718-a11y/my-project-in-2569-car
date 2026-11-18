const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../config/db');
const notificationService = require('../services/notificationService');

const formatDate = (d) => {
  const date = d ? new Date(d) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getRollingMinuteToken = (offsetMinutes = 0) => {
  const secretKey = process.env.SESSION_SECRET || 'garageflow-secret-key-2026';
  const now = new Date();

  const windowTime = Math.floor(now.getTime() / (60 * 1000)) + offsetMinutes;
  return crypto.createHmac('sha256', secretKey).update(`qr-window-${windowTime}`).digest('hex').substring(0, 16);
};

const isValidRollingToken = (token) => {
  const current = getRollingMinuteToken(0);
  const prev = getRollingMinuteToken(-1);
  return token === current || token === prev;
};

const getAttendancePage = async (req, res) => {
  const selectedDate = req.query.date ? req.query.date : formatDate();
  const isOwner = req.session.user.role === 'owner';

  try {

    const [staffList] = await db.query(`
      SELECT id, username, fullname, role, phone, skills, status
      FROM users
      WHERE role != 'owner' AND status = 'active'
      ORDER BY fullname ASC
    `);

    const [attendanceRows] = await db.query(`
      SELECT a.*, u.fullname, u.username, u.role, u.phone
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      WHERE a.work_date = ? AND u.role != 'owner'
    `, [selectedDate]);

    const attendanceMap = {};
    attendanceRows.forEach(a => {
      attendanceMap[a.user_id] = a;
    });

    const fullStaffStatus = staffList.map(s => {
      const att = attendanceMap[s.id] || null;
      let status = 'not_clocked_in';
      if (att) {
        status = att.status;
      }
      return {
        ...s,
        attendance: att,
        currentStatus: status
      };
    });

    const presentCount = attendanceRows.filter(a => a.status === 'present').length;
    const lateCount = attendanceRows.filter(a => a.status === 'late').length;
    const leaveCount = attendanceRows.filter(a => a.status.startsWith('leave')).length;
    const absentCount = attendanceRows.filter(a => a.status === 'absent').length;
    const notClockedInCount = staffList.length - attendanceRows.length;

    const summary = {
      totalStaff: staffList.length,
      presentCount: presentCount,
      lateCount: lateCount,
      leaveCount: leaveCount,
      absentCount: absentCount,
      notClockedInCount: notClockedInCount
    };

    const [recentLogs] = await db.query(`
      SELECT a.*, u.fullname, u.role
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      WHERE u.role != 'owner'
      ORDER BY a.work_date DESC, a.created_at DESC
      LIMIT 15
    `);

    const todayStr = formatDate();
    const isPastDate = selectedDate < todayStr;

    res.render('attendance/index', {
      title: 'เช็คชื่อเข้างานลูกจ้าง & บันทึกเวลาทำงาน',
      activePage: 'attendance',
      selectedDate: selectedDate,
      todayStr: todayStr,
      isPastDate: isPastDate,
      staffStatusList: fullStaffStatus,
      staffList: staffList,
      summary: summary,
      recentLogs: recentLogs,
      isOwner: isOwner
    });
  } catch (err) {
    console.error('Get Attendance Page Error:', err);
    res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถดึงข้อมูลระบบเช็คชื่อได้' });
  }
};

const quickUpdateStatus = async (req, res) => {
  const { user_id, work_date, status, clock_in_time, clock_out_time, ot_hours, notes } = req.body;
  const targetDate = work_date || formatDate();

  if (!user_id || !status) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุพนักงานและสถานะ' });
  }

  try {
    let clockInVal = null;
    let clockOutVal = null;
    const parsedOt = parseFloat(ot_hours) || 0.00;

    if (status === 'present') {
      clockInVal = clock_in_time ? `${targetDate} ${clock_in_time}` : `${targetDate} 08:30:00`;
      if (clock_out_time) clockOutVal = `${targetDate} ${clock_out_time}`;
    } else if (status === 'late') {
      clockInVal = clock_in_time ? `${targetDate} ${clock_in_time}` : `${targetDate} 09:00:00`;
      if (clock_out_time) clockOutVal = `${targetDate} ${clock_out_time}`;
    } else if (status.startsWith('leave') || status === 'absent') {
      clockInVal = null;
      clockOutVal = null;
    }

    const sql = `
      INSERT INTO attendances (user_id, work_date, clock_in, clock_out, ot_hours, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        clock_in = VALUES(clock_in),
        clock_out = VALUES(clock_out),
        ot_hours = VALUES(ot_hours),
        status = VALUES(status),
        notes = VALUES(notes)
    `;

    await db.query(sql, [user_id, targetDate, clockInVal, clockOutVal, parsedOt, status, notes || null]);

    const [[staff]] = await db.query('SELECT fullname FROM users WHERE id = ?', [user_id]);

    const statusNames = {
      'present': '✅ มาทำงาน (ตรงเวลา)',
      'late': '⚠️ มาสาย',
      'leave_business': '🏖️ ลากิจ',
      'leave_sick': '🏥 ลาป่วย',
      'leave_vacation': '🌴 ลาพักร้อน',
      'absent': '❌ ขาดงาน'
    };

    res.json({
      success: true,
      message: `บันทึกสถานะของ "${staff.fullname}" เป็น ${statusNames[status] || status} สำเร็จ!`
    });
  } catch (err) {
    console.error('Quick Update Attendance Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
};

const clockIn = async (req, res) => {
  const userId = req.body.user_id || req.session.user.id;
  const today = formatDate();
  const selectedTime = req.body.custom_time;
  const now = new Date();

  let timeStr = selectedTime ? `${selectedTime}:00` : now.toTimeString().split(' ')[0];
  const nowFull = `${today} ${timeStr}`;

  const checkHour = selectedTime ? parseInt(selectedTime.split(':')[0]) : now.getHours();
  const checkMin = selectedTime ? parseInt(selectedTime.split(':')[1]) : now.getMinutes();
  const isLate = (checkHour > 8 || (checkHour === 8 && checkMin > 30));
  const status = req.body.status || (isLate ? 'late' : 'present');

  try {
    const [[existing]] = await db.query('SELECT * FROM attendances WHERE user_id = ? AND work_date = ?', [userId, today]);

    if (existing) {
      await db.query(`
        UPDATE attendances
        SET clock_in = ?, status = ?, notes = ?
        WHERE id = ?
      `, [nowFull, status, req.body.notes || existing.notes, existing.id]);
    } else {
      await db.query(`
        INSERT INTO attendances (user_id, work_date, clock_in, status, notes)
        VALUES (?, ?, ?, ?, ?)
      `, [userId, today, nowFull, status, req.body.notes || null]);
    }

    const [[staff]] = await db.query('SELECT fullname, role FROM users WHERE id = ?', [userId]);

    const lateText = status === 'late' ? '⚠️ (มาสาย)' : '✅ (ตรงเวลา)';
    const lineMsg = {
      type: 'text',
      text: `🕒 [เช็คชื่อเข้างาน - BT Auto]\n• ลูกจ้าง: คุณ ${staff.fullname}\n• เวลาเข้างาน: ${timeStr.slice(0, 5)} น.\n• สถานะ: ${lateText}\n• วันที่: ${today}`
    };
    notificationService.sendToAdmin([lineMsg]).catch(() => {});

    res.json({
      success: true,
      message: `บันทึกเวลาเข้างานของ ${staff.fullname} (${timeStr.slice(0, 5)} น.) สำเร็จ!`,
      clockInTime: nowFull,
      status: status
    });
  } catch (err) {
    console.error('Clock-In Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลงเวลาเข้างาน: ' + err.message });
  }
};

const clockOut = async (req, res) => {
  const userId = req.body.user_id || req.session.user.id;
  const today = formatDate();
  const selectedTime = req.body.custom_time;
  const now = new Date();
  const timeStr = selectedTime ? `${selectedTime}:00` : now.toTimeString().split(' ')[0];
  const nowFull = `${today} ${timeStr}`;

  try {
    const [[existing]] = await db.query('SELECT * FROM attendances WHERE user_id = ? AND work_date = ?', [userId, today]);
    if (!existing || !existing.clock_in) {
      return res.status(400).json({ success: false, message: 'ยังไม่พบเวลาเข้างานของวันนี้' });
    }

    await db.query('UPDATE attendances SET clock_out = ? WHERE id = ?', [nowFull, existing.id]);

    const [[staff]] = await db.query('SELECT fullname FROM users WHERE id = ?', [userId]);

    const lineMsg = {
      type: 'text',
      text: `🏁 [ลงเวลาออกงาน - BT Auto]\n• ลูกจ้าง: คุณ ${staff.fullname}\n• เวลาออกงาน: ${timeStr.slice(0, 5)} น.\n• วันที่: ${today}`
    };
    notificationService.sendToAdmin([lineMsg]).catch(() => {});

    res.json({
      success: true,
      message: `บันทึกเวลาออกงานของ ${staff.fullname} (${timeStr.slice(0, 5)} น.) สำเร็จ!`
    });
  } catch (err) {
    console.error('Clock-Out Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลงเวลาออกงาน: ' + err.message });
  }
};

const manualAttendanceRecord = async (req, res) => {
  const { user_id, work_date, clock_in_time, clock_out_time, ot_hours, status, notes } = req.body;

  if (!user_id || !work_date || !status) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    let clockInVal = null;
    let clockOutVal = null;
    const parsedOt = parseFloat(ot_hours) || 0.00;

    if (status === 'present' || status === 'late') {
      if (clock_in_time) clockInVal = `${work_date} ${clock_in_time}:00`;
      if (clock_out_time) clockOutVal = `${work_date} ${clock_out_time}:00`;
    }

    const sql = `
      INSERT INTO attendances (user_id, work_date, clock_in, clock_out, ot_hours, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        clock_in = VALUES(clock_in),
        clock_out = VALUES(clock_out),
        ot_hours = VALUES(ot_hours),
        status = VALUES(status),
        notes = VALUES(notes)
    `;

    await db.query(sql, [user_id, work_date, clockInVal, clockOutVal, parsedOt, status, notes || null]);

    res.json({ success: true, message: 'บันทึกข้อมูลการเช็คชื่อ/การลาเรียบร้อยแล้ว!' });
  } catch (err) {
    console.error('Manual Attendance Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
};

const verifyUnlock = async (req, res) => {
  const { password } = req.body;
  const userId = req.session.user.id;

  if (!password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสผ่านเพื่อปลดล็อก' });
  }

  try {
    const [[user]] = await db.query('SELECT password, role FROM users WHERE id = ?', [userId]);
    if (!user || user.role !== 'owner') {
      return res.status(403).json({ success: false, message: 'เฉพาะเจ้าของร้านเท่านั้นที่มีสิทธิ์ปลดล็อก' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'รหัสผ่านเจ้าของร้านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' });
    }

    res.json({ success: true, message: 'ยืนยันรหัสผ่านถูกต้อง ปลดล็อกการแก้ไขย้อนหลังสำเร็จ!' });
  } catch (err) {
    console.error('Verify Unlock Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบรหัสผ่าน' });
  }
};

const getQrKioskPage = async (req, res) => {
  const today = formatDate();
  const token = getRollingMinuteToken(0);

  const protocol = req.protocol;
  const host = req.get('host');
  const scanUrl = `${protocol}://${host}/attendance/scan?token=${token}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      width: 360,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    const [todayRows] = await db.query(`
      SELECT a.*, u.fullname, u.skills
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      WHERE a.work_date = ?
      ORDER BY a.clock_in DESC
    `, [today]);

    res.render('attendance/kiosk', {
      title: 'Kiosk เช็คชื่อเข้างานประจำวัน - สแกน QR Code',
      today: today,
      token: token,
      qrDataUrl: qrDataUrl,
      scanUrl: scanUrl,
      todayRows: todayRows
    });
  } catch (err) {
    console.error('QR Kiosk Error:', err);
    res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถสร้าง QR Code สำหรับลงเวลาได้' });
  }
};

const getQrDataApi = async (req, res) => {
  const today = formatDate();
  const token = getRollingMinuteToken(0);
  const protocol = req.protocol;
  const host = req.get('host');
  const scanUrl = `${protocol}://${host}/attendance/scan?token=${token}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      width: 360,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    const [todayRows] = await db.query(`
      SELECT a.*, u.fullname, u.skills
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      WHERE a.work_date = ?
      ORDER BY a.clock_in DESC
    `, [today]);

    res.json({
      success: true,
      qrDataUrl: qrDataUrl,
      token: token,
      scanUrl: scanUrl,
      checkedCount: todayRows.length,
      todayRows: todayRows
    });
  } catch (err) {
    console.error('API QR Data Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถสร้าง QR Code ได้' });
  }
};

const getScanPage = async (req, res) => {
  const { token } = req.query;
  const today = formatDate();

  if (!token || !isValidRollingToken(token)) {
    return res.status(403).render('error', {
      title: 'QR Code หมดอายุ (Expired)',
      message: 'รหัส QR Code นี้หมดอายุแล้ว (ระบบรีเฟรชรหัสใหม่ทุก 1 นาที) กรุณาสแกนรหัสใหม่จากหน้าจอคอมพิวเตอร์ของร้าน'
    });
  }

  try {

    const [mechanics] = await db.query(`
      SELECT id, fullname, username, skills, phone
      FROM users
      WHERE role != 'owner' AND status = 'active'
      ORDER BY fullname ASC
    `);

    const [attendances] = await db.query('SELECT user_id, clock_in, clock_out, status FROM attendances WHERE work_date = ?', [today]);
    const attMap = {};
    attendances.forEach(a => { attMap[a.user_id] = a; });

    const staffList = mechanics.map(m => ({
      ...m,
      attendance: attMap[m.id] || null
    }));

    res.render('attendance/scan', {
      title: 'สแกนลงเวลาเข้างานประจำวัน',
      today: today,
      token: token,
      staffList: staffList,
      currentUser: req.session.user || null
    });
  } catch (err) {
    console.error('Scan Page Error:', err);
    res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถโหลดหน้าลงเวลาได้' });
  }
};

const processScanCheckIn = async (req, res) => {
  const { user_id, token, notes } = req.body;
  const today = formatDate();

  if (!token || !isValidRollingToken(token)) {
    return res.status(403).json({ success: false, message: 'รหัสยืนยัน QR Code หมดอายุแล้ว (กรุณาสแกนใหม่จากหน้าจอ)' });
  }

  if (!user_id) {
    return res.status(400).json({ success: false, message: 'กรุณาเลือกช่างที่ต้องการลงเวลา' });
  }

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  const nowFull = `${today} ${timeStr}`;

  const isLate = (now.getHours() > 8 || (now.getHours() === 8 && now.getMinutes() > 30));
  const status = isLate ? 'late' : 'present';

  try {
    const [[existing]] = await db.query('SELECT * FROM attendances WHERE user_id = ? AND work_date = ?', [user_id, today]);

    if (existing && existing.clock_in) {
      return res.status(400).json({
        success: false,
        message: `คุณได้ลงเวลาเข้างานของวันนี้ไปแล้วเมื่อเวลา ${new Date(existing.clock_in).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`
      });
    }

    if (existing) {
      await db.query(`
        UPDATE attendances
        SET clock_in = ?, status = ?, notes = ?
        WHERE id = ?
      `, [nowFull, status, notes || existing.notes, existing.id]);
    } else {
      await db.query(`
        INSERT INTO attendances (user_id, work_date, clock_in, status, notes)
        VALUES (?, ?, ?, ?, ?)
      `, [user_id, today, nowFull, status, notes || null]);
    }

    const [[staff]] = await db.query('SELECT fullname, role FROM users WHERE id = ?', [user_id]);

    const lateText = status === 'late' ? '⚠️ (มาสาย)' : '✅ (ตรงเวลา)';
    const lineMsg = {
      type: 'text',
      text: `📱 [สแกน QR เข้างาน - BT Auto]\n• ช่าง: คุณ ${staff.fullname}\n• เวลาเข้างาน: ${timeStr.slice(0, 5)} น.\n• สถานะ: ${lateText}\n• วันที่: ${today}`
    };
    notificationService.sendToAdmin([lineMsg]).catch(() => {});

    const startOfMonth = today.slice(0, 7) + '-01';
    const [[monthStats]] = await db.query(`
      SELECT COUNT(*) as total_days
      FROM attendances
      WHERE user_id = ? AND work_date >= ? AND (status = 'present' OR status = 'late')
    `, [user_id, startOfMonth]);

    const thaiFormattedDate = new Date().toLocaleDateString('th-TH', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    res.json({
      success: true,
      message: `ยืนยันตัวตนสำเร็จ! ลงเวลาเข้างานของ "${staff.fullname}" เวลา ${timeStr.slice(0, 5)} น. ${lateText} เรียบร้อยแล้ว`,
      staffName: staff.fullname,
      clockInTime: timeStr.slice(0, 5),
      workDate: today,
      thaiFormattedDate: thaiFormattedDate,
      totalDaysThisMonth: monthStats.total_days || 1,
      status: status
    });
  } catch (err) {
    console.error('Process Scan Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกเวลา: ' + err.message });
  }
};

module.exports = {
  getAttendancePage,
  clockIn,
  clockOut,
  quickUpdateStatus,
  manualAttendanceRecord,
  verifyUnlock,
  getQrKioskPage,
  getQrDataApi,
  getScanPage,
  processScanCheckIn
};
