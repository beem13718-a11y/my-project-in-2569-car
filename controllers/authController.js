const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');

const showLogin = (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  const successMsg = req.query.success || null;
  res.render('login', { title: 'เข้าสู่ระบบ', error: null, success: successMsg, username: '' });
};

const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('login', {
      title: 'เข้าสู่ระบบ',
      error: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน',
      success: null,
      username: username || ''
    });
  }

  try {
    console.log(`[Login Attempt] Username: "${username}"`);
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);

    if (rows.length === 0) {
      return res.render('login', {
        title: 'เข้าสู่ระบบ',
        error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง',
        success: null,
        username: username
      });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.render('login', {
        title: 'เข้าสู่ระบบ',
        error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง',
        success: null,
        username: username
      });
    }

    if (user.status === 'inactive') {
      return res.render('login', {
        title: 'เข้าสู่ระบบ',
        error: 'บัญชีผู้ใช้งานนี้ถูกระงับการใช้งานชั่วคราว',
        success: null,
        username: username
      });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      fullname: user.fullname,
      role: user.role
    };

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login Error:', err);
    res.render('login', {
      title: 'เข้าสู่ระบบ',
      error: 'เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้ง',
      success: null,
      username: username
    });
  }
};

const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout Session Destroy Error:', err);
    }
    res.redirect('/auth/login');
  });
};

const showForgotPassword = (req, res) => {
  res.render('forgot_password', {
    title: 'กู้คืนรหัสผ่าน',
    error: null,
    success: null,
    username: '',
    phone: ''
  });
};

const processForgotPassword = async (req, res) => {
  const { username, phone } = req.body;

  if (!username || !phone) {
    return res.render('forgot_password', {
      title: 'กู้คืนรหัสผ่าน',
      error: 'กรุณากรอกชื่อผู้ใช้งานและเบอร์โทรศัพท์ที่ลงทะเบียนไว้',
      success: null,
      username: username || '',
      phone: phone || ''
    });
  }

  try {

    const [users] = await db.query(
      'SELECT id, username, fullname, phone, status FROM users WHERE username = ? AND status = "active"',
      [username.trim()]
    );

    if (users.length === 0) {
      return res.render('forgot_password', {
        title: 'กู้คืนรหัสผ่าน',
        error: 'ไม่พบบัญชีผู้ใช้งานนี้ในระบบ หรือบัญชีถูกระงับการใช้งาน',
        success: null,
        username: username,
        phone: phone
      });
    }

    const user = users[0];

    const cleanInputPhone = phone.replace(/[^0-9]/g, '');
    const cleanDbPhone = (user.phone || '').replace(/[^0-9]/g, '');

    if (!cleanDbPhone || cleanInputPhone !== cleanDbPhone) {
      return res.render('forgot_password', {
        title: 'กู้คืนรหัสผ่าน',
        error: 'เบอร์โทรศัพท์ไม่ตรงกับข้อมูลที่ลงทะเบียนไว้สำหรับผู้ใช้นี้',
        success: null,
        username: username,
        phone: phone
      });
    }

    const token = crypto.randomBytes(24).toString('hex');

    await db.query(
      'UPDATE users SET reset_token = ?, reset_expires = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id = ?',
      [token, user.id]
    );

    console.log(`[Password Reset] Token generated for user "${user.username}": ${token}`);
    res.redirect(`/auth/reset-password/${token}`);
  } catch (err) {
    console.error('Process Forgot Password Error:', err);
    res.render('forgot_password', {
      title: 'กู้คืนรหัสผ่าน',
      error: 'เกิดข้อผิดพลาดในการตรวจสอบข้อมูล กรุณาลองใหม่อีกครั้ง',
      success: null,
      username: username,
      phone: phone
    });
  }
};

const showResetPassword = async (req, res) => {
  const { token } = req.params;

  try {
    const [users] = await db.query(
      'SELECT id, username, fullname FROM users WHERE reset_token = ? AND reset_expires > NOW()',
      [token]
    );

    if (users.length === 0) {
      return res.render('forgot_password', {
        title: 'กู้คืนรหัสผ่าน',
        error: 'รหัสอ้างอิงกู้คืนรหัสผ่านหมดอายุแล้ว หรือไม่ถูกต้อง กรุณากรอกข้อมูลใหม่อีกครั้ง',
        success: null,
        username: '',
        phone: ''
      });
    }

    res.render('reset_password', {
      title: 'ตั้งรหัสผ่านใหม่',
      token: token,
      user: users[0],
      error: null
    });
  } catch (err) {
    console.error('Show Reset Password Error:', err);
    res.redirect('/auth/forgot-password');
  }
};

const processResetPassword = async (req, res) => {
  const { token } = req.params;
  const { new_password, confirm_password } = req.body;

  try {
    const [users] = await db.query(
      'SELECT id, username, fullname FROM users WHERE reset_token = ? AND reset_expires > NOW()',
      [token]
    );

    if (users.length === 0) {
      return res.render('forgot_password', {
        title: 'กู้คืนรหัสผ่าน',
        error: 'ระยะเวลาการตั้งรหัสผ่านใหม่หมดอายุแล้ว กรุณากรอกข้อมูลเพื่อขอใหม่อีกครั้ง',
        success: null,
        username: '',
        phone: ''
      });
    }

    const user = users[0];

    if (!new_password || !confirm_password) {
      return res.render('reset_password', {
        title: 'ตั้งรหัสผ่านใหม่',
        token: token,
        user: user,
        error: 'กรุณากรอกรหัสผ่านใหม่และยืนยันรหัสผ่าน'
      });
    }

    if (new_password.length < 6) {
      return res.render('reset_password', {
        title: 'ตั้งรหัสผ่านใหม่',
        token: token,
        user: user,
        error: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร'
      });
    }

    if (new_password !== confirm_password) {
      return res.render('reset_password', {
        title: 'ตั้งรหัสผ่านใหม่',
        token: token,
        user: user,
        error: 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน'
      });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);

    await db.query(
      'UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
      [hashedPassword, user.id]
    );

    console.log(`[Password Reset Success] Password updated for user: "${user.username}"`);

    res.redirect('/auth/login?success=' + encodeURIComponent('ตั้งรหัสผ่านใหม่สำเร็จเรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่'));
  } catch (err) {
    console.error('Process Reset Password Error:', err);
    res.render('reset_password', {
      title: 'ตั้งรหัสผ่านใหม่',
      token: token,
      user: { username: '', fullname: '' },
      error: 'เกิดข้อผิดพลาดในการบันทึกรหัสผ่านใหม่ กรุณาลองใหม่อีกครั้ง'
    });
  }
};

module.exports = {
  showLogin,
  login,
  logout,
  showForgotPassword,
  processForgotPassword,
  showResetPassword,
  processResetPassword
};
