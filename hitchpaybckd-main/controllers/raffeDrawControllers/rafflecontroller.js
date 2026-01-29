const { success, error } = require("../../utils/pubapi_response.js");
const { cleanMe } = require("../../config/myfunct.js");
const db = require('../../models');
const { Op } = require('sequelize'); // Sequelize Operator
const { logger } = require('../../config/logger.js');

const Customer = db.customers;
const RaffleDraw = db.raffledraw;

const initiateDraw = async (req, res, next) => {
  try {
    const { referralCode, drawName } = cleanMe(req.body);

    if (!referralCode) {
      return error(res, "INVALID_REQUEST", "referralCode is required.", 400);
    }

    // 1. Find all customer IDs who have previously won a draw for THIS referral code.
    const previousWinnersForThisCode = await RaffleDraw.findAll({
      where: { referralCode: referralCode },
      attributes: ['winnerCustomerId'],
      raw: true,
    });
    const previousWinnerIds = previousWinnersForThisCode.map(w => w.winnerCustomerId);

    // 2. Find all eligible participants for this referral code, excluding those who have already won.
    const participants = await Customer.findAll({
      where: {
        referby: referralCode,
        bvverify: 2,
        id: { [Op.notIn]: previousWinnerIds }
      },
      attributes: ['id', 'firstname', 'lastname', 'email', 'photo'],
    });

    if (participants.length === 0) {
      return error(res, "NOT_FOUND", "No eligible participants found. All may have won previously or none exist.", 404);
    }

    // 3. Pick a random winner and identify the remaining participants.
    const winnerIndex = Math.floor(Math.random() * participants.length);
    const winner = participants[winnerIndex];

    // The remaining participants are everyone else in the list.
    const remainingParticipants = participants.filter((_, index) => index !== winnerIndex);

    const transaction = await db.sequelize.transaction();
    try {
      // 4. Deactivate any previous active draws for this referral code to make the new one current.
      await RaffleDraw.update(
        { isActive: false },
        { where: { referralCode: referralCode, isActive: true }, transaction }
      );

      // 5. Create a new record for the current draw, marking it as active.
      const newDraw = await RaffleDraw.create({
        referralCode: referralCode,
        winnerCustomerId: winner.id,
        drawName: drawName, // Save the draw name
        isActive: true,
      }, { transaction });

      await transaction.commit();

      return success(res, {
        drawIdentifier: newDraw.drawIdentifier,
        drawName: newDraw.drawName,
        winner: {
          name: `${winner.firstname} ${winner.lastname}`,
          email: winner.email,
          profilePicture: winner.photo,
        },
        remainingParticipants: remainingParticipants.map(p => ({ name: `${p.firstname} ${p.lastname}`, email: p.email, profilePicture: p.photo })),
      }, "New raffle draw initiated successfully.");

    } catch (err) {
      await transaction.rollback();
      logger.error('Raffle draw transaction failed:', err);
      return error(res, "SERVER_ERROR", "Could not complete the draw.", 500);
    }

  } catch (err) {
    next(err);
  }
};


const getWinner = async (req, res, next) => {
  try {
    const { referralCode } = cleanMe(req.params);

    if (!referralCode) {
      return error(res, "INVALID_REQUEST", "referralCode is required in the URL path.", 400);
    }

    // Find the latest active draw for the given referral code.
    const activeDraw = await RaffleDraw.findOne({
      where: { referralCode, isActive: true },
      order: [['createdAt', 'DESC']],
      include: [{
        model: Customer,
        as: 'winner',
        attributes: ['firstname', 'lastname', 'email'],
      }]
    });

    if (!activeDraw || !activeDraw.winner) {
      return error(res, "NOT_FOUND", "No active draw found for this referral code. Please initiate a draw first.", 404);
    }

    const { winner, drawIdentifier, drawName } = activeDraw;

    return success(res, {
      drawIdentifier,
      drawName,
      winner: {
        name: `${winner.firstname} ${winner.lastname}`,
        email: winner.email,
        profilePicture: winner.photo
      }
    }, "Active raffle winner retrieved successfully.");

  } catch (err) {
    next(err);
  }
};


const resetDraws = async (req, res, next) => {
  try {
    const { referralCode } = cleanMe(req.body);

    if (!referralCode) {
      return error(res, "INVALID_REQUEST", "referralCode is required.", 400);
    }

    const deletedCount = await RaffleDraw.destroy({
      where: {
        referralCode: referralCode,
      },
    });

    return success(res, {
      deletedCount
    }, `Successfully reset ${deletedCount} draw(s) for referral code '${referralCode}'.`);

  } catch (err) {
    next(err);
  }
};

module.exports = {
  initiateDraw,
  getWinner,
  resetDraws,
};
