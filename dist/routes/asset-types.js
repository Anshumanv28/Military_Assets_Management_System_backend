"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const connection_1 = require("../database/connection");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (_req, res) => {
    try {
        const assetTypesQuery = `
      SELECT id, name, category, description, unit_of_measure, is_active, created_at, updated_at
      FROM asset_types
      WHERE is_active = true
      ORDER BY name
    `;
        const result = await (0, connection_1.query)(assetTypesQuery);
        return res.json({
            success: true,
            data: result.rows
        });
    }
    catch (error) {
        logger_1.logger.error('Get asset types error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.get('/:id', auth_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const assetTypeQuery = `
      SELECT id, name, category, description, unit_of_measure, is_active, created_at, updated_at
      FROM asset_types
      WHERE id = $1 AND is_active = true
    `;
        const result = await (0, connection_1.query)(assetTypeQuery, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Asset type not found'
            });
        }
        return res.json({
            success: true,
            data: result.rows[0]
        });
    }
    catch (error) {
        logger_1.logger.error('Get asset type error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.post('/', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { name, category, description, unit_of_measure } = req.body;
        if (!name || !category || !unit_of_measure) {
            return res.status(400).json({
                success: false,
                error: 'Name, category, and unit of measure are required'
            });
        }
        const existingAssetType = await (0, connection_1.query)('SELECT id FROM asset_types WHERE name = $1', [name]);
        if (existingAssetType.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Asset type name already exists'
            });
        }
        const createQuery = `
      INSERT INTO asset_types (name, category, description, unit_of_measure)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
        const result = await (0, connection_1.query)(createQuery, [
            name,
            category,
            description || null,
            unit_of_measure
        ]);
        const newAssetType = result.rows[0];
        logger_1.logger.info({
            action: 'ASSET_TYPE_CREATED',
            user_id: req.user.user_id,
            asset_type_id: newAssetType.id,
            asset_type_name: newAssetType.name
        });
        return res.status(201).json({
            success: true,
            data: newAssetType
        });
    }
    catch (error) {
        logger_1.logger.error('Create asset type error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.put('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, description, unit_of_measure, is_active } = req.body;
        const existingAssetType = await (0, connection_1.query)('SELECT * FROM asset_types WHERE id = $1', [id]);
        if (existingAssetType.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Asset type not found'
            });
        }
        if (name && name !== existingAssetType.rows[0].name) {
            const nameConflict = await (0, connection_1.query)('SELECT id FROM asset_types WHERE name = $1 AND id != $2', [name, id]);
            if (nameConflict.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Asset type name already exists'
                });
            }
        }
        const updateQuery = `
      UPDATE asset_types 
      SET name = COALESCE($1, name),
          category = COALESCE($2, category),
          description = COALESCE($3, description),
          unit_of_measure = COALESCE($4, unit_of_measure),
          is_active = COALESCE($5, is_active),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `;
        const result = await (0, connection_1.query)(updateQuery, [
            name,
            category,
            description,
            unit_of_measure,
            is_active,
            id
        ]);
        const updatedAssetType = result.rows[0];
        logger_1.logger.info({
            action: 'ASSET_TYPE_UPDATED',
            user_id: req.user.user_id,
            asset_type_id: id,
            changes: req.body
        });
        return res.json({
            success: true,
            data: updatedAssetType
        });
    }
    catch (error) {
        logger_1.logger.error('Update asset type error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.delete('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const existingAssetType = await (0, connection_1.query)('SELECT * FROM asset_types WHERE id = $1', [id]);
        if (existingAssetType.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Asset type not found'
            });
        }
        const usageCheck = await (0, connection_1.query)('SELECT COUNT(*) as count FROM assets WHERE asset_type_id = $1', [id]);
        if (parseInt(usageCheck.rows[0].count) > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete asset type that is being used by assets'
            });
        }
        const deleteQuery = `
      UPDATE asset_types 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;
        await (0, connection_1.query)(deleteQuery, [id]);
        logger_1.logger.info({
            action: 'ASSET_TYPE_DELETED',
            user_id: req.user.user_id,
            asset_type_id: id,
            asset_type_name: existingAssetType.rows[0].name
        });
        return res.json({
            success: true,
            message: 'Asset type deleted successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Delete asset type error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
exports.default = router;
//# sourceMappingURL=asset-types.js.map