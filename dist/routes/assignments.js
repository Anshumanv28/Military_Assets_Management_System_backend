"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const connection_1 = require("../database/connection");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const db_1 = __importDefault(require("../database/db"));
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { base_id, asset_name, assigned_to, start_date, end_date, page = 1, limit = 10 } = req.query;
        let whereConditions = ['1=1'];
        const params = [];
        let paramIndex = 1;
        if (req.user.role === 'base_commander' && req.user.base_id) {
            whereConditions.push(`a.base_id = $${paramIndex++}`);
            params.push(req.user.base_id);
        }
        else if (req.user.role === 'logistics_officer' && req.user.base_id) {
            whereConditions.push(`a.base_id = $${paramIndex++}`);
            params.push(req.user.base_id);
        }
        else if (base_id && req.user.role !== 'admin') {
            whereConditions.push(`a.base_id = $${paramIndex++}`);
            params.push(base_id);
        }
        if (asset_name) {
            whereConditions.push(`a.asset_name ILIKE $${paramIndex++}`);
            params.push(`%${asset_name}%`);
        }
        if (assigned_to) {
            whereConditions.push(`a.assigned_to = $${paramIndex++}`);
            params.push(assigned_to);
        }
        if (start_date && end_date) {
            whereConditions.push(`a.assignment_date BETWEEN $${paramIndex++} AND $${paramIndex++}`);
            params.push(start_date, end_date);
        }
        const whereClause = whereConditions.join(' AND ');
        const countQuery = `
      SELECT COUNT(*) as total
      FROM assignments a
      WHERE ${whereClause}
    `;
        const countResult = await (0, connection_1.query)(countQuery, params);
        const total = parseInt(countResult.rows[0].total);
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const assignmentsQuery = `
      SELECT a.*, 'N/A' as asset_serial_number, b.name as base_name,
             CONCAT(p.first_name, ' ', p.last_name) as personnel_name, p.rank as personnel_rank,
             CONCAT(u.first_name, ' ', u.last_name) as assigned_by_name
      FROM assignments a
      JOIN bases b ON a.base_id = b.id
      JOIN personnel p ON a.assigned_to = p.id
      JOIN users u ON a.assigned_by = u.id
      WHERE ${whereClause}
      ORDER BY a.assignment_date DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
        const assignmentsResult = await (0, connection_1.query)(assignmentsQuery, [...params, parseInt(limit), offset]);
        res.json({
            success: true,
            data: assignmentsResult.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Get assignments error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.post('/', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander', 'logistics_officer'), async (req, res) => {
    try {
        const { asset_name, assigned_to, base_id, quantity, assignment_date, notes } = req.body;
        console.log('Received assignment data:', req.body);
        if (!asset_name || !assigned_to || !base_id || !quantity || !assignment_date) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        const validQuantity = parseInt(quantity);
        console.log('Quantity type:', typeof validQuantity, 'Value:', validQuantity);
        if (isNaN(validQuantity) || validQuantity <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantity must be a positive number'
            });
        }
        if (req.user.role === 'base_commander' && base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Base commanders can only create assignments for their base'
            });
        }
        const assetResult = await (0, connection_1.query)('SELECT quantity, available_quantity FROM assets WHERE name = $1 AND base_id = $2', [asset_name, base_id]);
        if (assetResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Asset not found'
            });
        }
        const asset = assetResult.rows[0];
        console.log('Asset data from database:', asset);
        console.log('Available quantity:', asset.available_quantity, 'Type:', typeof asset.available_quantity);
        console.log('Assigned quantity:', asset.assigned_quantity, 'Type:', typeof asset.assigned_quantity);
        if (asset.available_quantity < validQuantity) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient available quantity'
            });
        }
        const personnelResult = await (0, connection_1.query)('SELECT * FROM personnel WHERE id = $1', [assigned_to]);
        if (personnelResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Personnel not found'
            });
        }
        const transaction = await db_1.default.begin(async (sql) => {
            const createQuery = `
        INSERT INTO assignments (asset_name, assigned_to, assigned_by, base_id, quantity, assignment_date, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
            const result = await sql.unsafe(createQuery, [
                asset_name,
                assigned_to,
                req.user.user_id,
                base_id,
                validQuantity,
                assignment_date,
                notes || null
            ]);
            const newAssignment = result[0];
            const availableQuantity = parseInt(asset.available_quantity) || 0;
            const assignedQuantity = parseInt(asset.assigned_quantity) || 0;
            const newAvailableQuantity = availableQuantity - validQuantity;
            const newAssignedQuantity = assignedQuantity + validQuantity;
            console.log('Calculating new quantities:');
            console.log('Original available:', availableQuantity, 'Original assigned:', assignedQuantity);
            console.log('New available:', newAvailableQuantity, 'New assigned:', newAssignedQuantity);
            await sql.unsafe(`
        UPDATE assets 
        SET available_quantity = $1, assigned_quantity = $2
        WHERE name = $3 AND base_id = $4
      `, [newAvailableQuantity, newAssignedQuantity, asset_name, base_id]);
            let newStatus = 'available';
            if (newAvailableQuantity === 0) {
                newStatus = 'low_stock';
            }
            await sql.unsafe(`
        UPDATE assets 
        SET status = $1
        WHERE name = $2 AND base_id = $3
      `, [newStatus, asset_name, base_id]);
            return newAssignment;
        });
        logger_1.logger.info({
            action: 'ASSIGNMENT_CREATED',
            user_id: req.user.user_id,
            assignment_id: transaction?.['id'],
            asset_name,
            assigned_to,
            quantity
        });
        return res.status(201).json({
            success: true,
            data: transaction
        });
    }
    catch (error) {
        logger_1.logger.error('Create assignment error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.put('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, assignment_date, notes } = req.body;
        const assignmentResult = await (0, connection_1.query)('SELECT * FROM assignments WHERE id = $1', [id]);
        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Assignment not found'
            });
        }
        const assignment = assignmentResult.rows[0];
        if (req.user.role === 'base_commander' && assignment.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Base commanders can only update assignments for their base'
            });
        }
        if (quantity !== undefined && quantity <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantity must be greater than 0'
            });
        }
        if (quantity !== undefined && quantity !== assignment.quantity) {
            const quantityDifference = quantity - assignment.quantity;
            const assetResult = await (0, connection_1.query)('SELECT quantity, available_quantity, assigned_quantity FROM assets WHERE name = $1 AND base_id = $2', [assignment.asset_name, assignment.base_id]);
            if (assetResult.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Asset inventory not found'
                });
            }
            const asset = assetResult.rows[0];
            const newAvailableQuantity = asset.available_quantity - quantityDifference;
            const newAssignedQuantity = asset.assigned_quantity + quantityDifference;
            if (newAvailableQuantity < 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Insufficient available quantity for assignment'
                });
            }
            await (0, connection_1.query)(`
        UPDATE assets 
        SET available_quantity = $1, assigned_quantity = $2
        WHERE name = $3 AND base_id = $4
      `, [newAvailableQuantity, newAssignedQuantity, assignment.asset_name, assignment.base_id]);
        }
        const updateQuery = `
      UPDATE assignments 
      SET quantity = COALESCE($1, quantity),
          assignment_date = COALESCE($2, assignment_date),
          notes = COALESCE($3, notes)
      WHERE id = $4
      RETURNING *
    `;
        const result = await (0, connection_1.query)(updateQuery, [
            quantity,
            assignment_date,
            notes,
            id
        ]);
        const updatedAssignment = result.rows[0];
        logger_1.logger.info({
            action: 'ASSIGNMENT_UPDATED',
            user_id: req.user.user_id,
            assignment_id: id,
            old_quantity: assignment.quantity,
            new_quantity: quantity || assignment.quantity
        });
        return res.json({
            success: true,
            data: updatedAssignment
        });
    }
    catch (error) {
        logger_1.logger.error('Update assignment error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.delete('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { id } = req.params;
        const assignmentResult = await (0, connection_1.query)('SELECT * FROM assignments WHERE id = $1', [id]);
        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Assignment not found'
            });
        }
        const assignment = assignmentResult.rows[0];
        if (req.user.role === 'base_commander' && assignment.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Base commanders can only delete assignments for their base'
            });
        }
        await db_1.default.begin(async (sql) => {
            if (assignment.status === 'active') {
                const assetResult = await sql.unsafe('SELECT quantity, available_quantity, assigned_quantity FROM assets WHERE name = $1 AND base_id = $2', [assignment.asset_name, assignment.base_id]);
                if (assetResult.length > 0) {
                    const asset = assetResult[0];
                    if (asset) {
                        const newAvailableQuantity = asset['available_quantity'] + assignment.quantity;
                        const newAssignedQuantity = asset['assigned_quantity'] - assignment.quantity;
                        await sql.unsafe(`
              UPDATE assets 
              SET available_quantity = $1, assigned_quantity = $2
              WHERE name = $3 AND base_id = $4
            `, [newAvailableQuantity, newAssignedQuantity, assignment.asset_name, assignment.base_id]);
                    }
                }
            }
            await sql.unsafe('DELETE FROM assignments WHERE id = $1', [id]);
        });
        logger_1.logger.info({
            action: 'ASSIGNMENT_DELETED',
            user_id: req.user.user_id,
            assignment_id: id,
            asset_name: assignment.asset_name,
            quantity: assignment.quantity
        });
        return res.json({
            success: true,
            message: 'Assignment deleted successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Delete assignment error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.put('/:id/expend', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander', 'logistics_officer'), async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, notes, reason } = req.body;
        if (!quantity || quantity <= 0) {
            return res.status(400).json({ success: false, error: 'Quantity must be positive' });
        }
        const assignmentResult = await (0, connection_1.query)('SELECT * FROM assignments WHERE id = $1', [id]);
        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Assignment not found' });
        }
        const assignment = assignmentResult.rows[0];
        const remaining = assignment.quantity - assignment.expended_quantity;
        if (quantity > remaining) {
            return res.status(400).json({ success: false, error: 'Cannot expend more than remaining quantity' });
        }
        await db_1.default.begin(async (sql) => {
            const newExpended = assignment.expended_quantity + quantity;
            let newStatus = 'active';
            if (newExpended === assignment.quantity)
                newStatus = 'expended';
            else if (newExpended > 0)
                newStatus = 'partially_expended';
            await sql.unsafe('UPDATE assignments SET expended_quantity = $1, status = $2, notes = COALESCE($3, notes) WHERE id = $4 RETURNING *', [newExpended, newStatus, notes || null, id]);
            const assetResult = await sql.unsafe('SELECT quantity, available_quantity, assigned_quantity FROM assets WHERE name = $1 AND base_id = $2', [assignment.asset_name, assignment.base_id]);
            if (assetResult.length === 0) {
                throw new Error('Asset record not found for this base and asset name');
            }
            const asset = assetResult[0];
            if (!asset) {
                throw new Error('Asset record not found for this base and asset name');
            }
            const newQuantity = asset['quantity'] - quantity;
            const newAvailableQuantity = asset['available_quantity'] - quantity;
            const newAssignedQuantity = asset['assigned_quantity'] - quantity;
            if (newQuantity < 0 || newAvailableQuantity < 0 || newAssignedQuantity < 0) {
                throw new Error('Asset quantities cannot be negative');
            }
            await sql.unsafe('UPDATE assets SET quantity = $1, available_quantity = $2, assigned_quantity = $3 WHERE name = $4 AND base_id = $5', [newQuantity, newAvailableQuantity, newAssignedQuantity, assignment.asset_name, assignment.base_id]);
            let assetNewStatus = 'available';
            if (newQuantity === 0) {
                assetNewStatus = 'out_of_stock';
            }
            else if (newAvailableQuantity === 0) {
                assetNewStatus = 'low_stock';
            }
            await sql.unsafe('UPDATE assets SET status = $1 WHERE name = $2 AND base_id = $3', [assetNewStatus, assignment.asset_name, assignment.base_id]);
            const expenditureReason = reason || 'Expended from assignment';
            await sql.unsafe('INSERT INTO expenditures (asset_name, base_id, personnel_id, quantity, expenditure_date, reason, notes, created_by) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7)', [assignment.asset_name, assignment.base_id, assignment.assigned_to, quantity, expenditureReason, notes || null, req.user.user_id]);
        });
        logger_1.logger.info({
            action: 'ASSIGNMENT_EXPENDED',
            user_id: req.user.user_id,
            assignment_id: id,
            asset_name: assignment.asset_name,
            base_id: assignment.base_id,
            personnel_id: assignment.assigned_to,
            quantity,
            reason: reason || 'Expended from assignment'
        });
        return res.json({
            success: true,
            message: 'Asset expended successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Expend assignment error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Server error'
        });
    }
});
exports.default = router;
//# sourceMappingURL=assignments.js.map