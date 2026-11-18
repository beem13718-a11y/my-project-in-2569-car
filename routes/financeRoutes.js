const express = require('express');
const router = express.Router();
const financeController = require('../controllers/financeController');
const { isAuthenticated, hasRole } = require('../middleware/authMiddleware');

router.use(isAuthenticated);

router.use(hasRole('owner', 'receptionist'));

router.get('/', financeController.getAllFinances);
router.get('/export', financeController.exportFinancesCsv);
router.post('/record-income', financeController.recordIncome);
router.post('/record-expense', financeController.recordExpense);
router.post('/settle/:id', financeController.settlePayment);

module.exports = router;
