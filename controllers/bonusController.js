const db = require('../models')
const jwt = require("jsonwebtoken");

const bcrypt = require('bcryptjs');
const md5 = require('md5');
const { json } = require('sequelize');
const saltRounds = 12;
const randomstring = require("randomstring");
const Sequelize = require('sequelize');
const https = require('https');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { client: redisClient } = require('../config/redisClient'); // Import Redis client
const { ExtractJwt } = require('passport-jwt'); // Helper to extract token
const twoFactor = require('node-2fa');
const qrcode = require('qrcode');

//moment 
const moment = require('moment-timezone');
require('moment-timezone/builds/moment-timezone-with-data');
moment.tz.setDefault('Africa/Lagos');
const axios = require('axios');
const { cleanMe, shAcessToken, genSHAccount, gen9PSBAccount, validatePassword, FreeTransfersCount, TransLimit, giveWelcomeBonus, referralUplineDownlineBonus } = require("../config/myfunct");
const { compareNames } = require("../config/nameMatcher");
const { check } = require('express-validator');
const { genCode } = require("../config/getcode");
const { sendSMS, notifyMe, sendWhatsApp, pushNotify } = require("../config/notifyuser");
const { mailSender } = require("../config/mailsender");
const { getUserInfo, getBal } = require("../config/userdetails");
const path = require('path');

const Op = Sequelize.Op;
const Customer = db.customers;
const logEarning = db.earnings;
const BonusTask = db.bonusTask;
const UserBonusProgress = db.bonusprogress;
const BonusCategory = db.bonuscategory;
const CheckinReward = db.checkinRewards;
const bonusCoupon = db.bonusCoupon;


const processBonus = async (req, res) => {
    try {
        const { userId, action, amount } = req.body;

        // Find all active tasks matching the action
        const tasks = await BonusTask.findAll({ where: { action, is_active: true } });

        if (!tasks.length) {
            return res.status(404).json({ message: "No bonus available for this action" });
        }

        let rewards = [];

        for (let task of tasks) {
            if (amount >= task.min_amount) {
                let reward = 0;

                if (task.reward_unit === "percent") {
                    reward = (amount * task.reward_value) / 100;
                    if (task.max_reward) reward = Math.min(reward, task.max_reward);
                } else {
                    reward = task.reward_value;
                }

                // Save progress
                await UserBonusProgress.create({
                    userid: userId,
                    task_id: task.id,
                    reward_earned: reward,
                    date: new Date()
                });

                // Update user wallet (if cashback)
                if (task.reward_type === "cashback") {
                    const user = await Customer.findByPk(userId);
                    user.wallet_balance = parseFloat(user.wallet_balance) + parseFloat(reward);
                    await user.save();
                }

                rewards.push({ task: task.title, reward });
            }
        }

        return res.json({ message: "Bonus processed", rewards });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
}

const checkinBonusNew = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const userId = req.user.id;
        if (!userId) {
            await t.rollback();
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });
        }

        const task = await BonusTask.findOne({ where: { type: "checkin", is_active: true }, transaction: t });
        if (!task) {
            await t.rollback();
            return res.status(404).json({ message: "Check-in bonus not available" });
        }

        const lastCheckin = await UserBonusProgress.findOne({
            where: { userid: userId, task_id: task.id },
            order: [["date", "DESC"]],
            transaction: t
        });

        let streak = 1; // Default to 1 for a new streak
        const today = moment().format("YYYY-MM-DD");

        if (lastCheckin) {
            const lastDate = moment(lastCheckin.date).format("YYYY-MM-DD");
            if (lastDate === today) {
                await t.rollback();
                return res.status(400).json({ message: "You have already checked in today." });
            }

            // Check if the last check-in was yesterday to continue the streak
            if (moment().subtract(1, "day").format("YYYY-MM-DD") === lastDate) {
                streak = lastCheckin.times_completed + 1;
            }
            // If it was before yesterday, the streak resets to 1 (which is the default)
        }

        // If the streak goes past 7, it resets to 1 for a new cycle
        if (streak > 7) {
            streak = 1;
        }

        // --- New Logic: Award bonus only on Day 7 ---
        if (streak === 7) {
            // On the 7th day, calculate the total reward for the entire week
            const rewards = await CheckinReward.findAll({
                where: { day: { [Op.between]: [1, 7] } },
                transaction: t
            });

            if (rewards.length < 7) {
                await t.rollback();
                return res.status(500).json({ message: "Check-in reward configuration is incomplete." });
            }

            const totalReward = rewards.reduce((sum, day) => sum + parseFloat(day.reward), 0);

            // Save progress for the 7th day
            await UserBonusProgress.create({
                userid: userId,
                task_id: task.id,
                date: today,
                times_completed: streak,
                reward_earned: totalReward, // Log the total reward earned for this streak
            }, { transaction: t });

            // Credit the user's wallet with the total sum
            await updateBalance(userId, totalReward, 'NGN', 'credit', { transaction: t });

            await t.commit();

            return res.json({
                status: true,
                message: `Congratulations! You've completed a 7-day streak and earned a bonus of NGN ${formatAmount(totalReward)}.`,
                data: {
                    streak: streak,
                    reward: totalReward,
                    nextDay: "Your streak will restart tomorrow."
                }
            });

        } else {
            // For days 1-6, just log the check-in without giving a reward
            await UserBonusProgress.create({
                userid: userId,
                task_id: task.id,
                date: today,
                times_completed: streak,
                reward_earned: 0, // No reward earned yet
            }, { transaction: t });

            await t.commit();

            return res.json({
                status: true,
                message: `Check-in successful! You are on a ${streak}-day streak. Complete 7 days to get your bonus.`,
                data: {
                    streak: streak,
                    reward: 0,
                    nextDay: `Day ${streak + 1}`
                }
            });
        }

    } catch (error) {
        await t.rollback();
        console.error("Error during check-in:", error);
        return res.status(500).json({ message: "Server error during check-in.", error: error.message });
    }
}

const checkinBonus = async (req, res) => {
    try {

        const userId = req.user.id;
        if (!userId) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const task = await BonusTask.findOne({ where: { type: "checkin", is_active: true } });
        if (!task) return res.status(404).json({ message: "Check-in bonus not available" });

        const lastCheckin = await UserBonusProgress.findOne({
            where: { userid: userId, task_id: task.id },
            order: [["date", "DESC"]],
        });

        let streak = 0;
        let today = moment().format("YYYY-MM-DD");

        if (lastCheckin) {
            let lastDate = moment(lastCheckin.date).format("YYYY-MM-DD");
            if (lastDate === today) return res.status(400).json({ message: "Already checked in today" });

            if (moment().subtract(1, "day").format("YYYY-MM-DD") === lastDate) {
                streak = lastCheckin.times_completed + 1;
            } else {
                streak = 1;
            }

            if (streak > 7) streak = 1; // restart after 7 days
        } else {
            streak = 1;
        }

        // Fetch reward for this streak day
        const rewardRow = await CheckinReward.findOne({ where: { day: streak } });
        if (!rewardRow) return res.status(500).json({ message: "Reward config missing for this day" });

        const reward = parseFloat(rewardRow.reward);

        // Save progress
        await UserBonusProgress.create({
            userid: userId,
            task_id: task.id,
            date: today,
            times_completed: streak,
            reward_earned: reward,
        });

        // Credit wallet
        const user = await Customer.findByPk(userId);
        user.wallet_balance = parseFloat(user.wallet_balance) + reward;
        await user.save();

        return res.json({
            message: "Check-in successful",
            streak,
            reward,
            nextDay: streak === 7 ? "Cycle will restart tomorrow" : `Day ${streak + 1}`,
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
}

const getBonusCategory = async (req, res) => {
    const categories = await BonusCategory.findAll({
        include: { model: BonusTask },
    });
    // include: [{ model: BonusTask }]

    // console.log('categories', categories)

    res.json(categories);
}

const getBonusTasks = async (req, res) => {
    const tasklisst = await BonusTask.findAll({});
    if (!tasklisst || tasklisst.length < 1)
        return res.status(400).json({ status: false, message: 'No tasks found' });

    // fetch the reward custiomer has gotten for the day from the list of bonus task
    const userBonusProgress = await UserBonusProgress.findAll({
        where: {
            userid: req.user.id,
            date: {
                [Op.gte]: moment().startOf('day').toDate(),
                [Op.lte]: moment().endOf('day').toDate()
            }
        },
        attributes: ['task_id', 'reward_earned']
    });

    const userProgressMap = new Map();
    userBonusProgress.forEach(progress => {
        userProgressMap.set(progress.task_id, progress.reward_earned);
    });

    
    const tasksWithProgress = tasklisst.map(task => {
        const progress = userProgressMap.get(task.id);
        return {
            ...task.toJSON(),
            reward_today: progress !== undefined ? progress : 0,
            has_earned_today: progress !== undefined
        };
    });


    res.json({
        status: true,
        message: 'Retrived',
        data: tasksWithProgress,
    });
}


const deleteBonusTask = async (req, res) => {
    try {
        const { taskid } = req.body;
        if (!taskid) {
            return res.status(400).json({
                status: false,
                message: "Task ID is required."
            });
        }

        const numDeleted = await BonusTask.destroy({ where: { id: taskid } });

        if (numDeleted > 0) {
            return res.json({
                status: true,
                message: 'Task deleted successfully.',
            });
        } else {
            return res.status(404).json({
                status: false,
                message: 'Task not found.',
            });
        }
    } catch (error) {
        console.error("Error deleting bonus task:", error);
        return res.status(500).json({
            status: false,
            message: 'Task not deleted',
            message: 'An internal server error occurred while deleting the task.',
            error: error.message
        });
    }
}

const getCheckInRewards = async (req, res) => {
    try {
        const rewards = await CheckinReward.findAll({ order: [["day", "ASC"]] });

        if (!rewards || rewards.length < 1)
            return res.status(400).json({ status: false, message: 'No checking found added' });

        const checkinList = rewards.map((item) => ({
            id: item.id,
            day: item.day,
            reward: item.reward,
            // createdAt: item.createdAt,
            is_active: item.is_active
        }));

        res.json({
            status: true,
            message: 'Retrived',
            data: checkinList
        });

    } catch (err) {
        res.status(500).json({
            status: false,
            message: err.message,
            data: []
        });
    }
}

const updateCheckInRewards = async (req, res) => {

    try {
        const { day, reward } = req.body;

        let rewardRow = await CheckinReward.findOne({ where: { day } });

        if (rewardRow) {
            rewardRow.reward = reward;
            await rewardRow.save();
        } else {
            rewardRow = await CheckinReward.create({ day, reward });
        }

        // res.json(rewardRow);
        res.json({
            status: true,
            message: 'Updated',
            data: rewardRow
        });

    } catch (err) {
        console.log(err.message);
        res.status(500).json({ error: err.message });
    }
}

const getUserCheckinStatus = async (req, res) => {

    try {

        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const task = await BonusTask.findOne({ where: { type: "checkin", is_active: true } });
        if (!task) {
            return res.status(404).json({
                status: false,
                message: "Check-in bonus not available."
            });
        }

        const lastCheckin = await UserBonusProgress.findOne({
            where: { userid: userid, task_id: task.id },
            order: [["date", "DESC"]],
        });

        let today = moment().format("YYYY-MM-DD");
        let hasCheckedInToday = false;
        let currentStreak = 0;
        let nextRewardDay = 1;
        let nextRewardAmount = 0;

        if (lastCheckin) {
            let lastCheckinDate = moment(lastCheckin.date).format("YYYY-MM-DD");
            if (lastCheckinDate === today) {
                hasCheckedInToday = true;
                currentStreak = lastCheckin.times_completed;
            } else {
                // Check if yesterday was the last check-in to continue streak
                if (moment().subtract(1, "day").format("YYYY-MM-DD") === lastCheckinDate) {
                    currentStreak = lastCheckin.times_completed;
                } else {
                    currentStreak = 0; // Streak broken
                }
            }
        }

        // Determine the next reward day and amount
        if (hasCheckedInToday) {
            nextRewardDay = (currentStreak % 7) + 1; 
        } else {
            nextRewardDay = (currentStreak % 7) + 1;
        }

        if (currentStreak === 7 && !hasCheckedInToday) {
            nextRewardDay = 1;
        }

        const nextRewardRow = await CheckinReward.findOne({ where: { day: nextRewardDay } });
        if (nextRewardRow) {
            nextRewardAmount = parseFloat(nextRewardRow.reward);
        }

        //you are yet to complete this code
        res.json({
            status: true,
            message: "Check-in status retrieved successfully.",
            data: {
                hasCheckedInToday,
                currentStreak,
                nextRewardDay,
                nextRewardAmount,
                lastCheckinDate: lastCheckin ? moment(lastCheckin.date).format("DD-MM-YYYY") : null,
            }
        });

    } catch (error) {
        console.error("Error fetching user check-in status:", error);
        return res.status(500).json({
            status: false,
            message: "An internal server error occurred.",
            error: error.message
        });
    }
}

const createBonusTask = async (req, res) => {
    try {
        const {
            taskname,
            taskdesc,
            tasktype,
            taskaction,
            taskrewardtype,
            taskrewardunit,
            taskrewardvalue,
            isactive,
            min_amount,
            max_reward,
            taskrewardnetwork,
            bonus_category_id
        } = req.body;

        // check if the fields are passed and not empty
        if (!taskname || !taskdesc || !tasktype || !taskaction || !taskrewardtype || !taskrewardvalue) {
            return res.status(400).json({
                status: false,
                message: "All required task fields must be provided."
            });
        }

        if (!taskrewardunit && taskrewardtype != 'voucher') {
            return res.status(400).json({
                status: false,
                message: `Reward unit must be specified for ${taskrewardtype}`
            });
        }

        const newTask = await BonusTask.create({
            name: taskname,
            title: taskname,
            description: taskdesc,
            type: tasktype,
            action: taskaction,
            reward_type: taskrewardtype,
            reward_unit: taskrewardunit,
            reward_value: taskrewardvalue,
            is_active: isactive,
            min_amount: min_amount || 0,
            max_reward: max_reward || null,
            network_type: taskrewardnetwork || null,
            bonus_category_id: bonus_category_id || null
        });

        return res.status(201).json({
            status: true,
            message: "Bonus task added successfully.",
            data: newTask
        });

    } catch (error) {
        console.error("Error adding bonus task:", error);
        return res.status(500).json({
            status: false,
            message: "Failed to add bonus task.",
            error: error.message
        });
    }
};

const updateBonusTask = async (req, res) => {
    try {
        const { taskid, taskname, taskdesc, tasktype, taskaction, taskrewardtype, taskrewardunit, taskrewardvalue,
            isactive, min_amount, max_reward, network_type, bonus_category_id } = req.body;

        if (!taskid) {
            return res.status(400).json({
                status: false,
                message: "Task ID is required for update."
            });
        }

        if (!taskname || !taskdesc || !tasktype || !taskaction || !taskrewardtype || !taskrewardunit || !taskrewardvalue) {
            return res.status(400).json({
                status: false,
                message: "All required task fields must be provided."
            });
        }

        const task = await BonusTask.findByPk(taskid);
        if (!task) {
            return res.status(404).json({
                status: false,
                message: "Bonus task not found."
            });
        }

        task.name = taskname !== undefined ? taskname : task.name;
        task.title = taskname !== undefined ? taskname : task.title;
        task.description = taskdesc !== undefined ? taskdesc : task.description;
        task.type = tasktype !== undefined ? tasktype : task.type;
        task.action = taskaction !== undefined ? taskaction : task.action;
        task.reward_type = taskrewardtype !== undefined ? taskrewardtype : task.reward_type;
        task.reward_unit = taskrewardunit !== undefined ? taskrewardunit : task.reward_unit;
        task.reward_value = taskrewardvalue !== undefined ? taskrewardvalue : task.reward_value;
        task.is_active = isactive !== undefined ? isactive : task.is_active;
        task.min_amount = min_amount !== undefined ? min_amount : task.min_amount;
        task.network_type = network_type !== undefined ? network_type : task.network_type;
        task.max_reward = max_reward !== undefined ? max_reward : task.max_reward;
        task.bonus_category_id = bonus_category_id !== undefined ? bonus_category_id : task.bonus_category_id;

        await task.save();

        return res.status(200).json({
            status: true,
            message: "Bonus task updated successfully.",
            data: task
        });

    } catch (error) {
        console.error("Error updating bonus task:", error);
    }
}

const createBonusCoupon = async (req, res) => {
    try {
        const { name, amount, validity, usage_quantity, scope, product, is_active, min_amount } = req.body;

        // check if the fields are passed and not empty
        if (!name || !amount || !validity || !usage_quantity || !scope) {
            return res.status(400).json({
                status: false,
                message: "All required coupon fields must be provided."
            });
        }

        // convert the validity e.g 2025-10-30 to unixtimestamp
        const validityTimestamp = moment(validity).unix();

        const newCoupon = await bonusCoupon.create({
            name: name,
            amount: amount,
            validity_date: validityTimestamp,
            usage_quantity: usage_quantity,
            min_amount: min_amount,
            scope: scope,
            product: product || null,
            is_active: is_active,
            timecreated: Math.floor(Date.now() / 1000)
        });

        return res.status(201).json({
            status: true,
            message: "Coupon added successfully.",
            // data: newCoupon
        });

    } catch (error) {
        console.error("Error adding coupon:", error);
        return res.status(500).json({
            status: false,
            message: "Failed to add coupon.",
            error: error.message
        });
    }
};

const getBonusCoupons = async (req, res) => {
    try {
        const allCoupons = await bonusCoupon.findAll({
            order: [['id', 'DESC']] // Optional: order by most recent
        });

        if (!allCoupons || allCoupons.length < 1) {
            return res.status(404).json({ status: false, message: 'No coupons found' });
        }

        const allUserIds = new Set();
        allCoupons.forEach(coupon => {
            if (coupon.assigned) {
                try {
                    const assignedData = JSON.parse(coupon.assigned);
                    if (assignedData.type === 'specific' && Array.isArray(assignedData.users)) {
                        assignedData.users.forEach(userId => allUserIds.add(userId));
                    }
                } catch (e) {
                    console.error("Error parsing JSON for coupon:", coupon.id, e);
                }
            }
        });

        // ---  Fetch all required user details in a single query ---
        let usersMap = new Map();
        if (allUserIds.size > 0) {
            const users = await Customer.findAll({
                where: {
                    id: { [Op.in]: [...allUserIds] }
                },
                // Corrected attributes to match the Customer model
                attributes: ['id', 'firstname', 'lastname', 'email']
            });
            // Create a Map for quick lookups
            users.forEach(user => usersMap.set(user.id, user));
        }

        // --- Map coupons to their final structure ---
        const result = allCoupons.map(coupon => {
            const couponJSON = coupon.toJSON();
            let assignedUsersDetails = [];

            if (couponJSON.validity_date) {
                couponJSON.validity_date = moment.unix(couponJSON.validity_date).format("DD-MM-YYYY");
            }

            // Attach user details using the pre-fetched map
            if (couponJSON.assigned) {
                try {
                    const assignedData = JSON.parse(couponJSON.assigned);
                    if (assignedData.type === 'specific' && Array.isArray(assignedData.users)) {
                        assignedUsersDetails = assignedData.users
                            .map(userId => {
                                const user = usersMap.get(userId);
                                if (user) {
                                    return {
                                        name: `${user.firstname} ${user.lastname}`,
                                        email: user.email
                                    };
                                }
                                return null;
                            })
                            .filter(user => user);
                    }
                } catch (e) {
                    assignedUsersDetails = [];
                }
            }

            couponJSON.assigned_users_details = assignedUsersDetails;
            return couponJSON;
        });

        res.json({
            status: true,
            message: 'Retrieved',
            data: result,
        });

    } catch (error) {
        console.error("Failed to get coupons:", error);
        res.status(500).json({
            status: false, message: "An internal server error occurred."
        });
    }
};

const deleteCoupon = async (req, res) => {
    try {
        const { couponid } = req.body;
        if (!couponid) {
            return res.status(400).json({
                status: false,
                message: "Coupon ID is required."
            });
        }

        const numDeleted = await bonusCoupon.destroy({ where: { id: couponid } });

        if (numDeleted > 0) {
            return res.json({
                status: true,
                message: 'Coupon deleted successfully.',
            });
        } else {
            return res.status(404).json({
                status: false,
                message: 'Coupon not found.',
            });
        }

    } catch (error) {
        console.error("Error deleting bonus coupon:", error);
        return res.status(500).json({
            status: false,
            message: 'Coupon not deleted',
        });
    }
}

const assignCoupon = async (req, res) => {
    const { couponid, assignment_type, user_ids } = req.body;

    //  --- Validation ---
    if (!couponid || !assignment_type) {
        return res.status(400).json({ status: false, message: "Coupon ID and assignment type are required." });
    }

    if (assignment_type === 'specific_users' && (!user_ids || user_ids.length === 0)) {
        return res.status(400).json({ status: false, message: "Please select at least one user for specific assignment." });
    }

    try {
        //  --- Find the Coupon ---
        const coupon = await bonusCoupon.findByPk(couponid);

        if (!coupon) {
            return res.status(404).json({ status: false, message: "Coupon not found." });
        }

        let assignmentData;

        if (assignment_type === 'all_users') {
            assignmentData = { type: 'all' };
        } else {
            assignmentData = { type: 'specific', users: user_ids };
        }

        await coupon.update({
            assigned: JSON.stringify(assignmentData),
            assigned_coupon: assignment_type
        });

        return res.status(200).json({
            status: true, message: "Coupon assigned successfully."
        });

    } catch (error) {
        console.error("Error assigning coupon:", error);
        return res.status(500).json({ status: false, message: "An internal server error occurred." });
    }
};

const updateCouponStatus = async (req, res) => {
    const { couponid, is_active } = req.body;
    if (!couponid || typeof is_active !== 'boolean') {
        return res.status(400).json({
            status: false,
            message: "Invalid request. 'couponid' and a boolean 'is_active' status are required."
        });
    }

    try {
        const [affectedRows] = await bonusCoupon.update(
            { is_active: is_active },
            { where: { id: couponid } }
        );

        if (affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Coupon not found or status is already the same." });
        }

        const action = is_active ? 'enabled' : 'disabled';
        return res.status(200).json({
            status: true,
            message: `Coupon successfully ${action}.`
        });

    } catch (error) {
        console.error("Error updating coupon status:", error);
        return res.status(500).json({
            status: false,
            message: "An internal server error occurred while updating the coupon status."
        });
    }
};

const editCoupon = async (req, res) => {
    const {couponid, name, amount, validity,usage_quantity, scope, product, is_active, min_amount} = req.body;

    // Validation ---
    if (!couponid) {
        return res.status(400).json({ status: false, message: "Coupon ID is required." });
    }
    if (!name || !amount || !validity || !usage_quantity || !scope) {
        return res.status(400).json({ status: false, message: "All required fields must be provided." });
    }

    try {
        const coupon = await bonusCoupon.findByPk(couponid);

        if (!coupon) {
            return res.status(404).json({ status: false, message: "Coupon not found." });
        }

        const validityTimestamp = moment(validity, "DD-MM-YYYY").unix();

        const updatedFields = {
            name, amount, validity_date: validityTimestamp, usage_quantity, scope, product: scope === 'specific_product' ? product : null, min_amount: min_amount,
            is_active
        };

        await coupon.update(updatedFields);

        return res.status(200).json({
            status: true,
            message: "Coupon updated successfully."
        });

    } catch (error) {
        console.error("Error editing coupon:", error);
        return res.status(500).json({
            status: false,
            message: "An internal server error occurred while editing the coupon."
        });
    }
};


const getAvailableCoupons = async (req, res) => {
    try {
        const userId = req.user.id;
        if (!userId) {
            return res.status(401).json({ status: false, message: 'Authentication required.' });
        }

        const now = moment().unix();

        // --- Fetch all coupons that are either public or assigned to the user ---
        const allPotentiallyRelevantCoupons = await bonusCoupon.findAll({
            where: {
                [Op.or]: [
                    { assigned_coupon: 'all_users' },
                    {
                        assigned_coupon: 'specific_users',
                        assigned: { [Op.like]: `%${userId}%` }
                    }
                ]
            },
            attributes: [
                'id', 'name', 'amount', 'scope', 'product', 'validity_date',
                'assigned_coupon', 'assigned', 'used_by', 'is_active', 'min_amount'
            ],
            order: [['id', 'DESC']]
        });

        if (!allPotentiallyRelevantCoupons || allPotentiallyRelevantCoupons.length === 0) {
            return res.status(404).json({ status: false, message: 'No coupons are available for you at the moment.' });
        }

        // --- Step 2: Filter, determine status, and format the results ---
        const finalCoupons = allPotentiallyRelevantCoupons.map(coupon => {
            const couponJSON = coupon.toJSON();
            let isEligible = false;
            let status = 'unavailable'; // Default status

            // Determine if the user is eligible for this coupon
            if (couponJSON.assigned_coupon === 'all_users') {
                isEligible = true;
            } else if (couponJSON.assigned_coupon === 'specific_users') {
                try {
                    const assignedData = JSON.parse(couponJSON.assigned);
                    if (assignedData.type === 'specific' && Array.isArray(assignedData.users) && assignedData.users.includes(userId)) {
                        isEligible = true;
                    }
                } catch (e) { /* Invalid JSON, not eligible */ }
            }

            if (!isEligible) {
                return null; // User is not eligible for this coupon, so we filter it out
            }

            // Determine the status for the eligible user
            const usedByUsers = couponJSON.used_by ? JSON.parse(couponJSON.used_by) : [];
            if (usedByUsers.includes(userId)) {
                status = 'used';
            } else if (couponJSON.validity_date < now) {
                status = 'expired';
            } else if (couponJSON.is_active) {
                status = 'available';
            } else {
                status = 'inactive'; // Coupon is disabled by an admin
            }

            // Format and clean up the final object
            couponJSON.status = status;
            couponJSON.validity_date = moment.unix(couponJSON.validity_date).format("DD-MM-YYYY");
            delete couponJSON.assigned;
            delete couponJSON.assigned_coupon;
            delete couponJSON.used_by;
            delete couponJSON.is_active;

            return couponJSON;
        }).filter(c => c !== null); // Remove null entries from the array

        if (finalCoupons.length === 0) {
            return res.status(404).json({ status: false, message: 'No coupons are available for you.' });
        }

        return res.json({
            status: true,
            message: 'Available coupons retrieved successfully.',
            data: finalCoupons
        });

    } catch (error) {
        console.error("Error fetching available coupons:", error);
        return res.status(500).json({ status: false, message: "An internal server error occurred." });
    }
};

module.exports = {
    processBonus, checkinBonus, getBonusCategory, getBonusTasks, createBonusTask,
    updateBonusTask, deleteBonusTask, getCheckInRewards, updateCheckInRewards,
    getUserCheckinStatus, createBonusCoupon, getBonusCoupons, assignCoupon, deleteCoupon,
    updateCouponStatus, editCoupon, getAvailableCoupons
};
