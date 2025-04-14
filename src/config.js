/**
 * Configuration management
 */

/**
 * Load configuration from environment variables
 */
export function loadConfig() {
  const config = {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    referer: process.env.REFERER,
    tokenUrl: process.env.TOKEN_URL || 'https://eightcap-embedded.auth.ap-northeast-1.amazoncognito.com/oauth2/token',
    apiBaseUrl: process.env.API_BASE_URL || 'https://api.embedded.eightcap.com',
    wsBaseUrl: process.env.WS_BASE_URL || 'wss://quote.embedded.eightcap.com',
  };
  
  // Validate required fields
  const requiredFields = ['clientId', 'clientSecret', 'referer'];
  const missingFields = requiredFields.filter(field => !config[field]);
  
  if (missingFields.length > 0) {
    throw new Error(`Missing required configuration: ${missingFields.join(', ')}`);
  }
  
  return config;
}