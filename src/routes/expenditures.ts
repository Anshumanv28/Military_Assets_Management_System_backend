import { Router, Response } from 'express';
import { query } from '../database/connection';
import { authenticate, authorize } from '../middleware/auth';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../types';

const router = Router();

// @route   GET /api/expenditures
// @desc    Get all expenditures with filters
// @access  Private
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { base_id, asset_name, start_date, end_date, page = 1, limit = 10 } = req.query;
    
    // Build where conditions
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // Apply filters based on user role
    if (req.user!.role === 'base_commander' && req.user!.base_id) {
      whereClause += ` AND e.base_id = $${paramIndex}`;
      params.push(req.user!.base_id);
      paramIndex++;
    } else if (req.user!.role === 'logistics_officer' && req.user!.base_id) {
      whereClause += ` AND e.base_id = $${paramIndex}`;
      params.push(req.user!.base_id);
      paramIndex++;
    } else if (base_id) {
      whereClause += ` AND e.base_id = $${paramIndex}`;
      params.push(base_id as string);
      paramIndex++;
    }

    if (asset_name) {
      whereClause += ` AND e.asset_name ILIKE $${paramIndex}`;
      params.push(`%${asset_name}%`);
      paramIndex++;
    }

    if (start_date && end_date) {
      whereClause += ` AND e.expenditure_date >= $${paramIndex} AND e.expenditure_date <= $${paramIndex + 1}`;
      params.push(start_date as string, end_date as string);
      paramIndex += 2;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM expenditures e ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const expendituresQuery = `
      SELECT 
        e.*,
        b.name as base_name,
        u.first_name,
        u.last_name,
        p.first_name as personnel_first_name,
        p.last_name as personnel_last_name,
        p.rank as personnel_rank
      FROM expenditures e
      LEFT JOIN bases b ON e.base_id = b.id
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN personnel p ON e.personnel_id = p.id
      ${whereClause}
      ORDER BY e.expenditure_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), offset);
    
    const expendituresResult = await query(expendituresQuery, params);
    const expenditures = expendituresResult.rows;

    // Transform data to match expected format
    const transformedExpenditures = expenditures.map((expenditure: any) => ({
      ...expenditure,
      base_name: expenditure.base_name,
      first_name: expenditure.first_name,
      last_name: expenditure.last_name,
      personnel_first_name: expenditure.personnel_first_name || null,
      personnel_last_name: expenditure.personnel_last_name || null,
      personnel_rank: expenditure.personnel_rank || null
    }));

    res.json({
      success: true,
      data: transformedExpenditures,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        totalPages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    logger.error('Get expenditures error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   POST /api/expenditures
// @desc    Create new expenditure (Delete operation - removes assets from inventory)
// @access  Private (Admin, Base Commander, Logistics Officer)
router.post('/', authenticate, authorize('admin', 'base_commander', 'logistics_officer'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { asset_name, base_id, quantity, expenditure_date, reason, notes } = req.body;

    // Validate required fields
    if (!asset_name || !base_id || !quantity || !expenditure_date || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Asset name, base ID, quantity, expenditure date, and reason are required'
      });
    }

    // Validate quantity
    if (quantity <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Quantity must be greater than 0'
      });
    }

    // Check access permissions
    if (req.user!.role === 'base_commander' && base_id !== req.user!.base_id) {
      return res.status(403).json({
        success: false,
        error: 'Base commanders can only create expenditures for their base'
      });
    }

    // Check if there are sufficient assets available for expenditure
    const assetResult = await query(
      'SELECT * FROM assets WHERE name = $1 AND base_id = $2',
      [asset_name, base_id]
    );

    if (assetResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Base does not have this asset in inventory'
      });
    }

    const asset = assetResult.rows[0];

    if (asset.available_quantity < quantity) {
      return res.status(400).json({
        success: false,
        error: `Insufficient available quantity for expenditure. Available: ${asset.available_quantity}, Requested: ${quantity}`
      });
    }

    // Use database transaction
    await query('BEGIN');
    
    try {
      // Create expenditure record
      const newExpenditureResult = await query(`
        INSERT INTO expenditures (asset_name, base_id, quantity, expenditure_date, reason, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [asset_name, base_id, quantity, new Date(expenditure_date), reason, notes || null, req.user!.user_id]);

      const newExpenditure = newExpenditureResult.rows[0];

      // Update asset quantities - reduce from inventory
      const newQuantity = asset.quantity - quantity;
      const newAvailableQuantity = asset.available_quantity - quantity;

      // Update asset status based on remaining quantity
      let newStatus = 'available';
      if (newQuantity === 0) {
        newStatus = 'out_of_stock';
      } else if (newAvailableQuantity === 0) {
        newStatus = 'low_stock';
      }

      await query(`
        UPDATE assets 
        SET quantity = $1, available_quantity = $2, status = $3
        WHERE id = $4
      `, [newQuantity, newAvailableQuantity, newStatus, asset.id]);

      await query('COMMIT');

      // Log expenditure creation
      logger.info({
        action: 'EXPENDITURE_CREATED',
        user_id: req.user!.user_id,
        expenditure_id: newExpenditure.id,
        asset_name: asset_name,
        base_id: base_id,
        quantity: quantity,
        reason: reason
      });

      return res.status(201).json({
        success: true,
        data: newExpenditure
      });
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    logger.error('Create expenditure error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   PUT /api/expenditures/:id
// @desc    Update expenditure
// @access  Private (Admin, Base Commander)
router.put('/:id', authenticate, authorize('admin', 'base_commander'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { quantity, expenditure_date, reason, notes } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Expenditure ID is required'
      });
    }

    // Check if expenditure exists
    const expenditureResult = await query(
      'SELECT * FROM expenditures WHERE id = $1',
      [id]
    );

    if (expenditureResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Expenditure not found'
      });
    }

    const expenditure = expenditureResult.rows[0];

    // Check access permissions
    if (req.user!.role === 'base_commander' && expenditure.base_id !== req.user!.base_id) {
      return res.status(403).json({
        success: false,
        error: 'Base commanders can only update expenditures for their base'
      });
    }

    // Validate quantity if being updated
    if (quantity !== undefined && quantity <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Quantity must be greater than 0'
      });
    }

    // If quantity is being changed, we need to adjust the asset inventory
    if (quantity !== undefined && quantity !== expenditure.quantity) {
      const quantityDifference = expenditure.quantity - quantity;
      
      // Get current asset inventory
      const assetResult = await query(
        'SELECT * FROM assets WHERE name = $1 AND base_id = $2',
        [expenditure.asset_name, expenditure.base_id]
      );

      if (assetResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Asset inventory not found'
        });
      }

      const asset = assetResult.rows[0];

      const newQuantity = asset.quantity + quantityDifference;
      const newAvailableQuantity = asset.available_quantity + quantityDifference;

      if (newQuantity < 0 || newAvailableQuantity < 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot reduce expenditure quantity below zero'
        });
      }

      // Update asset quantities
      await query(`
        UPDATE assets 
        SET quantity = $1, available_quantity = $2
        WHERE id = $3
      `, [newQuantity, newAvailableQuantity, asset.id]);
    }

    // Update expenditure
    const updateData: any = {};
    if (quantity !== undefined) updateData.quantity = quantity;
    if (expenditure_date) updateData.expenditure_date = new Date(expenditure_date);
    if (reason) updateData.reason = reason;
    if (notes !== undefined) updateData.notes = notes;

    const updatedExpenditureResult = await query(`
      UPDATE expenditures
      SET quantity = $1, expenditure_date = $2, reason = $3, notes = $4
      WHERE id = $5
      RETURNING *
    `, [updateData.quantity, updateData.expenditure_date, updateData.reason, updateData.notes, id]);

    const updatedExpenditure = updatedExpenditureResult.rows[0];

    // Log expenditure update
    logger.info({
      action: 'EXPENDITURE_UPDATED',
      user_id: req.user!.user_id,
      expenditure_id: id,
      old_quantity: expenditure.quantity,
      new_quantity: quantity || expenditure.quantity
    });

    return res.json({
      success: true,
      data: updatedExpenditure
    });
  } catch (error) {
    logger.error('Update expenditure error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @route   DELETE /api/expenditures/:id
// @desc    Delete expenditure
// @access  Private (Admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Expenditure ID is required'
      });
    }

    // Check if expenditure exists
    const expenditureResult = await query(
      'SELECT * FROM expenditures WHERE id = $1',
      [id]
    );

    if (expenditureResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Expenditure not found'
      });
    }

    const expenditure = expenditureResult.rows[0];

    // Use database transaction
    await query('BEGIN');
    
    try {
      // Restore asset quantities
      const assetResult = await query(
        'SELECT * FROM assets WHERE name = $1 AND base_id = $2',
        [expenditure.asset_name, expenditure.base_id]
      );

      if (assetResult.rows.length > 0) {
        const asset = assetResult.rows[0];
        const newQuantity = asset.quantity + expenditure.quantity;
        const newAvailableQuantity = asset.available_quantity + expenditure.quantity;

        // Update asset status
        let newStatus = 'available';
        if (newQuantity === 0) {
          newStatus = 'out_of_stock';
        } else if (newAvailableQuantity === 0) {
          newStatus = 'low_stock';
        }

        await query(`
          UPDATE assets 
          SET quantity = $1, available_quantity = $2, status = $3
          WHERE id = $4
        `, [newQuantity, newAvailableQuantity, newStatus, asset.id]);
      }

      // Delete expenditure
      await query(`
        DELETE FROM expenditures
        WHERE id = $1
      `, [id]);

      await query('COMMIT');

      // Log expenditure deletion
      logger.info({
        action: 'EXPENDITURE_DELETED',
        user_id: req.user!.user_id,
        expenditure_id: id,
        asset_name: expenditure.asset_name,
        quantity: expenditure.quantity
      });

      return res.json({
        success: true,
        message: 'Expenditure deleted successfully'
      });
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    logger.error('Delete expenditure error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router; 