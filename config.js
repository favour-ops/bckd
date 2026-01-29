module.exports = {
    DB_HOST: process.env.DB_HOST,
    USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PW,
    DB_NAME: process.env.DB_NAME,
    dialect: 'mysql',
    define: {
      timestamps: false
    },
  
    pool: {
      max:5,
      min: 2,
      acquire: 30000,
      idle: 30000,
      evict: 5000,
    }
  }