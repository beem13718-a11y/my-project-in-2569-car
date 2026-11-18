const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const { isAuthenticated, hasRole } = require('../middleware/authMiddleware');

router.use(isAuthenticated);

router.get('/', vehicleController.getAllVehicles);
router.post('/add', hasRole('owner', 'receptionist'), vehicleController.addVehicle);
router.post('/edit/:id', hasRole('owner', 'receptionist'), vehicleController.editVehicle);
router.post('/delete/:id', hasRole('owner', 'receptionist'), vehicleController.deleteVehicle);
router.get('/history/:id', vehicleController.getRepairHistory);

module.exports = router;
