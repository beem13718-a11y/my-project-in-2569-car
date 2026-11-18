const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { isAuthenticated, hasRole } = require('../middleware/authMiddleware');

router.use(isAuthenticated);

router.get('/', customerController.getAllCustomers);
router.post('/add', hasRole('owner', 'receptionist'), customerController.addCustomer);
router.post('/edit/:id', hasRole('owner', 'receptionist'), customerController.editCustomer);
router.post('/delete/:id', hasRole('owner', 'receptionist'), customerController.deleteCustomer);

module.exports = router;
