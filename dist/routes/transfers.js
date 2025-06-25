"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const connection_1 = require("../database/connection");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { from_base_id, to_base_id, asset_name, start_date, end_date, page = 1, limit = 10 } = req.query;
        let whereClause = 'WHERE 1=1';
        const params = [];
        let paramIndex = 1;
        if (req.user.role === 'base_commander' && req.user.base_id) {
            whereClause += ` AND (t.from_base_id = $${paramIndex} OR t.to_base_id = $${paramIndex})`;
            params.push(req.user.base_id);
            paramIndex++;
        }
        else if (req.user.role === 'logistics_officer' && req.user.base_id) {
            whereClause += ` AND (t.from_base_id = $${paramIndex} OR t.to_base_id = $${paramIndex})`;
            params.push(req.user.base_id);
            paramIndex++;
        }
        else {
            if (from_base_id) {
                whereClause += ` AND t.from_base_id = $${paramIndex}`;
                params.push(from_base_id);
                paramIndex++;
            }
            if (to_base_id) {
                whereClause += ` AND t.to_base_id = $${paramIndex}`;
                params.push(to_base_id);
                paramIndex++;
            }
        }
        if (asset_name) {
            whereClause += ` AND t.asset_name ILIKE $${paramIndex}`;
            params.push(`%${asset_name}%`);
            paramIndex++;
        }
        if (start_date && end_date) {
            whereClause += ` AND t.transfer_date >= $${paramIndex} AND t.transfer_date <= $${paramIndex + 1}`;
            params.push(start_date, end_date);
            paramIndex += 2;
        }
        const countQuery = `SELECT COUNT(*) FROM transfers t ${whereClause}`;
        const countResult = await (0, connection_1.query)(countQuery, params);
        const total = parseInt(countResult.rows[0].count);
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const transfersQuery = `
      SELECT 
        t.*,
        bf.name as from_base_name,
        bt.name as to_base_name,
        u.first_name,
        u.last_name
      FROM transfers t
      LEFT JOIN bases bf ON t.from_base_id = bf.id
      LEFT JOIN bases bt ON t.to_base_id = bt.id
      LEFT JOIN users u ON t.created_by = u.id
      ${whereClause}
      ORDER BY t.transfer_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
        params.push(parseInt(limit), offset);
        const transfersResult = await (0, connection_1.query)(transfersQuery, params);
        const transfers = transfersResult.rows;
        const transformedTransfers = transfers.map((t) => ({
            ...t,
            from_base_name: t.from_base_name,
            to_base_name: t.to_base_name,
            first_name: t.first_name,
            last_name: t.last_name
        }));
        res.json({
            success: true,
            data: transformedTransfers,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Get transfers error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.post('/', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { from_base_id, to_base_id, asset_name, quantity, transfer_date, notes } = req.body;
        logger_1.logger.info('Received transfer data:', { from_base_id, to_base_id, asset_name, quantity, transfer_date, notes });
        if (!from_base_id || !to_base_id || !asset_name || quantity === undefined || quantity === null) {
            return res.status(400).json({ success: false, error: 'From base ID, to base ID, asset name, and quantity are required' });
        }
        const parsedQuantity = parseInt(quantity);
        if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
            return res.status(400).json({ success: false, error: 'Quantity must be a valid positive integer' });
        }
        if (req.user.role === 'base_commander') {
            if (from_base_id !== req.user.base_id && to_base_id !== req.user.base_id) {
                return res.status(403).json({ success: false, error: 'Base commanders can only create transfers involving their base' });
            }
        }
        const basesResult = await (0, connection_1.query)('SELECT id FROM bases WHERE id IN ($1, $2)', [from_base_id, to_base_id]);
        if (basesResult.rows.length !== 2) {
            return res.status(400).json({ success: false, error: 'Invalid base IDs' });
        }
        const sourceAssetResult = await (0, connection_1.query)('SELECT * FROM assets WHERE name = $1 AND base_id = $2', [asset_name, from_base_id]);
        if (sourceAssetResult.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Source base does not have this asset in inventory' });
        }
        const sourceAsset = sourceAssetResult.rows[0];
        if (sourceAsset.available_quantity < parsedQuantity) {
            return res.status(400).json({ success: false, error: `Insufficient available quantity. Available: ${sourceAsset.available_quantity}, Requested: ${parsedQuantity}` });
        }
        const status = 'pending';
        const transferNumber = `TRF-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        const newTransferResult = await (0, connection_1.query)(`
      INSERT INTO transfers (transfer_number, from_base_id, to_base_id, asset_name, quantity, transfer_date, status, approved_by, approved_at, created_by, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [transferNumber, from_base_id, to_base_id, asset_name, parsedQuantity, transfer_date ? new Date(transfer_date) : new Date(), status, null, null, req.user.user_id, notes || null]);
        const newTransfer = newTransferResult.rows[0];
        logger_1.logger.info({
            action: 'TRANSFER_REQUESTED',
            user_id: req.user.user_id,
            user_role: req.user.role,
            transfer_id: newTransfer.id,
            transfer_number: newTransfer.transfer_number,
            from_base_id,
            to_base_id,
            asset_name,
            quantity: parsedQuantity,
            status
        });
        return res.status(201).json({ success: true, data: newTransfer });
    }
    catch (error) {
        logger_1.logger.error('Create transfer error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.put('/:id/approve', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id)
            return res.status(400).json({ success: false, error: 'Transfer ID is required' });
        const transferResult = await (0, connection_1.query)('SELECT * FROM transfers WHERE id = $1', [id]);
        if (transferResult.rows.length === 0)
            return res.status(404).json({ success: false, error: 'Transfer not found' });
        const transfer = transferResult.rows[0];
        if (transfer.status === 'approved')
            return res.status(400).json({ success: false, error: 'Transfer is already approved' });
        if (transfer.status === 'rejected')
            return res.status(400).json({ success: false, error: 'Cannot approve a rejected transfer' });
        const sourceAssetResult = await (0, connection_1.query)('SELECT * FROM assets WHERE name = $1 AND base_id = $2', [transfer.asset_name, transfer.from_base_id]);
        if (sourceAssetResult.rows.length === 0)
            return res.status(400).json({ success: false, error: 'Source base no longer has this asset in inventory' });
        const sourceAsset = sourceAssetResult.rows[0];
        if (sourceAsset.available_quantity < transfer.quantity)
            return res.status(400).json({ success: false, error: `Insufficient available quantity. Available: ${sourceAsset.available_quantity}, Requested: ${transfer.quantity}` });
        await (0, connection_1.query)('BEGIN');
        try {
            const approvedTransferResult = await (0, connection_1.query)(`
        UPDATE transfers 
        SET status = $1, approved_by = $2, approved_at = $3
        WHERE id = $4
        RETURNING *
      `, ['approved', req.user.user_id, new Date(), id]);
            const approvedTransfer = approvedTransferResult.rows[0];
            await executeTransfer(approvedTransfer);
            await (0, connection_1.query)('COMMIT');
            logger_1.logger.info({
                action: 'TRANSFER_APPROVED',
                user_id: req.user.user_id,
                transfer_id: id,
                transfer_number: transfer.transfer_number,
                asset_name: transfer.asset_name,
                quantity: transfer.quantity
            });
            return res.json({ success: true, data: approvedTransfer });
        }
        catch (error) {
            await (0, connection_1.query)('ROLLBACK');
            throw error;
        }
    }
    catch (error) {
        logger_1.logger.error('Approve transfer error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.put('/:id/reject', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;
        if (!id)
            return res.status(400).json({ success: false, error: 'Transfer ID is required' });
        const transferResult = await (0, connection_1.query)('SELECT * FROM transfers WHERE id = $1', [id]);
        if (transferResult.rows.length === 0)
            return res.status(404).json({ success: false, error: 'Transfer not found' });
        const transfer = transferResult.rows[0];
        if (transfer.status === 'rejected')
            return res.status(400).json({ success: false, error: 'Transfer is already rejected' });
        if (transfer.status === 'approved')
            return res.status(400).json({ success: false, error: 'Cannot reject an approved transfer' });
        const rejectedTransferResult = await (0, connection_1.query)(`
      UPDATE transfers 
      SET status = $1, notes = $2
      WHERE id = $3
      RETURNING *
    `, ['rejected', notes || transfer.notes, id]);
        const rejectedTransfer = rejectedTransferResult.rows[0];
        logger_1.logger.info({
            action: 'TRANSFER_REJECTED',
            user_id: req.user.user_id,
            transfer_id: id,
            transfer_number: transfer.transfer_number,
            notes
        });
        return res.json({ success: true, data: rejectedTransfer });
    }
    catch (error) {
        logger_1.logger.error('Reject transfer error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.delete('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id)
            return res.status(400).json({ success: false, error: 'Transfer ID is required' });
        const transferResult = await (0, connection_1.query)('SELECT * FROM transfers WHERE id = $1', [id]);
        if (transferResult.rows.length === 0)
            return res.status(404).json({ success: false, error: 'Transfer not found' });
        const transfer = transferResult.rows[0];
        if (req.user.role === 'base_commander') {
            if (transfer.status === 'approved') {
                return res.status(400).json({ success: false, error: 'Cannot delete an approved transfer' });
            }
            if (transfer.from_base_id !== req.user.base_id && transfer.to_base_id !== req.user.base_id) {
                return res.status(403).json({ success: false, error: 'Base commanders can only delete transfers involving their base' });
            }
        }
        await (0, connection_1.query)('DELETE FROM transfers WHERE id = $1', [id]);
        logger_1.logger.info({
            action: 'TRANSFER_DELETED',
            user_id: req.user.user_id,
            transfer_id: id,
            transfer_number: transfer.transfer_number
        });
        return res.json({ success: true, message: 'Transfer deleted successfully' });
    }
    catch (error) {
        logger_1.logger.error('Delete transfer error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
async function executeTransfer(transfer) {
    try {
        const sourceAssetResult = await (0, connection_1.query)('SELECT * FROM assets WHERE name = $1 AND base_id = $2', [transfer.asset_name, transfer.from_base_id]);
        if (sourceAssetResult.rows.length === 0) {
            throw new Error(`Source asset not found: ${transfer.asset_name} at base ${transfer.from_base_id}`);
        }
        const sourceAsset = sourceAssetResult.rows[0];
        const newSourceQuantity = sourceAsset.quantity - transfer.quantity;
        const newSourceAvailableQuantity = sourceAsset.available_quantity - transfer.quantity;
        let newSourceStatus = 'available';
        if (newSourceQuantity === 0) {
            newSourceStatus = 'out_of_stock';
        }
        else if (newSourceAvailableQuantity === 0) {
            newSourceStatus = 'low_stock';
        }
        await (0, connection_1.query)(`
      UPDATE assets 
      SET quantity = $1, available_quantity = $2, status = $3
      WHERE id = $4
    `, [newSourceQuantity, newSourceAvailableQuantity, newSourceStatus, sourceAsset.id]);
        const destAssetResult = await (0, connection_1.query)('SELECT * FROM assets WHERE name = $1 AND base_id = $2', [transfer.asset_name, transfer.to_base_id]);
        if (destAssetResult.rows.length > 0) {
            const destAsset = destAssetResult.rows[0];
            const newDestQuantity = destAsset.quantity + transfer.quantity;
            const newDestAvailableQuantity = destAsset.available_quantity + transfer.quantity;
            let newDestStatus = 'available';
            if (newDestAvailableQuantity === 0) {
                newDestStatus = 'low_stock';
            }
            await (0, connection_1.query)(`
        UPDATE assets 
        SET quantity = $1, available_quantity = $2, status = $3
        WHERE id = $4
      `, [newDestQuantity, newDestAvailableQuantity, newDestStatus, destAsset.id]);
        }
        else {
            await (0, connection_1.query)(`
        INSERT INTO assets (name, base_id, quantity, available_quantity, assigned_quantity, status)
        VALUES ($1, $2, $3, $3, 0, 'available')
      `, [transfer.asset_name, transfer.to_base_id, transfer.quantity]);
        }
        logger_1.logger.info({
            action: 'TRANSFER_EXECUTED',
            transfer_id: transfer.id,
            transfer_number: transfer.transfer_number,
            asset_name: transfer.asset_name,
            quantity: transfer.quantity,
            from_base_id: transfer.from_base_id,
            to_base_id: transfer.to_base_id
        });
    }
    catch (error) {
        logger_1.logger.error('Error executing transfer:', error);
        throw error;
    }
}
exports.default = router;
//# sourceMappingURL=transfers.js.map