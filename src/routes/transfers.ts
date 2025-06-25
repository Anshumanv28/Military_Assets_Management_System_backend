import { Router, Response } from 'express';
import { query } from '../database/connection';
import { authenticate, authorize } from '../middleware/auth';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../types';

const router = Router();

// @route   GET /api/transfers
// @desc    Get all transfers with filters
// @access  Private
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from_base_id, to_base_id, asset_name, start_date, end_date, page = 1, limit = 10 } = req.query;

    // Build where conditions
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (req.user!.role === 'base_commander' && req.user!.base_id) {
      whereClause += ` AND (t.from_base_id = $${paramIndex} OR t.to_base_id = $${paramIndex})`;
      params.push(req.user!.base_id);
      paramIndex++;
    } else if (req.user!.role === 'logistics_officer' && req.user!.base_id) {
      whereClause += ` AND (t.from_base_id = $${paramIndex} OR t.to_base_id = $${paramIndex})`;
      params.push(req.user!.base_id);
      paramIndex++;
    } else {
      if (from_base_id) {
        whereClause += ` AND t.from_base_id = $${paramIndex}`;
        params.push(from_base_id as string);
        paramIndex++;
      }
      if (to_base_id) {
        whereClause += ` AND t.to_base_id = $${paramIndex}`;
        params.push(to_base_id as string);
        paramIndex++;
      }
    }

    if (asset_name) {
      whereClause += ` AND t.asset_name ILIKE $${paramIndex}`;
      params.push(`%${asset_name}%`);
      paramIndex++;
    }

    if (start_date && end_date) {
      whereClause += ` AND t.transfer_date >= $${paramIndex} AND t.transfer_date <= $${paramIndex + 1}`;
      params.push(start_date as string, end_date as string);
      paramIndex += 2;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM transfers t ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const transfersQuery = `
      SELECT 
        t.*,
        bf.name as from_base_name,
        bt.name as to_base_name,
        u.first_name,
        u.last_name
      FROM transfers t
      LEFT JOIN bases bf ON t.from_base_id = bf.id
      LEFT JOIN bases bt ON t.to_base_id = bt.id
      LEFT JOIN users u ON t.created_by = u.id
      ${whereClause}
      ORDER BY t.transfer_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), offset);
    
    const transfersResult = await query(transfersQuery, params);
    const transfers = transfersResult.rows;

    // Transform data to match expected format
    const transformedTransfers = transfers.map((t: any) => ({
      ...t,
      from_base_name: t.from_base_name,
      to_base_name: t.to_base_name,
      first_name: t.first_name,
      last_name: t.last_name
    }));

    res.json({
      success: true,
      data: transformedTransfers,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        totalPages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    logger.error('Get transfers error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @route   POST /api/transfers
// @desc    Create new transfer request
// @access  Private (Admin, Base Commander)
router.post('/', authenticate, authorize('admin', 'base_commander'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from_base_id, to_base_id, asset_name, quantity, transfer_date, notes } = req.body;
    logger.info('Received transfer data:', { from_base_id, to_base_id, asset_name, quantity, transfer_date, notes });
    
    if (!from_base_id || !to_base_id || !asset_name || quantity === undefined || quantity === null) {
      return res.status(400).json({ success: false, error: 'From base ID, to base ID, asset name, and quantity are required' });
    }
    
    const parsedQuantity = parseInt(quantity);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ success: false, error: 'Quantity must be a valid positive integer' });
    }
    
    if (req.user!.role === 'base_commander') {
      if (from_base_id !== req.user!.base_id && to_base_id !== req.user!.base_id) {
        return res.status(403).json({ success: false, error: 'Base commanders can only create transfers involving their base' });
      }
    }
    
    // Check if bases exist
    const basesResult = await query('SELECT id FROM bases WHERE id IN ($1, $2)', [from_base_id, to_base_id]);
    if (basesResult.rows.length !== 2) {
      return res.status(400).json({ success: false, error: 'Invalid base IDs' });
    }
    
    // Check if source base has sufficient available quantity
    const sourceAssetResult = await query(
      'SELECT * FROM assets WHERE name = $1 AND base_id = $2',
      [asset_name, from_base_id]
    );
    
    if (sourceAssetResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Source base does not have this asset in inventory' });
    }
    
    const sourceAsset = sourceAssetResult.rows[0];
    if (sourceAsset.available_quantity < parsedQuantity) {
      return res.status(400).json({ success: false, error: `Insufficient available quantity. Available: ${sourceAsset.available_quantity}, Requested: ${parsedQuantity}` });
    }
    
    const status = 'pending';
    const transferNumber = `TRF-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    const newTransferResult = await query(`
      INSERT INTO transfers (transfer_number, from_base_id, to_base_id, asset_name, quantity, transfer_date, status, approved_by, approved_at, created_by, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [transferNumber, from_base_id, to_base_id, asset_name, parsedQuantity, transfer_date ? new Date(transfer_date) : new Date(), status, null, null, req.user!.user_id, notes || null]);

    const newTransfer = newTransferResult.rows[0];
    
    logger.info({ 
      action: 'TRANSFER_REQUESTED', 
      user_id: req.user!.user_id, 
      user_role: req.user!.role, 
      transfer_id: newTransfer.id, 
      transfer_number: newTransfer.transfer_number, 
      from_base_id, 
      to_base_id, 
      asset_name, 
      quantity: parsedQuantity, 
      status 
    });
    
    return res.status(201).json({ success: true, data: newTransfer });
  } catch (error) {
    logger.error('Create transfer error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @route   PUT /api/transfers/:id/approve
// @desc    Approve transfer request
// @access  Private (Admin only)
router.put('/:id/approve', authenticate, authorize('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Transfer ID is required' });
    
    console.log('Approving transfer with ID:', id);
    
    const transferResult = await query('SELECT * FROM transfers WHERE id = $1', [id]);
    if (transferResult.rows.length === 0) return res.status(404).json({ success: false, error: 'Transfer not found' });
    
    const transfer = transferResult.rows[0];
    console.log('Transfer found:', transfer);
    
    if (transfer.status === 'approved') return res.status(400).json({ success: false, error: 'Transfer is already approved' });
    if (transfer.status === 'rejected') return res.status(400).json({ success: false, error: 'Cannot approve a rejected transfer' });
    
    // Check if source base still has sufficient available quantity
    const sourceAssetResult = await query(
      'SELECT * FROM assets WHERE name = $1 AND base_id = $2',
      [transfer.asset_name, transfer.from_base_id]
    );
    
    if (sourceAssetResult.rows.length === 0) return res.status(400).json({ success: false, error: 'Source base no longer has this asset in inventory' });
    
    const sourceAsset = sourceAssetResult.rows[0];
    console.log('Source asset for validation:', sourceAsset);
    
    if (sourceAsset.available_quantity < transfer.quantity) return res.status(400).json({ success: false, error: `Insufficient available quantity. Available: ${sourceAsset.available_quantity}, Requested: ${transfer.quantity}` });
    
    // Approve transfer without transaction for now
    const approvedTransferResult = await query(`
      UPDATE transfers 
      SET status = $1, approved_by = $2, approved_at = $3
      WHERE id = $4
      RETURNING *
    `, ['approved', req.user!.user_id, new Date(), id]);

    const approvedTransfer = approvedTransferResult.rows[0];
    console.log('Transfer approved:', approvedTransfer);
    
    // Execute the transfer
    console.log('Executing transfer...');
    await executeTransfer(approvedTransfer);
    
    console.log('Transfer executed successfully');
    
    logger.info({ 
      action: 'TRANSFER_APPROVED', 
      user_id: req.user!.user_id, 
      transfer_id: id, 
      transfer_number: transfer.transfer_number, 
      asset_name: transfer.asset_name, 
      quantity: transfer.quantity 
    });
    
    return res.json({ success: true, data: approvedTransfer });
  } catch (error) {
    console.error('Approve transfer error:', error);
    logger.error('Approve transfer error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @route   PUT /api/transfers/:id/reject
// @desc    Reject transfer request
// @access  Private (Admin only)
router.put('/:id/reject', authenticate, authorize('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'Transfer ID is required' });
    
    const transferResult = await query('SELECT * FROM transfers WHERE id = $1', [id]);
    if (transferResult.rows.length === 0) return res.status(404).json({ success: false, error: 'Transfer not found' });
    
    const transfer = transferResult.rows[0];
    if (transfer.status === 'rejected') return res.status(400).json({ success: false, error: 'Transfer is already rejected' });
    if (transfer.status === 'approved') return res.status(400).json({ success: false, error: 'Cannot reject an approved transfer' });
    
    const rejectedTransferResult = await query(`
      UPDATE transfers 
      SET status = $1, notes = $2
      WHERE id = $3
      RETURNING *
    `, ['rejected', notes || transfer.notes, id]);

    const rejectedTransfer = rejectedTransferResult.rows[0];
    
    logger.info({ 
      action: 'TRANSFER_REJECTED', 
      user_id: req.user!.user_id, 
      transfer_id: id, 
      transfer_number: transfer.transfer_number, 
      notes 
    });
    
    return res.json({ success: true, data: rejectedTransfer });
  } catch (error) {
    logger.error('Reject transfer error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @route   DELETE /api/transfers/:id
// @desc    Delete transfer
// @access  Private (Admin, Base Commander)
router.delete('/:id', authenticate, authorize('admin', 'base_commander'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Transfer ID is required' });
    
    const transferResult = await query('SELECT * FROM transfers WHERE id = $1', [id]);
    if (transferResult.rows.length === 0) return res.status(404).json({ success: false, error: 'Transfer not found' });
    
    const transfer = transferResult.rows[0];
    if (req.user!.role === 'base_commander') {
      if (transfer.status === 'approved') {
        return res.status(400).json({ success: false, error: 'Cannot delete an approved transfer' });
      }
      if (transfer.from_base_id !== req.user!.base_id && transfer.to_base_id !== req.user!.base_id) {
        return res.status(403).json({ success: false, error: 'Base commanders can only delete transfers involving their base' });
      }
    }
    
    // Delete transfer
    await query('DELETE FROM transfers WHERE id = $1', [id]);
    
    logger.info({ 
      action: 'TRANSFER_DELETED', 
      user_id: req.user!.user_id, 
      transfer_id: id, 
      transfer_number: transfer.transfer_number 
    });
    
    return res.json({ success: true, message: 'Transfer deleted successfully' });
  } catch (error) {
    logger.error('Delete transfer error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Helper function to execute transfer
async function executeTransfer(transfer: { id: string; from_base_id: string; to_base_id: string; asset_name: string; quantity: number; transfer_number: string; }) {
  try {
    console.log('Executing transfer:', transfer);
    
    // Reduce quantity from source base
    const sourceAssetResult = await query(
      'SELECT * FROM assets WHERE name = $1 AND base_id = $2',
      [transfer.asset_name, transfer.from_base_id]
    );
    
    if (sourceAssetResult.rows.length === 0) {
      throw new Error(`Source asset not found: ${transfer.asset_name} at base ${transfer.from_base_id}`);
    }
    
    const sourceAsset = sourceAssetResult.rows[0];
    console.log('Source asset:', sourceAsset);
    
    const newSourceQuantity = sourceAsset.quantity - transfer.quantity;
    const newSourceAvailableQuantity = sourceAsset.available_quantity - transfer.quantity;
    
    console.log('Source asset calculations:', {
      currentQuantity: sourceAsset.quantity,
      currentAvailable: sourceAsset.available_quantity,
      transferQuantity: transfer.quantity,
      newQuantity: newSourceQuantity,
      newAvailable: newSourceAvailableQuantity
    });
    
    // Update source asset status
    let newSourceStatus = 'available';
    if (newSourceQuantity === 0) {
      newSourceStatus = 'out_of_stock';
    } else if (newSourceAvailableQuantity === 0) {
      newSourceStatus = 'low_stock';
    }
    
    await query(`
      UPDATE assets 
      SET quantity = $1, available_quantity = $2, status = $3
      WHERE id = $4
    `, [newSourceQuantity, newSourceAvailableQuantity, newSourceStatus, sourceAsset.id]);
    
    console.log('Source asset updated successfully');
    
    // Add quantity to destination base
    const destAssetResult = await query(
      'SELECT * FROM assets WHERE name = $1 AND base_id = $2',
      [transfer.asset_name, transfer.to_base_id]
    );
    
    if (destAssetResult.rows.length > 0) {
      // Update existing asset
      const destAsset = destAssetResult.rows[0];
      console.log('Destination asset (existing):', destAsset);
      
      const newDestQuantity = destAsset.quantity + transfer.quantity;
      const newDestAvailableQuantity = destAsset.available_quantity + transfer.quantity;
      
      // Update destination asset status
      let newDestStatus = 'available';
      if (newDestAvailableQuantity === 0) {
        newDestStatus = 'low_stock';
      }
      
      await query(`
        UPDATE assets 
        SET quantity = $1, available_quantity = $2, status = $3
        WHERE id = $4
      `, [newDestQuantity, newDestAvailableQuantity, newDestStatus, destAsset.id]);
      
      console.log('Destination asset updated successfully');
    } else {
      // Create new asset entry
      console.log('Creating new destination asset');
      
      await query(`
        INSERT INTO assets (name, base_id, quantity, available_quantity, assigned_quantity, status)
        VALUES ($1, $2, $3, $3, 0, 'available')
      `, [transfer.asset_name, transfer.to_base_id, transfer.quantity]);
      
      console.log('New destination asset created successfully');
    }
    
    logger.info({
      action: 'TRANSFER_EXECUTED',
      transfer_id: transfer.id,
      transfer_number: transfer.transfer_number,
      asset_name: transfer.asset_name,
      quantity: transfer.quantity,
      from_base_id: transfer.from_base_id,
      to_base_id: transfer.to_base_id
    });
  } catch (error) {
    console.error('Error in executeTransfer:', error);
    logger.error('Error executing transfer:', error);
    throw error;
  }
}

export default router; 