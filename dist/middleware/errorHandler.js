"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const logger_1 = require("../utils/logger");
const errorHandler = (err, req, res, _next) => {
    logger_1.logger.error('Error occurred:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    const errorResponse = {
        success: false,
        error: 'Internal server error'
    };
    if (err.name === 'ValidationError') {
        res.status(400).json({
            success: false,
            error: 'Validation error',
            details: err.message
        });
        return;
    }
    if (err.name === 'UnauthorizedError') {
        res.status(401).json({
            success: false,
            error: 'Unauthorized'
        });
        return;
    }
    if (err.name === 'ForbiddenError') {
        res.status(403).json({
            success: false,
            error: 'Forbidden'
        });
        return;
    }
    if (err.name === 'NotFoundError') {
        res.status(404).json({
            success: false,
            error: 'Resource not found'
        });
        return;
    }
    if (err.message.includes('duplicate key')) {
        res.status(409).json({
            success: false,
            error: 'Resource already exists'
        });
        return;
    }
    if (err.message.includes('foreign key')) {
        res.status(400).json({
            success: false,
            error: 'Invalid reference'
        });
        return;
    }
    if (process.env['NODE_ENV'] === 'development') {
        res.status(500).json({
            ...errorResponse,
            stack: err.stack
        });
        return;
    }
    res.status(500).json(errorResponse);
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=errorHandler.js.map