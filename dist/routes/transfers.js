"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { from_base_id, to_base_id, asset_name, start_date, end_date, page = 1, limit = 10 } = req.query;
        const whereConditions = {};
        if (req.user.role === 'base_commander' && req.user.base_id) {
            whereConditions.OR = [
                { from_base_id: req.user.base_id },
                { to_base_id: req.user.base_id }
            ];
        }
        else if (req.user.role === 'logistics_officer' && req.user.base_id) {
            whereConditions.OR = [
                { from_base_id: req.user.base_id },
                { to_base_id: req.user.base_id }
            ];
        }
        else {
            if (from_base_id)
                whereConditions.from_base_id = from_base_id;
            if (to_base_id)
                whereConditions.to_base_id = to_base_id;
        }
        if (asset_name) {
            whereConditions.asset_name = { contains: asset_name, mode: 'insensitive' };
        }
        if (start_date && end_date) {
            whereConditions.transfer_date = {
                gte: new Date(start_date),
                lte: new Date(end_date)
            };
        }
        const total = await prisma_1.default.transfers.count({ where: whereConditions });
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const transfers = await prisma_1.default.transfers.findMany({
            where: whereConditions,
            include: {
                bases_transfers_from_base_idTobases: { select: { name: true } },
                bases_transfers_to_base_idTobases: { select: { name: true } },
                users_transfers_created_byTousers: { select: { first_name: true, last_name: true } }
            },
            orderBy: { transfer_date: 'desc' },
            take: parseInt(limit),
            skip: offset
        });
        const transformedTransfers = transfers.map(t => ({
            ...t,
            from_base_name: t.bases_transfers_from_base_idTobases.name,
            to_base_name: t.bases_transfers_to_base_idTobases.name,
            first_name: t.users_transfers_created_byTousers.first_name,
            last_name: t.users_transfers_created_byTousers.last_name
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
        const bases = await prisma_1.default.bases.findMany({ where: { id: { in: [from_base_id, to_base_id] } } });
        if (bases.length !== 2) {
            return res.status(400).json({ success: false, error: 'Invalid base IDs' });
        }
        const sourceAsset = await prisma_1.default.assets.findFirst({ where: { name: asset_name, base_id: from_base_id } });
        if (!sourceAsset) {
            return res.status(400).json({ success: false, error: 'Source base does not have this asset in inventory' });
        }
        if (sourceAsset.available_quantity < parsedQuantity) {
            return res.status(400).json({ success: false, error: `Insufficient available quantity. Available: ${sourceAsset.available_quantity}, Requested: ${parsedQuantity}` });
        }
        const status = 'pending';
        const transferNumber = `TRF-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        const newTransfer = await prisma_1.default.transfers.create({
            data: {
                transfer_number: transferNumber,
                from_base_id,
                to_base_id,
                asset_name,
                quantity: parsedQuantity,
                transfer_date: transfer_date ? new Date(transfer_date) : new Date(),
                status,
                approved_by: null,
                approved_at: null,
                created_by: req.user.user_id,
                notes: notes || null
            }
        });
        logger_1.logger.info({ action: 'TRANSFER_REQUESTED', user_id: req.user.user_id, user_role: req.user.role, transfer_id: newTransfer.id, transfer_number: newTransfer.transfer_number, from_base_id, to_base_id, asset_name, quantity: parsedQuantity, status });
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
        const transfer = await prisma_1.default.transfers.findUnique({ where: { id } });
        if (!transfer)
            return res.status(404).json({ success: false, error: 'Transfer not found' });
        if (transfer.status === 'approved')
            return res.status(400).json({ success: false, error: 'Transfer is already approved' });
        if (transfer.status === 'rejected')
            return res.status(400).json({ success: false, error: 'Cannot approve a rejected transfer' });
        const sourceAsset = await prisma_1.default.assets.findFirst({ where: { name: transfer.asset_name, base_id: transfer.from_base_id } });
        if (!sourceAsset)
            return res.status(400).json({ success: false, error: 'Source base no longer has this asset in inventory' });
        if (sourceAsset.available_quantity < transfer.quantity)
            return res.status(400).json({ success: false, error: `Insufficient available quantity. Available: ${sourceAsset.available_quantity}, Requested: ${transfer.quantity}` });
        const approvedTransfer = await prisma_1.default.transfers.update({
            where: { id },
            data: { status: 'approved', approved_by: req.user.user_id, approved_at: new Date() }
        });
        await executeTransfer(approvedTransfer);
        logger_1.logger.info({ action: 'TRANSFER_APPROVED', user_id: req.user.user_id, transfer_id: id, transfer_number: transfer.transfer_number, asset_name: transfer.asset_name, quantity: transfer.quantity });
        return res.json({ success: true, data: approvedTransfer });
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
        const transfer = await prisma_1.default.transfers.findUnique({ where: { id } });
        if (!transfer)
            return res.status(404).json({ success: false, error: 'Transfer not found' });
        if (transfer.status === 'rejected')
            return res.status(400).json({ success: false, error: 'Transfer is already rejected' });
        if (transfer.status === 'approved')
            return res.status(400).json({ success: false, error: 'Cannot reject an approved transfer' });
        const rejectedTransfer = await prisma_1.default.transfers.update({ where: { id }, data: { status: 'rejected', notes: notes || transfer.notes } });
        logger_1.logger.info({ action: 'TRANSFER_REJECTED', user_id: req.user.user_id, transfer_id: id, transfer_number: transfer.transfer_number, notes });
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
        const transfer = await prisma_1.default.transfers.findUnique({ where: { id } });
        if (!transfer)
            return res.status(404).json({ success: false, error: 'Transfer not found' });
        if (req.user.role === 'base_commander') {
            if (transfer.status === 'approved') {
                return res.status(400).json({ success: false, error: 'Cannot delete an approved transfer' });
            }
            if (transfer.from_base_id !== req.user.base_id && transfer.to_base_id !== req.user.base_id) {
                return res.status(403).json({ success: false, error: 'You can only delete transfers involving your base' });
            }
        }
        await prisma_1.default.transfers.delete({ where: { id } });
        logger_1.logger.info({ action: 'TRANSFER_DELETED', user_id: req.user.user_id, user_role: req.user.role, transfer_id: id, transfer_number: transfer.transfer_number, transfer_status: transfer.status });
        return res.json({ success: true, message: 'Transfer deleted successfully' });
    }
    catch (error) {
        logger_1.logger.error('Delete transfer error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
async function executeTransfer(transfer) {
    try {
        await prisma_1.default.$transaction(async (tx) => {
            const sourceAsset = await tx.assets.findFirst({ where: { name: transfer.asset_name, base_id: transfer.from_base_id } });
            if (!sourceAsset)
                throw new Error('Source asset not found');
            const newSourceQuantity = sourceAsset.quantity - transfer.quantity;
            const newSourceAvailableQuantity = sourceAsset.available_quantity - transfer.quantity;
            if (newSourceAvailableQuantity < 0)
                throw new Error('Insufficient available quantity for transfer');
            await tx.assets.update({ where: { id: sourceAsset.id }, data: { quantity: newSourceQuantity, available_quantity: newSourceAvailableQuantity } });
            const destAsset = await tx.assets.findFirst({ where: { name: transfer.asset_name, base_id: transfer.to_base_id } });
            if (destAsset) {
                const newDestQuantity = destAsset.quantity + transfer.quantity;
                const newDestAvailableQuantity = destAsset.available_quantity + transfer.quantity;
                await tx.assets.update({ where: { id: destAsset.id }, data: { quantity: newDestQuantity, available_quantity: newDestAvailableQuantity } });
            }
            else {
                await tx.assets.create({ data: { name: transfer.asset_name, base_id: transfer.to_base_id, quantity: transfer.quantity, available_quantity: transfer.quantity, assigned_quantity: 0 } });
            }
        });
        logger_1.logger.info({ action: 'TRANSFER_EXECUTED', transfer_id: transfer.id, transfer_number: transfer.transfer_number, from_base_id: transfer.from_base_id, to_base_id: transfer.to_base_id, asset_name: transfer.asset_name, quantity: transfer.quantity });
    }
    catch (error) {
        logger_1.logger.error('Error executing transfer:', error);
        throw error;
    }
}
exports.default = router;
//# sourceMappingURL=transfers.js.map