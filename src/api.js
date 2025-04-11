/**
 * API Service for handling candle data requests and WebSocket connections
 */
export class ApiService {
    constructor(authService, options = {}) {
      this.authService = authService;
      this.apiBaseUrl = options.apiBaseUrl || 'https://api.embedded.eightcap.com';
      this.wsBaseUrl = options.wsBaseUrl || 'wss://quote.embedded.eightcap.com';
      
      // WebSocket state
      this.ws = null;
      this.wsConnectionPromise = null;
      this.wsReconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
      this.reconnectDelay = 2000; // Start with 2 seconds
      this.wsSubscriptions = new Map(); // Map of subscription key -> Set of callbacks
      
      // Cache management
      this.instrumentCache = new Map(); // Cache for instrument data
      this.historicalDataCache = new Map(); // Cache for historical data
      this.pendingRequests = new Map(); // Cache for in-flight requests
      
      // Initialize token
      this.bearerToken = null;
      this._initializeToken();
    }
  
    /**
     * Initialize token and set up refresh mechanism
     * @private
     */
    async _initializeToken() {
      try {
        // Get initial token
        const token = await this.authService.getToken();
        this.bearerToken = token;
      } catch (error) {
        console.error('Failed to initialize token:', error);
      }
    }
  
    /**
     * Generate headers for API requests
     * @returns {Object} Headers object with authorization
     */
    async getHeaders() {
      // Ensure we have a valid token
      if (!this.bearerToken) {
        this.bearerToken = await this.authService.getToken();
      }
      
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.bearerToken}`
      };
    }
  
    /**
     * Generate cache key for various data types
     * @param {string} prefix - Cache type prefix
     * @param {Object} params - Parameters to include in the key
     * @returns {string} Cache key
     */
    generateCacheKey(prefix, params) {
      return `${prefix}:${JSON.stringify(params)}`;
    }
  
    /**
     * Fetch data from API with caching and deduplication
     * @param {string} endpoint - API endpoint
     * @param {Object} params - Query parameters
     * @param {string} cachePrefix - Cache prefix for this request type
     * @param {function} transformData - Function to transform response data
     * @returns {Promise<any>} API response data
     */
    async fetchWithCache(endpoint, params, cachePrefix, transformData = data => data) {
      const cacheKey = this.generateCacheKey(cachePrefix, params);
      const requestKey = this.generateCacheKey(endpoint, params);
      
      console.log(`API request: ${endpoint}`, params);
      
      // Check cache first
      const cachedData = this.historicalDataCache.get(cacheKey);
      if (cachedData) {
        console.log(`Using cached data for ${cacheKey}`);
        return cachedData;
      }
      
      // Check if identical request is already in flight
      if (this.pendingRequests.has(requestKey)) {
        console.log(`Reusing in-flight request for ${requestKey}`);
        return this.pendingRequests.get(requestKey);
      }
      
      // Build URL with parameters
      const url = new URL(`${this.apiBaseUrl}${endpoint}`);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, value.toString());
        }
      });
      
      console.log(`Fetching data from: ${url.toString()}`);
      
      const requestPromise = (async () => {
        try {
          const headers = await this.getHeaders();
          console.log('Request headers:', headers);
          
          const response = await fetch(url.toString(), {
            method: 'GET',
            headers
          });
          
          console.log(`Response status: ${response.status}`);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`API error (${response.status}):`, errorText);
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json();
          console.log(`Received data from API, type: ${typeof data}, length: ${Array.isArray(data) ? data.length : 'n/a'}`);
          
          const transformedData = transformData(data);
          
          // Cache the result if it's not empty
          if (transformedData && 
             (Array.isArray(transformedData) ? transformedData.length > 0 : true)) {
            console.log(`Caching data for ${cacheKey}`);
            this.historicalDataCache.set(cacheKey, transformedData);
            
            // Limit cache size
            if (this.historicalDataCache.size > 100) {
              const firstKey = this.historicalDataCache.keys().next().value;
              this.historicalDataCache.delete(firstKey);
            }
          }
          
          return transformedData;
        } catch (error) {
          console.error(`Error fetching from ${endpoint}:`, error);
          throw error;
        } finally {
          this.pendingRequests.delete(requestKey);
        }
      })();
      
      // Store promise for potential future identical requests
      this.pendingRequests.set(requestKey, requestPromise);
      
      return requestPromise;
    }
  
    /**
     * Fetch historical candle data
     * @param {string} symbol - Instrument symbol
     * @param {string} width - Candle width (e.g., '1m', '5m', '1d')
     * @param {Object} options - Request options
     * @returns {Promise<Array>} Array of candle data
     */
    async fetchCandles(symbol, width, options = {}) {
      const { limit, start, end } = options;
      
      const params = {
        symbol,
        width,
        ...(limit ? { limit } : {}),
        ...(start ? { start } : {}),
        ...(end ? { end } : {})
      };
      
      return this.fetchWithCache(
        '/candle', 
        params, 
        `candles:${symbol}:${width}:${start || 'start'}:${end || 'end'}`
      );
    }
  
    /**
     * Fetch instrument details
     * @param {string} symbol - Instrument symbol
     * @returns {Promise<Object>} Instrument details
     */
    async fetchInstrument(symbol) {
      // Check instrument cache first
      if (this.instrumentCache.has(symbol)) {
        return this.instrumentCache.get(symbol);
      }
      
      const requestKey = `/instrument/${symbol}`;
      
      // Check if identical request is already in flight
      if (this.pendingRequests.has(requestKey)) {
        return this.pendingRequests.get(requestKey);
      }
      
      const url = `${this.apiBaseUrl}/instrument/${symbol}`;
      
      // Create request promise
      const requestPromise = (async () => {
        try {
          const headers = await this.getHeaders();
          const response = await fetch(url, {
            method: 'GET',
            headers
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`API error (${response.status}):`, errorText);
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json();
          
          // Cache the instrument data
          this.instrumentCache.set(symbol, data);
          
          return data;
        } catch (error) {
          console.error(`Error fetching instrument data for ${symbol}:`, error);
          throw error;
        } finally {
          // Remove from pending requests
          this.pendingRequests.delete(requestKey);
        }
      })();
      
      // Store promise for potential future identical requests
      this.pendingRequests.set(requestKey, requestPromise);
      
      return requestPromise;
    }
  
    /**
     * Initialize WebSocket connection with authentication
     * @returns {Promise<WebSocket>} WebSocket instance
     */
    async initWebSocket() {
      // If already connecting, return the existing promise
      if (this.wsConnectionPromise) {
        return this.wsConnectionPromise;
      }
      
      // If already connected, return the existing connection
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return this.ws;
      }
      
      // Ensure we have a token
      if (!this.bearerToken) {
        this.bearerToken = await this.authService.getToken();
      }
      
      this.wsConnectionPromise = (async () => {
        try {
          // Build the WebSocket URL with authentication token
          const queryParams = new URLSearchParams();
          queryParams.append('token', this.bearerToken);
          
          // Include initial subscriptions if any
          const subscriptions = Array.from(this.wsSubscriptions.keys());
          if (subscriptions.length > 0) {
            queryParams.append('symbols', subscriptions.join(','));
          }
          
          const wsUrl = `${this.wsBaseUrl}/candle?${queryParams.toString()}`;
          
          // Create a promise that resolves when connection is established
          const connectionPromise = new Promise((resolve, reject) => {
            let socket;
            try {
              socket = new WebSocket(wsUrl);
            } catch (error) {
              console.error('Error creating WebSocket:', error);
              reject(error);
              return;
            }
            
            socket.onopen = () => {
              console.log('WebSocket connection established');
              // Reset reconnect attempts on successful connection
              this.wsReconnectAttempts = 0;
              this.reconnectDelay = 2000;
              resolve(socket);
            };
            
            socket.onmessage = (event) => {
              try {
                const data = JSON.parse(event.data);
                this.processWebSocketData(data);
              } catch (error) {
                console.error('Error processing WebSocket message:', error);
              }
            };
            
            socket.onerror = (error) => {
              console.error('WebSocket error:', error);
              reject(error);
            };
            
            socket.onclose = (event) => {
              console.log(`WebSocket connection closed: ${event.code} ${event.reason}`);
              this.ws = null;
              
              // Check if we should attempt to reconnect
              if (this.wsReconnectAttempts < this.maxReconnectAttempts) {
                this.wsReconnectAttempts++;
                // Exponential backoff for reconnect
                const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.wsReconnectAttempts), 30000);
                
                setTimeout(() => {
                  this.wsConnectionPromise = null;
                  this.initWebSocket();
                }, delay);
              }
            };
            
            this.ws = socket;
          });
          
          await connectionPromise;
          return this.ws;
        } catch (error) {
          console.error('Error establishing WebSocket connection:', error);
          throw error;
        } finally {
          this.wsConnectionPromise = null;
        }
      })();
      
      return this.wsConnectionPromise;
    }
  
    /**
     * Process data received from WebSocket
     * @param {Object} data - Candle data from WebSocket
     */
    processWebSocketData(data) {
      if (!data || !data.symbol || !data.width) {
        console.warn('Invalid WebSocket data format:', data);
        return;
      }
      
      const key = `${data.symbol}@${data.width}`;
      
      // Call registered callbacks for this symbol and width
      if (this.wsSubscriptions.has(key)) {
        const callbacks = this.wsSubscriptions.get(key);
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
     * @param {string} symbol - Instrument symbol
     * @param {string} width - Candle width
     * @param {Function} callback - Callback function for data updates
     * @returns {Promise<void>}
     */
    async subscribeToCandles(symbol, width, callback) {
      const key = `${symbol}@${width}`;
      
      // Initialize callback set if not exists
      if (!this.wsSubscriptions.has(key)) {
        this.wsSubscriptions.set(key, new Set());
      }
      
      // Add callback
      this.wsSubscriptions.get(key).add(callback);
      
      // Initialize WebSocket if not already done
      let socket;
      try {
        socket = await this.initWebSocket();
      } catch (error) {
        console.error('Failed to initialize WebSocket for subscription:', error);
        return;
      }
      
      // Send subscription message if socket is open
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(key);
        console.log(`Subscribed to ${key}`);
      }
    }
  
    /**
     * Unsubscribe from real-time candle updates
     * @param {string} symbol - Instrument symbol
     * @param {string} width - Candle width
     * @param {Function} [callback] - Specific callback to remove (if undefined, remove all)
     * @returns {Promise<void>}
     */
    async unsubscribeFromCandles(symbol, width, callback) {
      const key = `${symbol}@${width}`;
      
      if (!this.wsSubscriptions.has(key)) {
        return; // No subscriptions to this key
      }
      
      if (callback) {
        // Remove specific callback
        const callbacks = this.wsSubscriptions.get(key);
        callbacks.delete(callback);
        
        // If callbacks remain, don't send unsubscribe message
        if (callbacks.size > 0) {
          return;
        }
      }
      
      // Remove all callbacks for this key
      this.wsSubscriptions.delete(key);
      
      // Send unsubscribe message if WebSocket is open
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(`-${key}`);
        console.log(`Unsubscribed from ${key}`);
      }
    }
  
    /**
     * Close the WebSocket connection and clean up resources
     */
    cleanup() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      
      this.wsSubscriptions.clear();
      this.pendingRequests.clear();
    }
  }
  
  export default ApiService;