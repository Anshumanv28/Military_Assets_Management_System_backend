"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { page = '1', limit = '10', is_active, commander_id } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        let whereClause = 'WHERE 1=1';
        const params = [];
        let paramIndex = 1;
        if (is_active !== undefined && is_active !== '') {
            whereClause += ` AND b.is_active = $${paramIndex}`;
            params.push(is_active === 'true');
            paramIndex++;
        }
        else {
            whereClause += ` AND b.is_active = $${paramIndex}`;
            params.push(true);
            paramIndex++;
        }
        if (commander_id && commander_id !== '') {
            whereClause += ` AND b.commander_id = $${paramIndex}`;
            params.push(commander_id);
            paramIndex++;
        }
        const countQuery = `SELECT COUNT(*) FROM bases b ${whereClause}`;
        const countResult = await (0, connection_1.query)(countQuery, params);
        const total = parseInt(countResult.rows[0].count);
        const basesQuery = `
      SELECT 
        b.*,
        u.first_name,
        u.last_name
      FROM bases b
      LEFT JOIN users u ON b.commander_id = u.id
      ${whereClause}
      ORDER BY b.name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
        params.push(parseInt(limit), offset);
        const basesResult = await (0, connection_1.query)(basesQuery, params);
        const bases = basesResult.rows;
        const transformedBases = bases.map((base) => ({
            ...base,
            first_name: base.first_name || null,
            last_name: base.last_name || null
        }));
        return res.json({
            success: true,
            data: transformedBases,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Get bases error:', error);
        return res.status(500).json({
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
                error: 'Base ID is required'
            });
        }
        const baseResult = await (0, connection_1.query)(`
      SELECT 
        b.*,
        u.first_name,
        u.last_name
      FROM bases b
      LEFT JOIN users u ON b.commander_id = u.id
      WHERE b.id = $1 AND b.is_active = true
    `, [id]);
        if (baseResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Base not found'
            });
        }
        const base = baseResult.rows[0];
        const transformedBase = {
            ...base,
            first_name: base.first_name || null,
            last_name: base.last_name || null
        };
        return res.json({
            success: true,
            data: transformedBase
        });
    }
    catch (error) {
        logger_1.logger.error('Get base error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.post('/', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { name, code, location, commander_id } = req.body;
        if (!name || !code || !location) {
            return res.status(400).json({
                success: false,
                error: 'Name, code, and location are required'
            });
        }
        const existingBaseResult = await (0, connection_1.query)('SELECT id FROM bases WHERE code = $1', [code]);
        if (existingBaseResult.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Base code already exists'
            });
        }
        const newBaseResult = await (0, connection_1.query)(`
      INSERT INTO bases (name, code, location, commander_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, code, location, commander_id || null]);
        const newBase = newBaseResult.rows[0];
        logger_1.logger.info({
            action: 'BASE_CREATED',
            user_id: req.user.user_id,
            base_id: newBase.id,
            base_name: newBase.name
        });
        return res.status(201).json({
            success: true,
            data: newBase
        });
    }
    catch (error) {
        logger_1.logger.error('Create base error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.put('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, code, location, commander_id, is_active } = req.body;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Base ID is required'
            });
        }
        const existingBaseResult = await (0, connection_1.query)('SELECT * FROM bases WHERE id = $1', [id]);
        if (existingBaseResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Base not found'
            });
        }
        const existingBase = existingBaseResult.rows[0];
        if (code && code !== existingBase.code) {
            const codeExistsResult = await (0, connection_1.query)('SELECT id FROM bases WHERE code = $1 AND id != $2', [code, id]);
            if (codeExistsResult.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Base code already exists'
                });
            }
        }
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;
        if (name !== undefined) {
            updateFields.push(`name = $${paramIndex}`);
            updateValues.push(name);
            paramIndex++;
        }
        if (code !== undefined) {
            updateFields.push(`code = $${paramIndex}`);
            updateValues.push(code);
            paramIndex++;
        }
        if (location !== undefined) {
            updateFields.push(`location = $${paramIndex}`);
            updateValues.push(location);
            paramIndex++;
        }
        if (commander_id !== undefined) {
            updateFields.push(`commander_id = $${paramIndex}`);
            updateValues.push(commander_id);
            paramIndex++;
        }
        if (is_active !== undefined) {
            updateFields.push(`is_active = $${paramIndex}`);
            updateValues.push(is_active);
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
      UPDATE bases 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
        const updatedBaseResult = await (0, connection_1.query)(updateQuery, updateValues);
        const updatedBase = updatedBaseResult.rows[0];
        logger_1.logger.info({
            action: 'BASE_UPDATED',
            user_id: req.user.user_id,
            base_id: id,
            base_name: updatedBase.name,
            changes: { name, code, location, commander_id, is_active }
        });
        return res.json({
            success: true,
            data: updatedBase
        });
    }
    catch (error) {
        logger_1.logger.error('Update base error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.delete('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Base ID is required'
            });
        }
        const baseResult = await (0, connection_1.query)('SELECT * FROM bases WHERE id = $1', [id]);
        if (baseResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Base not found'
            });
        }
        const base = baseResult.rows[0];
        const assetsResult = await (0, connection_1.query)('SELECT COUNT(*) FROM assets WHERE base_id = $1', [id]);
        const assetCount = parseInt(assetsResult.rows[0].count);
        if (assetCount > 0) {
            return res.status(400).json({
                success: false,
                error: `Cannot delete base. It has ${assetCount} assets assigned to it.`
            });
        }
        const personnelResult = await (0, connection_1.query)('SELECT COUNT(*) FROM personnel WHERE base_id = $1', [id]);
        const personnelCount = parseInt(personnelResult.rows[0].count);
        if (personnelCount > 0) {
            return res.status(400).json({
                success: false,
                error: `Cannot delete base. It has ${personnelCount} personnel assigned to it.`
            });
        }
        await (0, connection_1.query)('UPDATE bases SET is_active = false WHERE id = $1', [id]);
        logger_1.logger.info({
            action: 'BASE_DELETED',
            user_id: req.user.user_id,
            base_id: id,
            base_name: base.name
        });
        return res.json({
            success: true,
            message: 'Base deleted successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Delete base error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
exports.default = router;
//# sourceMappingURL=bases.js.map