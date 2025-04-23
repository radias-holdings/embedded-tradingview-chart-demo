import { createChart } from 'lightweight-charts';
import { 
  formatCandleData, 
  mergeCandles, 
  calculateDataRange,
  findNearestTradingDay,
  calculateSubscriptionRange,
  formatPrice,
  formatDate
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
    this.symbol = null;
    this.interval = '1d';
    this.data = [];
    this.instrumentData = null;
    this.isLoading = false;
    this.loadingPromise = null;
    this.lastLoadedRange = null;
    this.realtimeCallback = null;
    this._timeRangeChangeTimeout = null;
    this.tooltipElement = document.getElementById('tooltip-container');
    
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
      layout: {
        background: { color: '#ffffff' },
        textColor: '#263238',
        fontSize: 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
      },
      grid: {
        vertLines: { color: '#f0f3fa' },
        horzLines: { color: '#f0f3fa' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: 'rgba(41, 98, 255, 0.3)',
          width: 1,
          style: 3, // Dashed
          labelBackgroundColor: '#2962ff',
        },
        horzLine: {
          color: 'rgba(41, 98, 255, 0.3)',
          width: 1,
          style: 3, // Dashed
          labelBackgroundColor: '#2962ff',
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#e0e4e8',
        rightOffset: 12,
        barSpacing: 6,
        fixLeftEdge: true,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: true,
        borderVisible: true,
        visible: true,
        timeFormat: this.getTimeFormatOptions(),
      },
      rightPriceScale: {
        borderColor: '#e0e4e8',
        autoScale: true,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      localization: {
        priceFormatter: this.getPriceFormatter(),
      },
      handleScroll: {
        vertTouchDrag: true,
      },
    });
    
    // Add candlestick series
    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    
    // Add event listeners
    window.addEventListener('resize', this.handleResize.bind(this));
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(
      this.handleTimeRangeChange.bind(this)
    );
    
    // Subscribe to crosshair move event for custom tooltip
    this.chart.subscribeCrosshairMove(this.handleCrosshairMove.bind(this));
  }
  
  /**
   * Get custom price formatter
   */
  getPriceFormatter() {
    return (price) => {
      return formatPrice(price, this.symbol);
    };
  }
  
  /**
   * Get time format options based on interval
   */
  getTimeFormatOptions() {
    return '{yyyy}-{MM}-{dd} {HH}:{mm}';
  }
  
  /**
   * Handle crosshair move to display custom tooltip
   */
  handleCrosshairMove(param) {
    if (!this.tooltipElement) return;
    
    // Hide tooltip when not on data
    if (
      param === undefined || 
      param.time === undefined || 
      param.point === undefined || 
      param.point.x < 0 || 
      param.point.y < 0
    ) {
      this.tooltipElement.classList.remove('visible');
      return;
    }
    
    // Find the data point
    const dataPoint = this.findDataPointByTime(param.time);
    if (!dataPoint) {
      this.tooltipElement.classList.remove('visible');
      return;
    }
    
    // Calculate change and percent change
    const change = dataPoint.close - dataPoint.open;
    const percentChange = (change / dataPoint.open) * 100;
    const changeClass = change >= 0 ? 'positive' : 'negative';
    const signChar = change >= 0 ? '+' : '';
    
    // Format timestamp based on interval
    const formattedDate = formatDate(dataPoint.time, this.interval);
    
    // Format volume with appropriate units
    let formattedVolume = 'N/A';
    if (dataPoint.volume !== undefined) {
      if (dataPoint.volume >= 1000000000) {
        formattedVolume = `${(dataPoint.volume / 1000000000).toFixed(2)}B`;
      } else if (dataPoint.volume >= 1000000) {
        formattedVolume = `${(dataPoint.volume / 1000000).toFixed(2)}M`;
      } else if (dataPoint.volume >= 1000) {
        formattedVolume = `${(dataPoint.volume / 1000).toFixed(2)}K`;
      } else {
        formattedVolume = dataPoint.volume.toLocaleString();
      }
    }
    
    // Update tooltip content
    this.tooltipElement.innerHTML = `
      <div class="tooltip-title">${this.symbol} - ${formattedDate}</div>
      <div class="tooltip-data">
        <div class="tooltip-label">Open:</div>
        <div class="tooltip-value">${formatPrice(dataPoint.open, this.symbol)}</div>
        
        <div class="tooltip-label">High:</div>
        <div class="tooltip-value">${formatPrice(dataPoint.high, this.symbol)}</div>
        
        <div class="tooltip-label">Low:</div>
        <div class="tooltip-value">${formatPrice(dataPoint.low, this.symbol)}</div>
        
        <div class="tooltip-label">Close:</div>
        <div class="tooltip-value">${formatPrice(dataPoint.close, this.symbol)}</div>
        
        <div class="tooltip-label">Volume:</div>
        <div class="tooltip-value">${formattedVolume}</div>
        
        <div class="tooltip-label">Change:</div>
        <div class="tooltip-value ${changeClass}">${signChar}${formatPrice(change, this.symbol)}</div>
        
        <div class="tooltip-label">% Change:</div>
        <div class="tooltip-value ${changeClass}">${signChar}${percentChange.toFixed(2)}%</div>
      </div>
    `;
    
    // Position tooltip near the crosshair point but avoid the cursor
    const chartRect = this.container.getBoundingClientRect();
    const tooltipWidth = 220; // from CSS max-width
    const tooltipHeight = 180; // approximate height based on content
    
    // Always position the tooltip to the top-right of the cursor with a fixed offset
    // This ensures it's consistently visible and not under the mouse
    let left = param.point.x + 20; // Offset to the right
    let top = param.point.y - tooltipHeight - 10; // Offset above the cursor
    
    // If tooltip would go outside right edge, place it to the left of cursor instead
    if (left + tooltipWidth > chartRect.width) {
      left = param.point.x - tooltipWidth - 20;
    }
    
    // If tooltip would go outside top edge, place it below cursor instead
    if (top < 10) {
      top = param.point.y + 20;
    }
    
    // Keep tooltip within chart bounds
    left = Math.max(10, Math.min(chartRect.width - tooltipWidth - 10, left));
    top = Math.max(10, Math.min(chartRect.height - tooltipHeight - 10, top));
    
    this.tooltipElement.style.left = `${left}px`;
    this.tooltipElement.style.top = `${top}px`;
    this.tooltipElement.classList.add('visible');
  }
  
  /**
   * Find a data point by timestamp
   */
  findDataPointByTime(time) {
    if (!this.data || !this.data.length) return null;
    
    return this.data.find(candle => candle.time === time);
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
    if (!this.data || !this.candleSeries || this.data.length === 0) return;
    
    // Update candlestick series
    this.candleSeries.setData(this.data);
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
      
      // Set up realtime subscription (only once per symbol/interval)
      this.realtimeCallback = (candle) => {
        // Convert to chart format
        const timestamp = Math.floor(candle.timestamp / 1000);
        
        const candleData = {
          time: timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume || 0 // Keep volume for the tooltip
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
        
        // Update loaded range
        if (this.lastLoadedRange) {
          this.lastLoadedRange.end = Math.max(
            this.lastLoadedRange.end, 
            candle.timestamp
          );
        }
      };
      
      // Subscribe to updates for this symbol and interval
      await this.apiService.subscribeToCandles(
        this.symbol, 
        this.interval, 
        this.realtimeCallback
      );
      
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
    
    // Hide tooltip
    if (this.tooltipElement) {
      this.tooltipElement.classList.remove('visible');
    }
    
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