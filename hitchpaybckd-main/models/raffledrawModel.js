const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const RaffleDraw = sequelize.define("raffledraws", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        referralCode: { type: DataTypes.STRING, allowNull: false},
        winnerCustomerId: {type: DataTypes.INTEGER, allowNull: false},
        drawIdentifier: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, unique: true},
        isActive: {type: DataTypes.BOOLEAN, defaultValue: true},
        drawName: {type: DataTypes.STRING, allowNull: true},

      }, {
        tableName: 'raffledraws',
        timestamps: true
      });

      // define association here
    RaffleDraw.associate = function(models) {
        RaffleDraw.belongsTo(models.customers, { foreignKey: 'winnerCustomerId', as: 'winner' });
    }

    return RaffleDraw;      
}

// 'use strict';
// const {
//     Model
// } = require('sequelize');

// module.exports = (sequelize, DataTypes) => {
//     class RaffleDraw extends Model {

//         static associate(models) {
//             // define association here
//             RaffleDraw.belongsTo(models.customers, { foreignKey: 'winnerCustomerId', as: 'winner' });
//         }
//     }
//     RaffleDraw.init({
       
//     }, {
//         sequelize,
//         modelName: 'RaffleDraw',
//         tableName: 'raffledraws',
//         timestamps: true,
//     });
//     return RaffleDraw;
// };
