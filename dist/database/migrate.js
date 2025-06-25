"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = void 0;
const connection_1 = require("./connection");
const logger_1 = require("../utils/logger");
const runMigrations = async () => {
    try {
        await (0, connection_1.testConnection)();
        logger_1.logger.info('Starting database migrations...');
        const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'purchases' AND column_name = 'status'
    `;
        const columnExists = await (0, connection_1.query)(checkColumnQuery);
        if (columnExists.rows.length === 0) {
            logger_1.logger.info('Adding status fields to purchases table...');
            const alterQuery = `
        ALTER TABLE purchases 
        ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'cancelled')),
        ADD COLUMN approved_by UUID REFERENCES users(id),
        ADD COLUMN approved_at TIMESTAMP
      `;
            await (0, connection_1.query)(alterQuery);
            logger_1.logger.info('✅ Status fields added to purchases table');
        }
        else {
            logger_1.logger.info('✅ Status fields already exist in purchases table');
        }
        logger_1.logger.info('✅ Database migrations completed successfully');
    }
    catch (error) {
        logger_1.logger.error('❌ Database migration failed:', error);
        process.exit(1);
    }
};
exports.runMigrations = runMigrations;
if (require.main === module) {
    runMigrations();
}
//# sourceMappingURL=migrate.js.map