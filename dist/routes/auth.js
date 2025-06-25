"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const connection_1 = require("../database/connection");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.post('/register', [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('password').isLength({ min: 6 }),
    (0, express_validator_1.body)('first_name').notEmpty().trim(),
    (0, express_validator_1.body)('last_name').notEmpty().trim(),
    (0, express_validator_1.body)('role').isIn(['admin', 'base_commander', 'logistics_officer']),
    (0, express_validator_1.body)('base_id').optional().isUUID()
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({
                success: false,
                error: errors.array()[0]?.msg || 'Validation error'
            });
            return;
        }
        const { email, password, first_name, last_name, role, base_id } = req.body;
        const existingUser = await (0, connection_1.query)('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            res.status(400).json({
                success: false,
                error: 'User already exists'
            });
            return;
        }
        const saltRounds = 10;
        const hashedPassword = await bcryptjs_1.default.hash(password, saltRounds);
        const result = await (0, connection_1.query)('INSERT INTO users (email, password_hash, first_name, last_name, role, base_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, first_name, last_name, role, base_id', [email, hashedPassword, first_name, last_name, role, base_id || null]);
        const user = result.rows[0];
        const token = jsonwebtoken_1.default.sign({ user_id: user.id }, process.env['JWT_SECRET']);
        const refreshToken = jsonwebtoken_1.default.sign({ user_id: user.id }, process.env['JWT_SECRET']);
        logger_1.logger.info({
            action: 'USER_REGISTERED',
            user_id: user.id,
            email: user.email,
            role: user.role
        });
        res.status(201).json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    role: user.role,
                    base_id: user.base_id
                },
                token,
                refreshToken
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.post('/login', [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('password').notEmpty()
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            const errorMsg = errors.array()[0]?.msg || 'Validation error';
            logger_1.logger.warn('Login validation failed', { email: req.body.email, error: errorMsg, ip: req.ip });
            res.status(400).json({
                success: false,
                error: errorMsg
            });
            return;
        }
        const { email, password } = req.body;
        const result = await (0, connection_1.query)('SELECT id, email, password_hash, first_name, last_name, role, base_id FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            logger_1.logger.warn('Login attempt failed for non-existent user', { email, ip: req.ip });
            res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
            return;
        }
        const user = result.rows[0];
        const isPasswordValid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!isPasswordValid) {
            logger_1.logger.warn('Invalid password attempt', { email: user.email, user_id: user.id, ip: req.ip });
            res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
            return;
        }
        const token = jsonwebtoken_1.default.sign({ user_id: user.id }, process.env['JWT_SECRET']);
        const refreshToken = jsonwebtoken_1.default.sign({ user_id: user.id }, process.env['JWT_SECRET']);
        logger_1.logger.info({
            action: 'USER_LOGIN',
            user_id: user.id,
            email: user.email
        });
        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    role: user.role,
                    base_id: user.base_id
                },
                token,
                refreshToken
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.get('/profile', auth_1.authenticate, async (req, res) => {
    try {
        const result = await (0, connection_1.query)('SELECT id, email, first_name, last_name, role, base_id, created_at FROM users WHERE id = $1', [req.user.user_id]);
        if (result.rows.length === 0) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }
        const user = result.rows[0];
        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                base_id: user.base_id,
                created_at: user.created_at
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
router.post('/refresh', [
    (0, express_validator_1.body)('refreshToken').notEmpty()
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({
                success: false,
                error: errors.array()[0]?.msg || 'Validation error'
            });
            return;
        }
        const { refreshToken } = req.body;
        const decoded = jsonwebtoken_1.default.verify(refreshToken, process.env['JWT_SECRET']);
        const result = await (0, connection_1.query)('SELECT id, email, first_name, last_name, role, base_id FROM users WHERE id = $1', [decoded.user_id]);
        if (result.rows.length === 0) {
            res.status(401).json({
                success: false,
                error: 'Invalid refresh token'
            });
            return;
        }
        const user = result.rows[0];
        const newToken = jsonwebtoken_1.default.sign({ user_id: user.id }, process.env['JWT_SECRET']);
        res.json({
            success: true,
            data: {
                token: newToken,
                user: {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    role: user.role,
                    base_id: user.base_id
                }
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Token refresh error:', error);
        res.status(401).json({
            success: false,
            error: 'Invalid refresh token'
        });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map