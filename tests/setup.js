// tests/setup.js

// 1. Mock the models folder (Correct path from tests/ to models/)
// We use '../models' because setup.js is in 'tests/'
jest.mock('../models', () => ({
  sequelize: {
    sync: jest.fn().mockResolvedValue(true),
    authenticate: jest.fn().mockResolvedValue(true),
    close: jest.fn().mockResolvedValue(true),
    transaction: jest.fn().mockReturnValue({
      commit: jest.fn().mockResolvedValue(true),
      rollback: jest.fn().mockResolvedValue(true),
    }),
  },
  Sequelize: {
    DataTypes: {},
    Op: {
      between: Symbol('between'),
      like: Symbol('like'),
      and: Symbol('and'),
      or: Symbol('or'),
      gt: Symbol('gt'),
      lte: Symbol('lte'),
    },
  },
  // Add empty objects for all models imported in utility functions
  customers: {},
  payn: {},
  notify: {},
  appsettings: {},
  wallets: {},
}));

// 2. Mock Redis (Path: '../config/redisClient')
jest.mock('../config/redisClient', () => ({
  client: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(true),
  },
  connectRedis: jest.fn().mockResolvedValue(true),
}));

// 3. Mock external libraries used in index.js
jest.mock('newrelic', () => ({
  addCustomAttribute: jest.fn(),
  noticeError: jest.fn(),
}));

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  messaging: jest.fn(() => ({
    send: jest.fn().mockResolvedValue('fake-id'),
  })),
}));

// 4. Mock Logger to keep the console clean
jest.mock('../config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// 5. Set up environment variables for tests
process.env.JWT_SECRET = 'test-jwt-secret-for-testing';
process.env.SENDGRID_API_KEY = 'test-sendgrid-key';

// 6. Mock Passport JWT strategy
jest.mock('../auth/passport', () => ({
  authenticate: jest.fn((strategy, options) => (req, res, next) => {
    // Mock authenticated user
    req.user = { id: 1, email: 'test@example.com' };
    next();
  }),
}));