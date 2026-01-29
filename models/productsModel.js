const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const Products = sequelize.define("products", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        category: {type:DataTypes.STRING(50), allowNull: false},   //e.g Eletricity   
        prdname: {type:DataTypes.STRING(50), allowNull: true},    // Ibedc
        prdcode: {type:DataTypes.STRING(50), allowNull: true, defaultValue: ''},    //1332
        billerid: {type:DataTypes.STRING(20), allowNull: true},    //1332
        dataplan: {type:DataTypes.STRING(20), allowNull: true, defaultValue: ''},   // 2gb
        providerprice: {type:DataTypes.DECIMAL(16,2),allowNull: true, defaultValue: 0},  //1.5%
        provider_fee_cap: {type:DataTypes.DECIMAL(16,2),allowNull: true, defaultValue: 0},  //1.5%
        provfeetype: {type:DataTypes.STRING(20),allowNull: true, defaultValue: 'percentage'},  //e.g percentage/fixed
        provfeemodel: {type:DataTypes.STRING(20),allowNull: true, defaultValue: 'commission'},  //discounted(commission)/charge
        amount: {type:DataTypes.DECIMAL(16,2),allowNull: true, defaultValue: 0},   //our fee e.g 30
        feetype: {type:DataTypes.STRING(20),allowNull: true, defaultValue: 'fixed'},    //our fee type e.g percentage/fixed
        feemodel: {type:DataTypes.STRING(20),allowNull: true, defaultValue: 'charge'},    //our fee model discounted(commission)/charge
        ntwk: {type:DataTypes.STRING(50), allowNull: false},  //IBEDC
        status: {type:DataTypes.INTEGER(11), allowNull: false}   
      }, {
        tableName: 'products'
      });

    
    return Products;      
}