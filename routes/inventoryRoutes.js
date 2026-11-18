const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { isAuthenticated, hasRole } = require('../middleware/authMiddleware');

router.use(isAuthenticated);

router.get('/', inventoryController.getAllInventory);

router.post('/add', hasRole('owner', 'inventory'), inventoryController.addInventoryPart);
router.post('/edit/:id', hasRole('owner', 'inventory'), inventoryController.editInventoryPart);
router.post('/delete/:id', hasRole('owner', 'inventory'), inventoryController.deleteInventoryPart);
router.post('/restock/:id', hasRole('owner', 'inventory'), inventoryController.restockPart);

module.exports = router;
