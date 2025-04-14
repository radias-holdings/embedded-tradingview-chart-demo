import { createChart } from 'lightweight-charts';
import { 
  formatCandleData, 
  mergeCandles, 
  parseInterval,
  calculateDataRange,
  findNearestTradingDay,
  calculateSubscriptionRange
} from './utils';

/**
 * Chart wrapper for TradingView Lightweight Charts
 */
export class ChartComponent {
  constructor(container, apiService) {
    this.container = container;
    this.apiService = apiService;
    
    // Chart state
    this.chart = null;
    this.candleSeries = null;
    this.volumeSeries = null;
    this.symbol = null;
    this.interval = '1d';
    this.data = [];
    this.instrumentData = null;
    this.isLoading = false;
    this.loadingPromise = null;
    this.lastLoadedRange = null;
    this.realtimeCallback = null;
    this._volumeScale = 0.1; // Initial volume scale (small)
    this._timeRangeChangeTimeout = null;
    
    // Data cache
    this.dataCache = new Map();
    
    this.init();
  }

  /**
   * Initialize the chart
   */
  init() {
    // Get container dimensions
    const { width, height } = this.container.getBoundingClientRect();
    const containerWidth = width || 800;
    const containerHeight = height || 500;
    
    // Create chart
    this.chart = createChart(this.container, {
      width: containerWidth,
      height: containerHeight,
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
        mode: 1,
      }
    });
    
    // Add candlestick series
    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    
    // Add volume series - using a separate scale and very small size
    this.volumeSeries = this.chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume', // Use a separate price scale
      // Make volume much smaller to avoid hiding candles
      scaleMargins: {
        top: 0.9, // Push volume to the very bottom
        bottom: 0.02,
      },
      // Reduce visibility further
      lastValueVisible: false,
      priceLineVisible: false,
    });
    
    // Add event listeners
    window.addEventListener('resize', this.handleResize.bind(this));
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(
      this.handleTimeRangeChange.bind(this)
    );
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
   */
  async handleTimeRangeChange(logicalRange) {
    if (!this.symbol || !this.interval || !logicalRange || this.isLoading) return;
    
    // Debounce rapid viewport changes
    if (this._timeRangeChangeTimeout) {
      clearTimeout(this._timeRangeChangeTimeout);
    }
    
    this._timeRangeChangeTimeout = setTimeout(async () => {
      try {
        // Get visible range
        const timeScale = this.chart.timeScale();
        const visibleRange = timeScale.getVisibleRange();
        
        if (!visibleRange) return;
        
        const { from, to } = visibleRange;
        const fromMs = from * 1000;
        const toMs = to * 1000;
        
        // Check if we need to load more data
        let needsLoading = false;
        let loadStart = fromMs;
        let loadEnd = toMs;
        
        if (this.lastLoadedRange) {
          const { start, end } = this.lastLoadedRange;
          const buffer = (end - start) * 0.2; // 20% buffer
          
          if (fromMs < (start + buffer)) {
            // Need to load earlier data
            needsLoading = true;
            loadEnd = start;
            loadStart = fromMs - (end - start) * 0.5; // Load 50% more history
          } else if (toMs > (end - buffer)) {
            // Need to load later data
            needsLoading = true;
            loadStart = end;
            loadEnd = toMs + (toMs - fromMs) * 0.5; // Load 50% more future
          }
        } else {
          // No data loaded yet
          needsLoading = true;
        }
        
        if (needsLoading) {
          // Calculate optimal data range
          const range = calculateDataRange(
            this.interval,
            this.container.clientWidth,
            loadStart,
            loadEnd
          );
          
          await this.loadDataForRange(range.start, range.end, range.limit);
        }
        
        // Update WebSocket subscription
        if (visibleRange) {
          await this.updateRealtimeSubscription(visibleRange);
        }
      } catch (error) {
        console.error('Error handling time range change:', error);
      }
    }, 300); // 300ms debounce
  }

  /**
   * Set loading state
   */
  setLoadingState(isLoading) {
    this.isLoading = isLoading;
    
    // Update chart UI based on loading state
    if (this.chart) {
      this.chart.applyOptions({
        crosshair: {
          mode: isLoading ? 0 : 1,
          vertLine: { visible: !isLoading },
          horzLine: { visible: !isLoading }
        }
      });
    }
  }

  /**
   * Load data for a specific time range
   */
  async loadDataForRange(start, end, limit) {
    // If already loading, return the existing promise
    if (this.loadingPromise) {
      return this.loadingPromise;
    }
    
    this.setLoadingState(true);
    
    this.loadingPromise = (async () => {
      try {
        // Fetch instrument data if not available
        if (!this.instrumentData) {
          try {
            this.instrumentData = await this.apiService.fetchInstrument(this.symbol);
          } catch (error) {
            console.warn('Could not fetch instrument data:', error.message);
            // Continue without instrument data
          }
        }
        
        // For instruments with limited trading hours, adjust the start time
        let adjustedStart = start;
        if (this.instrumentData && this.instrumentData.category !== 'Crypto') {
          adjustedStart = findNearestTradingDay(this.instrumentData, adjustedStart);
        }
        
        // Fetch candles
        const candles = await this.apiService.fetchCandles(this.symbol, this.interval, {
          start: adjustedStart,
          end,
          limit
        });
        
        if (candles && candles.length > 0) {
          const formattedCandles = formatCandleData(candles);
          this.data = mergeCandles(this.data, formattedCandles);
          
          this.updateSeries();
          
          // Update loaded range
          this.lastLoadedRange = {
            start: Math.min(adjustedStart, this.lastLoadedRange?.start || Infinity),
            end: Math.max(end, this.lastLoadedRange?.end || 0)
          };
        }
        
        return this.data;
      } catch (error) {
        console.error('Error loading data:', error);
        // Return existing data to keep chart working
        return this.data;
      } finally {
        this.setLoadingState(false);
        this.loadingPromise = null;
      }
    })();
    
    return this.loadingPromise;
  }

  /**
   * Update chart series with current data
   */
  updateSeries() {
    if (!this.data || !this.candleSeries || !this.volumeSeries || this.data.length === 0) return;
    
    // Update candlestick series
    this.candleSeries.setData(this.data);
    
    // Make volume extremely small to avoid overlapping with candles
    const maxVolume = Math.max(...this.data.map(item => item.volume || 0), 1);
    
    // Use an extremely small scale - 0.001 means volume is at most 0.1% of the price range
    let volumeScale = 0.001;
    
    // Further reduce scale for larger volumes
    if (maxVolume > 1000000) volumeScale = 0.0001;
    else if (maxVolume > 100000) volumeScale = 0.0005;
    else if (maxVolume > 10000) volumeScale = 0.001;
    else if (maxVolume > 1000) volumeScale = 0.002;
    
    // Store scale for realtime updates
    this._volumeScale = volumeScale;
    
    // Update volume series with scaled values and colors
    const volumeData = this.data.map(item => ({
      time: item.time,
      value: (item.volume || 0) * volumeScale,
      color: item.close >= item.open 
        ? 'rgba(38, 166, 154, 0.5)' // Green with transparency
        : 'rgba(239, 83, 80, 0.5)'  // Red with transparency
    }));
    
    this.volumeSeries.setData(volumeData);
  }

  /**
   * Update realtime subscription based on visible range
   */
  async updateRealtimeSubscription(visibleRange) {
    if (!this.symbol || !this.interval) return;
    
    // Calculate subscription range
    const subRange = calculateSubscriptionRange(this.interval, visibleRange);
    
    // Unsubscribe from previous
    if (this.realtimeCallback) {
      await this.apiService.unsubscribeFromCandles(
        this.symbol, 
        this.interval, 
        this.realtimeCallback
      );
      this.realtimeCallback = null;
    }
    
    // Create new callback for realtime updates
    this.realtimeCallback = (candle) => {
      // Convert to chart format
      const timestamp = Math.floor(candle.timestamp / 1000);
      
      const candleData = {
        time: timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0
      };
      
      // Update or add to data array
      const index = this.data.findIndex(c => c.time === timestamp);
      
      if (index >= 0) {
        this.data[index] = candleData;
      } else {
        this.data.push(candleData);
        this.data.sort((a, b) => a.time - b.time);
      }
      
      // Update chart
      this.candleSeries.update(candleData);
      
      this.volumeSeries.update({
        time: timestamp,
        value: candleData.volume * this._volumeScale,
        color: candleData.close >= candleData.open 
          ? 'rgba(38, 166, 154, 0.5)' 
          : 'rgba(239, 83, 80, 0.5)'
      });
      
      // Update loaded range
      if (this.lastLoadedRange) {
        this.lastLoadedRange.end = Math.max(
          this.lastLoadedRange.end, 
          candle.timestamp
        );
      }
    };
    
    // Subscribe to updates
    await this.apiService.subscribeToCandles(
      this.symbol, 
      this.interval, 
      this.realtimeCallback
    );
  }

  /**
   * Load symbol and interval
   */
  async loadSymbol(symbol, interval) {
    if (this.symbol === symbol && this.interval === interval && this.isLoading) {
      return;
    }
    
    this.setLoadingState(true);
    
    try {
      // Unsubscribe from previous
      if (this.symbol && this.interval && this.realtimeCallback) {
        await this.apiService.unsubscribeFromCandles(
          this.symbol, 
          this.interval, 
          this.realtimeCallback
        );
        this.realtimeCallback = null;
      }
      
      // Cache current data if any
      const currentKey = this.symbol && this.interval 
        ? `${this.symbol}:${this.interval}` 
        : null;
        
      if (currentKey && this.data.length > 0) {
        this.dataCache.set(currentKey, {
          data: [...this.data],
          range: this.lastLoadedRange ? {...this.lastLoadedRange} : null,
          instrumentData: this.instrumentData
        });
      }
      
      // Set new symbol/interval
      this.symbol = symbol;
      this.interval = interval;
      
      // Check cache for new symbol/interval
      const newKey = `${symbol}:${interval}`;
      const cachedData = this.dataCache.get(newKey);
      
      if (cachedData) {
        // Use cached data
        this.data = [...cachedData.data];
        this.lastLoadedRange = cachedData.range ? {...cachedData.range} : null;
        this.instrumentData = cachedData.instrumentData;
        this.updateSeries();
      } else {
        // Fresh load - reset data
        this.data = [];
        this.lastLoadedRange = null;
        this.instrumentData = null;
        
        // Calculate optimal range based on interval
        const end = Date.now();
        let start, limit;
        
        switch (interval) {
          case '1m': start = end - (12 * 60 * 60 * 1000); limit = 720; break;
          case '5m': start = end - (24 * 60 * 60 * 1000); limit = 288; break;
          case '15m': start = end - (3 * 24 * 60 * 60 * 1000); limit = 288; break;
          case '30m': start = end - (7 * 24 * 60 * 60 * 1000); limit = 336; break;
          case '1h': start = end - (14 * 24 * 60 * 60 * 1000); limit = 336; break;
          case '2h': start = end - (30 * 24 * 60 * 60 * 1000); limit = 360; break;
          case '4h': start = end - (30 * 24 * 60 * 60 * 1000); limit = 180; break;
          case '12h': start = end - (90 * 24 * 60 * 60 * 1000); limit = 180; break;
          case '1d': start = end - (365 * 24 * 60 * 60 * 1000); limit = 365; break;
          case '1w': start = end - (3 * 365 * 24 * 60 * 60 * 1000); limit = 156; break;
          case '1mo': start = end - (5 * 365 * 24 * 60 * 60 * 1000); limit = 60; break;
          default: start = end - (30 * 24 * 60 * 60 * 1000); limit = 1000;
        }
        
        // Fetch instrument data and initial candles
        try {
          this.instrumentData = await this.apiService.fetchInstrument(symbol);
          
          // Adjust start time for non-crypto instruments
          if (this.instrumentData && this.instrumentData.category !== 'Crypto') {
            start = findNearestTradingDay(this.instrumentData, start);
          }
        } catch (error) {
          console.warn('Could not fetch instrument data:', error.message);
          // Continue without instrument data
        }
        
        await this.loadDataForRange(start, end, limit);
      }
      
      // Set up realtime subscription
      const visibleRange = this.chart.timeScale().getVisibleRange();
      if (visibleRange) {
        await this.updateRealtimeSubscription(visibleRange);
      }
      
      // Fit content to view
      this.chart.timeScale().fitContent();
      
      return this.data;
    } catch (error) {
      console.error(`Error loading symbol ${symbol} with interval ${interval}:`, error);
      throw error;
    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * Change interval for current symbol
   */
  async changeInterval(interval) {
    if (this.interval === interval || !this.symbol) return;
    
    return this.loadSymbol(this.symbol, interval);
  }

  /**
   * Clean up resources
   */
  async destroy() {
    // Clear timeouts
    if (this._timeRangeChangeTimeout) {
      clearTimeout(this._timeRangeChangeTimeout);
    }
    
    // Unsubscribe from WebSocket
    if (this.symbol && this.interval && this.realtimeCallback) {
      await this.apiService.unsubscribeFromCandles(
        this.symbol, 
        this.interval, 
        this.realtimeCallback
      );
    }
    
    // Remove event listeners
    window.removeEventListener('resize', this.handleResize.bind(this));
    
    // Clear chart
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
    }
    
    // Clear cache
    this.dataCache.clear();
  }
}

export default ChartComponent;