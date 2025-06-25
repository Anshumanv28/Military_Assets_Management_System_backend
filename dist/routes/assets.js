"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { base_id, name, status, page = 1, limit = 10 } = req.query;
        let whereClause = 'WHERE 1=1';
        const params = [];
        let paramIndex = 1;
        if (req.user.role === 'base_commander' && req.user.base_id) {
            whereClause += ` AND a.base_id = $${paramIndex}`;
            params.push(req.user.base_id);
            paramIndex++;
        }
        else if (base_id && req.user.role !== 'admin') {
            whereClause += ` AND a.base_id = $${paramIndex}`;
            params.push(base_id);
            paramIndex++;
        }
        if (name) {
            whereClause += ` AND a.name ILIKE $${paramIndex}`;
            params.push(`%${name}%`);
            paramIndex++;
        }
        if (status) {
            whereClause += ` AND a.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        const countQuery = `SELECT COUNT(*) FROM assets a ${whereClause}`;
        const countResult = await (0, connection_1.query)(countQuery, params);
        const total = parseInt(countResult.rows[0].count);
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const assetsQuery = `
      SELECT 
        a.*,
        b.name as base_name,
        b.code as base_code
      FROM assets a
      LEFT JOIN bases b ON a.base_id = b.id
      ${whereClause}
      ORDER BY a.name ASC, b.name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
        params.push(parseInt(limit), offset);
        const assetsResult = await (0, connection_1.query)(assetsQuery, params);
        const assets = assetsResult.rows;
        const transformedAssets = assets.map((asset) => ({
            ...asset,
            current_base_name: asset.base_name,
            base_code: asset.base_code
        }));
        res.json({
            success: true,
            data: transformedAssets,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Get assets error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.get('/:id', auth_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Asset ID is required'
            });
        }
        const assetResult = await (0, connection_1.query)(`
      SELECT 
        a.*,
        b.name as base_name,
        b.code as base_code
      FROM assets a
      LEFT JOIN bases b ON a.base_id = b.id
      WHERE a.id = $1
    `, [id]);
        if (assetResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Asset not found'
            });
        }
        const asset = assetResult.rows[0];
        if (req.user.role === 'base_commander' && asset.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this asset'
            });
        }
        const transformedAsset = {
            ...asset,
            current_base_name: asset.base_name,
            base_code: asset.base_code
        };
        return res.json({
            success: true,
            data: transformedAsset
        });
    }
    catch (error) {
        logger_1.logger.error('Get asset by ID error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.post('/', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { name, base_id, quantity, available_quantity, assigned_quantity } = req.body;
        if (!name || !base_id || quantity === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Asset name, base ID, and quantity are required'
            });
        }
        if (quantity < 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantity must be non-negative'
            });
        }
        const baseResult = await (0, connection_1.query)('SELECT id FROM bases WHERE id = $1', [base_id]);
        if (baseResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Base not found'
            });
        }
        const existingAssetResult = await (0, connection_1.query)('SELECT id FROM assets WHERE name = $1 AND base_id = $2', [name, base_id]);
        if (existingAssetResult.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Asset inventory already exists for this name and base'
            });
        }
        const finalAvailableQuantity = available_quantity !== undefined ? available_quantity : quantity;
        const finalAssignedQuantity = assigned_quantity !== undefined ? assigned_quantity : 0;
        if (finalAvailableQuantity + finalAssignedQuantity > quantity) {
            return res.status(400).json({
                success: false,
                error: 'Available + assigned quantity cannot exceed total quantity'
            });
        }
        const newAssetResult = await (0, connection_1.query)(`
      INSERT INTO assets (name, base_id, quantity, available_quantity, assigned_quantity)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, base_id, quantity, finalAvailableQuantity, finalAssignedQuantity]);
        const newAsset = newAssetResult.rows[0];
        logger_1.logger.info({
            action: 'ASSET_INVENTORY_CREATED',
            user_id: req.user.user_id,
            asset_id: newAsset.id,
            asset_name: name,
            base_id: base_id,
            quantity
        });
        return res.status(201).json({
            success: true,
            data: newAsset
        });
    }
    catch (error) {
        logger_1.logger.error('Create asset error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.put('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, available_quantity, assigned_quantity, status } = req.body;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Asset ID is required'
            });
        }
        const currentAssetResult = await (0, connection_1.query)('SELECT * FROM assets WHERE id = $1', [id]);
        if (currentAssetResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Asset not found'
            });
        }
        const currentAsset = currentAssetResult.rows[0];
        if (quantity !== undefined && quantity < 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantity must be non-negative'
            });
        }
        const finalQuantity = quantity !== undefined ? quantity : currentAsset.quantity;
        const finalAvailableQuantity = available_quantity !== undefined ? available_quantity : currentAsset.available_quantity;
        const finalAssignedQuantity = assigned_quantity !== undefined ? assigned_quantity : currentAsset.assigned_quantity;
        if (finalAvailableQuantity + finalAssignedQuantity > finalQuantity) {
            return res.status(400).json({
                success: false,
                error: 'Available + assigned quantity cannot exceed total quantity'
            });
        }
        const updatedAssetResult = await (0, connection_1.query)(`
      UPDATE assets 
      SET quantity = $1, available_quantity = $2, assigned_quantity = $3, status = $4
      WHERE id = $5
      RETURNING *
    `, [finalQuantity, finalAvailableQuantity, finalAssignedQuantity, status || currentAsset.status, id]);
        const updatedAsset = updatedAssetResult.rows[0];
        logger_1.logger.info({
            action: 'ASSET_INVENTORY_UPDATED',
            user_id: req.user.user_id,
            asset_id: id,
            asset_name: updatedAsset.name,
            changes: {
                quantity: finalQuantity,
                available_quantity: finalAvailableQuantity,
                assigned_quantity: finalAssignedQuantity,
                status: status || currentAsset.status
            }
        });
        return res.json({
            success: true,
            data: updatedAsset
        });
    }
    catch (error) {
        logger_1.logger.error('Update asset error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.delete('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Asset ID is required'
            });
        }
        const assetResult = await (0, connection_1.query)('SELECT * FROM assets WHERE id = $1', [id]);
        if (assetResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Asset not found'
            });
        }
        const asset = assetResult.rows[0];
        const assignmentsResult = await (0, connection_1.query)('SELECT COUNT(*) FROM assignments WHERE asset_name = $1', [asset.name]);
        const assignmentCount = parseInt(assignmentsResult.rows[0].count);
        if (assignmentCount > 0) {
            return res.status(400).json({
                success: false,
                error: `Cannot delete asset. It has ${assignmentCount} active assignments.`
            });
        }
        await (0, connection_1.query)('DELETE FROM assets WHERE id = $1', [id]);
        logger_1.logger.info({
            action: 'ASSET_INVENTORY_DELETED',
            user_id: req.user.user_id,
            asset_id: id,
            asset_name: asset.name
        });
        return res.json({
            success: true,
            message: 'Asset deleted successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Delete asset error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=assets.js.map