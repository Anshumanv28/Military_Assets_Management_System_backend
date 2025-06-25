"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixPersonnelTable = void 0;
const connection_1 = require("./connection");
const logger_1 = require("../utils/logger");
const fixPersonnelTable = async () => {
    try {
        await (0, connection_1.testConnection)();
        logger_1.logger.info('Checking personnel table...');
        const checkTable = await (0, connection_1.query)(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'personnel'
      );
    `);
        const tableExists = checkTable.rows[0].exists;
        if (!tableExists) {
            logger_1.logger.info('Personnel table does not exist. Creating it...');
            await (0, connection_1.query)(`
        CREATE TABLE personnel (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL,
          rank VARCHAR(50) NOT NULL,
          base_id UUID NOT NULL REFERENCES bases(id),
          email VARCHAR(255),
          phone VARCHAR(50),
          department VARCHAR(100),
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
            await (0, connection_1.query)(`
        CREATE INDEX idx_personnel_base_id ON personnel(base_id);
        CREATE INDEX idx_personnel_rank ON personnel(rank);
        CREATE INDEX idx_personnel_is_active ON personnel(is_active);
      `);
            await (0, connection_1.query)(`
        CREATE TRIGGER update_personnel_updated_at 
        BEFORE UPDATE ON personnel 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      `);
            logger_1.logger.info('✅ Personnel table created successfully');
        }
        else {
            logger_1.logger.info('✅ Personnel table already exists');
        }
    }
    catch (error) {
        logger_1.logger.error('❌ Error fixing personnel table:', error);
        process.exit(1);
    }
};
exports.fixPersonnelTable = fixPersonnelTable;
if (require.main === module) {
    fixPersonnelTable();
}
//# sourceMappingURL=fix-personnel.js.map