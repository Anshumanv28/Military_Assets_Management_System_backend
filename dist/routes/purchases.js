"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const connection_1 = require("../database/connection");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { base_id, asset_name, start_date, end_date, page = 1, limit = 10 } = req.query;
        let whereClause = 'WHERE 1=1';
        const params = [];
        let paramIndex = 1;
        if (req.user.role === 'base_commander' && req.user.base_id) {
            whereClause += ` AND p.base_id = $${paramIndex}`;
            params.push(req.user.base_id);
            paramIndex++;
        }
        else if (base_id && req.user.role !== 'admin') {
            whereClause += ` AND p.base_id = $${paramIndex}`;
            params.push(base_id);
            paramIndex++;
        }
        if (asset_name) {
            whereClause += ` AND a.name ILIKE $${paramIndex}`;
            params.push(`%${asset_name}%`);
            paramIndex++;
        }
        if (start_date && end_date) {
            whereClause += ` AND p.purchase_date >= $${paramIndex} AND p.purchase_date <= $${paramIndex + 1}`;
            params.push(start_date, end_date);
            paramIndex += 2;
        }
        const countQuery = `SELECT COUNT(*) FROM purchases p ${whereClause}`;
        const countResult = await (0, connection_1.query)(countQuery, params);
        const total = parseInt(countResult.rows[0].count);
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const purchasesQuery = `
      SELECT 
        p.*,
        b.name as base_name,
        u.first_name,
        u.last_name,
        a.name as asset_name
      FROM purchases p
      LEFT JOIN bases b ON p.base_id = b.id
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN assets a ON p.asset_id = a.id
      ${whereClause}
      ORDER BY p.purchase_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
        params.push(parseInt(limit), offset);
        const purchasesResult = await (0, connection_1.query)(purchasesQuery, params);
        const purchases = purchasesResult.rows;
        const transformedPurchases = purchases.map((purchase) => ({
            ...purchase,
            base_name: purchase.base_name,
            first_name: purchase.first_name,
            last_name: purchase.last_name,
            asset_name: purchase.asset_name
        }));
        res.json({
            success: true,
            data: transformedPurchases,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Get purchases error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.post('/', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { asset_id, base_id, quantity, supplier, purchase_date, notes } = req.body;
        if (!asset_id || !base_id || !quantity || !purchase_date) {
            return res.status(400).json({
                success: false,
                error: 'Asset, base, quantity, and purchase date are required'
            });
        }
        if (quantity <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantity must be greater than 0'
            });
        }
        if (req.user.role === 'base_commander' && base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Base commanders can only create purchases for their base'
            });
        }
        const status = 'pending';
        const newPurchaseResult = await (0, connection_1.query)(`
      INSERT INTO purchases (asset_id, base_id, quantity, supplier, purchase_date, status, approved_by, approved_at, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [asset_id, base_id, quantity, supplier || null, new Date(purchase_date), status, null, null, notes || null, req.user.user_id]);
        const newPurchase = newPurchaseResult.rows[0];
        logger_1.logger.info({
            action: 'PURCHASE_CREATED',
            user_id: req.user.user_id,
            purchase_id: newPurchase.id,
            asset_id,
            quantity,
            status
        });
        return res.status(201).json({ success: true, data: newPurchase });
    }
    catch (error) {
        logger_1.logger.error('Create purchase error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.put('/:id/approve', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Purchase ID is required'
            });
        }
        const purchaseResult = await (0, connection_1.query)('SELECT * FROM purchases WHERE id = $1', [id]);
        if (purchaseResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Purchase not found'
            });
        }
        const purchase = purchaseResult.rows[0];
        if (purchase.status === 'approved') {
            return res.status(400).json({
                success: false,
                error: 'Purchase is already approved'
            });
        }
        await (0, connection_1.query)('BEGIN');
        try {
            const updatedPurchaseResult = await (0, connection_1.query)(`
        UPDATE purchases 
        SET status = $1, approved_by = $2, approved_at = $3
        WHERE id = $4
        RETURNING *
      `, ['approved', req.user.user_id, new Date(), id]);
            const updatedPurchase = updatedPurchaseResult.rows[0];
            await addAssetsToInventory(updatedPurchase);
            await (0, connection_1.query)('COMMIT');
            logger_1.logger.info({
                action: 'PURCHASE_APPROVED',
                user_id: req.user.user_id,
                purchase_id: id,
                asset_id: purchase.asset_id,
                quantity: purchase.quantity
            });
            return res.json({
                success: true,
                data: updatedPurchase
            });
        }
        catch (error) {
            await (0, connection_1.query)('ROLLBACK');
            throw error;
        }
    }
    catch (error) {
        logger_1.logger.error('Approve purchase error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.put('/:id/reject', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Purchase ID is required'
            });
        }
        const purchaseResult = await (0, connection_1.query)('SELECT * FROM purchases WHERE id = $1', [id]);
        if (purchaseResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Purchase not found'
            });
        }
        const purchase = purchaseResult.rows[0];
        if (purchase.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: 'Purchase is already processed'
            });
        }
        const updatedPurchaseResult = await (0, connection_1.query)(`
      UPDATE purchases 
      SET status = $1, notes = $2
      WHERE id = $3
      RETURNING *
    `, ['rejected', reason || 'Rejected by admin', id]);
        const updatedPurchase = updatedPurchaseResult.rows[0];
        logger_1.logger.info({
            action: 'PURCHASE_REJECTED',
            user_id: req.user.user_id,
            purchase_id: id,
            asset_id: purchase.asset_id,
            quantity: purchase.quantity,
            reason: reason || 'Rejected by admin'
        });
        return res.json({
            success: true,
            data: updatedPurchase
        });
    }
    catch (error) {
        logger_1.logger.error('Reject purchase error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.put('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, supplier, purchase_date, notes } = req.body;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Purchase ID is required'
            });
        }
        const purchaseResult = await (0, connection_1.query)('SELECT * FROM purchases WHERE id = $1', [id]);
        if (purchaseResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Purchase not found'
            });
        }
        const purchase = purchaseResult.rows[0];
        if (req.user.role === 'base_commander' && purchase.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Base commanders can only update purchases for their base'
            });
        }
        if (purchase.status === 'approved') {
            return res.status(400).json({
                success: false,
                error: 'Cannot update approved purchases'
            });
        }
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;
        if (quantity !== undefined) {
            updateFields.push(`quantity = $${paramIndex}`);
            updateValues.push(quantity);
            paramIndex++;
        }
        if (supplier !== undefined) {
            updateFields.push(`supplier = $${paramIndex}`);
            updateValues.push(supplier);
            paramIndex++;
        }
        if (purchase_date !== undefined) {
            updateFields.push(`purchase_date = $${paramIndex}`);
            updateValues.push(new Date(purchase_date));
            paramIndex++;
        }
        if (notes !== undefined) {
            updateFields.push(`notes = $${paramIndex}`);
            updateValues.push(notes);
            paramIndex++;
        }
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }
        updateValues.push(id);
        const updateQuery = `
      UPDATE purchases 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
        const updatedPurchaseResult = await (0, connection_1.query)(updateQuery, updateValues);
        const updatedPurchase = updatedPurchaseResult.rows[0];
        logger_1.logger.info({
            action: 'PURCHASE_UPDATED',
            user_id: req.user.user_id,
            purchase_id: id,
            changes: { quantity, supplier, purchase_date, notes }
        });
        return res.json({
            success: true,
            data: updatedPurchase
        });
    }
    catch (error) {
        logger_1.logger.error('Update purchase error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.delete('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Purchase ID is required'
            });
        }
        const purchaseResult = await (0, connection_1.query)('SELECT * FROM purchases WHERE id = $1', [id]);
        if (purchaseResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Purchase not found'
            });
        }
        const purchase = purchaseResult.rows[0];
        if (req.user.role === 'base_commander' && purchase.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Base commanders can only delete purchases for their base'
            });
        }
        if (purchase.status === 'approved') {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete approved purchases'
            });
        }
        await (0, connection_1.query)('DELETE FROM purchases WHERE id = $1', [id]);
        logger_1.logger.info({
            action: 'PURCHASE_DELETED',
            user_id: req.user.user_id,
            purchase_id: id,
            asset_id: purchase.asset_id,
            quantity: purchase.quantity
        });
        return res.json({
            success: true,
            message: 'Purchase deleted successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Delete purchase error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
async function addAssetsToInventory(purchase) {
    const assetResult = await (0, connection_1.query)('SELECT name FROM assets WHERE id = $1', [purchase.asset_id]);
    if (assetResult.rows.length === 0) {
        throw new Error(`Asset with id ${purchase.asset_id} not found`);
    }
    const assetName = assetResult.rows[0].name;
    const existingAssetResult = await (0, connection_1.query)('SELECT * FROM assets WHERE name = $1 AND base_id = $2', [assetName, purchase.base_id]);
    if (existingAssetResult.rows.length > 0) {
        const existingAsset = existingAssetResult.rows[0];
        const newQuantity = existingAsset.quantity + purchase.quantity;
        const newAvailableQuantity = existingAsset.available_quantity + purchase.quantity;
        let newStatus = 'available';
        if (newAvailableQuantity === 0) {
            newStatus = 'low_stock';
        }
        await (0, connection_1.query)(`
      UPDATE assets 
      SET quantity = $1, available_quantity = $2, status = $3
      WHERE id = $4
    `, [newQuantity, newAvailableQuantity, newStatus, existingAsset.id]);
    }
    else {
        await (0, connection_1.query)(`
      INSERT INTO assets (name, base_id, quantity, available_quantity, assigned_quantity, status)
      VALUES ($1, $2, $3, $3, 0, 'available')
    `, [assetName, purchase.base_id, purchase.quantity]);
    }
}
exports.default = router;
//# sourceMappingURL=purchases.js.map