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
            whereClause += ` AND e.base_id = $${paramIndex}`;
            params.push(req.user.base_id);
            paramIndex++;
        }
        else if (req.user.role === 'logistics_officer' && req.user.base_id) {
            whereClause += ` AND e.base_id = $${paramIndex}`;
            params.push(req.user.base_id);
            paramIndex++;
        }
        else if (base_id) {
            whereClause += ` AND e.base_id = $${paramIndex}`;
            params.push(base_id);
            paramIndex++;
        }
        if (asset_name) {
            whereClause += ` AND e.asset_name ILIKE $${paramIndex}`;
            params.push(`%${asset_name}%`);
            paramIndex++;
        }
        if (start_date && end_date) {
            whereClause += ` AND e.expenditure_date >= $${paramIndex} AND e.expenditure_date <= $${paramIndex + 1}`;
            params.push(start_date, end_date);
            paramIndex += 2;
        }
        const countQuery = `SELECT COUNT(*) FROM expenditures e ${whereClause}`;
        const countResult = await (0, connection_1.query)(countQuery, params);
        const total = parseInt(countResult.rows[0].count);
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const expendituresQuery = `
      SELECT 
        e.*,
        b.name as base_name,
        u.first_name,
        u.last_name,
        p.first_name as personnel_first_name,
        p.last_name as personnel_last_name,
        p.rank as personnel_rank
      FROM expenditures e
      LEFT JOIN bases b ON e.base_id = b.id
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN personnel p ON e.personnel_id = p.id
      ${whereClause}
      ORDER BY e.expenditure_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
        params.push(parseInt(limit), offset);
        const expendituresResult = await (0, connection_1.query)(expendituresQuery, params);
        const expenditures = expendituresResult.rows;
        const transformedExpenditures = expenditures.map((expenditure) => ({
            ...expenditure,
            base_name: expenditure.base_name,
            first_name: expenditure.first_name,
            last_name: expenditure.last_name,
            personnel_first_name: expenditure.personnel_first_name || null,
            personnel_last_name: expenditure.personnel_last_name || null,
            personnel_rank: expenditure.personnel_rank || null
        }));
        res.json({
            success: true,
            data: transformedExpenditures,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Get expenditures error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.post('/', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander', 'logistics_officer'), async (req, res) => {
    try {
        const { asset_name, base_id, quantity, expenditure_date, reason, notes } = req.body;
        if (!asset_name || !base_id || !quantity || !expenditure_date || !reason) {
            return res.status(400).json({
                success: false,
                error: 'Asset name, base ID, quantity, expenditure date, and reason are required'
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
                error: 'Base commanders can only create expenditures for their base'
            });
        }
        const assetResult = await (0, connection_1.query)('SELECT * FROM assets WHERE name = $1 AND base_id = $2', [asset_name, base_id]);
        if (assetResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Base does not have this asset in inventory'
            });
        }
        const asset = assetResult.rows[0];
        if (asset.available_quantity < quantity) {
            return res.status(400).json({
                success: false,
                error: `Insufficient available quantity for expenditure. Available: ${asset.available_quantity}, Requested: ${quantity}`
            });
        }
        await (0, connection_1.query)('BEGIN');
        try {
            const newExpenditureResult = await (0, connection_1.query)(`
        INSERT INTO expenditures (asset_name, base_id, quantity, expenditure_date, reason, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [asset_name, base_id, quantity, new Date(expenditure_date), reason, notes || null, req.user.user_id]);
            const newExpenditure = newExpenditureResult.rows[0];
            const newQuantity = asset.quantity - quantity;
            const newAvailableQuantity = asset.available_quantity - quantity;
            let newStatus = 'available';
            if (newQuantity === 0) {
                newStatus = 'out_of_stock';
            }
            else if (newAvailableQuantity === 0) {
                newStatus = 'low_stock';
            }
            await (0, connection_1.query)(`
        UPDATE assets 
        SET quantity = $1, available_quantity = $2, status = $3
        WHERE id = $4
      `, [newQuantity, newAvailableQuantity, newStatus, asset.id]);
            await (0, connection_1.query)('COMMIT');
            logger_1.logger.info({
                action: 'EXPENDITURE_CREATED',
                user_id: req.user.user_id,
                expenditure_id: newExpenditure.id,
                asset_name: asset_name,
                base_id: base_id,
                quantity: quantity,
                reason: reason
            });
            return res.status(201).json({
                success: true,
                data: newExpenditure
            });
        }
        catch (error) {
            await (0, connection_1.query)('ROLLBACK');
            throw error;
        }
    }
    catch (error) {
        logger_1.logger.error('Create expenditure error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.put('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, expenditure_date, reason, notes } = req.body;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Expenditure ID is required'
            });
        }
        const expenditureResult = await (0, connection_1.query)('SELECT * FROM expenditures WHERE id = $1', [id]);
        if (expenditureResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Expenditure not found'
            });
        }
        const expenditure = expenditureResult.rows[0];
        if (req.user.role === 'base_commander' && expenditure.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Base commanders can only update expenditures for their base'
            });
        }
        if (quantity !== undefined && quantity <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantity must be greater than 0'
            });
        }
        if (quantity !== undefined && quantity !== expenditure.quantity) {
            const quantityDifference = expenditure.quantity - quantity;
            const assetResult = await (0, connection_1.query)('SELECT * FROM assets WHERE name = $1 AND base_id = $2', [expenditure.asset_name, expenditure.base_id]);
            if (assetResult.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Asset inventory not found'
                });
            }
            const asset = assetResult.rows[0];
            const newQuantity = asset.quantity + quantityDifference;
            const newAvailableQuantity = asset.available_quantity + quantityDifference;
            if (newQuantity < 0 || newAvailableQuantity < 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot reduce expenditure quantity below zero'
                });
            }
            await (0, connection_1.query)(`
        UPDATE assets 
        SET quantity = $1, available_quantity = $2
        WHERE id = $3
      `, [newQuantity, newAvailableQuantity, asset.id]);
        }
        const updateData = {};
        if (quantity !== undefined)
            updateData.quantity = quantity;
        if (expenditure_date)
            updateData.expenditure_date = new Date(expenditure_date);
        if (reason)
            updateData.reason = reason;
        if (notes !== undefined)
            updateData.notes = notes;
        const updatedExpenditureResult = await (0, connection_1.query)(`
      UPDATE expenditures
      SET quantity = $1, expenditure_date = $2, reason = $3, notes = $4
      WHERE id = $5
      RETURNING *
    `, [updateData.quantity, updateData.expenditure_date, updateData.reason, updateData.notes, id]);
        const updatedExpenditure = updatedExpenditureResult.rows[0];
        logger_1.logger.info({
            action: 'EXPENDITURE_UPDATED',
            user_id: req.user.user_id,
            expenditure_id: id,
            old_quantity: expenditure.quantity,
            new_quantity: quantity || expenditure.quantity
        });
        return res.json({
            success: true,
            data: updatedExpenditure
        });
    }
    catch (error) {
        logger_1.logger.error('Update expenditure error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.delete('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Expenditure ID is required'
            });
        }
        const expenditureResult = await (0, connection_1.query)('SELECT * FROM expenditures WHERE id = $1', [id]);
        if (expenditureResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Expenditure not found'
            });
        }
        const expenditure = expenditureResult.rows[0];
        await (0, connection_1.query)('BEGIN');
        try {
            const assetResult = await (0, connection_1.query)('SELECT * FROM assets WHERE name = $1 AND base_id = $2', [expenditure.asset_name, expenditure.base_id]);
            if (assetResult.rows.length > 0) {
                const asset = assetResult.rows[0];
                const newQuantity = asset.quantity + expenditure.quantity;
                const newAvailableQuantity = asset.available_quantity + expenditure.quantity;
                let newStatus = 'available';
                if (newQuantity === 0) {
                    newStatus = 'out_of_stock';
                }
                else if (newAvailableQuantity === 0) {
                    newStatus = 'low_stock';
                }
                await (0, connection_1.query)(`
          UPDATE assets 
          SET quantity = $1, available_quantity = $2, status = $3
          WHERE id = $4
        `, [newQuantity, newAvailableQuantity, newStatus, asset.id]);
            }
            await (0, connection_1.query)(`
        DELETE FROM expenditures
        WHERE id = $1
      `, [id]);
            await (0, connection_1.query)('COMMIT');
            logger_1.logger.info({
                action: 'EXPENDITURE_DELETED',
                user_id: req.user.user_id,
                expenditure_id: id,
                asset_name: expenditure.asset_name,
                quantity: expenditure.quantity
            });
            return res.json({
                success: true,
                message: 'Expenditure deleted successfully'
            });
        }
        catch (error) {
            await (0, connection_1.query)('ROLLBACK');
            throw error;
        }
    }
    catch (error) {
        logger_1.logger.error('Delete expenditure error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=expenditures.js.map