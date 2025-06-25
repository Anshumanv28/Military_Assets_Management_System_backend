import { Router, Response } from 'express';
import { query } from '../database/connection';
import { authenticate, authorize } from '../middleware/auth';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../types';

const router = Router();

// @route   GET /api/purchases
// @desc    Get all purchases with filters
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
      whereClause += ` AND p.base_id = $${paramIndex}`;
      params.push(req.user!.base_id);
      paramIndex++;
    } else if (base_id && req.user!.role !== 'admin') {
      whereClause += ` AND p.base_id = $${paramIndex}`;
      params.push(base_id as string);
      paramIndex++;
    }

    if (asset_name) {
      whereClause += ` AND a.name ILIKE $${paramIndex}`;
      params.push(`%${asset_name}%`);
      paramIndex++;
    }

    if (start_date && end_date) {
      whereClause += ` AND p.purchase_date >= $${paramIndex} AND p.purchase_date <= $${paramIndex + 1}`;
      params.push(start_date as string, end_date as string);
      paramIndex += 2;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM purchases p ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const purchasesQuery = `
      SELECT 
        p.*,
        b.name as base_name,
        u.first_name,
        u.last_name,
        a.name as asset_name
      FROM purchases p
      LEFT JOIN bases b ON p.base_id = b.id
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN assets a ON p.asset_id = a.id
      ${whereClause}
      ORDER BY p.purchase_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), offset);
    
    const purchasesResult = await query(purchasesQuery, params);
    const purchases = purchasesResult.rows;

    // Transform data to match expected format
    const transformedPurchases = purchases.map((purchase: any) => ({
      ...purchase,
      base_name: purchase.base_name,
      first_name: purchase.first_name,
      last_name: purchase.last_name,
      asset_name: purchase.asset_name
    }));

    res.json({
      success: true,
      data: transformedPurchases,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        totalPages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    logger.error('Get purchases error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   POST /api/purchases
// @desc    Create new purchase (Create operation - adds assets to inventory)
// @access  Private (Admin, Base Commander)
router.post('/', authenticate, authorize('admin', 'base_commander'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { asset_id, base_id, quantity, supplier, purchase_date, notes } = req.body;

    // Validate required fields
    if (!asset_id || !base_id || !quantity || !purchase_date) {
      return res.status(400).json({
        success: false,
        error: 'Asset, base, quantity, and purchase date are required'
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
        error: 'Base commanders can only create purchases for their base'
      });
    }

    // All purchases start as pending - only admins can approve them
    const status = 'pending';

    const newPurchaseResult = await query(`
      INSERT INTO purchases (asset_id, base_id, quantity, supplier, purchase_date, status, approved_by, approved_at, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [asset_id, base_id, quantity, supplier || null, new Date(purchase_date), status, null, null, notes || null, req.user!.user_id]);

    const newPurchase = newPurchaseResult.rows[0];

    // Log purchase creation
    logger.info({
      action: 'PURCHASE_CREATED',
      user_id: req.user!.user_id,
      purchase_id: newPurchase.id,
      asset_id,
      quantity,
      status
    });

    return res.status(201).json({ success: true, data: newPurchase });
  } catch (error) {
    logger.error('Create purchase error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @route   PUT /api/purchases/:id/approve
// @desc    Approve purchase request
// @access  Private (Admin only)
router.put('/:id/approve', authenticate, authorize('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Purchase ID is required'
      });
    }

    // Check if purchase exists
    const purchaseResult = await query('SELECT * FROM purchases WHERE id = $1', [id]);
    if (purchaseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Purchase not found'
      });
    }

    const purchase = purchaseResult.rows[0];

    // Check if already approved
    if (purchase.status === 'approved') {
      return res.status(400).json({
        success: false,
        error: 'Purchase is already approved'
      });
    }

    // Use database transaction
    await query('BEGIN');
    
    try {
      // Update purchase status
      const updatedPurchaseResult = await query(`
        UPDATE purchases 
        SET status = $1, approved_by = $2, approved_at = $3
        WHERE id = $4
        RETURNING *
      `, ['approved', req.user!.user_id, new Date(), id]);

      const updatedPurchase = updatedPurchaseResult.rows[0];

      // Add assets to inventory
      await addAssetsToInventory(updatedPurchase);

      await query('COMMIT');

      // Log purchase approval
      logger.info({
        action: 'PURCHASE_APPROVED',
        user_id: req.user!.user_id,
        purchase_id: id,
        asset_id: purchase.asset_id,
        quantity: purchase.quantity
      });

      return res.json({
        success: true,
        data: updatedPurchase
      });
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    logger.error('Approve purchase error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   PUT /api/purchases/:id/reject
// @desc    Reject purchase request
// @access  Private (Admin only)
router.put('/:id/reject', authenticate, authorize('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Purchase ID is required'
      });
    }

    // Check if purchase exists
    const purchaseResult = await query('SELECT * FROM purchases WHERE id = $1', [id]);
    if (purchaseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Purchase not found'
      });
    }

    const purchase = purchaseResult.rows[0];

    // Check if already processed
    if (purchase.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Purchase is already processed'
      });
    }

    // Update purchase status
    const updatedPurchaseResult = await query(`
      UPDATE purchases 
      SET status = $1, notes = $2
      WHERE id = $3
      RETURNING *
    `, ['rejected', reason || 'Rejected by admin', id]);

    const updatedPurchase = updatedPurchaseResult.rows[0];

    // Log purchase rejection
    logger.info({
      action: 'PURCHASE_REJECTED',
      user_id: req.user!.user_id,
      purchase_id: id,
      asset_id: purchase.asset_id,
      quantity: purchase.quantity,
      reason: reason || 'Rejected by admin'
    });

    return res.json({
      success: true,
      data: updatedPurchase
    });
  } catch (error) {
    logger.error('Reject purchase error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   PUT /api/purchases/:id
// @desc    Update purchase
// @access  Private (Admin, Base Commander)
router.put('/:id', authenticate, authorize('admin', 'base_commander'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { quantity, supplier, purchase_date, notes } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Purchase ID is required'
      });
    }

    // Check if purchase exists
    const purchaseResult = await query('SELECT * FROM purchases WHERE id = $1', [id]);
    if (purchaseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Purchase not found'
      });
    }

    const purchase = purchaseResult.rows[0];

    // Check access permissions
    if (req.user!.role === 'base_commander' && purchase.base_id !== req.user!.base_id) {
      return res.status(403).json({
        success: false,
        error: 'Base commanders can only update purchases for their base'
      });
    }

    // Cannot update approved purchases
    if (purchase.status === 'approved') {
      return res.status(400).json({
        success: false,
        error: 'Cannot update approved purchases'
      });
    }

    // Update purchase
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (quantity !== undefined) {
      updateFields.push(`quantity = $${paramIndex}`);
      updateValues.push(quantity);
      paramIndex++;
    }

    if (supplier !== undefined) {
      updateFields.push(`supplier = $${paramIndex}`);
      updateValues.push(supplier);
      paramIndex++;
    }

    if (purchase_date !== undefined) {
      updateFields.push(`purchase_date = $${paramIndex}`);
      updateValues.push(new Date(purchase_date));
      paramIndex++;
    }

    if (notes !== undefined) {
      updateFields.push(`notes = $${paramIndex}`);
      updateValues.push(notes);
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
      UPDATE purchases 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const updatedPurchaseResult = await query(updateQuery, updateValues);
    const updatedPurchase = updatedPurchaseResult.rows[0];

    // Log purchase update
    logger.info({
      action: 'PURCHASE_UPDATED',
      user_id: req.user!.user_id,
      purchase_id: id,
      changes: { quantity, supplier, purchase_date, notes }
    });

    return res.json({
      success: true,
      data: updatedPurchase
    });
  } catch (error) {
    logger.error('Update purchase error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   DELETE /api/purchases/:id
// @desc    Delete purchase
// @access  Private (Admin, Base Commander)
router.delete('/:id', authenticate, authorize('admin', 'base_commander'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Purchase ID is required'
      });
    }

    // Check if purchase exists
    const purchaseResult = await query('SELECT * FROM purchases WHERE id = $1', [id]);
    if (purchaseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Purchase not found'
      });
    }

    const purchase = purchaseResult.rows[0];

    // Check access permissions
    if (req.user!.role === 'base_commander' && purchase.base_id !== req.user!.base_id) {
      return res.status(403).json({
        success: false,
        error: 'Base commanders can only delete purchases for their base'
      });
    }

    // Cannot delete approved purchases
    if (purchase.status === 'approved') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete approved purchases'
      });
    }

    // Delete purchase
    await query('DELETE FROM purchases WHERE id = $1', [id]);

    // Log purchase deletion
    logger.info({
      action: 'PURCHASE_DELETED',
      user_id: req.user!.user_id,
      purchase_id: id,
      asset_id: purchase.asset_id,
      quantity: purchase.quantity
    });

    return res.json({
      success: true,
      message: 'Purchase deleted successfully'
    });
  } catch (error) {
    logger.error('Delete purchase error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Helper function to add assets to inventory
async function addAssetsToInventory(purchase: { id: string; asset_id: string; base_id: string; quantity: number }) {
  // Check if asset already exists in inventory
  const existingAssetResult = await query(
    'SELECT * FROM assets WHERE id = $1 AND base_id = $2',
    [purchase.asset_id, purchase.base_id]
  );

  if (existingAssetResult.rows.length > 0) {
    // Update existing asset quantities
    const existingAsset = existingAssetResult.rows[0];
    const newQuantity = existingAsset.quantity + purchase.quantity;
    const newAvailableQuantity = existingAsset.available_quantity + purchase.quantity;

    // Update asset status based on new quantity
    let newStatus = 'available';
    if (newAvailableQuantity === 0) {
      newStatus = 'low_stock';
    }

    await query(`
      UPDATE assets 
      SET quantity = $1, available_quantity = $2, status = $3
      WHERE id = $4
    `, [newQuantity, newAvailableQuantity, newStatus, existingAsset.id]);
  } else {
    // Create new asset entry
    await query(`
      INSERT INTO assets (id, base_id, quantity, available_quantity, assigned_quantity, status)
      VALUES ($1, $2, $3, $3, 0, 'available')
    `, [purchase.asset_id, purchase.base_id, purchase.quantity]);
  }
}

export default router; 