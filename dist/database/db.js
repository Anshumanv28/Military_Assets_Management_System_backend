"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const postgres_1 = __importDefault(require("postgres"));
const connectionString = process.env['DATABASE_URL'];
const sql = (0, postgres_1.default)(connectionString, {
    ssl: {
        rejectUnauthorized: false
    },
    max: 10,
    idle_timeout: 20,
    connect_timeout: 30,
    max_lifetime: 60 * 30,
    onnotice: () => { },
    onparameter: () => { },
    prepare: false,
});
exports.default = sql;
//# sourceMappingURL=db.js.map