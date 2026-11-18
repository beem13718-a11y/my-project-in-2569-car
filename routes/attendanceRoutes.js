const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const { isAuthenticated, isOwner } = require('../middleware/authMiddleware');

router.get('/scan', attendanceController.getScanPage);
router.post('/scan', attendanceController.processScanCheckIn);

router.use(isAuthenticated);

router.get('/', attendanceController.getAttendancePage);

router.get('/qr-kiosk', isOwner, attendanceController.getQrKioskPage);
router.get('/qr-api', isOwner, attendanceController.getQrDataApi);

router.post('/clock-in', attendanceController.clockIn);
router.post('/clock-out', attendanceController.clockOut);

router.post('/quick-update', isOwner, attendanceController.quickUpdateStatus);

router.post('/manual', isOwner, attendanceController.manualAttendanceRecord);

router.post('/verify-unlock', isOwner, attendanceController.verifyUnlock);

module.exports = router;
