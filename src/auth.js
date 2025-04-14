import { loadConfig } from './config.js';

/**
 * Authentication service for managing AWS Cognito tokens
 */
export class AuthService {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
    this.refreshPromise = null;
    this.refreshThreshold = 60000; // Refresh 60 seconds before expiry
    this.credentials = null;
    this.refreshTimer = null;
  }

  /**
   * Load credentials from configuration
   * @returns {Object} Client credentials
   */
  loadCredentials() {
    try {
      this.credentials = loadConfig();
      
      // Validate the configuration
      if (!this.credentials.clientId || !this.credentials.clientSecret) {
        throw new Error('Missing clientId or clientSecret in configuration');
      }
      
      console.log('Configuration loaded successfully');
      return this.credentials;
    } catch (error) {
      console.error('Error loading credentials:', error);
      throw error;
    }
  }

  /**
   * Check if current token is valid
   * @returns {boolean} True if token is valid and not near expiry
   */
  isTokenValid() {
    if (!this.token || !this.tokenExpiry) {
      return false;
    }
    
    const now = Date.now();
    return now < (this.tokenExpiry - this.refreshThreshold);
  }

  /**
   * Fetch a new token using client credentials
   * @returns {Promise<string>} New bearer token
   */
  async fetchToken() {
    // Make sure credentials are loaded
    if (!this.credentials) {
      await this.loadCredentials();
    }
    
    const { clientId, clientSecret, tokenUrl } = this.credentials;
    
    try {
      // Create form data for token request
      const formData = new URLSearchParams();
      formData.append('grant_type', 'client_credentials');
      formData.append('client_id', clientId);
      
      const authHeader = 'Basic ' + btoa(`${clientId}:${clientSecret}`);
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token response error:', response.status, errorText);
        throw new Error(`Token request failed: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Calculate token expiry time (current time + expires_in seconds)
      this.token = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000);
      
      // Schedule token refresh
      this.scheduleTokenRefresh();
      
      return this.token;
    } catch (error) {
      console.error('Error fetching token:', error);
      throw error;
    }
  }

  /**
   * Schedule token refresh before it expires
   */
  scheduleTokenRefresh() {
    // Clear any existing refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    
    if (!this.token || !this.tokenExpiry) {
      return;
    }
    
    const now = Date.now();
    const timeToRefresh = this.tokenExpiry - now - this.refreshThreshold;
    
    if (timeToRefresh <= 0) {
      // Token is already expired or about to expire, refresh immediately
      this.refreshToken();
      return;
    }
    
    // Schedule refresh
    this.refreshTimer = setTimeout(() => {
      this.refreshToken();
    }, timeToRefresh);
  }

  /**
   * Refresh the token
   * @returns {Promise<string>} Refreshed bearer token
   */
  async refreshToken() {
    // Only allow one refresh process at a time
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    
    this.refreshPromise = this.fetchToken();
    
    try {
      const token = await this.refreshPromise;
      return token;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Get a valid token, refreshing if necessary
   * @returns {Promise<string>} Valid bearer token
   */
  async getToken() {
    if (this.isTokenValid()) {
      return this.token;
    }
    
    return this.refreshToken();
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

export default AuthService;