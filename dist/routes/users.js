"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { role, limit = '1000' } = req.query;
        let whereClause = 'WHERE is_active = true';
        const params = [];
        if (role && role !== '') {
            whereClause += ' AND role = $1';
            params.push(role);
        }
        const usersQuery = `
      SELECT id, username, first_name, last_name, role, base_id
      FROM users
      ${whereClause}
      ORDER BY first_name ASC, last_name ASC
      LIMIT $${params.length + 1}
    `;
        params.push(parseInt(limit));
        const usersResult = await (0, connection_1.query)(usersQuery, params);
        return res.json({
            success: true,
            data: usersResult.rows
        });
    }
    catch (error) {
        logger_1.logger.error('Get users error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map