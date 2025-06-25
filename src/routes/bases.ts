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
    const transformedBases = bases.map(base => ({
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

    const base = await prisma.bases.findFirst({
      where: {
        id,
        is_active: true
      },
      include: {
        users_bases_commander_idTousers: {
          select: {
            first_name: true,
            last_name: true
          }
        }
      }
    });

    if (!base) {
      return res.status(404).json({
        success: false,
        error: 'Base not found'
      });
    }

    // Transform data to match expected format
    const transformedBase = {
      ...base,
      first_name: base.users_bases_commander_idTousers?.first_name || null,
      last_name: base.users_bases_commander_idTousers?.last_name || null
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
    const existingBase = await prisma.bases.findUnique({
      where: { code }
    });

    if (existingBase) {
      return res.status(400).json({
        success: false,
        error: 'Base code already exists'
      });
    }

    const newBase = await prisma.bases.create({
      data: {
        name,
        code,
        location,
        commander_id: commander_id || null
      }
    });

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
    const existingBase = await prisma.bases.findUnique({
      where: { id }
    });

    if (!existingBase) {
      return res.status(404).json({
        success: false,
        error: 'Base not found'
      });
    }

    // Check if code already exists (excluding current base)
    if (code && code !== existingBase.code) {
      const codeExists = await prisma.bases.findUnique({
        where: { code }
      });

      if (codeExists) {
        return res.status(400).json({
          success: false,
          error: 'Base code already exists'
        });
      }
    }

    // Build update data
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code;
    if (location !== undefined) updateData.location = location;
    if (commander_id !== undefined) updateData.commander_id = commander_id || null;
    if (is_active !== undefined) updateData.is_active = is_active;

    const updatedBase = await prisma.bases.update({
      where: { id },
      data: updateData
    });

    // Log base update
    logger.info({
      action: 'BASE_UPDATED',
      user_id: req.user!.user_id,
      base_id: updatedBase.id,
      base_name: updatedBase.name
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
    const existingBase = await prisma.bases.findUnique({
      where: { id },
      select: { id: true, name: true }
    });

    if (!existingBase) {
      return res.status(404).json({
        success: false,
        error: 'Base not found'
      });
    }

    // Soft delete by setting is_active to false
    const deletedBase = await prisma.bases.update({
      where: { id },
      data: { is_active: false }
    });

    // Log base deletion
    logger.info({
      action: 'BASE_DELETED',
      user_id: req.user!.user_id,
      base_id: deletedBase.id,
      base_name: deletedBase.name
    });

    return res.json({
      success: true,
      data: deletedBase
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