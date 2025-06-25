"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addPersonnelUniqueConstraint = void 0;
const connection_1 = require("./connection");
const logger_1 = require("../utils/logger");
const addPersonnelUniqueConstraint = async () => {
    try {
        await (0, connection_1.testConnection)();
        logger_1.logger.info('Starting personnel unique constraint migration...');
        const constraintExists = await (0, connection_1.query)(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'personnel' 
      AND constraint_name = 'personnel_unique_name_email'
    `);
        if (constraintExists.rows.length > 0) {
            logger_1.logger.info('Unique constraint already exists on personnel table');
            return;
        }
        await (0, connection_1.query)(`
      ALTER TABLE personnel 
      ADD CONSTRAINT personnel_unique_name_email 
      UNIQUE (first_name, last_name, email)
    `);
        logger_1.logger.info('✅ Successfully added unique constraint on personnel table');
        logger_1.logger.info('   - Constraint: personnel_unique_name_email');
        logger_1.logger.info('   - Fields: first_name, last_name, email');
    }
    catch (error) {
        logger_1.logger.error('❌ Failed to add personnel unique constraint:', error);
        throw error;
    }
};
exports.addPersonnelUniqueConstraint = addPersonnelUniqueConstraint;
if (require.main === module) {
    addPersonnelUniqueConstraint()
        .then(() => {
        logger_1.logger.info('Migration completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        logger_1.logger.error('Migration failed:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=add-personnel-unique-constraint.js.map