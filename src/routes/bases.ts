import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { logger } from '../utils/logger';
import { query } from '../database/connection';

const router = Router();

// @route   GET /api/bases
// @desc    Get all bases
// @access  Private
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '10', is_active, commander_id } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    
    // Build where conditions
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // Add status filter
    if (is_active !== undefined && is_active !== '') {
      whereClause += ` AND b.is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    } else {
      // Default to active bases only
      whereClause += ` AND b.is_active = $${paramIndex}`;
      params.push(true);
      paramIndex++;
    }

    // Add commander filter
    if (commander_id && commander_id !== '') {
      whereClause += ` AND b.commander_id = $${paramIndex}`;
      params.push(commander_id);
      paramIndex++;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM bases b ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results with commander information
    const basesQuery = `
      SELECT 
        b.*,
        u.first_name,
        u.last_name
      FROM bases b
      LEFT JOIN users u ON b.commander_id = u.id
      ${whereClause}
      ORDER BY b.name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), offset);
    
    const basesResult = await query(basesQuery, params);
    const bases = basesResult.rows;

    // Transform data to match expected format
    const transformedBases = bases.map((base: any) => ({
      ...base,
      first_name: base.first_name || null,
      last_name: base.last_name || null
    }));

    return res.json({
      success: true,
      data: transformedBases,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    logger.error('Get bases error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   GET /api/bases/:id
// @desc    Get base by ID
// @access  Private
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Base ID is required'
      });
    }

    const baseResult = await query(`
      SELECT 
        b.*,
        u.first_name,
        u.last_name
      FROM bases b
      LEFT JOIN users u ON b.commander_id = u.id
      WHERE b.id = $1 AND b.is_active = true
    `, [id]);

    if (baseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Base not found'
      });
    }

    const base = baseResult.rows[0];

    // Transform data to match expected format
    const transformedBase = {
      ...base,
      first_name: base.first_name || null,
      last_name: base.last_name || null
    };

    return res.json({
      success: true,
      data: transformedBase
    });
  } catch (error) {
    logger.error('Get base error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   POST /api/bases
// @desc    Create new base
// @access  Private (Admin only)
router.post('/', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { name, code, location, commander_id } = req.body;

    // Validate required fields
    if (!name || !code || !location) {
      return res.status(400).json({
        success: false,
        error: 'Name, code, and location are required'
      });
    }

    // Check if code already exists
    const existingBaseResult = await query('SELECT id FROM bases WHERE code = $1', [code]);
    if (existingBaseResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Base code already exists'
      });
    }

    const newBaseResult = await query(`
      INSERT INTO bases (name, code, location, commander_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, code, location, commander_id || null]);

    const newBase = newBaseResult.rows[0];

    // Log base creation
    logger.info({
      action: 'BASE_CREATED',
      user_id: req.user!.user_id,
      base_id: newBase.id,
      base_name: newBase.name
    });

    return res.status(201).json({
      success: true,
      data: newBase
    });
  } catch (error) {
    logger.error('Create base error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   PUT /api/bases/:id
// @desc    Update base
// @access  Private (Admin only)
router.put('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, location, commander_id, is_active } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Base ID is required'
      });
    }

    // Check if base exists
    const existingBaseResult = await query('SELECT * FROM bases WHERE id = $1', [id]);
    if (existingBaseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Base not found'
      });
    }

    const existingBase = existingBaseResult.rows[0];

    // Check if code already exists (if code is being changed)
    if (code && code !== existingBase.code) {
      const codeExistsResult = await query('SELECT id FROM bases WHERE code = $1 AND id != $2', [code, id]);
      if (codeExistsResult.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Base code already exists'
        });
      }
    }

    // Update base
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramIndex}`);
      updateValues.push(name);
      paramIndex++;
    }

    if (code !== undefined) {
      updateFields.push(`code = $${paramIndex}`);
      updateValues.push(code);
      paramIndex++;
    }

    if (location !== undefined) {
      updateFields.push(`location = $${paramIndex}`);
      updateValues.push(location);
      paramIndex++;
    }

    if (commander_id !== undefined) {
      updateFields.push(`commander_id = $${paramIndex}`);
      updateValues.push(commander_id);
      paramIndex++;
    }

    if (is_active !== undefined) {
      updateFields.push(`is_active = $${paramIndex}`);
      updateValues.push(is_active);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updateValues.push(id);
    const updateQuery = `
      UPDATE bases 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const updatedBaseResult = await query(updateQuery, updateValues);
    const updatedBase = updatedBaseResult.rows[0];

    // Log base update
    logger.info({
      action: 'BASE_UPDATED',
      user_id: req.user!.user_id,
      base_id: id,
      base_name: updatedBase.name,
      changes: { name, code, location, commander_id, is_active }
    });

    return res.json({
      success: true,
      data: updatedBase
    });
  } catch (error) {
    logger.error('Update base error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   DELETE /api/bases/:id
// @desc    Delete base (soft delete by setting is_active to false)
// @access  Private (Admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Base ID is required'
      });
    }

    // Check if base exists
    const baseResult = await query('SELECT * FROM bases WHERE id = $1', [id]);
    if (baseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Base not found'
      });
    }

    const base = baseResult.rows[0];

    // Check if base has any assets
    const assetsResult = await query('SELECT COUNT(*) FROM assets WHERE base_id = $1', [id]);
    const assetCount = parseInt(assetsResult.rows[0].count);

    if (assetCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete base. It has ${assetCount} assets assigned to it.`
      });
    }

    // Check if base has any personnel
    const personnelResult = await query('SELECT COUNT(*) FROM personnel WHERE base_id = $1', [id]);
    const personnelCount = parseInt(personnelResult.rows[0].count);

    if (personnelCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete base. It has ${personnelCount} personnel assigned to it.`
      });
    }

    // Soft delete by setting is_active to false
    await query('UPDATE bases SET is_active = false WHERE id = $1', [id]);

    // Log base deletion
    logger.info({
      action: 'BASE_DELETED',
      user_id: req.user!.user_id,
      base_id: id,
      base_name: base.name
    });

    return res.json({
      success: true,
      message: 'Base deleted successfully'
    });
  } catch (error) {
    logger.error('Delete base error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

export default router; 