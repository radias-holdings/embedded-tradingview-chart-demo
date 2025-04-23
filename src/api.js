/**
 * API Service for handling candle data requests and WebSocket connections
 */
export class ApiService {
  constructor(authService, config) {
    this.authService = authService;
    this.apiBaseUrl = config.apiBaseUrl;
    this.wsBaseUrl = config.wsBaseUrl;
    this.config = config;
    
    // Cache management
    this.cache = new Map();
    this.pendingRequests = new Map();
    
    // WebSocket state
    this.ws = null;
    this.wsConnecting = false;
    this.subscriptions = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  /**
   * Get authentication headers for API requests
   */
  async getHeaders() {
    const token = await this.authService.getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  /**
   * Fetch data with caching and request deduplication
   */
  async fetchWithCache(endpoint, params, cacheKey) {
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // Check for in-flight requests
    const requestKey = `${endpoint}:${JSON.stringify(params)}`;
    if (this.pendingRequests.has(requestKey)) {
      return this.pendingRequests.get(requestKey);
    }
    
    // Build URL
    const url = new URL(`${this.apiBaseUrl}${endpoint}`);
    
    // Add referer param if available
    if (this.config.referer && !params.referer) {
      params.referer = this.config.referer;
    }
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });
    
    // Make request
    const requestPromise = (async () => {
      try {
        const headers = await this.getHeaders();
        const response = await fetch(url.toString(), { method: 'GET', headers });
        
        if (!response.ok) {
          throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Cache result if not empty
        if (data && (Array.isArray(data) ? data.length > 0 : true)) {
          this.cache.set(cacheKey, data);
          
          // Limit cache size
          if (this.cache.size > 100) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
          }
        }
        
        return data;
      } finally {
        this.pendingRequests.delete(requestKey);
      }
    })();
    
    // Store promise for deduplication
    this.pendingRequests.set(requestKey, requestPromise);
    
    return requestPromise;
  }

  /**
   * Fetch historical candle data
   */
  async fetchCandles(symbol, width, options = {}) {
    const { limit, start, end } = options;
    
    // Ensure timestamps are integers
    const formattedStart = start ? Math.floor(start) : undefined;
    const formattedEnd = end ? Math.floor(end) : undefined;
    
    const params = {
      symbol,
      width,
      ...(limit ? { limit } : {}),
      ...(formattedStart ? { start: formattedStart } : {}),
      ...(formattedEnd ? { end: formattedEnd } : {}),
      referer: this.config.referer
    };
    
    const cacheKey = `candles:${symbol}:${width}:${formattedStart || 'start'}:${formattedEnd || 'end'}:${limit || 'nolimit'}`;
    
    return this.fetchWithCache('/candle', params, cacheKey);
  }

  /**
   * Fetch instrument details
   */
  async fetchInstrument(symbol) {
    const cacheKey = `instrument:${symbol}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    try {
      const headers = await this.getHeaders();
      const response = await fetch(`${this.apiBaseUrl}/instrument/${symbol}`, {
        method: 'GET',
        headers
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      this.cache.set(cacheKey, data);
      
      return data;
    } catch (error) {
      console.error(`Error fetching instrument data for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Initialize WebSocket connection
   */
  async connectWebSocket() {
    // Return existing connection if available
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.ws;
    }
    
    // Prevent multiple simultaneous connection attempts
    if (this.wsConnecting) {
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            clearInterval(checkInterval);
            resolve(this.ws);
          } else if (!this.wsConnecting) {
            clearInterval(checkInterval);
            reject(new Error('WebSocket connection failed'));
          }
        }, 100);
      });
    }
    
    this.wsConnecting = true;
    
    try {      
      // Build WebSocket URL with subscriptions and referer
      const subscriptions = Array.from(this.subscriptions.keys());
      const queryParams = new URLSearchParams();
      
      if (subscriptions.length > 0) {
        queryParams.append('symbols', subscriptions.join(','));
      }
      
      // Add referer parameter if available
      if (this.config.referer) {
        queryParams.append('referer', this.config.referer);
      }
      
      const wsUrlWithParams = `${this.wsBaseUrl}/candle${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      console.log(`Connecting to WebSocket: ${wsUrlWithParams}`);
      
      return new Promise((resolve, reject) => {
        try {          
          this.ws = new WebSocket(wsUrlWithParams);
          
          // Set up connection handler
          this.ws.onopen = () => {
            console.log('WebSocket connection opened');
          
            
            this.reconnectAttempts = 0;
            this.wsConnecting = false;
            
            // Re-subscribe to all active subscriptions
            subscriptions.forEach(sub => {
              this.ws.send(sub);
              console.log(`Subscribed to ${sub}`);
            });
            
            resolve(this.ws);
          };
          
          this.ws.onmessage = (event) => {
            // Handle ping messages
            if (event.data === 'ping') {
              this.ws.send('pong');
              console.log('Received ping, sent pong');
              return;
            }
            
            try {
              const data = JSON.parse(event.data);
              console.log('Received WebSocket message:', data);
              this.handleWebSocketMessage(data);
            } catch (error) {
              console.error('Error processing WebSocket message:', error, 'Raw data:', event.data);
            }
          };
          
          this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.wsConnecting = false;
            reject(error);
          };
          
          this.ws.onclose = (event) => {
            console.log(`WebSocket closed: ${event.code} - ${event.reason}`);
            this.ws = null;
            this.wsConnecting = false;
            
            // Attempt reconnection
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
              this.reconnectAttempts++;
              const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
              
              console.log(`Will attempt to reconnect in ${delay}ms`);
              setTimeout(() => {
                this.connectWebSocket().catch(err => {
                  console.error('WebSocket reconnection failed:', err);
                });
              }, delay);
            }
          };
        } catch (error) {
          this.wsConnecting = false;
          reject(error);
        }
      });
    } catch (error) {
      this.wsConnecting = false;
      throw error;
    }
  }

  /**
   * Handle data received from WebSocket
   */
  handleWebSocketMessage(data) {
    if (!data || !data.symbol || !data.width) return;
    
    const key = `${data.symbol}@${data.width}`;
    
    if (this.subscriptions.has(key)) {
      const callbacks = this.subscriptions.get(key);
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in WebSocket callback for ${key}:`, error);
        }
      });
    }
  }

  /**
   * Subscribe to real-time candle updates
   */
  async subscribeToCandles(symbol, width, callback) {
    const key = `${symbol}@${width}`;
    
    // Initialize callback set if needed
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }
    
    // Add callback to the set
    this.subscriptions.get(key).add(callback);
    
    // Ensure WebSocket is connected
    try {
      const ws = await this.connectWebSocket();
      
      // Send subscription message
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(key);
        console.log(`Subscribed to ${key}`);
      }
    } catch (error) {
      console.error('Failed to subscribe to WebSocket:', error);
    }
  }

  /**
   * Unsubscribe from real-time candle updates
   */
  async unsubscribeFromCandles(symbol, width, callback) {
    const key = `${symbol}@${width}`;
    
    if (!this.subscriptions.has(key)) return;
    
    if (callback) {
      // Remove specific callback
      const callbacks = this.subscriptions.get(key);
      callbacks.delete(callback);
      
      // If callbacks remain, don't unsubscribe
      if (callbacks.size > 0) return;
    }
    
    // Remove all callbacks for this key
    this.subscriptions.delete(key);
    
    // Send unsubscribe message if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(`-${key}`);
      console.log(`Unsubscribed from ${key}`);
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.subscriptions.clear();
    this.pendingRequests.clear();
    this.cache.clear();
  }
}

export default ApiService;