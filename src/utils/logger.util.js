const pino = require('pino');

const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV !== 'production' && !isTest;

const logger = pino({
  level: isTest ? 'silent' : (process.env.LOG_LEVEL || 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

module.exports = logger;

