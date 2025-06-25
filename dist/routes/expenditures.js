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
        const { base_id, asset_name, start_date, end_date, page = 1, limit = 10 } = req.query;
        const whereConditions = {};
        if (req.user.role === 'base_commander' && req.user.base_id) {
            whereConditions.base_id = req.user.base_id;
        }
        else if (req.user.role === 'logistics_officer' && req.user.base_id) {
            whereConditions.base_id = req.user.base_id;
        }
        else if (base_id) {
            whereConditions.base_id = base_id;
        }
        if (asset_name) {
            whereConditions.asset_name = {
                contains: asset_name,
                mode: 'insensitive'
            };
        }
        if (start_date && end_date) {
            whereConditions.expenditure_date = {
                gte: new Date(start_date),
                lte: new Date(end_date)
            };
        }
        const total = await prisma_1.default.expenditures.count({
            where: whereConditions
        });
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const expenditures = await prisma_1.default.expenditures.findMany({
            where: whereConditions,
            include: {
                bases: {
                    select: {
                        name: true
                    }
                },
                users_expenditures_created_byTousers: {
                    select: {
                        first_name: true,
                        last_name: true
                    }
                },
                personnel: {
                    select: {
                        first_name: true,
                        last_name: true,
                        rank: true
                    }
                }
            },
            orderBy: {
                expenditure_date: 'desc'
            },
            take: parseInt(limit),
            skip: offset
        });
        const transformedExpenditures = expenditures.map(expenditure => ({
            ...expenditure,
            base_name: expenditure.bases.name,
            first_name: expenditure.users_expenditures_created_byTousers.first_name,
            last_name: expenditure.users_expenditures_created_byTousers.last_name,
            personnel_first_name: expenditure.personnel?.first_name || null,
            personnel_last_name: expenditure.personnel?.last_name || null,
            personnel_rank: expenditure.personnel?.rank || null
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
        const asset = await prisma_1.default.assets.findFirst({
            where: {
                name: asset_name,
                base_id: base_id
            }
        });
        if (!asset) {
            return res.status(400).json({
                success: false,
                error: 'Base does not have this asset in inventory'
            });
        }
        if (asset.available_quantity < quantity) {
            return res.status(400).json({
                success: false,
                error: `Insufficient available quantity for expenditure. Available: ${asset.available_quantity}, Requested: ${quantity}`
            });
        }
        const result = await prisma_1.default.$transaction(async (tx) => {
            const newExpenditure = await tx.expenditures.create({
                data: {
                    asset_name,
                    base_id,
                    quantity,
                    expenditure_date: new Date(expenditure_date),
                    reason,
                    notes: notes || null,
                    created_by: req.user.user_id
                }
            });
            const newQuantity = asset.quantity - quantity;
            const newAvailableQuantity = asset.available_quantity - quantity;
            let newStatus = 'available';
            if (newQuantity === 0) {
                newStatus = 'out_of_stock';
            }
            else if (newAvailableQuantity === 0) {
                newStatus = 'low_stock';
            }
            await tx.assets.update({
                where: {
                    id: asset.id
                },
                data: {
                    quantity: newQuantity,
                    available_quantity: newAvailableQuantity,
                    status: newStatus
                }
            });
            return newExpenditure;
        });
        logger_1.logger.info({
            action: 'EXPENDITURE_CREATED',
            user_id: req.user.user_id,
            expenditure_id: result.id,
            asset_name,
            base_id,
            quantity,
            reason,
            remaining_quantity: asset.quantity - quantity
        });
        return res.status(201).json({ success: true, data: result });
    }
    catch (error) {
        logger_1.logger.error('Create expenditure error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
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
        const expenditure = await prisma_1.default.expenditures.findUnique({
            where: { id }
        });
        if (!expenditure) {
            return res.status(404).json({
                success: false,
                error: 'Expenditure not found'
            });
        }
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
            const asset = await prisma_1.default.assets.findFirst({
                where: {
                    name: expenditure.asset_name,
                    base_id: expenditure.base_id
                }
            });
            if (!asset) {
                return res.status(400).json({
                    success: false,
                    error: 'Asset inventory not found'
                });
            }
            const newQuantity = asset.quantity + quantityDifference;
            const newAvailableQuantity = asset.available_quantity + quantityDifference;
            if (newQuantity < 0 || newAvailableQuantity < 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot reduce expenditure quantity below zero'
                });
            }
            await prisma_1.default.assets.update({
                where: {
                    id: asset.id
                },
                data: {
                    quantity: newQuantity,
                    available_quantity: newAvailableQuantity
                }
            });
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
        const updatedExpenditure = await prisma_1.default.expenditures.update({
            where: { id },
            data: updateData
        });
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
        const expenditure = await prisma_1.default.expenditures.findUnique({
            where: { id }
        });
        if (!expenditure) {
            return res.status(404).json({
                success: false,
                error: 'Expenditure not found'
            });
        }
        await prisma_1.default.$transaction(async (tx) => {
            const asset = await tx.assets.findFirst({
                where: {
                    name: expenditure.asset_name,
                    base_id: expenditure.base_id
                }
            });
            if (asset) {
                const newQuantity = asset.quantity + expenditure.quantity;
                const newAvailableQuantity = asset.available_quantity + expenditure.quantity;
                let newStatus = 'available';
                if (newQuantity === 0) {
                    newStatus = 'out_of_stock';
                }
                else if (newAvailableQuantity === 0) {
                    newStatus = 'low_stock';
                }
                await tx.assets.update({
                    where: {
                        id: asset.id
                    },
                    data: {
                        quantity: newQuantity,
                        available_quantity: newAvailableQuantity,
                        status: newStatus
                    }
                });
            }
            await tx.expenditures.delete({
                where: { id }
            });
        });
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
        logger_1.logger.error('Delete expenditure error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=expenditures.js.map