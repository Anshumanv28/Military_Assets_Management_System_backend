"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeBaseAccess = exports.optionalAuth = exports.authorize = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const connection_1 = require("../database/connection");
const logger_1 = require("../utils/logger");
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({
                success: false,
                error: 'Access token required'
            });
            return;
        }
        const token = authHeader.substring(7);
        const decoded = jsonwebtoken_1.default.verify(token, process.env['JWT_SECRET']);
        const userResult = await (0, connection_1.query)('SELECT id, email, role, base_id FROM users WHERE id = $1', [decoded.user_id]);
        if (userResult.rows.length === 0) {
            res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
            return;
        }
        const user = userResult.rows[0];
        req.user = {
            user_id: user.id,
            email: user.email,
            role: user.role,
            base_id: user.base_id
        };
        next();
    }
    catch (error) {
        logger_1.logger.error('Authentication error:', error);
        res.status(401).json({
            success: false,
            error: 'Invalid token'
        });
    }
};
exports.authenticate = authenticate;
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
            return;
        }
        if (!roles.includes(req.user.role)) {
            res.status(403).json({
                success: false,
                error: 'Insufficient permissions'
            });
            return;
        }
        next();
    };
};
exports.authorize = authorize;
const optionalAuth = async (req, _res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            next();
            return;
        }
        const token = authHeader.substring(7);
        const decoded = jsonwebtoken_1.default.verify(token, process.env['JWT_SECRET']);
        const userResult = await (0, connection_1.query)('SELECT id, email, role, base_id FROM users WHERE id = $1', [decoded.user_id]);
        if (userResult.rows.length > 0) {
            const user = userResult.rows[0];
            req.user = {
                user_id: user.id,
                email: user.email,
                role: user.role,
                base_id: user.base_id
            };
        }
        next();
    }
    catch (error) {
        next();
    }
};
exports.optionalAuth = optionalAuth;
const authorizeBaseAccess = (baseIdParam = 'base_id') => {
    return async (req, res, next) => {
        if (!req.user) {
            res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
            return;
        }
        if (req.user.role === 'admin') {
            next();
            return;
        }
        const baseId = req.params[baseIdParam] || req.body[baseIdParam];
        if (!baseId) {
            res.status(400).json({
                success: false,
                error: 'Base ID required'
            });
            return;
        }
        if (req.user.role === 'base_commander' && req.user.base_id !== baseId) {
            res.status(403).json({
                success: false,
                error: 'Access denied to this base'
            });
            return;
        }
        if (req.user.role === 'logistics_officer') {
            next();
            return;
        }
        next();
    };
};
exports.authorizeBaseAccess = authorizeBaseAccess;
//# sourceMappingURL=auth.js.map