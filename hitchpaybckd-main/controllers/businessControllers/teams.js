//========================IMPORT DEPENDENCIES======================
const { db, uuidv4, moment, bcrypt, mailSender, notifyMe, pushNotify, cleanMe, ucFirst, logger, Customer, Business, BizTeam, BizInvites, Op} = require('./_dependencies');
const { rolePermissions } = require('../../auth/businessAuth');



const addTeamMember = async (req, res) => {
    const t = await db.sequelize.transaction();
    
    try {
        const ownerId = req.user.id; 
        const { bizid, member_email, member_name, member_phone, role, staffdefaultpin } = req.body;

        // --- 1. Input Validation ---
        if (!bizid || !member_email || !role || !member_name) {
            await t.rollback();
            return res.status(400).json({ status: false, message: 'Team name, team email, role, and your PIN are required.' });
        }

        // --- 2. Authenticate Owner and Verify Ownership ---
        const business = await Business.findOne({
            where: {uuid: bizid, ownerid: ownerId } 
        });

        if (!business) {
            await t.rollback();
            return res.status(403).json({ status: false, message: "You are not the owner of this business or it doesn't exist." });
        }

        // --- 3. Find the User to be Added ---
        const member = await Customer.findOne({ where: { email: member_email } });

        if (!member) {
            // --- User Not Found: Create and Send an Invitation ---
            const existingInvite = await BizInvites.findOne({ where: { email: member_email, business_id: business.id } });
            if (existingInvite) {
                await t.rollback();
                return res.status(409).json({ status: false, message: `An invitation has already been sent to ${member_email} for this business.` });
            }

            const dtimed = Math.floor(Date.now() / 1000);
            const staffId = `STF${business.id}${uuidv4().slice(0, 8)}`;
            const hashedPin = staffdefaultpin ? bcrypt.hashSync(staffdefaultpin, 12) : null;

            await BizInvites.create({
                business_id: business.id,
                name: member_name,
                email: member_email,
                phoneno: member_phone || null,
                assignrole: role.toLowerCase(),
                staffid: staffId,
                staffpin: '0000',
                status: 0,
                timed: dtimed,
            }, { transaction: t });

            await t.commit();

            // Send invitation email (outside transaction)
            const owner = await Customer.findByPk(ownerId);
            const inviterName = `${owner.firstname} ${owner.lastname}`;
            const emailTitle = `You're Invited to Join ${business.business_name} on HitchPay!`;
            const emailContent = `
                <p>Hello ${member_name},</p>
                <p>You have been invited by <strong>${inviterName}</strong> to join the <strong>${business.business_name}</strong> team on HitchPay as a ${ucFirst(role)}.</p>
                <p>Please <a href="https://apps.hitchpay.ng/T2JB/download">click here to sign up</a> and login to accept your invitation.</p>
                <p>If you have any questions, please contact the business owner.</p>`;
            await mailSender(member_name, emailTitle, member_email, emailContent);

            return res.status(200).json({ status: true, message: `Invitation sent successfully to ${member_email}.` });
        }

        if (member.id === ownerId) {
            await t.rollback();
            return res.status(400).json({ status: false, message: 'You cannot add yourself as a team member.' });
        }

        // --- 4. Check if User is Already a Team Member ---
        const existingTeamMember = await BizTeam.findOne({
            where: { bizid: business.id, customerid: member.id }
        });

        if (existingTeamMember) {
            await t.rollback();
            return res.status(409).json({ status: false, message: 'This user is already a member of this business team.' });
        }

        // --- 5. Add to Team within a Transaction ---
        const dtimed = Math.floor(Date.now() / 1000);
        const staffId = `STF${business.id}${member.id}`; // Create a unique staff ID
        const hashedPin = staffdefaultpin ? bcrypt.hashSync(staffdefaultpin, 12) : null;

        const newTeamMember = await BizTeam.create({
            bizid: business.id,
            customerid: member.id,
            role: role.toLowerCase(),
            staffid: staffId,
            staffpin: '0000', // Staff member should set their own PIN later
            status: 1, // Active
            timed: dtimed
        }, { transaction: t });

        await t.commit();

        // --- 6. Send Notifications (outside the transaction) ---
        const notificationTitle = 'You\'ve been added to a Business Team!';
        const notificationMessage = `You have been added to the "${business.business_name}" team as a ${role}. You can now access business functions based on your assigned role.`;

        await notifyMe(member.id, notificationTitle, 'user', notificationMessage);
        await pushNotify(member.id, notificationTitle, notificationMessage);

        const emailContent = `
            <p>Hello ${member.firstname},</p>
            <p>Great news! You have been added to the <strong>${business.business_name}</strong> team on HitchPay with the role of <strong>${ucFirst(role)}</strong>.</p>
            <p>You can now log in to your HitchPay account to access the business dashboard and perform tasks based on your new permissions.</p>
            <p>If you have any questions, please contact the business owner.</p>
        `;
        await mailSender(member.firstname, notificationTitle, member.email, emailContent);

        return res.status(201).json({
            status: true,
            message: `${member.firstname} ${member.lastname} has been successfully added to the team.`,
            data: {
                teamMemberId: newTeamMember.id,
                staffId: newTeamMember.staffid,
                role: newTeamMember.role
            }
        });

    } catch (error) {
        if (t && !t.finished) {
            await t.rollback();
        }
        logger.error('Error in addTeam Member:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};

const getTeamMembers = async (req, res) => {
    try {
        const { bizid } = req.params;
        const ownerId = req.user.id;

        if (!bizid) {
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });
        }

        // Find the business by its UUID to get its internal ID
         const business = await Business.findOne({
            where: { [Op.or]: [{ id: bizid }, { uuid: bizid }]} ,
            attributes: ['id']
        });
    
        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized access.' });
        }

        // 2. Fetch active team members and pending invites in parallel.
        const [team, invites] = await Promise.all([
            BizTeam.findAll({
                where: { bizid: business.id },
                include: [{
                    model: Customer,
                    as: 'customer',
                    attributes: ['firstname', 'lastname', 'email', 'photo']
                }],
                order: [['id', 'DESC']]
            }),
            BizInvites.findAll({
                where: { business_id: business.id, status: 0 }, // 0 = pending
                order: [['id', 'DESC']]
            })
        ]);

        // 3. Format the results for a clean API response.
        const formattedTeam = team.map(member => ({
            id: member.id,
            type: 'member',
            name: `${member.customer.firstname} ${member.customer.lastname}`,
            email: member.customer.email,
            photo: member.customer.photo,
            role: member.role,
            staff_id: member.staffid,
            status: member.status === 1 ? 'active' : 'inactive',
            joined_at: moment.unix(member.timed).format("Do MMM, YYYY")
        }));

        const formattedInvites = invites.map(invite => ({
            id: invite.id,
            type: 'invite',
            name: invite.name,
            email: invite.email,
            role: invite.assignrole,
            status: 'pending',
            invited_at: moment.unix(invite.timed).format("Do MMM, YYYY")
        }));

        return res.status(200).json({ status: true, message: 'Team list retrieved successfully.', data: [...formattedTeam, ...formattedInvites] });

    } catch (error) {
        logger.error('Error in getTeamMembers:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};

const manageTeamMember = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const ownerId = req.user.id;
        const { bizid, memberId, action, transpin } = cleanMe(req.body);

        // --- 1. Input Validation ---
        if (!bizid || !memberId || !action || !transpin) {
            return res.status(400).json({ status: false, message: 'Business ID, Member ID, action, and your PIN are required.' });
        }

        const validActions = ['suspend', 'activate', 'remove'];
        if (!validActions.includes(action)) {
            return res.status(400).json({ status: false, message: 'Invalid action. Must be one of: suspend, activate, remove.' });
        }

        // --- 2. Authenticate Owner and Verify Ownership ---
        const business = await Business.findOne({ where: { uuid: bizid, ownerid: ownerId } });
        if (!business) {
            return res.status(403).json({ status: false, message: "You are not the owner of this business or it doesn't exist." });
        }

        const busid = business.id;  //business ID

        const owner = await Customer.findByPk(ownerId);
        if (!owner || !bcrypt.compareSync(transpin, owner.authpin)) {
            return res.status(400).json({ status: false, message: 'Invalid transaction PIN.' });
        }

        // --- 3. Find the Team Member to Manage ---
        const teamMember = await BizTeam.findOne({ where: { id: memberId, bizid: busid }, transaction: t });
        if (!teamMember) {
            await t.rollback();
            return res.status(404).json({ status: false, message: 'Team member not found in this business.' });
        }

        if (teamMember.role === 'owner') {
            await t.rollback();
            return res.status(403).json({ status: false, message: 'You cannot manage your own owner role.' });
        }

        // --- 4. Perform the Action ---
        let successMessage = '';
        if (action === 'suspend') {
            teamMember.status = 0; // Inactive
            await teamMember.save({ transaction: t });
            successMessage = 'Team member has been suspended.';
        } else if (action === 'activate') {
            teamMember.status = 1; // Active
            await teamMember.save({ transaction: t });
            successMessage = 'Team member has been reactivated.';
        } else if (action === 'remove') {
            await teamMember.destroy({ transaction: t });
            successMessage = 'Team member has been removed from the business.';
        }

        await t.commit();

        // --- 5. Send Notification (Optional) ---
        // You can add email or push notifications here to inform the member of the status change.
        const memberCustomer = await Customer.findByPk(teamMember.customerid);
        if (memberCustomer) {
            const notificationTitle = `Your Team Membership Status Changed for ${business.business_name}`;
            let notificationMessage = '';
            if (action === 'suspend') {
                notificationMessage = `Your membership in the "${business.business_name}" team has been suspended by the owner. You will no longer be able to access business functions.`;
            } else if (action === 'activate') {
                notificationMessage = `Your membership in the "${business.business_name}" team has been reactivated by the owner. You can now access business functions.`;
            } else if (action === 'remove') {
                notificationMessage = `You have been removed from the "${business.business_name}" team by the owner.`;
            }

            await notifyMe(memberCustomer.id, notificationTitle, 'user', notificationMessage);
            await pushNotify(memberCustomer.id, notificationTitle, notificationMessage);
            await mailSender(memberCustomer.firstname, notificationTitle, memberCustomer.email, `<p>${notificationMessage}</p>`);
        }
        

        return res.status(200).json({ status: true, message: successMessage });

    } catch (error) {
        if (t && !t.finished) await t.rollback();
        logger.error('Error in manageTeamMember:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};

const listMemberOfBusinesses = async (req, res) => {
    try {
        const customerId = req.user.id;
        if (!customerId) {
            return res.status(400).json({ status: false, message: 'Authentication error. Please log in again.' });
        }

        // Find all team memberships for the current user
        const teamMemberships = await BizTeam.findAll({
            where: { customerid: customerId },
            include: [{
                model: Business,
                as: 'businessDetails',
                required: true 
            }, {
                model: Customer,
                as: 'customer',
                attributes: ['email', 'phoneno'],
                required: true
            }],
            order: [['id', 'DESC']]
        });

        if (teamMemberships.length === 0) {
            return res.status(200).json({ status: true, message: "You are not a member of any business team yet.", data: [] });
        }

        // Format the response to be more intuitive
        const businesses = teamMemberships.map(membership => {
            const { id, business_name, business_email, logo, status, isverified, uuid } = membership.businessDetails;
            return {
                id, uuid, business_name, business_email, logo, status, isverified,
                my_role: membership.role,
                my_status: membership.status === 1 ? 'active' : 'suspended',
                my_email: membership.customer.email,
                my_phone: membership.customer.phoneno
            };
        });

        return res.status(200).json({ status: true, message: 'Businesses retrieved successfully.', data: businesses });

    } catch (error) {
        logger.error('Error in listMemberOfBusinesses:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};

const getBusinessRolesAndPermissions = async (req, res) => {
    try {
        // Exclude the 'owner' role as it's a special, non-assignable role.
        const { owner, ...assignableRoles } = rolePermissions;

        const formattedRoles = Object.entries(assignableRoles).map(([role, { description, permissions }]) => ({
            role,
            description,
            permissions,
        }));

        return res.status(200).json({
            status: true,
            message: 'Available business roles and permissions retrieved successfully.',
            data: formattedRoles
        });
    } catch (error) {
        logger.error('Error in getBusinessRolesAndPermissions:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};

const manageTeamInvite = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const senderid = req.user.id;
        const { bizid, inviteId, action } = cleanMe(req.body);

        if (!bizid || !inviteId || !action) {
            return res.status(400).json({ status: false, message: 'Invite details required. Kindly reload the page' });
        }

        const validActions = ['resend', 'revoke'];
        if (!validActions.includes(action)) {
            return res.status(400).json({ status: false, message: 'Invalid action. Must be one of: resend, revoke.' });
        }

        const business = await Business.findOne({ where: { uuid: bizid} });
        if (!business) {
            return res.status(403).json({ status: false, message: "Unauthorized request." });
        }

        const owner = await Customer.findByPk(senderid);

        const busid = business.id;  //business ID

        // --- 3. Find the Pending Invitation ---
        const invite = await BizInvites.findOne({ where: { id: inviteId, business_id: busid, status: 0 }, transaction: t });
        if (!invite) {
            await t.rollback();
            return res.status(404).json({ status: false, message: 'Pending invitation not found for this business.' });
        }

        // --- 4. Perform the Action ---
        let successMessage = '';
        if (action === 'revoke') {
            await invite.destroy({ transaction: t });
            successMessage = 'Invitation has been successfully revoked.';
            await t.commit();
        } else if (action === 'resend') {
            await t.commit();

            const inviterName = `${owner.firstname} ${owner.lastname}`;
            const emailTitle = `Reminder: You're Invited to Join ${business.business_name} on HitchPay!`;
            const emailContent = `
                <p>Hello ${invite.name},</p>
                <p>This is a reminder that you have been invited by <strong>${inviterName}</strong> to join the <strong>${business.business_name}</strong> team on HitchPay as a ${ucFirst(invite.assignrole)}.</p>
                <p>Please <a href="https://apps.hitchpay.ng/T2JB/download">click here to download the app</a> and accept your invitation.</p>
                <p>If you have any questions, please contact the business owner.</p>`;
            await mailSender(invite.name, emailTitle, invite.email, emailContent);

            successMessage = 'Invitation has been resent successfully.';
        }

        return res.status(200).json({ status: true, message: successMessage });

    } catch (error) {
        if (t && !t.finished) await t.rollback();
        logger.error('Error in manageTeamInvite:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};

const updateTeamMemberRole = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const ownerId = req.user.id;
        const { bizid, memberId, role} = cleanMe(req.body);
        if (!bizid || !memberId || !role) {
            return res.status(400).json({ status: false, message: 'Unable to process request, kindly reload the page' });
        }

        const business = await Business.findOne({ where: { uuid: bizid} });
        if (!business) {
            return res.status(403).json({ status: false, message: "Unauthorized request." });
        }

        const busid = business.id;  //business ID

        const owner = await Customer.findByPk(ownerId);

        const { owner: _, ...assignableRoles } = rolePermissions; // Exclude owner role
        if (!Object.keys(assignableRoles).includes(role.toLowerCase())) {
            return res.status(400).json({ status: false, message: 'Invalid role specified. Cannot assign this role.' });
        }

        // --- 4. Find and Update the Team Member ---
        const teamMember = await BizTeam.findOne({ where: { id: memberId, bizid: busid }, transaction: t });
        if (!teamMember) {
            await t.rollback();
            return res.status(404).json({ status: false, message: 'Team member not found in this business.' });
        }

        if (teamMember.role === 'owner') {
            await t.rollback();
            return res.status(403).json({ status: false, message: 'The owner role cannot be changed.' });
        }

        teamMember.role = role.toLowerCase();
        await teamMember.save({ transaction: t });

        await t.commit();

        // --- 5. Send Notification ---
        const memberCustomer = await Customer.findByPk(teamMember.customerid);
        if (memberCustomer) {
            const notificationTitle = `Your Role Update for ${business.business_name}`;
            const notificationMessage = `Your role in the "${business.business_name}" team has been updated to ${ucFirst(role)} by the owner.`;
            await notifyMe(memberCustomer.id, notificationTitle, 'user', notificationMessage);
            await pushNotify(memberCustomer.id, notificationTitle, notificationMessage);
            await mailSender(memberCustomer.firstname, notificationTitle, memberCustomer.email, `<p>${notificationMessage}</p>`);
        }

        return res.status(200).json({ status: true, message: 'Team member role has been updated successfully.' });

    } catch (error) {
        if (t && !t.finished) await t.rollback();
        logger.error('Error in update TeamMemberRole:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};

const updateTeamMemberStatus = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const ownerId = req.user.id;
        const { bizid, memberId, status} = cleanMe(req.body);
        if (!bizid || !memberId || !status) {
            return res.status(400).json({ status: false, message: 'Unable to process request, kindly reload the page' });
        }

        const business = await Business.findOne({ where: { uuid: bizid} });
        if (!business) {
            return res.status(403).json({ status: false, message: "Unauthorized request." });
        }

        const busid = business.id;  //business ID
        const owner = await Customer.findByPk(ownerId);

        const teamMember = await BizTeam.findOne({ where: { id: memberId, bizid: busid }, transaction: t });
        if (!teamMember) {
            await t.rollback();
            return res.status(404).json({ status: false, message: 'Team member not found in this business.' });
        }

        if (teamMember.role === 'owner' && status != 'active') {
            await t.rollback();
            return res.status(403).json({ status: false, message: 'The owner status cannot be disabled.' });
        }

        if (status === 'active') {
            teamMember.status = 1; // Active
        } else if (status === 'disabled') {
            teamMember.status = 0; // Inactive
        } else {
            await t.rollback();
            return res.status(400).json({ status: false, message: 'Invalid status. Must be one of: active, inactive.' });
        }

        await teamMember.save({ transaction: t });
        await t.commit();

        return res.status(200).json({ status: true, message: 'Team member status has been updated successfully.' });

    } catch (error) {
        if (t && !t.finished) await t.rollback();
        logger.error('Error in update Team Memberstatus:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};


module.exports = {
    addTeamMember,
    getTeamMembers,
    manageTeamMember,
    listMemberOfBusinesses,
    getBusinessRolesAndPermissions,
    manageTeamInvite,
    updateTeamMemberRole,
    updateTeamMemberStatus
}