import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { logger } from '../utils/logger';
import { query } from '../database/connection';

const router = Router();

// @route   GET /api/assets
// @desc    Get all assets with filters (quantity-based)
// @access  Private
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { base_id, name, status, page = 1, limit = 10 } = req.query;
    
    // Build where conditions
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // Apply filters based on user role
    if (req.user!.role === 'base_commander' && req.user!.base_id) {
      whereClause += ` AND a.base_id = $${paramIndex}`;
      params.push(req.user!.base_id);
      paramIndex++;
    } else if (base_id && req.user!.role !== 'admin') {
      whereClause += ` AND a.base_id = $${paramIndex}`;
      params.push(base_id);
      paramIndex++;
    }

    if (name) {
      whereClause += ` AND a.name ILIKE $${paramIndex}`;
      params.push(`%${name}%`);
      paramIndex++;
    }

    if (status) {
      whereClause += ` AND a.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM assets a ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results with base information
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const assetsQuery = `
      SELECT 
        a.*,
        b.name as base_name,
        b.code as base_code
      FROM assets a
      LEFT JOIN bases b ON a.base_id = b.id
      ${whereClause}
      ORDER BY a.name ASC, b.name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), offset);
    
    const assetsResult = await query(assetsQuery, params);
    const assets = assetsResult.rows;

    // Transform data to match expected format
    const transformedAssets = assets.map((asset: any) => ({
      ...asset,
      current_base_name: asset.base_name,
      base_code: asset.base_code
    }));

    res.json({
      success: true,
      data: transformedAssets,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        totalPages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    logger.error('Get assets error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   GET /api/assets/:id
// @desc    Get asset by ID
// @access  Private
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Asset ID is required'
      });
    }

    const assetResult = await query(`
      SELECT 
        a.*,
        b.name as base_name,
        b.code as base_code
      FROM assets a
      LEFT JOIN bases b ON a.base_id = b.id
      WHERE a.id = $1
    `, [id]);

    if (assetResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Asset not found'
      });
    }

    const asset = assetResult.rows[0];

    // Check access permissions
    if (req.user!.role === 'base_commander' && asset.base_id !== req.user!.base_id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this asset'
      });
    }

    // Transform data to match expected format
    const transformedAsset = {
      ...asset,
      current_base_name: asset.base_name,
      base_code: asset.base_code
    };

    return res.json({
      success: true,
      data: transformedAsset
    });
  } catch (error) {
    logger.error('Get asset by ID error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @route   POST /api/assets
// @desc    Create new asset inventory entry
// @access  Private (Admin only)
router.post('/', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { name, base_id, quantity, available_quantity, assigned_quantity } = req.body;

    // Validate required fields
    if (!name || !base_id || quantity === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Asset name, base ID, and quantity are required'
      });
    }

    // Validate quantity
    if (quantity < 0) {
      return res.status(400).json({
        success: false,
        error: 'Quantity must be non-negative'
      });
    }

    // Check if base exists
    const baseResult = await query('SELECT id FROM bases WHERE id = $1', [base_id]);
    if (baseResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Base not found'
      });
    }

    // Check if asset already exists for this name and base
    const existingAssetResult = await query(
      'SELECT id FROM assets WHERE name = $1 AND base_id = $2',
      [name, base_id]
    );

    if (existingAssetResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Asset inventory already exists for this name and base'
      });
    }

    // Set default values
    const finalAvailableQuantity = available_quantity !== undefined ? available_quantity : quantity;
    const finalAssignedQuantity = assigned_quantity !== undefined ? assigned_quantity : 0;

    // Validate quantities
    if (finalAvailableQuantity + finalAssignedQuantity > quantity) {
      return res.status(400).json({
        success: false,
        error: 'Available + assigned quantity cannot exceed total quantity'
      });
    }

    const newAssetResult = await query(`
      INSERT INTO assets (name, base_id, quantity, available_quantity, assigned_quantity)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, base_id, quantity, finalAvailableQuantity, finalAssignedQuantity]);

    const newAsset = newAssetResult.rows[0];

    // Log asset creation
    logger.info({
      action: 'ASSET_INVENTORY_CREATED',
      user_id: req.user!.user_id,
      asset_id: newAsset.id,
      asset_name: name,
      base_id: base_id,
      quantity
    });

    return res.status(201).json({
      success: true,
      data: newAsset
    });
  } catch (error) {
    logger.error('Create asset error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @route   PUT /api/assets/:id
// @desc    Update asset inventory
// @access  Private (Admin only)
router.put('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { quantity, available_quantity, assigned_quantity, status } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Asset ID is required'
      });
    }

    // Get current asset
    const currentAssetResult = await query('SELECT * FROM assets WHERE id = $1', [id]);
    if (currentAssetResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Asset not found'
      });
    }

    const currentAsset = currentAssetResult.rows[0];

    // Validate quantities
    if (quantity !== undefined && quantity < 0) {
      return res.status(400).json({
        success: false,
        error: 'Quantity must be non-negative'
      });
    }

    const finalQuantity = quantity !== undefined ? quantity : currentAsset.quantity;
    const finalAvailableQuantity = available_quantity !== undefined ? available_quantity : currentAsset.available_quantity;
    const finalAssignedQuantity = assigned_quantity !== undefined ? assigned_quantity : currentAsset.assigned_quantity;

    if (finalAvailableQuantity + finalAssignedQuantity > finalQuantity) {
      return res.status(400).json({
        success: false,
        error: 'Available + assigned quantity cannot exceed total quantity'
      });
    }

    // Update asset
    const updatedAssetResult = await query(`
      UPDATE assets 
      SET quantity = $1, available_quantity = $2, assigned_quantity = $3, status = $4
      WHERE id = $5
      RETURNING *
    `, [finalQuantity, finalAvailableQuantity, finalAssignedQuantity, status || currentAsset.status, id]);

    const updatedAsset = updatedAssetResult.rows[0];

    // Log asset update
    logger.info({
      action: 'ASSET_INVENTORY_UPDATED',
      user_id: req.user!.user_id,
      asset_id: id,
      asset_name: updatedAsset.name,
      changes: {
        quantity: finalQuantity,
        available_quantity: finalAvailableQuantity,
        assigned_quantity: finalAssignedQuantity,
        status: status || currentAsset.status
      }
    });

    return res.json({
      success: true,
      data: updatedAsset
    });
  } catch (error) {
    logger.error('Update asset error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @route   DELETE /api/assets/:id
// @desc    Delete asset inventory
// @access  Private (Admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Asset ID is required'
      });
    }

    // Check if asset exists
    const assetResult = await query('SELECT * FROM assets WHERE id = $1', [id]);
    if (assetResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Asset not found'
      });
    }

    const asset = assetResult.rows[0];

    // Check if asset has any assignments
    const assignmentsResult = await query('SELECT COUNT(*) FROM assignments WHERE asset_name = $1', [asset.name]);
    const assignmentCount = parseInt(assignmentsResult.rows[0].count);

    if (assignmentCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete asset. It has ${assignmentCount} active assignments.`
      });
    }

    // Delete asset
    await query('DELETE FROM assets WHERE id = $1', [id]);

    // Log asset deletion
    logger.info({
      action: 'ASSET_INVENTORY_DELETED',
      user_id: req.user!.user_id,
      asset_id: id,
      asset_name: asset.name
    });

    return res.json({
      success: true,
      message: 'Asset deleted successfully'
    });
  } catch (error) {
    logger.error('Delete asset error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router; 