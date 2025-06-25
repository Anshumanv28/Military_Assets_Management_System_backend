"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { base_id, rank, page = 1, limit = 10 } = req.query;
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
        if (rank) {
            whereClause += ` AND p.rank = $${paramIndex}`;
            params.push(rank);
            paramIndex++;
        }
        const countQuery = `SELECT COUNT(*) FROM personnel p ${whereClause}`;
        const countResult = await (0, connection_1.query)(countQuery, params);
        const total = parseInt(countResult.rows[0].count);
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const personnelQuery = `
      SELECT 
        p.*,
        b.name as base_name
      FROM personnel p
      LEFT JOIN bases b ON p.base_id = b.id
      ${whereClause}
      ORDER BY p.first_name ASC, p.last_name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
        params.push(parseInt(limit), offset);
        const personnelResult = await (0, connection_1.query)(personnelQuery, params);
        const personnel = personnelResult.rows;
        const transformedPersonnel = personnel.map((person) => ({
            ...person,
            base_name: person.base_name,
            full_name: `${person.first_name} ${person.last_name}`
        }));
        res.json({
            success: true,
            data: transformedPersonnel,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Get personnel error:', error);
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
                error: 'Personnel ID is required'
            });
        }
        const personnelResult = await (0, connection_1.query)(`
      SELECT 
        p.*,
        b.name as base_name
      FROM personnel p
      LEFT JOIN bases b ON p.base_id = b.id
      WHERE p.id = $1
    `, [id]);
        if (personnelResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Personnel not found'
            });
        }
        const personnel = personnelResult.rows[0];
        if (req.user.role === 'base_commander' && personnel.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this personnel record'
            });
        }
        const transformedPersonnel = {
            ...personnel,
            base_name: personnel.base_name,
            full_name: `${personnel.first_name} ${personnel.last_name}`
        };
        return res.json({
            success: true,
            data: transformedPersonnel
        });
    }
    catch (error) {
        logger_1.logger.error('Get personnel error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.post('/', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { first_name, last_name, rank, base_id, email, phone, department } = req.body;
        if (!first_name || !last_name || !rank || !base_id) {
            return res.status(400).json({
                success: false,
                error: 'First name, last name, rank, and base are required'
            });
        }
        const targetBaseId = req.user.role === 'base_commander' ? req.user.base_id : base_id;
        const newPersonnelResult = await (0, connection_1.query)(`
      INSERT INTO personnel (first_name, last_name, rank, base_id, email, phone, department)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [first_name, last_name, rank, targetBaseId, email || null, phone || null, department || null]);
        const newPersonnel = newPersonnelResult.rows[0];
        logger_1.logger.info({
            action: 'PERSONNEL_CREATED',
            user_id: req.user.user_id,
            personnel_id: newPersonnel.id,
            personnel_name: `${newPersonnel.first_name} ${newPersonnel.last_name}`
        });
        return res.status(201).json({
            success: true,
            data: newPersonnel
        });
    }
    catch (error) {
        logger_1.logger.error('Create personnel error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.put('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { id } = req.params;
        const { first_name, last_name, rank, base_id, email, phone, department } = req.body;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Personnel ID is required'
            });
        }
        const existingPersonnelResult = await (0, connection_1.query)('SELECT * FROM personnel WHERE id = $1', [id]);
        if (existingPersonnelResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Personnel not found'
            });
        }
        const existingPersonnel = existingPersonnelResult.rows[0];
        if (req.user.role === 'base_commander' && existingPersonnel.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Base commanders can only update personnel in their base'
            });
        }
        const targetBaseId = req.user.role === 'base_commander' ? req.user.base_id : base_id;
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;
        if (first_name !== undefined) {
            updateFields.push(`first_name = $${paramIndex}`);
            updateValues.push(first_name);
            paramIndex++;
        }
        if (last_name !== undefined) {
            updateFields.push(`last_name = $${paramIndex}`);
            updateValues.push(last_name);
            paramIndex++;
        }
        if (rank !== undefined) {
            updateFields.push(`rank = $${paramIndex}`);
            updateValues.push(rank);
            paramIndex++;
        }
        if (base_id !== undefined && req.user.role === 'admin') {
            updateFields.push(`base_id = $${paramIndex}`);
            updateValues.push(targetBaseId);
            paramIndex++;
        }
        if (email !== undefined) {
            updateFields.push(`email = $${paramIndex}`);
            updateValues.push(email);
            paramIndex++;
        }
        if (phone !== undefined) {
            updateFields.push(`phone = $${paramIndex}`);
            updateValues.push(phone);
            paramIndex++;
        }
        if (department !== undefined) {
            updateFields.push(`department = $${paramIndex}`);
            updateValues.push(department);
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
      UPDATE personnel 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
        const updatedPersonnelResult = await (0, connection_1.query)(updateQuery, updateValues);
        const updatedPersonnel = updatedPersonnelResult.rows[0];
        logger_1.logger.info({
            action: 'PERSONNEL_UPDATED',
            user_id: req.user.user_id,
            personnel_id: id,
            personnel_name: `${updatedPersonnel.first_name} ${updatedPersonnel.last_name}`
        });
        return res.json({
            success: true,
            data: updatedPersonnel
        });
    }
    catch (error) {
        logger_1.logger.error('Update personnel error:', error);
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
                error: 'Personnel ID is required'
            });
        }
        const personnelResult = await (0, connection_1.query)('SELECT * FROM personnel WHERE id = $1', [id]);
        if (personnelResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Personnel not found'
            });
        }
        const personnel = personnelResult.rows[0];
        if (req.user.role === 'base_commander' && personnel.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Base commanders can only delete personnel in their base'
            });
        }
        const assignmentsResult = await (0, connection_1.query)('SELECT COUNT(*) FROM assignments WHERE personnel_id = $1', [id]);
        const assignmentCount = parseInt(assignmentsResult.rows[0].count);
        if (assignmentCount > 0) {
            return res.status(400).json({
                success: false,
                error: `Cannot delete personnel. They have ${assignmentCount} active assignments.`
            });
        }
        await (0, connection_1.query)('DELETE FROM personnel WHERE id = $1', [id]);
        logger_1.logger.info({
            action: 'PERSONNEL_DELETED',
            user_id: req.user.user_id,
            personnel_id: id,
            personnel_name: `${personnel.first_name} ${personnel.last_name}`
        });
        return res.json({
            success: true,
            message: 'Personnel deleted successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Delete personnel error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
exports.default = router;
//# sourceMappingURL=personnel.js.map