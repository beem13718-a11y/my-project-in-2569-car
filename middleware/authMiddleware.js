const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/auth/login');
};

const isOwner = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'owner') {
    return next();
  }

  res.status(403).render('error', { 
    title: 'ปฏิเสธการเข้าถึง', 
    message: 'บทบาทของคุณไม่มีสิทธิ์ในการใช้งานฟังก์ชันนี้ (เฉพาะเจ้าของอู่เท่านั้น)' 
  });
};


const hasRole = (...roles) => {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/auth/login');
    }
    const userRole = req.session.user.role;

    if (userRole === 'owner' || roles.includes(userRole)) {
      return next();
    }
    res.status(403).render('error', { 
      title: 'ปฏิเสธการเข้าถึง', 
      message: `บทบาทของคุณไม่มีสิทธิ์ในการเข้าถึงฟังก์ชันนี้ (เฉพาะ: ${roles.join(', ')})` 
    });
  };
};

module.exports = {
  isAuthenticated,
  isOwner,
  hasRole
};
