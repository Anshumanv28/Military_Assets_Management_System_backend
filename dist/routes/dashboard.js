"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const connection_1 = require("../database/connection");
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
        let assetWhereClause = 'WHERE 1=1';
        const assetParams = [];
        if (targetBaseId) {
            assetWhereClause += ' AND base_id = $1';
            assetParams.push(targetBaseId);
        }
        let purchaseWhereClause = 'WHERE status = $1';
        const purchaseParams = ['approved'];
        let purchaseParamIndex = 2;
        if (targetBaseId) {
            purchaseWhereClause += ` AND base_id = $${purchaseParamIndex}`;
            purchaseParams.push(targetBaseId);
            purchaseParamIndex++;
        }
        if (start_date && end_date) {
            purchaseWhereClause += ` AND purchase_date >= $${purchaseParamIndex} AND purchase_date <= $${purchaseParamIndex + 1}`;
            purchaseParams.push(start_date, end_date);
        }
        let expenditureWhereClause = 'WHERE 1=1';
        const expenditureParams = [];
        let expenditureParamIndex = 1;
        if (targetBaseId) {
            expenditureWhereClause += ` AND base_id = $${expenditureParamIndex}`;
            expenditureParams.push(targetBaseId);
            expenditureParamIndex++;
        }
        if (start_date && end_date) {
            expenditureWhereClause += ` AND expenditure_date >= $${expenditureParamIndex} AND expenditure_date <= $${expenditureParamIndex + 1}`;
            expenditureParams.push(start_date, end_date);
        }
        let transferWhereClause = 'WHERE status = $1';
        const transferParams = ['approved'];
        let transferParamIndex = 2;
        if (start_date && end_date) {
            transferWhereClause += ` AND transfer_date >= $${transferParamIndex} AND transfer_date <= $${transferParamIndex + 1}`;
            transferParams.push(start_date, end_date);
        }
        const totalQuantitiesResult = await (0, connection_1.query)(`SELECT COALESCE(SUM(quantity), 0) as total FROM assets ${assetWhereClause}`, assetParams);
        const total_quantities = parseInt(totalQuantitiesResult.rows[0].total);
        const availableQuantitiesResult = await (0, connection_1.query)(`SELECT COALESCE(SUM(available_quantity), 0) as total FROM assets ${assetWhereClause}`, assetParams);
        const available_quantities = parseInt(availableQuantitiesResult.rows[0].total);
        const assignedQuantitiesResult = await (0, connection_1.query)(`SELECT COALESCE(SUM(assigned_quantity), 0) as total FROM assets ${assetWhereClause}`, assetParams);
        const assigned_quantities = parseInt(assignedQuantitiesResult.rows[0].total);
        const lowStockWhereClause = assetWhereClause + (assetParams.length > 0 ? ' AND status = $' + (assetParams.length + 1) : ' AND status = $1');
        const lowStockParams = [...assetParams, 'low_stock'];
        const lowStockQuantitiesResult = await (0, connection_1.query)(`SELECT COALESCE(SUM(quantity), 0) as total FROM assets ${lowStockWhereClause}`, lowStockParams);
        const low_stock_quantities = parseInt(lowStockQuantitiesResult.rows[0].total);
        const purchasedQuantitiesResult = await (0, connection_1.query)(`SELECT COALESCE(SUM(quantity), 0) as total FROM purchases ${purchaseWhereClause}`, purchaseParams);
        const purchased_quantities = parseInt(purchasedQuantitiesResult.rows[0].total);
        const expendedQuantitiesResult = await (0, connection_1.query)(`SELECT COALESCE(SUM(quantity), 0) as total FROM expenditures ${expenditureWhereClause}`, expenditureParams);
        const expended_quantities = parseInt(expendedQuantitiesResult.rows[0].total);
        let transfersIn = 0;
        let transfersOut = 0;
        if (targetBaseId) {
            const transfersInWhereClause = transferWhereClause + ` AND to_base_id = $${transferParamIndex}`;
            const transfersInParams = [...transferParams, targetBaseId];
            const transfersInResult = await (0, connection_1.query)(`SELECT COALESCE(SUM(quantity), 0) as total FROM transfers ${transfersInWhereClause}`, transfersInParams);
            transfersIn = parseInt(transfersInResult.rows[0].total);
            const transfersOutWhereClause = transferWhereClause + ` AND from_base_id = $${transferParamIndex}`;
            const transfersOutParams = [...transferParams, targetBaseId];
            const transfersOutResult = await (0, connection_1.query)(`SELECT COALESCE(SUM(quantity), 0) as total FROM transfers ${transfersOutWhereClause}`, transfersOutParams);
            transfersOut = parseInt(transfersOutResult.rows[0].total);
        }
        else if (role === 'admin') {
            const adminTransfersResult = await (0, connection_1.query)(`SELECT COALESCE(SUM(quantity), 0) as total FROM transfers ${transferWhereClause}`, transferParams);
            const totalTransfers = parseInt(adminTransfersResult.rows[0].total);
            transfersIn = totalTransfers;
            transfersOut = totalTransfers;
        }
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
        const purchases = await (0, connection_1.query)(`SELECT id, quantity, purchase_date, assets.name, bases.name
       FROM purchases
       JOIN assets ON purchases.asset_id = assets.id
       JOIN bases ON purchases.base_id = bases.id
       WHERE ${targetBaseId ? `base_id = $1 AND ` : ''}status = $2
       ORDER BY purchase_date DESC
       LIMIT 10`, targetBaseId ? [targetBaseId, 'approved'] : ['approved']);
        let transfers = { rows: [] };
        if (targetBaseId) {
            transfers = await (0, connection_1.query)(`SELECT id, quantity, transfer_date, assets.name,
                CASE
                  WHEN from_base_id = $1 THEN bases_transfers_from_base_idTobases.name
                  WHEN to_base_id = $1 THEN bases_transfers_to_base_idTobases.name
                END AS from_base_name,
                CASE
                  WHEN to_base_id = $1 THEN bases_transfers_to_base_idTobases.name
                END AS to_base_name
         FROM transfers
         JOIN bases_transfers_from_base_idTobases ON transfers.from_base_id = bases_transfers_from_base_idTobases.id
         JOIN bases_transfers_to_base_idTobases ON transfers.to_base_id = bases_transfers_to_base_idTobases.id
         WHERE ${targetBaseId ? `from_base_id = $1 OR to_base_id = $1 AND ` : ''}status = $2
         ORDER BY transfer_date DESC
         LIMIT 10`, targetBaseId ? [targetBaseId, 'approved'] : ['approved']);
        }
        const purchasedAssets = purchases.rows.map((purchase) => ({
            id: purchase.id,
            name: purchase.name,
            asset_name: purchase.name,
            quantity: purchase.quantity,
            base_name: purchase.bases_name,
            date: purchase.purchase_date
        }));
        let transfersIn = [];
        let transfersOut = [];
        if (targetBaseId) {
            const targetBase = await (0, connection_1.query)(`SELECT name FROM bases WHERE id = $1`, [targetBaseId]);
            if (targetBase.rows.length > 0) {
                transfersIn = transfers.rows
                    .filter((t) => t.to_base_name === targetBase.rows[0].name)
                    .map((t) => ({
                    id: t.id,
                    name: t.name,
                    asset_name: t.name,
                    quantity: t.quantity,
                    from_base_name: t.from_base_name,
                    to_base_name: t.to_base_name,
                    date: t.transfer_date
                }));
                transfersOut = transfers.rows
                    .filter((t) => t.from_base_name === targetBase.rows[0].name)
                    .map((t) => ({
                    id: t.id,
                    name: t.name,
                    asset_name: t.name,
                    quantity: t.quantity,
                    from_base_name: t.from_base_name,
                    to_base_name: t.to_base_name,
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
        const inventory = await (0, connection_1.query)(`SELECT name, quantity, available_quantity, assigned_quantity, status, bases.name
       FROM assets
       JOIN bases ON assets.base_id = bases.id
       WHERE ${targetBaseId ? `base_id = $1 AND ` : ''}name IS NOT NULL
       ORDER BY name ASC, bases.name ASC`, targetBaseId ? [targetBaseId] : []);
        const inventoryData = inventory.rows.map((asset) => ({
            asset_name: asset.name,
            quantity: asset.quantity,
            available_quantity: asset.available_quantity,
            assigned_quantity: asset.assigned_quantity,
            status: asset.status,
            base_name: asset.bases_name
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
        const expendedAssets = await (0, connection_1.query)(`SELECT asset_name, COALESCE(SUM(quantity), 0) as total
       FROM expenditures
       WHERE ${targetBaseId ? `base_id = $1 AND ` : ''}expenditure_date >= $2 AND expenditure_date <= $3
       GROUP BY asset_name
       ORDER BY total DESC
       LIMIT 10`, targetBaseId ? [targetBaseId, start_date, end_date] : [start_date, end_date]);
        const chartData = expendedAssets.rows.map((item) => ({
            name: item.asset_name,
            value: parseInt(item.total)
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