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
        const { role, limit = '1000' } = req.query;
        const where = {
            is_active: true
        };
        if (role && role !== '') {
            where.role = role;
        }
        const users = await prisma_1.default.users.findMany({
            where,
            select: {
                id: true,
                username: true,
                first_name: true,
                last_name: true,
                role: true,
                base_id: true
            },
            orderBy: [
                { first_name: 'asc' },
                { last_name: 'asc' }
            ],
            take: parseInt(limit)
        });
        return res.json({
            success: true,
            data: users
        });
    }
    catch (error) {
        logger_1.logger.error('Get users error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map