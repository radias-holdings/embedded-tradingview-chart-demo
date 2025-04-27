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
    this.cachedRanges = new Map();

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
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * Store range info for data in cache
   */
  _storeCachedRange(symbol, width, start, end) {
    const key = `${symbol}:${width}`;
    const ranges = this.cachedRanges.get(key) || [];
    
    // Add the new range
    ranges.push({ start, end });
    
    // Merge overlapping ranges
    if (ranges.length > 1) {
      ranges.sort((a, b) => a.start - b.start);
      
      const mergedRanges = [ranges[0]];
      
      for (let i = 1; i < ranges.length; i++) {
        const currentRange = ranges[i];
        const lastMerged = mergedRanges[mergedRanges.length - 1];
        
        if (currentRange.start <= lastMerged.end) {
          // Ranges overlap, extend the previous range
          lastMerged.end = Math.max(lastMerged.end, currentRange.end);
        } else {
          // No overlap, add as new range
          mergedRanges.push(currentRange);
        }
      }
      
      this.cachedRanges.set(key, mergedRanges);
    } else {
      this.cachedRanges.set(key, ranges);
    }
  }

  /**
   * Check if a range is already in cache
   */
  _isRangeInCache(symbol, width, start, end) {
    const key = `${symbol}:${width}`;
    const ranges = this.cachedRanges.get(key);
    
    if (!ranges || ranges.length === 0) return false;
    
    // Check if any cached range fully contains the requested range
    return ranges.some(range => range.start <= start && range.end >= end);
  }

  /**
   * Fetch data with caching and request deduplication
   */
  async fetchWithCache(endpoint, params, cacheKey) {
    // For candle requests, check if range is already in cache
    if (endpoint === '/candle' && params.symbol && params.width && 
        params.start && params.end) {
      
      if (this._isRangeInCache(params.symbol, params.width, params.start, params.end)) {
        console.log(`💾 Range already in cache for: ${params.symbol}@${params.width}`);
        // Find the cached data
        const possibleCache = Array.from(this.cache.entries())
          .filter(([key, _]) => key.startsWith(`candles:${params.symbol}:${params.width}:`))
          .sort((a, b) => b[1].length - a[1].length) // Sort by data length (most data first)
          .map(([_, value]) => value)[0];
          
        if (possibleCache) {
          console.log(`🔍 Using existing cached data for range: ${new Date(params.start).toISOString()} - ${new Date(params.end).toISOString()}`);
          return possibleCache;
        }
      }
    }


    // Check for in-flight requests with overlapping ranges
    const requestKey = `${endpoint}:${JSON.stringify(params)}`;
    
    if (endpoint === '/candle' && params.symbol && params.width) {
      // Look for an existing request that might satisfy this one
      const pendingRequest = this._findOverlappingRequest(params);
      if (pendingRequest) {
        console.log(`⏳ Using existing in-flight request with overlapping range for: ${params.symbol}@${params.width}`);
        return pendingRequest;
      }
    } else if (this.pendingRequests.has(requestKey)) {
      // For non-candle requests, check for exact matches
      console.log(`⏳ Using in-flight request for: ${requestKey}`);
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
        const response = await fetch(url.toString(), {
          method: "GET",
          headers,
        });

        if (!response.ok) {
          throw new Error(
            `API request failed: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();

        // Cache result if not empty
        if (data && (Array.isArray(data) ? data.length > 0 : true)) {
          this.cache.set(cacheKey, data);

          // For candle data, store range info
          if (endpoint === '/candle' && params.symbol && params.width && 
              params.start && params.end && Array.isArray(data) && data.length > 0) {
            this._storeCachedRange(params.symbol, params.width, Number(params.start), Number(params.end));
          }

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
   * Find an existing pending request that covers the same data range
   */
  _findOverlappingRequest(params) {
    const targetStart = params.start ? Number(params.start) : 0;
    const targetEnd = params.end ? Number(params.end) : Date.now();
    const targetSymbol = params.symbol;
    const targetWidth = params.width;

    // Check all pending requests
    for (const [key, promise] of this.pendingRequests.entries()) {
      if (!key.startsWith('/candle:')) continue;

      try {
        // Parse existing request params
        const existingParams = JSON.parse(key.split(':', 2)[1]);
        
        // Only consider requests for the same symbol and width
        if (existingParams.symbol !== targetSymbol || existingParams.width !== targetWidth) {
          continue;
        }

        const existingStart = existingParams.start ? Number(existingParams.start) : 0;
        const existingEnd = existingParams.end ? Number(existingParams.end) : Date.now();
        
        // Ranges overlap if one contains the other
        const rangeContained = (existingStart <= targetStart && existingEnd >= targetEnd) ||
                              (targetStart <= existingStart && targetEnd >= existingEnd);
                              
        // Or if they partially overlap
        const rangesOverlap = (existingStart <= targetEnd && existingEnd >= targetStart);
        
        // Use the request if it contains our range or has significant overlap
        const significantOverlap = rangeContained || 
                                  (rangesOverlap && 
                                   (Math.min(targetEnd, existingEnd) - Math.max(targetStart, existingStart)) / 
                                   (targetEnd - targetStart) > 0.7);

        if (significantOverlap) {
          console.log(`🔄 Found overlapping request for ${targetSymbol}@${targetWidth}`, {
            existing: `${new Date(existingStart).toISOString()} - ${new Date(existingEnd).toISOString()}`,
            requested: `${new Date(targetStart).toISOString()} - ${new Date(targetEnd).toISOString()}`
          });
          return promise;
        }
      } catch (error) {
        // Skip if we can't parse the key
        console.error(`Error parsing key ${key}:`, error);
        continue;
      }
    }

    return null;
  }

  /**
   * Fetch historical candle data
   */
  async fetchCandles(symbol, width, options = {}) {
    const { limit, start, end } = options;

    // Ensure timestamps are integers
    const formattedStart = start ? Math.floor(start) : undefined;
    const formattedEnd = end ? Math.floor(end) : undefined;

    // If start is in future, don't bother with request
    if (formattedStart && formattedStart > Date.now()) {
      console.log(
        `Start time ${new Date(formattedStart).toISOString()} is in the future. No request made.`
      );
      return null;
    }

    const params = {
      symbol,
      width,
      ...(limit ? { limit } : {}),
      ...(formattedStart ? { start: formattedStart } : {}),
      ...(formattedEnd ? { end: formattedEnd } : {}),
      referer: this.config.referer,
    };

    console.log(`📊 API Request: ${symbol}@${width}`, {
      start: formattedStart
        ? new Date(formattedStart).toISOString()
        : "undefined",
      end: formattedEnd ? new Date(formattedEnd).toISOString() : "undefined",
      limit: limit || "no limit",
    });

    const cacheKey = `candles:${symbol}:${width}:${formattedStart || "start"}:${
      formattedEnd || "end"
    }:${limit || "nolimit"}`;

    return this.fetchWithCache("/candle", params, cacheKey);
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
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`
        );
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
            reject(new Error("WebSocket connection failed"));
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
        queryParams.append("symbols", subscriptions.join(","));
      }

      // Add referer parameter if available
      if (this.config.referer) {
        queryParams.append("referer", this.config.referer);
      }

      const wsUrlWithParams = `${this.wsBaseUrl}/candle${
        queryParams.toString() ? `?${queryParams.toString()}` : ""
      }`;
      console.log(`Connecting to WebSocket: ${wsUrlWithParams}`);

      return new Promise((resolve, reject) => {
        try {
          this.ws = new WebSocket(wsUrlWithParams);

          // Set up connection handler
          this.ws.onopen = () => {
            console.log("WebSocket connection opened");

            this.reconnectAttempts = 0;
            this.wsConnecting = false;

            // Re-subscribe to all active subscriptions
            subscriptions.forEach((sub) => {
              this.ws.send(sub);
            });

            resolve(this.ws);
          };

          this.ws.onmessage = (event) => {
            // Handle ping messages
            if (event.data === "ping") {
              this.ws.send("pong");
              console.log("Received ping, sent pong");
              return;
            }

            try {
              const data = JSON.parse(event.data);
              console.log("Received WebSocket message:", data);
              this.handleWebSocketMessage(data);
            } catch (error) {
              console.error(
                "Error processing WebSocket message:",
                error,
                "Raw data:",
                event.data
              );
            }
          };

          this.ws.onerror = (error) => {
            console.error("WebSocket error:", error);
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
              const delay = Math.min(
                1000 * Math.pow(2, this.reconnectAttempts),
                30000
              );

              console.log(`Will attempt to reconnect in ${delay}ms`);
              setTimeout(() => {
                this.connectWebSocket().catch((err) => {
                  console.error("WebSocket reconnection failed:", err);
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
      callbacks.forEach((callback) => {
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
      console.error("Failed to subscribe to WebSocket:", error);
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
    this.cachedRanges.clear();
  }
}

export default ApiService;