/**
 * Configuration management using environment variables
 * Parcel automatically injects process.env values from .env files
 */

/**
 * Load configuration from environment variables
 * @returns {Object} Configuration object
 */
export function loadConfig() {
    // Create config object from environment variables
    const config = {
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      tokenUrl: process.env.TOKEN_URL || 'https://eightcap-embedded.auth.ap-northeast-1.amazoncognito.com/oauth2/token',
      apiBaseUrl: process.env.API_BASE_URL || 'https://api.embedded.eightcap.com',
      wsBaseUrl: process.env.WS_BASE_URL || 'wss://quote.embedded.eightcap.com'
    };
    
    validateConfig(config);
    
    return config;
  }
  
  /**
   * Validate configuration object
   * @param {Object} config - Configuration to validate
   * @throws {Error} If configuration is invalid
   */
  function validateConfig(config) {
    const requiredFields = [
      'clientId',
      'clientSecret'
    ];
    
    const missingFields = requiredFields.filter(field => !config[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required configuration: ${missingFields.join(', ')}`);
    }
  }