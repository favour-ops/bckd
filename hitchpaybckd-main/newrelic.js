'use strict'
/**
 * New Relic agent configuration.
 *
 * See lib/config/defaults.js in the agent distribution for a more complete
 * description of configuration variables and their potential values.
 */
exports.config = {
  /**
   * Array of application names.
   */
  app_name: ['HitchPay Backend'],
  /**
   * Your New Relic license key.
   * This is required!
   * @env NEW_RELIC_LICENSE_KEY
   */
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  logging: {
    /**
     * Level at which to log. 'info' is recommended for production.
     */
    level: 'info'
  },
  /**
   * When true, all request headers are collected for transaction traces,
   * captured events and error traces.
   */
  allow_all_headers: true,
  attributes: {
    /**
     * Prefix of attributes to exclude from all destinations. Allows * as wildcard
     * at end.
     */
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
      'response.headers.cookie',
      'response.headers.authorization'
    ]
  }
}