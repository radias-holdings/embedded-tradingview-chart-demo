/**
 * Authentication service for managing tokens
 */
export class AuthService {
  constructor(config) {
    this.config = config;
    this.token = null;
    this.tokenExpiry = null;
    this.refreshTimer = null;
    this.refreshThreshold = 60000; // Refresh 60 seconds before expiry
  }

  /**
   * Get a valid token, refreshing if necessary
   */
  async getToken() {
    if (this.isTokenValid()) {
      return this.token;
    }
    return this.fetchToken();
  }

  /**
   * Check if current token is valid and not near expiry
   */
  isTokenValid() {
    return this.token && this.tokenExpiry && Date.now() < (this.tokenExpiry - this.refreshThreshold);
  }

  /**
   * Fetch a new token using client credentials
   */
  async fetchToken() {
    try {
      const { clientId, clientSecret, tokenUrl } = this.config;
      
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
        throw new Error(`Token request failed: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      this.token = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000);
      
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
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    
    if (!this.token || !this.tokenExpiry) return;
    
    const timeToRefresh = this.tokenExpiry - Date.now() - this.refreshThreshold;
    
    if (timeToRefresh <= 0) {
      this.fetchToken();
      return;
    }
    
    this.refreshTimer = setTimeout(() => this.fetchToken(), timeToRefresh);
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