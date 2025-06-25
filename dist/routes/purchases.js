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
        else if (base_id && req.user.role !== 'admin') {
            whereConditions.base_id = base_id;
        }
        if (asset_name) {
            whereConditions.assets = {
                name: {
                    contains: asset_name,
                    mode: 'insensitive'
                }
            };
        }
        if (start_date && end_date) {
            whereConditions.purchase_date = {
                gte: new Date(start_date),
                lte: new Date(end_date)
            };
        }
        const total = await prisma_1.default.purchases.count({
            where: whereConditions
        });
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const purchases = await prisma_1.default.purchases.findMany({
            where: whereConditions,
            include: {
                bases: {
                    select: {
                        name: true
                    }
                },
                users_purchases_created_byTousers: {
                    select: {
                        first_name: true,
                        last_name: true
                    }
                },
                assets: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: {
                purchase_date: 'desc'
            },
            take: parseInt(limit),
            skip: offset
        });
        const transformedPurchases = purchases.map(purchase => ({
            ...purchase,
            base_name: purchase.bases.name,
            first_name: purchase.users_purchases_created_byTousers.first_name,
            last_name: purchase.users_purchases_created_byTousers.last_name,
            asset_name: purchase.assets.name
        }));
        res.json({
            success: true,
            data: transformedPurchases,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Get purchases error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.post('/', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { asset_id, base_id, quantity, supplier, purchase_date, notes } = req.body;
        if (!asset_id || !base_id || !quantity || !purchase_date) {
            return res.status(400).json({
                success: false,
                error: 'Asset, base, quantity, and purchase date are required'
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
                error: 'Base commanders can only create purchases for their base'
            });
        }
        const status = 'pending';
        const newPurchase = await prisma_1.default.purchases.create({
            data: {
                asset_id,
                base_id,
                quantity,
                supplier: supplier || null,
                purchase_date: new Date(purchase_date),
                status,
                approved_by: null,
                approved_at: null,
                notes: notes || null,
                created_by: req.user.user_id
            }
        });
        logger_1.logger.info({
            action: 'PURCHASE_CREATED',
            user_id: req.user.user_id,
            purchase_id: newPurchase.id,
            asset_id,
            quantity,
            status
        });
        return res.status(201).json({ success: true, data: newPurchase });
    }
    catch (error) {
        logger_1.logger.error('Create purchase error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.put('/:id/approve', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Purchase ID is required'
            });
        }
        const purchase = await prisma_1.default.purchases.findUnique({
            where: { id }
        });
        if (!purchase) {
            return res.status(404).json({
                success: false,
                error: 'Purchase not found'
            });
        }
        if (purchase.status === 'approved') {
            return res.status(400).json({
                success: false,
                error: 'Purchase is already approved'
            });
        }
        if (purchase.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                error: 'Cannot approve a cancelled purchase'
            });
        }
        const approvedPurchase = await prisma_1.default.purchases.update({
            where: { id },
            data: {
                status: 'approved',
                approved_by: req.user.user_id,
                approved_at: new Date()
            }
        });
        await addAssetsToInventory(approvedPurchase);
        logger_1.logger.info({
            action: 'PURCHASE_APPROVED',
            user_id: req.user.user_id,
            purchase_id: id,
            asset_id: purchase.asset_id,
            quantity: purchase.quantity
        });
        return res.json({
            success: true,
            data: approvedPurchase
        });
    }
    catch (error) {
        logger_1.logger.error('Approve purchase error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.put('/:id/cancel', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Purchase ID is required'
            });
        }
        const purchase = await prisma_1.default.purchases.findUnique({
            where: { id }
        });
        if (!purchase) {
            return res.status(404).json({
                success: false,
                error: 'Purchase not found'
            });
        }
        if (purchase.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                error: 'Purchase is already cancelled'
            });
        }
        if (purchase.status === 'approved') {
            return res.status(400).json({
                success: false,
                error: 'Cannot cancel an approved purchase'
            });
        }
        if (req.user.role === 'base_commander' && purchase.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Base commanders can only cancel purchases for their base'
            });
        }
        const cancelledPurchase = await prisma_1.default.purchases.update({
            where: { id },
            data: {
                status: 'cancelled'
            }
        });
        logger_1.logger.info({
            action: 'PURCHASE_CANCELLED',
            user_id: req.user.user_id,
            purchase_id: id
        });
        return res.json({
            success: true,
            data: cancelledPurchase
        });
    }
    catch (error) {
        logger_1.logger.error('Cancel purchase error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.delete('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Purchase ID is required'
            });
        }
        const purchase = await prisma_1.default.purchases.findUnique({
            where: { id }
        });
        if (!purchase) {
            return res.status(404).json({
                success: false,
                error: 'Purchase not found'
            });
        }
        if (purchase.status === 'approved') {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete an approved purchase'
            });
        }
        await prisma_1.default.purchases.delete({
            where: { id }
        });
        logger_1.logger.info({
            action: 'PURCHASE_DELETED',
            user_id: req.user.user_id,
            purchase_id: id
        });
        return res.json({
            success: true,
            message: 'Purchase deleted successfully'
        });
    }
    catch (error) {
        logger_1.logger.error('Delete purchase error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
router.put('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin', 'base_commander'), async (req, res) => {
    try {
        const { id } = req.params;
        const { asset_id, base_id, quantity, supplier, purchase_date, notes } = req.body;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Purchase ID is required'
            });
        }
        if (!asset_id || !base_id || !quantity || !purchase_date) {
            return res.status(400).json({
                success: false,
                error: 'Asset, base, quantity, and purchase date are required'
            });
        }
        if (quantity <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantity must be greater than 0'
            });
        }
        const existingPurchase = await prisma_1.default.purchases.findUnique({
            where: { id }
        });
        if (!existingPurchase) {
            return res.status(404).json({
                success: false,
                error: 'Purchase not found'
            });
        }
        if (req.user.role === 'base_commander') {
            if (existingPurchase.base_id !== req.user.base_id) {
                return res.status(403).json({
                    success: false,
                    error: 'Base commanders can only edit purchases for their base'
                });
            }
            if (existingPurchase.status === 'approved') {
                return res.status(403).json({
                    success: false,
                    error: 'Cannot edit approved purchases'
                });
            }
        }
        const updatedPurchase = await prisma_1.default.purchases.update({
            where: { id },
            data: {
                asset_id,
                base_id,
                quantity,
                supplier: supplier || null,
                purchase_date: new Date(purchase_date),
                notes: notes || null
            }
        });
        logger_1.logger.info({
            action: 'PURCHASE_UPDATED',
            user_id: req.user.user_id,
            purchase_id: id,
            asset_id,
            quantity
        });
        return res.json({ success: true, data: updatedPurchase });
    }
    catch (error) {
        logger_1.logger.error('Update purchase error:', error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});
async function addAssetsToInventory(purchase) {
    try {
        const asset = await prisma_1.default.assets.findUnique({
            where: { id: purchase.asset_id }
        });
        if (!asset) {
            throw new Error(`Asset with id ${purchase.asset_id} not found`);
        }
        const assetName = asset.name;
        const existingAsset = await prisma_1.default.assets.findFirst({
            where: {
                name: assetName,
                base_id: purchase.base_id
            }
        });
        if (existingAsset) {
            const newQuantity = existingAsset.quantity + purchase.quantity;
            const newAvailableQuantity = existingAsset.available_quantity + purchase.quantity;
            await prisma_1.default.assets.update({
                where: { id: existingAsset.id },
                data: {
                    quantity: newQuantity,
                    available_quantity: newAvailableQuantity
                }
            });
            logger_1.logger.info({
                action: 'ASSET_INVENTORY_UPDATED_FROM_PURCHASE',
                purchase_id: purchase.id,
                asset_id: existingAsset.id,
                added_quantity: purchase.quantity,
                new_total_quantity: newQuantity
            });
        }
        else {
            const newAsset = await prisma_1.default.assets.create({
                data: {
                    name: assetName,
                    base_id: purchase.base_id,
                    quantity: purchase.quantity,
                    available_quantity: purchase.quantity,
                    assigned_quantity: 0
                }
            });
            logger_1.logger.info({
                action: 'ASSET_INVENTORY_CREATED_FROM_PURCHASE',
                purchase_id: purchase.id,
                asset_id: newAsset.id,
                quantity: purchase.quantity
            });
        }
    }
    catch (error) {
        logger_1.logger.error('Error adding assets to inventory from purchase:', error);
        throw error;
    }
}
exports.default = router;
//# sourceMappingURL=purchases.js.map