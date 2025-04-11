import { createChart } from 'lightweight-charts';
import { 
  formatCandleData, 
  calculateDataRange, 
  mergeCandles, 
  isTimestampInRange,
  calculateSubscriptionRange,
  findNearestTradingDay
} from './utils';

/**
 * Chart wrapper for TradingView Lightweight Charts integration
 */
export class ChartComponent {
  constructor(container, apiService, options = {}) {
    this.container = container;
    this.apiService = apiService;
    this.options = {
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#D1D4DC',
        rightOffset: 12,
        barSpacing: 6,
      },
      rightPriceScale: {
        borderColor: '#D1D4DC',
      },
      layout: {
        background: { color: '#ffffff' },
        textColor: '#191919',
      },
      grid: {
        horzLines: { color: '#F0F3FA' },
        vertLines: { color: '#F0F3FA' },
      },
      crosshair: {
        mode: 0,
      },
      ...options
    };
    
    // Chart state
    this.symbol = null;
    this.interval = '1d';
    this.data = [];
    this.chart = null;
    this.candleSeries = null;
    this.volumeSeries = null;
    this.isLoading = false;
    this.lastLoadedRange = null;
    this.realtimeCallback = null;
    this.instrumentData = null;
    this._volumeScale = 1;
    this._timeRangeChangeTimeout = null;
    
    // Cache for previously loaded symbols and intervals
    this._symbolCache = new Map();
    
    // Create the chart instance
    this.init();
  }
  
  /**
   * Initialize the chart
   */
  init() {
    console.log('Initializing chart...', this.container);
    
    if (!this.container) {
      console.error('Chart container is null or undefined');
      return;
    }
    
    const { width, height } = this.container.getBoundingClientRect();
    console.log('Container dimensions:', { width, height });
    
    if (width === 0 || height === 0) {
      console.error('Chart container has zero width or height');
      // Force minimum dimensions to prevent chart creation failure
      this.container.style.width = '100%';
      this.container.style.height = '500px';
    }
    
    try {
      this.chart = createChart(this.container, {
        width: width || 800,  // Fallback width
        height: height || 500, // Fallback height
        ...this.options
      });
      
      console.log('Chart created successfully');
      
      this.candleSeries = this.chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });
      
      console.log('Candlestick series added');
      
      this.volumeSeries = this.chart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: '', // Use a separate price scale
        // Position volume at the bottom
        scaleMargins: {
          top: 0.85,
          bottom: 0,
        },
        // Use lower opacity for better visibility
        styleDefaults: {
          opacity: 0.6,
        }
      });
      
      console.log('Volume series added');
      
      window.addEventListener('resize', this.handleResize.bind(this));
      
      // Handle time scale changes
      this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.handleTimeRangeChange.bind(this));
    } catch (error) {
      console.error('Error initializing chart:', error);
    }
  }
  
  /**
   * Handle window resize events
   */
  handleResize() {
    if (!this.chart) return;
    
    const { width, height } = this.container.getBoundingClientRect();
    this.chart.resize(width, height);
  }
  
  /**
   * Handle time range changes (viewport navigation)
   * @param {Object} logicalRange - Visible logical range
   */
  async handleTimeRangeChange(logicalRange) {
    if (!this.symbol || !this.interval || !logicalRange) {
      return;
    }
    
    // Debounce rapid viewport changes
    if (this._timeRangeChangeTimeout) {
      clearTimeout(this._timeRangeChangeTimeout);
    }
    
    this._timeRangeChangeTimeout = setTimeout(async () => {
      // If already loading data, don't trigger another load
      if (this.isLoading) {
        return;
      }
      
      try {
        // Convert logical range to time range
        const timeScale = this.chart.timeScale();
        const visibleRange = timeScale.getVisibleRange();
        
        if (!visibleRange) {
          return;
        }
        
        const { from, to } = visibleRange;
        const fromMs = from * 1000;
        const toMs = to * 1000;
        
        // Check if we need to load more data
        if (this.lastLoadedRange) {
          const { start, end } = this.lastLoadedRange;
          
          // If the visible range is within the loaded range with buffer, no need to load more
          const buffer = (end - start) * 0.2;
          if (fromMs >= (start + buffer) && toMs <= (end - buffer)) {
            return;
          }
        }
        
        // Calculate the optimal data range
        const range = calculateDataRange(
          this.interval,
          this.container.clientWidth,
          fromMs,
          toMs
        );
        
        await this.loadDataForRange(range.start, range.end, range.limit);
        
        // Update subscription range for WebSocket
        this.updateRealtimeSubscription(visibleRange);
      } catch (error) {
        console.error('Error handling time range change:', error);
      }
    }, 300); // 300ms debounce
  }
  
  /**
   * Load data for a specific time range
   * @param {number} start - Start timestamp
   * @param {number} end - End timestamp
   * @param {number} limit - Maximum number of candles
   */
  async loadDataForRange(start, end, limit) {
    console.log(`Loading data range: ${new Date(start).toISOString()} to ${new Date(end).toISOString()}, limit: ${limit}`);
    
    if (this.isLoading) {
      console.log('Already loading data, request ignored');
      return;
    }
    
    try {
      this.isLoading = true;
      
      // Show loading state
      this.setLoadingState(true);
      
      // Fetch instrument data if not already available
      if (!this.instrumentData) {
        console.log(`Fetching instrument data for ${this.symbol}`);
        this.instrumentData = await this.apiService.fetchInstrument(this.symbol);
        console.log('Instrument data:', this.instrumentData);
      }
      
      // For instruments with limited trading hours, adjust the start time
      let adjustedStart = start;
      if (this.instrumentData && this.instrumentData.category !== 'Crypto') {
        adjustedStart = findNearestTradingDay(this.instrumentData, adjustedStart);
        console.log(`Adjusted start time to nearest trading day: ${new Date(adjustedStart).toISOString()}`);
      }
      
      console.log(`Fetching candles for ${this.symbol}:${this.interval}`);
      const newData = await this.apiService.fetchCandles(this.symbol, this.interval, {
        start: adjustedStart,
        end,
        limit
      });
      
      console.log(`Received ${newData?.length || 0} candles from API`);
      
      // Only update chart if we got new data
      if (newData && newData.length > 0) {
        const formattedData = formatCandleData(newData);
        console.log(`Formatted ${formattedData.length} candles for chart`);
        
        const previousDataLength = this.data.length;
        this.data = mergeCandles(this.data, formattedData);
        console.log(`Data after merge: ${previousDataLength} -> ${this.data.length} candles`);
        
        this.updateSeries();
        
        // Save the expanded loaded range
        this.lastLoadedRange = {
          start: Math.min(adjustedStart, this.lastLoadedRange?.start || Infinity),
          end: Math.max(end, this.lastLoadedRange?.end || 0)
        };
        console.log(`Updated loaded range: ${new Date(this.lastLoadedRange.start).toISOString()} to ${new Date(this.lastLoadedRange.end).toISOString()}`);
      } else {
        console.warn('No data received from API or empty data set');
      }
    } catch (error) {
      console.error('Error loading data for range:', error);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw error;
    } finally {
      this.setLoadingState(false);
      this.isLoading = false;
    }
  }
  
  /**
   * Set loading state for the chart
   * @param {boolean} isLoading - Whether chart is loading
   */
  setLoadingState(isLoading) {
    if (!this.chart) return;
    
    this.chart.applyOptions({
      crosshair: {
        mode: isLoading ? 0 : 1,
        vertLine: {
          visible: !isLoading,
        },
        horzLine: {
          visible: !isLoading,
        }
      }
    });
  }
  
  /**
   * Update the series with current data
   */
  updateSeries() {
    console.log('Updating series with data length:', this.data?.length);
    
    if (!this.data || !this.candleSeries || !this.volumeSeries) {
      console.warn('Cannot update series: missing data or series objects');
      return;
    }
    
    if (this.data.length === 0) {
      console.warn('No data to display in chart');
      return;
    }
    
    try {
      if (this.data.length > 0) {
        console.log('Sample data point:', this.data[0]);
      }
      
      this.candleSeries.setData(this.data);
      console.log('Candlestick series updated');
      
      // Calculate volume scale to prevent overlapping with candles
      const maxVolume = Math.max(...this.data.map(item => item.volume || 0), 1);
      console.log('Max volume:', maxVolume);
      
      let volumeScale = 1;
      
      // Scale down the volume bars if they're too large
      if (maxVolume > 100000) {
        volumeScale = 0.05;
      } else if (maxVolume > 10000) {
        volumeScale = 0.1;
      } else if (maxVolume > 1000) {
        volumeScale = 0.2;
      } else if (maxVolume > 100) {
        volumeScale = 0.4;
      } else {
        volumeScale = 0.8;
      }
      
      // Store volume scale for real-time updates
      this._volumeScale = volumeScale;
      
      // Update volume series with better color contrast
      const volumeData = this.data.map(item => ({
        time: item.time,
        value: (item.volume || 0) * volumeScale, // Scale the volume
        // Color based on candle direction
        color: item.close >= item.open 
          ? 'rgba(38, 166, 154, 0.7)' // Green for up
          : 'rgba(239, 83, 80, 0.7)'  // Red for down
      }));
      
      this.volumeSeries.setData(volumeData);
      console.log('Volume series updated');
    } catch (error) {
      console.error('Error updating chart series:', error);
    }
  }
  
  /**
   * Update the realtime subscription based on visible range
   * @param {Object} visibleRange - Visible time range
   */
  async updateRealtimeSubscription(visibleRange) {
    if (!this.symbol || !this.interval) {
      return;
    }
    
    const subscriptionRange = calculateSubscriptionRange(this.interval, visibleRange);
    
    if (this.realtimeCallback) {
      await this.apiService.unsubscribeFromCandles(this.symbol, this.interval, this.realtimeCallback);
      this.realtimeCallback = null;
    }
    
    this.realtimeCallback = this.createRealtimeCallback(subscriptionRange);
    
    await this.apiService.subscribeToCandles(this.symbol, this.interval, this.realtimeCallback);
  }
  
  /**
   * Create callback function for real-time updates
   * @param {Object} subscriptionRange - Range to check for updates
   * @returns {Function} Callback function
   */
  createRealtimeCallback(subscriptionRange) {
    return (candle) => {
      const formattedCandle = {
        time: candle.timestamp / 1000,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0
      };
      
      // Update or add the candle to our data
      const existingIndex = this.data.findIndex(c => c.time === formattedCandle.time);
      
      if (existingIndex >= 0) {
        // Update existing candle
        this.data[existingIndex] = formattedCandle;
      } else {
        // Add new candle
        this.data.push(formattedCandle);
        // Sort data by time
        this.data.sort((a, b) => a.time - b.time);
      }
      
      // Only update the UI if the candle is in the visible range
      if (isTimestampInRange(formattedCandle.time, subscriptionRange.from, subscriptionRange.to)) {
        this.candleSeries.update(formattedCandle);
        
        this.volumeSeries.update({
          time: formattedCandle.time,
          value: formattedCandle.volume * this._volumeScale,
          color: formattedCandle.close >= formattedCandle.open 
            ? 'rgba(38, 166, 154, 0.7)' 
            : 'rgba(239, 83, 80, 0.7)'
        });
      }
      
      // Update loaded range to include this candle
      if (this.lastLoadedRange) {
        const candleTime = candle.timestamp;
        this.lastLoadedRange = {
          start: Math.min(this.lastLoadedRange.start, candleTime),
          end: Math.max(this.lastLoadedRange.end, candleTime)
        };
      }
    };
  }
  
  /**
   * Generate a cache key for symbol and interval
   * @param {string} symbol - Instrument symbol
   * @param {string} interval - Candle interval
   * @returns {string} Cache key
   */
  _getCacheKey(symbol, interval) {
    return `${symbol}:${interval}`;
  }

  /**
   * Load initial data and set up chart for a symbol and interval
   * @param {string} symbol - Instrument symbol
   * @param {string} interval - Candle interval
   */
  async loadSymbol(symbol, interval) {
    if (this.isLoading) {
      return;
    }
    
    try {
      this.isLoading = true;
      this.setLoadingState(true);
      
      // Unsubscribe from previous symbol/interval
      if (this.symbol && this.interval && this.realtimeCallback) {
        await this.apiService.unsubscribeFromCandles(this.symbol, this.interval, this.realtimeCallback);
        this.realtimeCallback = null;
      }
      
      // Before changing symbol/interval, cache current state
      if (this.symbol && this.interval && this.data.length > 0) {
        const currentCacheKey = this._getCacheKey(this.symbol, this.interval);
        this._symbolCache.set(currentCacheKey, {
          data: [...this.data],
          range: this.lastLoadedRange ? { ...this.lastLoadedRange } : null,
          instrument: this.instrumentData,
          timeRange: this.chart.timeScale().getVisibleRange()
        });
      }
      
      this.symbol = symbol;
      this.interval = interval;
      
      const cacheKey = this._getCacheKey(symbol, interval);
      const cachedData = this._symbolCache.get(cacheKey);
      
      if (cachedData) {
        // Use cached data
        this.data = [...cachedData.data];
        this.lastLoadedRange = cachedData.range ? { ...cachedData.range } : null;
        this.instrumentData = cachedData.instrument;
        
        this.updateSeries();
        
        // Set the time scale to match the cached view
        if (cachedData.timeRange) {
          this.chart.timeScale().setVisibleRange(cachedData.timeRange);
        } else {
          this.chart.timeScale().fitContent();
        }
      } else {
        // Fresh load
        this.data = [];
        this.lastLoadedRange = null;
        
        this.instrumentData = await this.apiService.fetchInstrument(symbol);
        
        // Calculate optimal timeframe based on interval
        const end = Date.now();
        let start, limit;
        
        switch (interval) {
          case '1m':  
            start = end - (12 * 60 * 60 * 1000); // 12 hours
            limit = 720;
            break;
          case '5m':  
            start = end - (24 * 60 * 60 * 1000); // 1 day
            limit = 288;
            break;
          case '15m': 
            start = end - (3 * 24 * 60 * 60 * 1000); // 3 days
            limit = 288;
            break;
          case '30m': 
            start = end - (7 * 24 * 60 * 60 * 1000); // 1 week
            limit = 336;
            break;
          case '1h':  
            start = end - (14 * 24 * 60 * 60 * 1000); // 2 weeks
            limit = 336;
            break;
          case '2h':
            start = end - (30 * 24 * 60 * 60 * 1000); // 1 month
            limit = 360;
            break;
          case '4h':  
            start = end - (30 * 24 * 60 * 60 * 1000); // 1 month
            limit = 180;
            break;
          case '12h':
            start = end - (90 * 24 * 60 * 60 * 1000); // 3 months
            limit = 180;
            break;
          case '1d':  
            start = end - (365 * 24 * 60 * 60 * 1000); // 1 year
            limit = 365;
            break;
          case '1w':  
            start = end - (3 * 365 * 24 * 60 * 60 * 1000); // 3 years
            limit = 156;
            break;
          case '1mo':
            start = end - (5 * 365 * 24 * 60 * 60 * 1000); // 5 years
            limit = 60;
            break;
          default:    
            start = end - (30 * 24 * 60 * 60 * 1000); // Default 1 month
            limit = 1000;
        }
        
        // For non-crypto instruments, adjust the start time
        if (this.instrumentData && this.instrumentData.category !== 'Crypto') {
          start = findNearestTradingDay(this.instrumentData, start);
        }
        
        // Fetch initial candles
        await this.loadDataForRange(start, end, limit);
        
        // Fit content to view
        this.chart.timeScale().fitContent();
      }
      
      // Set up realtime subscription
      const visibleRange = this.chart.timeScale().getVisibleRange();
      if (visibleRange) {
        await this.updateRealtimeSubscription(visibleRange);
      }
      
    } catch (error) {
      console.error(`Error loading symbol ${symbol} with interval ${interval}:`, error);
      throw error;
    } finally {
      this.setLoadingState(false);
      this.isLoading = false;
    }
  }
  
  /**
   * Change the interval for the current symbol
   * @param {string} interval - New interval
   */
  async changeInterval(interval) {
    if (this.interval === interval || !this.symbol || this.isLoading) {
      return;
    }
    
    await this.loadSymbol(this.symbol, interval);
  }
  
  /**
   * Clean up chart resources
   */
  async destroy() {
    // Clear any pending timeouts
    if (this._timeRangeChangeTimeout) {
      clearTimeout(this._timeRangeChangeTimeout);
      this._timeRangeChangeTimeout = null;
    }
    
    // Unsubscribe from realtime updates
    if (this.symbol && this.interval && this.realtimeCallback) {
      await this.apiService.unsubscribeFromCandles(this.symbol, this.interval, this.realtimeCallback);
      this.realtimeCallback = null;
    }
    
    window.removeEventListener('resize', this.handleResize.bind(this));
    
    this._symbolCache.clear();
    
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
    }
  }
}

export default ChartComponent;