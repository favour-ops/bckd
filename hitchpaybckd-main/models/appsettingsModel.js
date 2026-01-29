const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const AppSet = sequelize.define("sitesettings", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        sitephone: {type:DataTypes.TEXT,allowNull: true},
        siteemail: {type:DataTypes.TEXT,allowNull: true},
        // investroi: {type:DataTypes.INTEGER,allowNull: true},
        siteadress: {type:DataTypes.TEXT,allowNull: true},
        referearn: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        inflowfee: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        stampduty: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        stampduty_max: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        inflowfee_cap: {type:DataTypes.DECIMAL(16,2),allowNull: true},      
        minwithdraw: {type:DataTypes.DECIMAL(16,2),allowNull: true},      
        eligible_refamt: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        ads: {type:DataTypes.TEXT,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false},
        paybtankcode: {type:DataTypes.STRING,allowNull: true},
        paytacctno: {type:DataTypes.STRING,allowNull: true},
        paytenquirytoken: {type:DataTypes.STRING,allowNull: true},
        paytaccountname: {type:DataTypes.STRING,allowNull: true},
        paytbankname: {type:DataTypes.STRING,allowNull: true},
        referaccntno: {type:DataTypes.STRING,allowNull: true},
        referbenchmark: {type:DataTypes.STRING,allowNull: true},
        referbonus_enabled: {type:DataTypes.INTEGER(11),allowNull: false},
        uplinebonus: {type:DataTypes.DECIMAL(16,2),allowNull: false},
        downlinebonus: {type:DataTypes.DECIMAL(16,2),allowNull: false},
        welcomebonus_enabled: {type:DataTypes.INTEGER(11),allowNull: false},
        welcomebonus: {type:DataTypes.DECIMAL(16,2),allowNull: false},
        dailybonus_enabled: {type:DataTypes.INTEGER(11),allowNull: false},
        dailybonus: {type:DataTypes.DECIMAL(16,2),allowNull: false},
        dailybonus_type: {type:DataTypes.STRING,allowNull: false},  //percentage or fixed
        refermilestone_enabled: {type:DataTypes.INTEGER(11),allowNull: false},
        dollarfee: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        dollarfund: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        dollarwithdraw: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        usacctfee: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        dollartransfer: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        ftprovider: {type:DataTypes.STRING, allowNull: false},
        achtransfer: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        achaccelerated: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        checkoutfee: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        checkoutcap: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        crosstransfer: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        crosscollectfee: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        rateprovider: {type:DataTypes.STRING,allowNull: true},
        ratemargin_percent: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        nocac_allow: {type:DataTypes.INTEGER(11),allowNull: false},  //1 - allow /0 - mean not allow
        billprovider: {type:DataTypes.STRING,allowNull: true}, //which providerare we using at the moment for bills payment e.g vtpass or coralpay
        remittance_card: {type:DataTypes.DECIMAL(16,2),allowNull: true}, //percetnae
        remittance_bank: {type:DataTypes.DECIMAL(16,2),allowNull: true}, //prcentage
        // refereligible: {type:DataTypes.DECIMAL(16,2),allowNull: false},
      }, {
        tableName: 'sitesettings',
        timestamps: false
      });

         
    return AppSet;      
}