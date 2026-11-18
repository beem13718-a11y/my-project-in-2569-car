const express = require('express');
const router = express.Router();
const repairController = require('../controllers/repairController');
const { isAuthenticated, hasRole } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(isAuthenticated);

router.get('/', repairController.getAllRepairs);
router.get('/detail/:id', repairController.getRepairDetail);

router.post('/add', hasRole('owner', 'receptionist'), upload.single('car_photo_before'), repairController.addRepair);
router.post('/estimate/:id', hasRole('owner', 'receptionist', 'mechanic'), repairController.updateEstimate);
router.post('/assign-parts/:id', hasRole('owner', 'receptionist', 'mechanic', 'inventory'), repairController.assignMechanicAndParts);
router.post('/status/:id', hasRole('owner', 'mechanic'), repairController.updateStatus);
router.post('/close/:id', hasRole('owner', 'receptionist'), upload.single('car_photo_after'), repairController.closeRepair);
router.post('/send-line-invoice/:id', hasRole('owner', 'receptionist'), repairController.sendLineInvoice);

module.exports = router;
