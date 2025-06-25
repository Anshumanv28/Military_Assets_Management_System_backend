import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('first_name').notEmpty().trim(),
  body('last_name').notEmpty().trim(),
  body('role').isIn(['admin', 'base_commander', 'logistics_officer']),
  body('base_id').optional().isUUID()
], async (req: Request, res: Response): Promise<void> => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: errors.array()[0]?.msg || 'Validation error'
      });
      return;
    }

    const { email, password, first_name, last_name, role, base_id } = req.body;

    // Check if user already exists
    const existingUser = await prisma.users.findUnique({
      where: { email }
    });

    if (existingUser) {
      res.status(400).json({
        success: false,
        error: 'User already exists'
      });
      return;
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = await prisma.users.create({
      data: {
        email,
        password_hash: hashedPassword,
        first_name,
        last_name,
        role,
        ...(base_id && { base_id })
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        base_id: true
      }
    });

    // Generate JWT token
    const token = jwt.sign(
      { user_id: user.id },
      process.env['JWT_SECRET']!
    );

    // Generate refresh token
    const refreshToken = jwt.sign(
      { user_id: user.id },
      process.env['JWT_SECRET']!
    );

    // Log user registration
    logger.info({
      action: 'USER_REGISTERED',
      user_id: user.id,
      email: user.email,
      role: user.role
    });

    res.status(201).json({
      success: true,
      data: {
        user,
        token,
        refreshToken
      }
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req: Request, res: Response): Promise<void> => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMsg = errors.array()[0]?.msg || 'Validation error';
      logger.warn('Login validation failed', { email: req.body.email, error: errorMsg, ip: req.ip });
      res.status(400).json({
        success: false,
        error: errorMsg
      });
      return;
    }

    const { email, password } = req.body;

    // Find user
    const user = await prisma.users.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password_hash: true,
        first_name: true,
        last_name: true,
        role: true,
        base_id: true
      }
    });

    if (!user) {
      logger.warn('Login attempt failed for non-existent user', { email, ip: req.ip });
      res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
      return;
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      logger.warn('Invalid password attempt', { email: user.email, user_id: user.id, ip: req.ip });
      res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
      return;
    }

    // Generate JWT token
    const token = jwt.sign(
      { user_id: user.id },
      process.env['JWT_SECRET']!
    );

    // Generate refresh token
    const refreshToken = jwt.sign(
      { user_id: user.id },
      process.env['JWT_SECRET']!
    );

    // Log user login
    logger.info({
      action: 'USER_LOGIN',
      user_id: user.id,
      email: user.email
    });

    // Remove password_hash from response
    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      success: true,
      data: {
        user: userWithoutPassword,
        token,
        refreshToken
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   GET /api/auth/profile
// @desc    Get user profile
// @access  Private
router.get('/profile', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await prisma.users.findUnique({
      where: { id: req.user!.user_id },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        base_id: true,
        created_at: true
      }
    });

    if (!result) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @route   POST /api/auth/refresh
// @desc    Refresh access token
// @access  Public
router.post('/refresh', [
  body('refreshToken').notEmpty()
], async (req: Request, res: Response): Promise<void> => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: errors.array()[0]?.msg || 'Validation error'
      });
      return;
    }

    const { refreshToken } = req.body;

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env['JWT_SECRET']!) as { user_id: string };

    // Check if user exists
    const result = await prisma.users.findUnique({
      where: { id: decoded.user_id },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        base_id: true
      }
    });

    if (!result) {
      res.status(401).json({
        success: false,
        error: 'Invalid refresh token'
      });
      return;
    }

    const user = result;

    // Generate new access token
    const newToken = jwt.sign(
      { user_id: user.id },
      process.env['JWT_SECRET']!
    );

    res.json({
      success: true,
      data: {
        token: newToken,
        user
      }
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token'
    });
  }
});

export default router; 