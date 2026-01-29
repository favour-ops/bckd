const {
    db, crypto, logger, cleanMe,
    Business, BizWebhook
} = require('./_dependencies');

const ALLOWED_EVENTS = [
    'transaction.created',
    'transaction.updated',
    'invoice.paid',
    'payout.successful',
    'payout.failed'
];

const addBusinessWebhook = async (req, res, next) => {
    try {
        const { bizid, url, events } = req.body;        
        if (!bizid || !url || !events) {
            return res.status(400).json({ status: false, message: 'URL, and events are required.' });
        }

        //get business with uuid
        const business = await Business.findOne({ where: { uuid: bizid },
            attributes: ['id'],
        });
        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id; // Use the internal ID
    
        // Validate URL format
        try {
            new URL(url);
        } catch (_) {
            return res.status(400).json({ status: false, message: 'Invalid webhook URL format.' });
        }

        // Validate events
        if (!Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ status: false, message: 'Events must be a non-empty array.' });
        }
        const invalidEvents = events.filter(event => !ALLOWED_EVENTS.includes(event));
        if (invalidEvents.length > 0) {
            return res.status(400).json({ status: false, message: `Invalid event(s): ${invalidEvents.join(', ')}.` });
        }

        // --- 2. Check for existing webhook for the same URL and environment ---
        const env = process.env.APPENV === 'production' ? 'live' : 'test';
        const existingWebhook = await BizWebhook.findOne({ where: { bizid: busid, url, env } });

        if (existingWebhook) {
            return res.status(409).json({ status: false, message: `A webhook for this URL already exists in the ${env} environment.` });
        }

        // --- 3. Create Webhook ---
        const secret = 'whsec_' + crypto.randomBytes(24).toString('hex');
        const timed = Math.floor(Date.now() / 1000);

        const newWebhook = await BizWebhook.create({
            bizid: busid,
            url,
            secret,
            events,
            env,
            status: 'active',
            timed
        });

        // --- 4. Respond ---
        // Return the full object on creation, but only show the secret once.
        res.status(201).json({
            status: true,
            message: 'Webhook created successfully. Please store your secret securely, it will not be shown again.',
            data: {
                id: newWebhook.id,
                url: newWebhook.url,
                secret: newWebhook.secret, // Show only on creation
                events: newWebhook.events,
                env: newWebhook.env,
                status: newWebhook.status
            }
        });

    } catch (error) {
        logger.error('Error in addBusinessWebhook:', error);
        next(error);
    }
};

const listBusinessWebhooks = async (req, res, next) => {
    try {
        const { uuid } = req.params;

        if (!uuid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const business = await Business.findOne({ where: { uuid: uuid },
            attributes: ['id'],
        });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id;

        const webhooks = await BizWebhook.findAll({
            where: { bizid: busid },
            attributes: { exclude: ['secret'] }, // Exclude the secret for security
            order: [['id', 'DESC']]
        });

        //format the timed field to readable date e.g 12/5/2025 02:34:23 am
        // format the timed field to readable date
        webhooks.forEach(wh => {
            const date = new Date(wh.timed * 1000);
            wh.dataValues.created_at = date.toISOString();
        });

        // Exclude the 'secret' field from the response for security
        const formattedWebhooks = webhooks.map(wh => {
            const { secret, ...rest } = wh.dataValues;
            return rest;
        });

        if (!webhooks || webhooks.length === 0) {
            return res.status(200).json({ status: true, message: 'No webhooks configured for this business yet.', data: [] });
        }

        res.status(200).json({
            status: true,
            message: 'Webhooks retrieved successfully.',
            data: formattedWebhooks
        });

    } catch (error) {
        logger.error('Error in listBusinessWebhooks:', error);
        next(error);
    }
};

const updateBusinessWebhook = async (req, res, next) => {
    try {
        const { bizid, webhookid, url, events, status } = req.body;

        if (!bizid || !webhookid) {
            return res.status(400).json({ status: false, message: 'Business ID and Webhook ID are required.' });
        }

        const business = await Business.findOne({ where: { uuid: bizid },
            attributes: ['id'],
        });
        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id; // Use the internal ID
        

        if (!url && !events && !status) {
            return res.status(400).json({ status: false, message: 'At least one field (url, events, or status) must be provided for update.' });
        }

        if (url) {
            try {
                new URL(url);
            } catch (_) {
                return res.status(400).json({ status: false, message: 'Invalid webhook URL format.' });
            }
        }

        if (events) {
            if (!Array.isArray(events) || events.length === 0) {
                return res.status(400).json({ status: false, message: 'Events must be a non-empty array.' });
            }
            const invalidEvents = events.filter(event => !ALLOWED_EVENTS.includes(event));
            if (invalidEvents.length > 0) {
                return res.status(400).json({ status: false, message: `Invalid event(s): ${invalidEvents.join(', ')}.` });
            }
        }

        if (status && !['active', 'disabled'].includes(status)) {
            return res.status(400).json({ status: false, message: 'Invalid status. Must be "active" or "disabled".' });
        }

        // --- 2. Find and Update Webhook ---
        const webhook = await BizWebhook.findOne({ where: { id: webhookid, bizid: busid } });

        if (!webhook) {
            return res.status(404).json({ status: false, message: 'Webhook not found for this business.' });
        }

        const updateFields = {};
        if (url) updateFields.url = url;
        if (events) updateFields.events = events;
        if (status) updateFields.status = status;

        await webhook.update(updateFields);
        // --- 3. Respond ---
        res.status(200).json({
            status: true,
            message: 'Webhook updated successfully.',
            data: {
                id: webhook.id,
                url: webhook.url,
                events: webhook.events,
                env: webhook.env,
                status: webhook.status
            }
        });

    } catch (error) {
        logger.error('Error in updateBusinessWebhook:', error);
        next(error);
    }
};

const deleteBusinessWebhook = async (req, res, next) => {
    try {
        const { bizid, webhookid } = req.body;
 
        if (!bizid || !webhookid) {
            return res.status(400).json({ status: false, message: 'Business ID and Webhook ID are required.' });
        }
 
        //get business with uuid
        const business = await Business.findOne({ where: { uuid: bizid },
            attributes: ['id'],
        });
        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }
 
        const busid = business.id;
 
        const webhook = await BizWebhook.findOne({ where: { id: webhookid, bizid: busid } });
 
        if (!webhook) {
            return res.status(404).json({ status: false, message: 'Webhook not found for this business.' });
        }
 
        await webhook.destroy();
 
        return res.status(200).json({
            status: true,
            message: 'Webhook deleted successfully.'
        });
 
    } catch (error) {
        logger.error('Error in deleteBusinessWebhook:', error);
        next(error);
    }
};

//webhook logs for a given business uuid
const listBusinessWebhookLogs = async (req, res, next) => {
    try {
        const { uuid } = req.params;
        const { webhookId, event, status, page = 1, limit = 200 } = req.query;

        if (!uuid) {
            return res.status(400).json({ status: false, message: 'Invalid request.' });
        }

        const business = await Business.findOne({ where: { uuid: uuid }, attributes: ['id'] });
        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id;
        const offset = (page - 1) * limit;

        const whereClause = { bizid: busid };
        if (webhookId) whereClause.webhookId = webhookId;
        if (event) whereClause.event = event;
        if (status) whereClause.status = status;

        const { count, rows: logs } = await db.bizwebhook_logs.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['timed', 'DESC']]
        });

        // Format the timed field to readable date
        logs.forEach(log => {
            if (log.timed) {
                const date = new Date(log.timed);
                log.dataValues.created_at = date.toISOString();
            }
            // Attempt to parse payload and response_body if they are JSON strings
            try {
                if (log.payload && typeof log.payload === 'string') {
                    log.dataValues.payload = JSON.parse(log.payload);
                }
            } catch (e) {
                logger.warn(`Could not parse payload for log ID ${log.id}: ${e.message}`);
            }
            try {
                if (log.response_body && typeof log.response_body === 'string') {
                    log.dataValues.response_body = JSON.parse(log.response_body);
                }
            } catch (e) {
                logger.warn(`Could not parse response_body for log ID ${log.id}: ${e.message}`);
            }
        });

        res.status(200).json({
            status: true,
            message: 'Webhook logs retrieved successfully.',
            data: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                logs: logs
            }
        });

    } catch (error) {
        logger.error('Error in listBusinessWebhookLogs:', error);
        next(error);
    }
};

const resendWebhook = async (req, res, next) => {
    try {
        const { bizid, logId } = req.body;

        if (!bizid || !logId) {
            return res.status(400).json({ status: false, message: 'Business ID and Log ID are required.' });
        }

        const business = await Business.findOne({ where: { uuid: bizid }, attributes: ['id'] });
        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id;

        const webhookLog = await db.bizwebhook_logs.findOne({ where: { id: logId, bizid: busid } });

        if (!webhookLog) {
            return res.status(404).json({ status: false, message: 'Webhook log not found for this business.' });
        }

        // Retrieve the original webhook details
        const webhook = await BizWebhook.findOne({ where: { bizid: busid, events: { [db.Sequelize.Op.contains]: [webhookLog.event] }, status: 'active' } });

        if (!webhook) {
            return res.status(404).json({ status: false, message: 'Active webhook configuration not found for this event.' });
        }

        // Reconstruct payload and signature
        const payload = webhookLog.payload; // Assuming payload is stored as a string or can be directly used
        const signature = generateWebhookSignature(payload, webhook.secret);

        // Increment attempt count and update status to pending for retry mechanism
        const newAttempt = webhookLog.attempt + 1;
        await webhookLog.update({ attempt: newAttempt, status: 'pending', timed: Math.floor(Date.now() / 1000) });

        // Send the webhook again
        // (Implementation of actual sending logic is assumed to be handled elsewhere, e.g., in a job queue)
        // For immediate resend, we can directly call the sendWebhook helper
        const { sendWebhook } = require('../../config/sendWebhookHelper');
        const resendResult = await sendWebhook({
            bizid: webhookLog.bizid,
            event: webhookLog.event,
            payreference: webhookLog.reference,
            data: JSON.parse(webhookLog.payload) // Assuming payload is a JSON string
        });

        if (resendResult.success) {
            // Update log with success
            await webhookLog.update({
                status: 'success',
                response_code: resendResult.statusCode.toString(),
                response_body: JSON.stringify(resendResult.response),
                http_status: resendResult.statusCode,
                timed: Math.floor(Date.now() / 1000)
            });
            res.status(200).json({ status: true, message: 'Webhook resent successfully.', data: resendResult });
        } else {
            // Update log with failure (but keep status as 'pending' if retries are still possible)
            await webhookLog.update({
                status: newAttempt >= MAX_ATTEMPTS ? 'failure' : 'pending', // Assuming MAX_ATTEMPTS is defined or imported
                response_code: resendResult.statusCode?.toString() || 'CLIENT_ERROR',
                response_body: resendResult.error,
                http_status: resendResult.statusCode || null,
                timed: Math.floor(Date.now() / 1000)
            });
            res.status(500).json({ status: false, message: 'Failed to resend webhook.', error: resendResult.error });
        }

    } catch (error) {
        logger.error('Error in resendWebhook:', error);
        next(error);
    }
};

module.exports = { 
    addBusinessWebhook, listBusinessWebhooks, 
    updateBusinessWebhook, deleteBusinessWebhook, listBusinessWebhookLogs, resendWebhook 
};