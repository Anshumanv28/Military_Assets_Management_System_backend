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
        const { base_id, rank, page = 1, limit = 10 } = req.query;
        const where = {};
        if (req.user.role === 'base_commander' && req.user.base_id) {
            where.base_id = req.user.base_id;
        }
        else if (base_id && req.user.role !== 'admin') {
            where.base_id = base_id;
        }
        if (rank) {
            where.rank = rank;
        }
        const total = await prisma_1.default.personnel.count({ where });
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const personnel = await prisma_1.default.personnel.findMany({
            where,
            include: {
                bases: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: [
                { first_name: 'asc' },
                { last_name: 'asc' }
            ],
            take: parseInt(limit),
            skip: offset
        });
        const transformedPersonnel = personnel.map(person => ({
            ...person,
            base_name: person.bases.name,
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
        const personnel = await prisma_1.default.personnel.findUnique({
            where: { id },
            include: {
                bases: {
                    select: {
                        name: true
                    }
                }
            }
        });
        if (!personnel) {
            return res.status(404).json({
                success: false,
                error: 'Personnel not found'
            });
        }
        if (req.user.role === 'base_commander' && personnel.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this personnel record'
            });
        }
        const transformedPersonnel = {
            ...personnel,
            base_name: personnel.bases.name,
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
        const newPersonnel = await prisma_1.default.personnel.create({
            data: {
                first_name,
                last_name,
                rank,
                base_id: targetBaseId,
                email: email || null,
                phone: phone || null,
                department: department || null
            }
        });
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
        const existingPersonnel = await prisma_1.default.personnel.findUnique({
            where: { id }
        });
        if (!existingPersonnel) {
            return res.status(404).json({
                success: false,
                error: 'Personnel not found'
            });
        }
        if (req.user.role === 'base_commander' && existingPersonnel.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this personnel record'
            });
        }
        const targetBaseId = req.user.role === 'base_commander' ? req.user.base_id : base_id;
        const updateData = {};
        if (first_name !== undefined)
            updateData.first_name = first_name;
        if (last_name !== undefined)
            updateData.last_name = last_name;
        if (rank !== undefined)
            updateData.rank = rank;
        if (targetBaseId !== undefined)
            updateData.base_id = targetBaseId;
        if (email !== undefined)
            updateData.email = email;
        if (phone !== undefined)
            updateData.phone = phone;
        if (department !== undefined)
            updateData.department = department;
        const updatedPersonnel = await prisma_1.default.personnel.update({
            where: { id },
            data: updateData
        });
        logger_1.logger.info({
            action: 'PERSONNEL_UPDATED',
            user_id: req.user.user_id,
            personnel_id: id,
            changes: req.body
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
        const existingPersonnel = await prisma_1.default.personnel.findUnique({
            where: { id }
        });
        if (!existingPersonnel) {
            return res.status(404).json({
                success: false,
                error: 'Personnel not found'
            });
        }
        if (req.user.role === 'base_commander' && existingPersonnel.base_id !== req.user.base_id) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this personnel record'
            });
        }
        const assignmentCount = await prisma_1.default.assignments.count({
            where: {
                assigned_to: id,
                status: 'active'
            }
        });
        if (assignmentCount > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete personnel with active assignments'
            });
        }
        await prisma_1.default.personnel.delete({
            where: { id }
        });
        logger_1.logger.info({
            action: 'PERSONNEL_DELETED',
            user_id: req.user.user_id,
            personnel_id: id,
            personnel_name: `${existingPersonnel.first_name} ${existingPersonnel.last_name}`
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