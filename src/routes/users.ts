import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';
import { query } from '../database/connection';

const router = Router();

// @route   GET /api/users
// @desc    Get users with optional role filtering
// @access  Private
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { role, limit = '1000' } = req.query;
    
    // Build where conditions
    let whereClause = 'WHERE is_active = true';
    const params: any[] = [];

    // Add role filter
    if (role && role !== '') {
      whereClause += ' AND role = $1';
      params.push(role as string);
    }

    const usersQuery = `
      SELECT id, username, first_name, last_name, role, base_id
      FROM users
      ${whereClause}
      ORDER BY first_name ASC, last_name ASC
      LIMIT $${params.length + 1}
    `;
    params.push(parseInt(limit as string));

    const usersResult = await query(usersQuery, params);

    return res.json({
      success: true,
      data: usersResult.rows
    });
  } catch (error) {
    logger.error('Get users error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

export default router; 