"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = exports.testConnection = void 0;
const db_1 = __importDefault(require("./db"));
const logger_1 = require("../utils/logger");
const testConnection = async () => {
    try {
        await (0, db_1.default) `SELECT 1`;
        logger_1.logger.info('✅ Database connection successful');
    }
    catch (error) {
        logger_1.logger.error('❌ Database connection failed:', error);
        throw error;
    }
};
exports.testConnection = testConnection;
const query = async (text, params) => {
    const start = Date.now();
    try {
        let res;
        if (params && params.length > 0) {
            res = await db_1.default.unsafe(text, params);
        }
        else {
            res = await db_1.default.unsafe(text);
        }
        const duration = Date.now() - start;
        logger_1.logger.debug(`Executed query in ${duration}ms: ${text.substring(0, 100)}...`);
        return { rows: res };
    }
    catch (error) {
        logger_1.logger.error('Query error:', error);
        throw error;
    }
};
exports.query = query;
exports.default = db_1.default;
//# sourceMappingURL=connection.js.map