/**
 * API Service for handling candle data requests and WebSocket connections
 */

// Debug logging utility
const DEBUG = true;
function log(...args) {
  if (DEBUG) {
    console.log(`[ApiService]`, ...args);
  }
}

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
    
    // Request tracking
    this.requestHistory = [];
    this.maxRequestHistorySize = 50;
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
    // Log the request
    log(`fetchWithCache - endpoint: ${endpoint}, params:`, params, `cacheKey: ${cacheKey}`);
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      log(`Cache hit for ${cacheKey}`);
      return this.cache.get(cacheKey);
    }
    
    // Check for in-flight requests
    const requestKey = `${endpoint}:${JSON.stringify(params)}`;
    if (this.pendingRequests.has(requestKey)) {
      log(`Request already in flight for ${requestKey}, returning existing promise`);
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
    
    log(`Fetching URL: ${url.toString()}`);
    
    // Track the request
    const requestInfo = {
      timestamp: Date.now(),
      endpoint,
      params: {...params},
      url: url.toString(),
      status: 'pending'
    };
    this.requestHistory.unshift(requestInfo);
    
    // Limit history size
    if (this.requestHistory.length > this.maxRequestHistorySize) {
      this.requestHistory.pop();
    }
    
    // Make request
    const requestPromise = (async () => {
      try {
        const headers = await this.getHeaders();
        const startTime = Date.now();
        const response = await fetch(url.toString(), { method: 'GET', headers });
        const duration = Date.now() - startTime;
        
        // Update request info
        requestInfo.status = response.status;
        requestInfo.duration = duration;
        
        if (!response.ok) {
          const errorText = await response.text();
          log(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
          requestInfo.error = `${response.status} ${response.statusText}`;
          throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Update request info with data summary
        if (Array.isArray(data)) {
          requestInfo.responseSize = data.length;
          requestInfo.summary = `Retrieved ${data.length} items`;
        } else {
          requestInfo.responseSize = 1;
          requestInfo.summary = 'Retrieved object';
        }
        
        log(`Request successful: ${endpoint}, items: ${Array.isArray(data) ? data.length : 'object'}, duration: ${duration}ms`);
        
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
      } catch (error) {
        log(`Request failed: ${error.message}`);
        requestInfo.status = 'error';
        requestInfo.error = error.message;
        throw error;
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
    
    log(`Fetching candles for ${symbol}@${width} from ${formattedStart ? new Date(formattedStart).toLocaleString() : 'undefined'} to ${formattedEnd ? new Date(formattedEnd).toLocaleString() : 'undefined'}, limit: ${limit || 'undefined'}`);
    
    const params = {
      symbol,
      width,
      ...(limit ? { limit } : {}),
      ...(formattedStart ? { start: formattedStart } : {}),
      ...(formattedEnd ? { end: formattedEnd } : {}),
      referer: this.config.referer
    };
    
    const cacheKey = `candles:${symbol}:${width}:${formattedStart || 'start'}:${formattedEnd || 'end'}:${limit || 'nolimit'}`;
    
    try {
      const result = await this.fetchWithCache('/candle', params, cacheKey);
      log(`Received ${result ? result.length : 0} candles for ${symbol}@${width}`);
      return result;
    } catch (error) {
      log(`Error fetching candles for ${symbol}@${width}:`, error.message);
      throw error;
    }
  }

  /**
   * Fetch instrument details
   */
  async fetchInstrument(symbol) {
    const cacheKey = `instrument:${symbol}`;
    log(`Fetching instrument data for ${symbol}`);
    
    if (this.cache.has(cacheKey)) {
      log(`Using cached instrument data for ${symbol}`);
      return this.cache.get(cacheKey);
    }
    
    // Track the request
    const requestInfo = {
      timestamp: Date.now(),
      endpoint: `/instrument/${symbol}`,
      params: {},
      status: 'pending'
    };
    this.requestHistory.unshift(requestInfo);
    
    // Limit history size
    if (this.requestHistory.length > this.maxRequestHistorySize) {
      this.requestHistory.pop();
    }
    
    try {
      const headers = await this.getHeaders();
      const startTime = Date.now();
      const url = `${this.apiBaseUrl}/instrument/${symbol}`;
      requestInfo.url = url;
      
      log(`Fetching URL: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers
      });
      
      const duration = Date.now() - startTime;
      requestInfo.duration = duration;
      requestInfo.status = response.status;
      
      if (!response.ok) {
        const errorText = await response.text();
        log(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
        requestInfo.error = `${response.status} ${response.statusText}`;
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      log(`Received instrument data for ${symbol}, duration: ${duration}ms`);
      
      requestInfo.responseSize = 1;
      requestInfo.summary = 'Retrieved instrument data';
      
      this.cache.set(cacheKey, data);
      
      return data;
    } catch (error) {
      log(`Error fetching instrument data for ${symbol}:`, error.message);
      requestInfo.status = 'error';
      requestInfo.error = error.message;
      throw error;
    }
  }

  /**
   * Initialize WebSocket connection
   */
  async connectWebSocket() {
    // Return existing connection if available
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      log('Using existing WebSocket connection');
      return this.ws;
    }
    
    // Prevent multiple simultaneous connection attempts
    if (this.wsConnecting) {
      log('WebSocket connection already in progress, waiting...');
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
    log('Initializing WebSocket connection...');
    
    try {      
      // Build WebSocket URL with subscriptions and referer
      const subscriptions = Array.from(this.subscriptions.keys());
      const queryParams = new URLSearchParams();
      
      if (subscriptions.length > 0) {
        queryParams.append('symbols', subscriptions.join(','));
        log(`Including ${subscriptions.length} active subscriptions in connection URL`);
      }
      
      // Add referer parameter if available
      if (this.config.referer) {
        queryParams.append('referer', this.config.referer);
      }
      
      const wsUrlWithParams = `${this.wsBaseUrl}/candle${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      log(`Connecting to WebSocket: ${wsUrlWithParams}`);
      
      return new Promise((resolve, reject) => {
        try {          
          this.ws = new WebSocket(wsUrlWithParams);
          
          // Set up connection handler
          this.ws.onopen = () => {
            log('WebSocket connection opened successfully');
            
            this.reconnectAttempts = 0;
            this.wsConnecting = false;
            
            // Re-subscribe to all active subscriptions
            subscriptions.forEach(sub => {
              this.ws.send(sub);
              log(`Re-subscribed to ${sub}`);
            });
            
            resolve(this.ws);
          };
          
          this.ws.onmessage = (event) => {
            // Handle ping messages
            if (event.data === 'ping') {
              this.ws.send('pong');
              log('Received ping, sent pong');
              return;
            }
            
            try {
              const data = JSON.parse(event.data);
              log(`Received WebSocket message: ${data.symbol}@${data.width}`);
              this.handleWebSocketMessage(data);
            } catch (error) {
              console.error('Error processing WebSocket message:', error);
              log('Error processing WebSocket message:', error.message, 'Raw data:', event.data);
            }
          };
          
          this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            log('WebSocket error:', error);
            this.wsConnecting = false;
            reject(error);
          };
          
          this.ws.onclose = (event) => {
            log(`WebSocket closed: ${event.code} - ${event.reason}`);
            this.ws = null;
            this.wsConnecting = false;
            
            // Attempt reconnection
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
              this.reconnectAttempts++;
              const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
              
              log(`Will attempt to reconnect in ${delay}ms (attempt ${this.reconnectAttempts} of ${this.maxReconnectAttempts})`);
              setTimeout(() => {
                this.connectWebSocket().catch(err => {
                  log('WebSocket reconnection failed:', err.message);
                });
              }, delay);
            } else {
              log('Maximum reconnection attempts reached');
            }
          };
        } catch (error) {
          this.wsConnecting = false;
          log('Error creating WebSocket:', error.message);
          reject(error);
        }
      });
    } catch (error) {
      this.wsConnecting = false;
      log('Error in connectWebSocket:', error.message);
      throw error;
    }
  }

  /**
   * Handle data received from WebSocket
   */
  handleWebSocketMessage(data) {
    if (!data || !data.symbol || !data.width) {
      log('Received invalid WebSocket message:', data);
      return;
    }
    
    const key = `${data.symbol}@${data.width}`;
    
    if (this.subscriptions.has(key)) {
      const callbacks = this.subscriptions.get(key);
      log(`Found ${callbacks.size} callbacks for ${key}`);
      
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in WebSocket callback for ${key}:`, error);
          log(`Error in WebSocket callback for ${key}:`, error.message);
        }
      });
    } else {
      log(`No callbacks registered for ${key}`);
    }
  }

  /**
   * Subscribe to real-time candle updates
   */
  async subscribeToCandles(symbol, width, callback) {
    const key = `${symbol}@${width}`;
    log(`Subscribing to ${key}`);
    
    // Initialize callback set if needed
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
      log(`Created new subscription for ${key}`);
    }
    
    // Add callback to the set
    this.subscriptions.get(key).add(callback);
    log(`Added callback for ${key}, now has ${this.subscriptions.get(key).size} callbacks`);
    
    // Ensure WebSocket is connected
    try {
      const ws = await this.connectWebSocket();
      
      // Send subscription message
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(key);
        log(`Sent subscription message for ${key}`);
      } else {
        log(`WebSocket not open, state: ${ws.readyState}`);
      }
    } catch (error) {
      console.error('Failed to subscribe to WebSocket:', error);
      log('Failed to subscribe to WebSocket:', error.message);
    }
  }

  /**
   * Unsubscribe from real-time candle updates
   */
  async unsubscribeFromCandles(symbol, width, callback) {
    const key = `${symbol}@${width}`;
    log(`Unsubscribing from ${key}`);
    
    if (!this.subscriptions.has(key)) {
      log(`No subscription found for ${key}`);
      return;
    }
    
    if (callback) {
      // Remove specific callback
      const callbacks = this.subscriptions.get(key);
      callbacks.delete(callback);
      log(`Removed callback for ${key}, ${callbacks.size} callbacks remaining`);
      
      // If callbacks remain, don't unsubscribe
      if (callbacks.size > 0) {
        log(`Callbacks remain for ${key}, not sending unsubscribe message`);
        return;
      }
    }
    
    // Remove all callbacks for this key
    this.subscriptions.delete(key);
    log(`Removed all callbacks for ${key}`);
    
    // Send unsubscribe message if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(`-${key}`);
      log(`Sent unsubscribe message for ${key}`);
    } else {
      log(`WebSocket not open, couldn't send unsubscribe message for ${key}`);
    }
  }

  /**
   * Get request history for debugging
   */
  getRequestHistory() {
    return [...this.requestHistory];
  }
  
  /**
   * Clear cached data for a specific symbol or all symbols
   * This is useful when debugging issues with data loading
   */
  clearCache(symbol = null) {
    if (symbol) {
      // Clear cache for specific symbol
      const keysToDelete = [];
      
      // Find all keys related to this symbol
      for (const key of this.cache.keys()) {
        if (key.includes(symbol)) {
          keysToDelete.push(key);
        }
      }
      
      // Delete the keys
      keysToDelete.forEach(key => {
        this.cache.delete(key);
        log(`Cleared cache for key: ${key}`);
      });
      
      return keysToDelete.length;
    } else {
      // Clear all cache
      const count = this.cache.size;
      this.cache.clear();
      log(`Cleared entire cache (${count} items)`);
      return count;
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    log('Cleaning up API service');
    
    if (this.ws) {
      log('Closing WebSocket connection');
      this.ws.close();
      this.ws = null;
    }
    
    log(`Clearing ${this.subscriptions.size} subscriptions`);
    this.subscriptions.clear();
    
    log(`Clearing ${this.pendingRequests.size} pending requests`);
    this.pendingRequests.clear();
    
    log(`Clearing ${this.cache.size} cached items`);
    this.cache.clear();
    
    log('Cleanup complete');
  }
}

export default ApiService;