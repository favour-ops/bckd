const jwt = require('jsonwebtoken');
const { db, BizTeam, Customer } = require('../controllers/businessControllers/_dependencies');
const {logger} = require('../config/logger');
// const { logger } = require('../../config/logger');

const rolePermissions = {
    owner: {
        description: 'Full administrative control over the business, including all team management, financial operations, and settings.',
        permissions: ['*']
    },
    admin: {
        description: 'Manages team members, views business details, and has access to wallets.',
        permissions: [
            'team:add',
            'team:view',
            'team:manage_status',
            'transactions:view',
            'wallets:view',
            'wallets:withdraw',
            'paylinks:manage',
            'team:remove',
            'team:manage_invites',
            'wallets:view',
            'reports:view',
            'payouts:initiate', 
            'debits:initiate',
            'apikeys:manage',
            'invoices:create',
            'invoices:view',
            'invoices:pay',
            'invoices:cancel',
            'invoices:refund',
            'transactions:view',
            'webhooks:manage',
            'team:update',

        ],
    },
    // auditor: {
    //     description: 'Has read-only access to team information, reports, and wallet balances for auditing purposes.',
    //     permissions: ['team:view', 'reports:view', 'wallets:view', 'transactions:view']
    // },
    finance: {
        description: 'Manages financial transactions, initiates payouts, and views wallet balances.',
        permissions: ['team:view', 'transactions:view', 'payouts:initiate', 'wallets:view', 'wallets:withdraw', 'paylinks:manage', 'debits:initiate']
    },
    developer: {
        description: 'Manages API keys and integrations for the business.',
        permissions: ['apikeys:manage', 'paylinks:manage', 'transactions:view', 'webhooks:manage']
    },
    cashier: {
        description: 'Creates invoices and views transaction history.',
        permissions: ['invoices:create', 'transactions:view', 'paylinks:manage']
    }
};

const businessAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ status: false, message: 'Authentication token is required.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Token must contain user ID and business ID
        if (!decoded.id || !decoded.bizid) {
            return res.status(401).json({ status: false, message: 'Invalid token: Missing required claims.' });
        }

        // Verify that the user is an active member of the business in the token
        const teamMembership = await BizTeam.findOne({
            where: {
                customerid: decoded.id,
                bizid: decoded.bizid,
                status: 1 // Ensure the user is an active member
            }
        });

        if (!teamMembership) {
            return res.status(403).json({ status: false, message: 'Access Denied: You are not an active member of this business.' });
        }

        // Attach user and business info to the request object
        req.user = { id: decoded.id, email: decoded.email };
        req.business = { id: decoded.bizid, role: teamMembership.role };

        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({ status: false, message: 'Session expired. Please log in again.' });
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ status: false, message: 'Invalid token. Please log in again.' });
        }
        logger.error('Error in businessAuth middleware:', error);
        return res.status(500).json({ status: false, message: 'Internal server error during authentication.' });
    }
};

/**
 * Middleware to check if a team member has the required permission for a business action.
 * @param {string} requiredPermission - The permission string required for the action (e.g., 'team:add').
 */

const checkBusinessPermission = (requiredPermission) => async (req, res, next) => {
    try {
        
        if (!req.user || !req.business) {
            logger.warn('checkBusinessPermission was called without businessAuth running first.');
            return res.status(401).json({ status: false, message: 'Authentication context is missing.' });
        }

        const userRole = req.business.role; // e.g., 'admin'
        const permissions = rolePermissions[userRole]?.permissions || [];

        // Check for permission
        if (permissions.includes('*') || permissions.includes(requiredPermission)) {
            return next(); // User has permission, proceed to the controller.
        }

        // Deny access if permission is not found
        return res.status(403).json({ status: false, message: 'Access Denied: You do not have the required permissions for this action.' });

    } catch (error) {
        console.log('Error in checkBusinessPermission:', error);
        return res.status(500).json({ status: false, message: 'Something went wrong. Kindly try again.' });
    }
};

module.exports = { checkBusinessPermission, rolePermissions, businessAuth };
