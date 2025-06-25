"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const dotenv_1 = __importDefault(require("dotenv"));
const connection_1 = require("./database/connection");
const logger_1 = require("./utils/logger");
const errorHandler_1 = require("./middleware/errorHandler");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env['PORT'] || 3001;
app.use((0, helmet_1.default)());
const allowedOrigins = [
    process.env['FRONTEND_URL'] || 'http://localhost:3000',
    'https://your-frontend-name.vercel.app',
    'https://military-assets-frontend.vercel.app'
].filter(Boolean);
app.use((0, cors_1.default)({
    origin: function (origin, callback) {
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
const limiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] || '900000'),
    max: parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] || '5000'),
    message: {
        error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use((0, morgan_1.default)('combined', {
    stream: {
        write: (message) => logger_1.logger.info(message.trim())
    }
}));
app.get('/health', (_req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env['NODE_ENV']
    });
});
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env['NODE_ENV'],
        version: process.env['API_VERSION'] || 'v1'
    });
});
const auth_1 = __importDefault(require("./routes/auth"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const assets_1 = __importDefault(require("./routes/assets"));
const purchases_1 = __importDefault(require("./routes/purchases"));
const transfers_1 = __importDefault(require("./routes/transfers"));
const assignments_1 = __importDefault(require("./routes/assignments"));
const expenditures_1 = __importDefault(require("./routes/expenditures"));
const bases_1 = __importDefault(require("./routes/bases"));
const personnel_1 = __importDefault(require("./routes/personnel"));
const users_1 = __importDefault(require("./routes/users"));
app.use('/api/auth', auth_1.default);
app.use('/api/dashboard', dashboard_1.default);
app.use('/api/assets', assets_1.default);
app.use('/api/purchases', purchases_1.default);
app.use('/api/transfers', transfers_1.default);
app.use('/api/assignments', assignments_1.default);
app.use('/api/expenditures', expenditures_1.default);
app.use('/api/bases', bases_1.default);
app.use('/api/personnel', personnel_1.default);
app.use('/api/users', users_1.default);
app.use('*', (_req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found'
    });
});
app.use(errorHandler_1.errorHandler);
const startServer = async () => {
    try {
        await (0, connection_1.testConnection)();
        app.listen(PORT, () => {
            logger_1.logger.info(`🚀 Server running on port ${PORT}`);
            logger_1.logger.info(`📊 Environment: ${process.env['NODE_ENV']}`);
            logger_1.logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to start server:', error);
        process.exit(1);
    }
};
process.on('SIGTERM', () => {
    logger_1.logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});
process.on('SIGINT', () => {
    logger_1.logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});
process.on('unhandledRejection', (reason, promise) => {
    logger_1.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
process.on('uncaughtException', (error) => {
    logger_1.logger.error('Uncaught Exception:', error);
    process.exit(1);
});
if (process.env['NODE_ENV'] !== 'production' || !process.env['VERCEL']) {
    startServer();
}
exports.default = app;
//# sourceMappingURL=index.js.map