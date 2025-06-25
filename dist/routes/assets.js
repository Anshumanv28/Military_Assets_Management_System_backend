"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const prisma_1 = __importDefault(require("../lib/prisma"));
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { base_id, name, status, page = 1, limit = 10 } = req.query;
        const where = {};
        if (req.user.role === 'base_commander' && req.user.base_id) {
            where.base_id = req.user.base_id;
        }
        else if (base_id && req.user.role !== 'admin') {
            where.base_id = base_id;
        }
        if (name) {
            where.name = {
                contains: name,
                mode: 'insensitive'
            };
        }
        if (status) {
            where.status = status;
        }
        const total = await prisma_1.default.assets.count({ where });
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const assets = await prisma_1.default.assets.findMany({
            where,
            include: {
                bases: {
                    select: {
                        name: true,
                        code: true
                    }
                }
            },
            orderBy: [
                { name: 'asc' },
                { bases: { name: 'asc' } }
            ],
            take: parseInt(limit),
            skip: offset
        });
        const transformedAssets = assets.map(asset => ({
            ...asset,
            current_base_name: asset.bases.name,
            base_code: asset.bases.code
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
        const asset = await prisma_1.default.assets.findUnique({
            where: { id },
            include: {
                bases: {
                    select: {
                        name: true,
                        code: true
                    }
                }
            }
        });
        if (!asset) {
            return res.status(404).json({
                success: false,
                error: 'Asset not found'
            });
        }
        if (req.user.role === 'base_commander' && asset.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this asset'
            });
        }
        const transformedAsset = {
            ...asset,
            current_base_name: asset.bases.name,
            base_code: asset.bases.code
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
        const base = await prisma_1.default.bases.findUnique({
            where: { id: base_id }
        });
        if (!base) {
            return res.status(400).json({
                success: false,
                error: 'Base not found'
            });
        }
        const existingAsset = await prisma_1.default.assets.findFirst({
            where: {
                name,
                base_id
            }
        });
        if (existingAsset) {
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
        const newAsset = await prisma_1.default.assets.create({
            data: {
                name,
                base_id,
                quantity,
                available_quantity: finalAvailableQuantity,
                assigned_quantity: finalAssignedQuantity
            }
        });
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
        const currentAsset = await prisma_1.default.assets.findUnique({
            where: { id }
        });
        if (!currentAsset) {
            return res.status(404).json({
                success: false,
                error: 'Asset not found'
            });
        }
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
        const updatedAsset = await prisma_1.default.assets.update({
            where: { id },
            data: {
                quantity: finalQuantity,
                available_quantity: finalAvailableQuantity,
                assigned_quantity: finalAssignedQuantity,
                status: status || currentAsset.status
            }
        });
        logger_1.logger.info({
            action: 'ASSET_INVENTORY_UPDATED',
            user_id: req.user.user_id,
            asset_id: id,
            old_quantity: currentAsset.quantity,
            new_quantity: finalQuantity
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
        const asset = await prisma_1.default.assets.findUnique({
            where: { id }
        });
        if (!asset) {
            return res.status(404).json({
                success: false,
                error: 'Asset not found'
            });
        }
        const assignmentCount = await prisma_1.default.assignments.count({
            where: {
                asset_name: asset.name,
                base_id: asset.base_id,
                status: 'active'
            }
        });
        if (assignmentCount > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete asset with active assignments'
            });
        }
        await prisma_1.default.assets.delete({
            where: { id }
        });
        logger_1.logger.info({
            action: 'ASSET_INVENTORY_DELETED',
            user_id: req.user.user_id,
            asset_id: id,
            asset_name: asset.name,
            base_id: asset.base_id
        });
        return res.json({
            success: true,
            message: 'Asset inventory deleted successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Delete asset error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=assets.js.map