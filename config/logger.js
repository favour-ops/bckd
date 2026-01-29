// @/config/logger.ts (Create this file in your config directory)
const { format, transports, createLogger } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const moment = require('moment-timezone');

const enumerateErrorFormat = format(info => {
  if (info.message instanceof Error) {
    info.message = Object.assign(
      { message: info.message.message, stack: info.message.stack },
      info.message
    );
  }

  if (info instanceof Error) {
    return Object.assign(
      { message: info.message, stack: info.stack },
      info
    );
  }
  return info;
});

// Define custom timestamp format with timezone
const timestampWithTimezone = format(info => {
  info.timestamp = moment().tz('Africa/Lagos').format();
  return info;
});

const jsonFormat = format.printf(({ level, message, timestamp, stack }) => {
  return JSON.stringify({ eventTime: timestamp, level, message, stack });
});

const transport = new DailyRotateFile({
  filename: (process.env.LOG_FOLDER || 'logs/') + (process.env.LOG_FILE || 'app-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d', // Keep logs for 14 days
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info', // set default log level
  format: format.combine(
    timestampWithTimezone(),
    enumerateErrorFormat(),
    format.splat(),
    format.errors({ stack: true }), 
    jsonFormat 
  ),
  transports: [
    transport,
    new transports.Console({
      level: 'debug',  // set default level
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
  ],
});

module.exports = { logger };
