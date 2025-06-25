"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
console.log('--- SEED SCRIPT START ---');
console.log('DATABASE_URL:', process.env['DATABASE_URL']);
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const connection_1 = __importStar(require("./connection"));
const logger_1 = require("../utils/logger");
const seedDatabase = async () => {
    try {
        await (0, connection_1.testConnection)();
        logger_1.logger.info('Starting database seeding...');
        const adminPassword = await bcryptjs_1.default.hash('admin123', 10);
        try {
            await (0, connection_1.default) `
        INSERT INTO users (username, email, password_hash, first_name, last_name, role)
        VALUES (${'admin'}, ${'admin@military.gov'}, ${adminPassword}, ${'System'}, ${'Administrator'}, ${'admin'})
        ON CONFLICT (username) DO UPDATE SET 
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          role = EXCLUDED.role
        RETURNING id
      `;
        }
        catch (error) {
        }
        const bases = [
            { name: 'Fort Bragg', code: 'FB', location: 'North Carolina, USA' },
            { name: 'Camp Pendleton', code: 'CP', location: 'California, USA' },
            { name: 'Fort Hood', code: 'FH', location: 'Texas, USA' },
            { name: 'Joint Base Lewis-McChord', code: 'JBLM', location: 'Washington, USA' }
        ];
        const baseIds = [];
        for (const base of bases) {
            const result = await (0, connection_1.default) `
        INSERT INTO bases (name, code, location)
        VALUES (${base.name}, ${base.code}, ${base.location})
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, location = EXCLUDED.location
        RETURNING id
      `;
            if (!result[0] || typeof result[0]['id'] === 'undefined')
                throw new Error('Failed to insert or fetch base id');
            baseIds.push(result[0]['id']);
        }
        const commanders = [
            { username: 'price', email: 'price@military.gov', first_name: 'John', last_name: 'Price', role: 'base_commander', base_id: baseIds[0] },
            { username: 'soap', email: 'soap@military.gov', first_name: 'John', last_name: 'MacTavish', role: 'base_commander', base_id: baseIds[1] },
            { username: 'ghost', email: 'ghost@military.gov', first_name: 'Simon', last_name: 'Riley', role: 'base_commander', base_id: baseIds[2] },
            { username: 'gaz', email: 'gaz@military.gov', first_name: 'Kyle', last_name: 'Garrick', role: 'base_commander', base_id: baseIds[3] }
        ];
        const logisticsOfficers = [
            { username: 'laswell', email: 'laswell@military.gov', first_name: 'Kate', last_name: 'Laswell', role: 'logistics_officer', base_id: baseIds[0] },
            { username: 'farah', email: 'farah@military.gov', first_name: 'Farah', last_name: 'Karim', role: 'logistics_officer', base_id: baseIds[1] },
            { username: 'alex', email: 'alex@military.gov', first_name: 'Alex', last_name: 'Keller', role: 'logistics_officer', base_id: baseIds[2] },
            { username: 'nikto', email: 'nikto@military.gov', first_name: 'Nikto', last_name: 'Unknown', role: 'logistics_officer', base_id: baseIds[3] }
        ];
        const allUsers = [...commanders, ...logisticsOfficers];
        const userIds = [];
        for (const user of allUsers) {
            const password = await bcryptjs_1.default.hash('password123', 10);
            const result = await (0, connection_1.default) `
        INSERT INTO users (username, email, password_hash, first_name, last_name, role, base_id)
        VALUES (${user.username}, ${user.email}, ${password}, ${user.first_name}, ${user.last_name}, ${user.role}, ${user.base_id})
        ON CONFLICT (username) DO UPDATE SET 
          email = EXCLUDED.email, 
          password_hash = EXCLUDED.password_hash,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          role = EXCLUDED.role,
          base_id = EXCLUDED.base_id
        RETURNING id
      `;
            if (!result[0] || typeof result[0]['id'] === 'undefined')
                throw new Error('Failed to insert or fetch user id');
            userIds.push(result[0]['id']);
        }
        for (let i = 0; i < baseIds.length; i++) {
            await (0, connection_1.default) `
        UPDATE bases SET commander_id = ${userIds[i]} WHERE id = ${baseIds[i]}
      `;
        }
        const personnel = [
            { first_name: 'Marcus', last_name: 'Fenix', rank: 'Sergeant', base_id: baseIds[0], email: 'mfenix@military.gov', department: 'Infantry' },
            { first_name: 'Dominic', last_name: 'Santiago', rank: 'Corporal', base_id: baseIds[0], email: 'dsantiago@military.gov', department: 'Logistics' },
            { first_name: 'Augustus', last_name: 'Cole', rank: 'Lieutenant', base_id: baseIds[0], email: 'acole@military.gov', department: 'Armor' },
            { first_name: 'Damon', last_name: 'Baird', rank: 'Captain', base_id: baseIds[0], email: 'dbaird@military.gov', department: 'Engineering' },
            { first_name: 'Anya', last_name: 'Stroud', rank: 'Staff Sergeant', base_id: baseIds[0], email: 'astroud@military.gov', department: 'Intelligence' },
            { first_name: 'Victor', last_name: 'Reznov', rank: 'Sergeant', base_id: baseIds[1], email: 'vreznov@military.gov', department: 'Infantry' },
            { first_name: 'Dimitri', last_name: 'Petrenko', rank: 'Corporal', base_id: baseIds[1], email: 'dpetrenko@military.gov', department: 'Logistics' },
            { first_name: 'Tank', last_name: 'Dempsey', rank: 'Lieutenant', base_id: baseIds[1], email: 'tdempsey@military.gov', department: 'Armor' },
            { first_name: 'Nikolai', last_name: 'Belinski', rank: 'Captain', base_id: baseIds[1], email: 'nbelinski@military.gov', department: 'Engineering' },
            { first_name: 'Takeo', last_name: 'Masaki', rank: 'Staff Sergeant', base_id: baseIds[1], email: 'tmasaki@military.gov', department: 'Intelligence' },
            { first_name: 'Frank', last_name: 'Woods', rank: 'Sergeant', base_id: baseIds[2], email: 'fwoods@military.gov', department: 'Infantry' },
            { first_name: 'Alex', last_name: 'Mason', rank: 'Corporal', base_id: baseIds[2], email: 'amason@military.gov', department: 'Logistics' },
            { first_name: 'Jason', last_name: 'Hudson', rank: 'Lieutenant', base_id: baseIds[2], email: 'jhudson@military.gov', department: 'Armor' },
            { first_name: 'Raul', last_name: 'Menendez', rank: 'Captain', base_id: baseIds[2], email: 'rmenendez@military.gov', department: 'Engineering' },
            { first_name: 'David', last_name: 'Mason', rank: 'Staff Sergeant', base_id: baseIds[2], email: 'dmason@military.gov', department: 'Intelligence' },
            { first_name: 'Logan', last_name: 'Walker', rank: 'Sergeant', base_id: baseIds[3], email: 'lwalker@military.gov', department: 'Infantry' },
            { first_name: 'Hesh', last_name: 'Walker', rank: 'Corporal', base_id: baseIds[3], email: 'hwalker@military.gov', department: 'Logistics' },
            { first_name: 'Elias', last_name: 'Walker', rank: 'Lieutenant', base_id: baseIds[3], email: 'ewalker@military.gov', department: 'Armor' },
            { first_name: 'Rorke', last_name: 'Unknown', rank: 'Captain', base_id: baseIds[3], email: 'rorke@military.gov', department: 'Engineering' },
            { first_name: 'Kick', last_name: 'Unknown', rank: 'Staff Sergeant', base_id: baseIds[3], email: 'kick@military.gov', department: 'Intelligence' }
        ];
        for (const person of personnel) {
            await (0, connection_1.default) `
        INSERT INTO personnel (first_name, last_name, rank, base_id, email, department)
        VALUES (${person.first_name}, ${person.last_name}, ${person.rank}, ${person.base_id}, ${person.email}, ${person.department})
        ON CONFLICT (first_name, last_name, email) DO UPDATE SET 
          rank = EXCLUDED.rank,
          base_id = EXCLUDED.base_id,
          department = EXCLUDED.department
      `;
        }
        const assetNames = [
            'M4 Carbine',
            '9mm Ammunition',
            'HMMWV',
            'Night Vision Goggles',
            'Body Armor',
            '5.56mm Ammunition',
            'M249 SAW',
            'M240 Machine Gun',
            'M2 Browning',
            '7.62mm Ammunition',
            '.50 Cal Ammunition',
            'M1A2 Abrams',
            'M2 Bradley',
            'UH-60 Black Hawk',
            'AH-64 Apache',
            'Combat Helmet',
            'Tactical Vest',
            'Radio Equipment',
            'Medical Kit',
            'Rations'
        ];
        const initialAssets = [];
        for (let baseIndex = 0; baseIndex < baseIds.length; baseIndex++) {
            const baseId = baseIds[baseIndex];
            const multiplier = baseIndex === 0 ? 1.5 : 1.0;
            initialAssets.push({ name: assetNames[0], base_id: baseId, quantity: Math.floor(3000 * multiplier), available_quantity: Math.floor(2400 * multiplier), assigned_quantity: Math.floor(600 * multiplier) }, { name: assetNames[6], base_id: baseId, quantity: Math.floor(1500 * multiplier), available_quantity: Math.floor(1200 * multiplier), assigned_quantity: Math.floor(300 * multiplier) }, { name: assetNames[7], base_id: baseId, quantity: Math.floor(1000 * multiplier), available_quantity: Math.floor(800 * multiplier), assigned_quantity: Math.floor(200 * multiplier) }, { name: assetNames[8], base_id: baseId, quantity: Math.floor(800 * multiplier), available_quantity: Math.floor(600 * multiplier), assigned_quantity: Math.floor(200 * multiplier) }, { name: assetNames[1], base_id: baseId, quantity: Math.floor(4000 * multiplier), available_quantity: Math.floor(3600 * multiplier), assigned_quantity: Math.floor(400 * multiplier) }, { name: assetNames[5], base_id: baseId, quantity: Math.floor(4500 * multiplier), available_quantity: Math.floor(4050 * multiplier), assigned_quantity: Math.floor(450 * multiplier) }, { name: assetNames[9], base_id: baseId, quantity: Math.floor(3500 * multiplier), available_quantity: Math.floor(3150 * multiplier), assigned_quantity: Math.floor(350 * multiplier) }, { name: assetNames[10], base_id: baseId, quantity: Math.floor(2000 * multiplier), available_quantity: Math.floor(1800 * multiplier), assigned_quantity: Math.floor(200 * multiplier) }, { name: assetNames[2], base_id: baseId, quantity: Math.floor(2500 * multiplier), available_quantity: Math.floor(1875 * multiplier), assigned_quantity: Math.floor(625 * multiplier) }, { name: assetNames[11], base_id: baseId, quantity: Math.floor(1200 * multiplier), available_quantity: Math.floor(960 * multiplier), assigned_quantity: Math.floor(240 * multiplier) }, { name: assetNames[12], base_id: baseId, quantity: Math.floor(1800 * multiplier), available_quantity: Math.floor(1440 * multiplier), assigned_quantity: Math.floor(360 * multiplier) }, { name: assetNames[13], base_id: baseId, quantity: Math.floor(800 * multiplier), available_quantity: Math.floor(600 * multiplier), assigned_quantity: Math.floor(200 * multiplier) }, { name: assetNames[14], base_id: baseId, quantity: Math.floor(600 * multiplier), available_quantity: Math.floor(480 * multiplier), assigned_quantity: Math.floor(120 * multiplier) }, { name: assetNames[3], base_id: baseId, quantity: Math.floor(3500 * multiplier), available_quantity: Math.floor(2925 * multiplier), assigned_quantity: Math.floor(575 * multiplier) }, { name: assetNames[4], base_id: baseId, quantity: Math.floor(4000 * multiplier), available_quantity: Math.floor(3200 * multiplier), assigned_quantity: Math.floor(800 * multiplier) }, { name: assetNames[15], base_id: baseId, quantity: Math.floor(4500 * multiplier), available_quantity: Math.floor(3750 * multiplier), assigned_quantity: Math.floor(750 * multiplier) }, { name: assetNames[16], base_id: baseId, quantity: Math.floor(3000 * multiplier), available_quantity: Math.floor(2625 * multiplier), assigned_quantity: Math.floor(375 * multiplier) }, { name: assetNames[17], base_id: baseId, quantity: Math.floor(2500 * multiplier), available_quantity: Math.floor(2250 * multiplier), assigned_quantity: Math.floor(250 * multiplier) }, { name: assetNames[18], base_id: baseId, quantity: Math.floor(2000 * multiplier), available_quantity: Math.floor(1600 * multiplier), assigned_quantity: Math.floor(400 * multiplier) }, { name: assetNames[19], base_id: baseId, quantity: Math.floor(5000 * multiplier), available_quantity: Math.floor(4500 * multiplier), assigned_quantity: Math.floor(500 * multiplier) });
        }
        for (const asset of initialAssets) {
            if (asset.name && asset.base_id) {
                await (0, connection_1.default) `
          INSERT INTO assets (name, base_id, quantity, available_quantity, assigned_quantity)
          VALUES (${asset.name}, ${asset.base_id}, ${asset.quantity}, ${asset.available_quantity}, ${asset.assigned_quantity})
          ON CONFLICT (name, base_id) DO UPDATE SET 
            quantity = EXCLUDED.quantity,
            available_quantity = EXCLUDED.available_quantity,
            assigned_quantity = EXCLUDED.assigned_quantity
        `;
            }
        }
        logger_1.logger.info('Database seeding completed successfully');
    }
    catch (error) {
        logger_1.logger.error('Error seeding database:', error);
        throw error;
    }
};
seedDatabase()
    .then(() => {
    console.log('✅ Database seeding completed successfully');
    process.exit(0);
})
    .catch((error) => {
    console.error('❌ Database seeding failed:', error);
    process.exit(1);
});
exports.default = seedDatabase;
//# sourceMappingURL=seed.js.map