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
        const { page = '1', limit = '10', is_active, commander_id } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const where = {};
        if (is_active !== undefined && is_active !== '') {
            where.is_active = is_active === 'true';
        }
        else {
            where.is_active = true;
        }
        if (commander_id && commander_id !== '') {
            where.commander_id = commander_id;
        }
        const total = await prisma_1.default.bases.count({ where });
        const bases = await prisma_1.default.bases.findMany({
            where,
            include: {
                users_bases_commander_idTousers: {
                    select: {
                        first_name: true,
                        last_name: true
                    }
                }
            },
            orderBy: {
                name: 'asc'
            },
            take: parseInt(limit),
            skip: offset
        });
        const transformedBases = bases.map(base => ({
            ...base,
            first_name: base.users_bases_commander_idTousers?.first_name || null,
            last_name: base.users_bases_commander_idTousers?.last_name || null
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
        const base = await prisma_1.default.bases.findFirst({
            where: {
                id,
                is_active: true
            },
            include: {
                users_bases_commander_idTousers: {
                    select: {
                        first_name: true,
                        last_name: true
                    }
                }
            }
        });
        if (!base) {
            return res.status(404).json({
                success: false,
                error: 'Base not found'
            });
        }
        const transformedBase = {
            ...base,
            first_name: base.users_bases_commander_idTousers?.first_name || null,
            last_name: base.users_bases_commander_idTousers?.last_name || null
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
        const existingBase = await prisma_1.default.bases.findUnique({
            where: { code }
        });
        if (existingBase) {
            return res.status(400).json({
                success: false,
                error: 'Base code already exists'
            });
        }
        const newBase = await prisma_1.default.bases.create({
            data: {
                name,
                code,
                location,
                commander_id: commander_id || null
            }
        });
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
        const existingBase = await prisma_1.default.bases.findUnique({
            where: { id }
        });
        if (!existingBase) {
            return res.status(404).json({
                success: false,
                error: 'Base not found'
            });
        }
        if (code && code !== existingBase.code) {
            const codeExists = await prisma_1.default.bases.findUnique({
                where: { code }
            });
            if (codeExists) {
                return res.status(400).json({
                    success: false,
                    error: 'Base code already exists'
                });
            }
        }
        const updateData = {};
        if (name !== undefined)
            updateData.name = name;
        if (code !== undefined)
            updateData.code = code;
        if (location !== undefined)
            updateData.location = location;
        if (commander_id !== undefined)
            updateData.commander_id = commander_id || null;
        if (is_active !== undefined)
            updateData.is_active = is_active;
        const updatedBase = await prisma_1.default.bases.update({
            where: { id },
            data: updateData
        });
        logger_1.logger.info({
            action: 'BASE_UPDATED',
            user_id: req.user.user_id,
            base_id: updatedBase.id,
            base_name: updatedBase.name
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
        const existingBase = await prisma_1.default.bases.findUnique({
            where: { id },
            select: { id: true, name: true }
        });
        if (!existingBase) {
            return res.status(404).json({
                success: false,
                error: 'Base not found'
            });
        }
        const deletedBase = await prisma_1.default.bases.update({
            where: { id },
            data: { is_active: false }
        });
        logger_1.logger.info({
            action: 'BASE_DELETED',
            user_id: req.user.user_id,
            base_id: deletedBase.id,
            base_name: deletedBase.name
        });
        return res.json({
            success: true,
            data: deletedBase
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