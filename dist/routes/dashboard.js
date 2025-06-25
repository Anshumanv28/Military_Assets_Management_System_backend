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
router.get('/summary', auth_1.authenticate, async (req, res) => {
    try {
        const { base_id, start_date, end_date } = req.query;
        const { role, base_id: user_base_id } = req.user;
        let targetBaseId;
        if (role === 'admin') {
            targetBaseId = base_id || '';
        }
        else {
            targetBaseId = user_base_id || '';
        }
        const assetWhereConditions = {};
        if (targetBaseId) {
            assetWhereConditions.base_id = targetBaseId;
        }
        const purchaseWhereConditions = { status: 'approved' };
        if (targetBaseId) {
            purchaseWhereConditions.base_id = targetBaseId;
        }
        if (start_date && end_date) {
            purchaseWhereConditions.purchase_date = {
                gte: new Date(start_date),
                lte: new Date(end_date)
            };
        }
        const expenditureWhereConditions = {};
        if (targetBaseId) {
            expenditureWhereConditions.base_id = targetBaseId;
        }
        if (start_date && end_date) {
            expenditureWhereConditions.expenditure_date = {
                gte: new Date(start_date),
                lte: new Date(end_date)
            };
        }
        const transferWhereConditions = { status: 'approved' };
        if (start_date && end_date) {
            transferWhereConditions.transfer_date = {
                gte: new Date(start_date),
                lte: new Date(end_date)
            };
        }
        const totalQuantities = await prisma_1.default.assets.aggregate({
            where: assetWhereConditions,
            _sum: { quantity: true }
        });
        const availableQuantities = await prisma_1.default.assets.aggregate({
            where: assetWhereConditions,
            _sum: { available_quantity: true }
        });
        const assignedQuantities = await prisma_1.default.assets.aggregate({
            where: assetWhereConditions,
            _sum: { assigned_quantity: true }
        });
        const lowStockQuantities = await prisma_1.default.assets.aggregate({
            where: { ...assetWhereConditions, status: 'low_stock' },
            _sum: { quantity: true }
        });
        const purchasedQuantities = await prisma_1.default.purchases.aggregate({
            where: purchaseWhereConditions,
            _sum: { quantity: true }
        });
        const expendedQuantities = await prisma_1.default.expenditures.aggregate({
            where: expenditureWhereConditions,
            _sum: { quantity: true }
        });
        let transfersIn = 0;
        let transfersOut = 0;
        if (targetBaseId) {
            const transfersInResult = await prisma_1.default.transfers.aggregate({
                where: { ...transferWhereConditions, to_base_id: targetBaseId },
                _sum: { quantity: true }
            });
            transfersIn = transfersInResult._sum.quantity || 0;
            const transfersOutResult = await prisma_1.default.transfers.aggregate({
                where: { ...transferWhereConditions, from_base_id: targetBaseId },
                _sum: { quantity: true }
            });
            transfersOut = transfersOutResult._sum.quantity || 0;
        }
        else if (role === 'admin') {
            const adminTransfersResult = await prisma_1.default.transfers.aggregate({
                where: transferWhereConditions,
                _sum: { quantity: true }
            });
            const totalTransfers = adminTransfersResult._sum.quantity || 0;
            transfersIn = totalTransfers;
            transfersOut = totalTransfers;
        }
        const total_quantities = totalQuantities._sum.quantity || 0;
        const available_quantities = availableQuantities._sum.available_quantity || 0;
        const assigned_quantities = assignedQuantities._sum.assigned_quantity || 0;
        const low_stock_quantities = lowStockQuantities._sum.quantity || 0;
        const purchased_quantities = purchasedQuantities._sum.quantity || 0;
        const expended_quantities = expendedQuantities._sum.quantity || 0;
        const opening_balance = total_quantities - purchased_quantities - transfersIn + transfersOut + expended_quantities;
        const closing_balance = total_quantities;
        const net_movement = purchased_quantities + transfersIn - transfersOut - expended_quantities;
        res.json({
            success: true,
            data: {
                opening_balance,
                closing_balance,
                net_movement,
                total_assets: total_quantities,
                available_assets: available_quantities,
                assigned_assets: assigned_quantities,
                maintenance_assets: low_stock_quantities,
                purchased_assets: purchased_quantities,
                transfers_in: transfersIn,
                transfers_out: transfersOut,
                expended_assets: expended_quantities
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Dashboard summary error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.get('/movements', auth_1.authenticate, async (req, res) => {
    try {
        const { base_id, start_date, end_date } = req.query;
        const { role, base_id: user_base_id } = req.user;
        let targetBaseId;
        if (role === 'admin') {
            targetBaseId = base_id || '';
        }
        else {
            targetBaseId = user_base_id || '';
        }
        const purchaseWhereConditions = { status: 'approved' };
        if (targetBaseId) {
            purchaseWhereConditions.base_id = targetBaseId;
        }
        if (start_date && end_date) {
            purchaseWhereConditions.purchase_date = {
                gte: new Date(start_date),
                lte: new Date(end_date)
            };
        }
        const transferWhereConditions = { status: 'approved' };
        if (start_date && end_date) {
            transferWhereConditions.transfer_date = {
                gte: new Date(start_date),
                lte: new Date(end_date)
            };
        }
        const purchases = await prisma_1.default.purchases.findMany({
            where: purchaseWhereConditions,
            include: {
                assets: {
                    select: { name: true }
                },
                bases: {
                    select: { name: true }
                }
            },
            orderBy: { purchase_date: 'desc' },
            take: 10
        });
        let transfers = [];
        if (targetBaseId) {
            transfers = await prisma_1.default.transfers.findMany({
                where: {
                    ...transferWhereConditions,
                    OR: [
                        { from_base_id: targetBaseId },
                        { to_base_id: targetBaseId }
                    ]
                },
                include: {
                    bases_transfers_from_base_idTobases: {
                        select: { name: true }
                    },
                    bases_transfers_to_base_idTobases: {
                        select: { name: true }
                    }
                },
                orderBy: { transfer_date: 'desc' },
                take: 10
            });
        }
        const purchasedAssets = purchases.map(purchase => ({
            id: purchase.id,
            name: purchase.assets.name,
            asset_name: purchase.assets.name,
            quantity: purchase.quantity,
            base_name: purchase.bases.name,
            date: purchase.purchase_date
        }));
        let transfersIn = [];
        let transfersOut = [];
        if (targetBaseId) {
            const targetBase = await prisma_1.default.bases.findUnique({
                where: { id: targetBaseId },
                select: { name: true }
            });
            if (targetBase) {
                transfersIn = transfers
                    .filter(t => t.bases_transfers_to_base_idTobases.name === targetBase.name)
                    .map(t => ({
                    id: t.id,
                    name: t.asset_name,
                    asset_name: t.asset_name,
                    quantity: t.quantity,
                    from_base_name: t.bases_transfers_from_base_idTobases.name,
                    to_base_name: t.bases_transfers_to_base_idTobases.name,
                    date: t.transfer_date
                }));
                transfersOut = transfers
                    .filter(t => t.bases_transfers_from_base_idTobases.name === targetBase.name)
                    .map(t => ({
                    id: t.id,
                    name: t.asset_name,
                    asset_name: t.asset_name,
                    quantity: t.quantity,
                    from_base_name: t.bases_transfers_from_base_idTobases.name,
                    to_base_name: t.bases_transfers_to_base_idTobases.name,
                    date: t.transfer_date
                }));
            }
        }
        res.json({
            success: true,
            data: {
                purchased_assets: purchasedAssets,
                transfers_in: transfersIn,
                transfers_out: transfersOut
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Dashboard movements error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.get('/inventory', auth_1.authenticate, async (req, res) => {
    try {
        const { base_id } = req.query;
        const { role, base_id: user_base_id } = req.user;
        let targetBaseId;
        if (role === 'admin') {
            targetBaseId = base_id || '';
        }
        else {
            targetBaseId = user_base_id || '';
        }
        const whereConditions = {};
        if (targetBaseId) {
            whereConditions.base_id = targetBaseId;
        }
        const inventory = await prisma_1.default.assets.findMany({
            where: whereConditions,
            include: {
                bases: {
                    select: { name: true }
                }
            },
            orderBy: [
                { name: 'asc' },
                { bases: { name: 'asc' } }
            ]
        });
        const inventoryData = inventory.map(asset => ({
            asset_name: asset.name,
            quantity: asset.quantity,
            available_quantity: asset.available_quantity,
            assigned_quantity: asset.assigned_quantity,
            status: asset.status,
            base_name: asset.bases.name
        }));
        res.json({
            success: true,
            data: inventoryData
        });
    }
    catch (error) {
        logger_1.logger.error('Dashboard inventory error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.get('/expended-assets', auth_1.authenticate, async (req, res) => {
    try {
        const { base_id, start_date, end_date } = req.query;
        const { role, base_id: user_base_id } = req.user;
        let targetBaseId;
        if (role === 'admin') {
            targetBaseId = base_id || '';
        }
        else {
            targetBaseId = user_base_id || '';
        }
        const whereConditions = {};
        if (targetBaseId) {
            whereConditions.base_id = targetBaseId;
        }
        if (start_date && end_date) {
            whereConditions.expenditure_date = {
                gte: new Date(start_date),
                lte: new Date(end_date)
            };
        }
        const expendedAssets = await prisma_1.default.expenditures.groupBy({
            by: ['asset_name'],
            where: whereConditions,
            _sum: {
                quantity: true
            },
            orderBy: {
                _sum: {
                    quantity: 'desc'
                }
            },
            take: 10
        });
        const chartData = expendedAssets.map(item => ({
            name: item.asset_name,
            value: item._sum.quantity || 0
        }));
        res.json({
            success: true,
            data: chartData
        });
    }
    catch (error) {
        logger_1.logger.error('Dashboard expended assets error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
exports.default = router;
//# sourceMappingURL=dashboard.js.map