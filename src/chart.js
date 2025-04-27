import { createChart } from "lightweight-charts";
import {
  formatCandleData,
  mergeCandles,
  calculateDataRange,
  findNearestTradingDay,
  formatPrice,
  formatDate,
  parseInterval,
} from "./utils";

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
    this.interval = "1d";
    this.data = [];
    this.instrumentData = null;
    this.isLoading = false;
    this.loadingPromise = null;
    this.lastLoadedRange = null;
    this.realtimeCallback = null;
    this._timeRangeChangeTimeout = null;
    this.tooltipElement = document.getElementById("tooltip-container");
    
    this.isInitializing = false;
    this.timeRangeChangeCooldown = false;

    // Data cache
    this.dataCache = new Map();
    
    // Backward scroll tracking
    this.backwardScrollAttempts = 0;
    this.lastViewportFrom = null;
    this.maxBackwardScrollAttempts = 3; // After this many attempts, we'll force a load
    this.historyLoadLimit = new Date().getTime() - (10 * 365 * 24 * 60 * 60 * 1000); // 10 years back max
    this.reachedHistoryLimit = false;
    
    // Track consecutive empty responses for different time ranges
    this.emptyResponseCounter = 0;
    this.lastEmptyResponseStart = null;
    this.maxEmptyResponses = 2; // After this many empty responses, consider it the history limit

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
        background: { color: "#ffffff" },
        textColor: "#263238",
        fontSize: 12,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
      },
      grid: {
        vertLines: { color: "#f0f3fa" },
        horzLines: { color: "#f0f3fa" },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: "rgba(41, 98, 255, 0.3)",
          width: 1,
          style: 3, // Dashed
          labelBackgroundColor: "#2962ff",
        },
        horzLine: {
          color: "rgba(41, 98, 255, 0.3)",
          width: 1,
          style: 3, // Dashed
          labelBackgroundColor: "#2962ff",
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#e0e4e8",
        rightOffset: 12,
        barSpacing: 6,
        fixLeftEdge: true,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: true,
        borderVisible: true,
        visible: true,
        timeFormat: "{yyyy}-{MM}-{dd} {HH}:{mm}",
      },
      rightPriceScale: {
        borderColor: "#e0e4e8",
        autoScale: true,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      localization: {
        priceFormatter: (price) => formatPrice(price, this.symbol),
      },
      handleScroll: {
        vertTouchDrag: true,
      },
    });

    // Add candlestick series
    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    // Add event listeners
    window.addEventListener("resize", this.handleResize.bind(this));
    
    // Only subscribe to time range changes after initialization
    this._subscribeToTimeRangeChanges();

    // Subscribe to crosshair move event for custom tooltip
    this.chart.subscribeCrosshairMove(this.handleCrosshairMove.bind(this));
  }

  /**
   * Subscribe to time range changes
   */
  _subscribeToTimeRangeChanges() {
    if (!this.chart) return;
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.handleTimeRangeChange.bind(this));
  }

  /**
   * Temporarily unsubscribe from time range changes
   */
  _unsubscribeFromTimeRangeChanges() {
    if (!this.chart) return;
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.handleTimeRangeChange.bind(this));
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
      this.tooltipElement.classList.remove("visible");
      return;
    }

    // Find the data point
    const dataPoint = this.findDataPointByTime(param.time);
    if (!dataPoint) {
      this.tooltipElement.classList.remove("visible");
      return;
    }

    // Calculate change and percent change
    const change = dataPoint.close - dataPoint.open;
    const percentChange = (change / dataPoint.open) * 100;
    const changeClass = change >= 0 ? "positive" : "negative";
    const signChar = change >= 0 ? "+" : "";

    // Format timestamp based on interval
    const formattedDate = formatDate(dataPoint.time, this.interval);

    // Format volume with appropriate units
    let formattedVolume = "N/A";
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

    // Position the tooltip to the top-right of the cursor with a fixed offset
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
    this.tooltipElement.classList.add("visible");
  }

  /**
   * Find a data point by timestamp
   */
  findDataPointByTime(time) {
    if (!this.data || !this.data.length) return null;
    return this.data.find((candle) => candle.time === time);
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
   * Check if we should attempt to load more history
   */
  shouldAttemptHistoryLoad(currentTime) {
    // If we've already reached the history limit, don't try again
    if (this.reachedHistoryLimit) {
      console.log(`ℹ️ Not attempting history load - already reached history limit`);
      return false;
    }
    
    const shouldAttempt = currentTime > this.historyLoadLimit;
    if (!shouldAttempt) {
      console.log(`ℹ️ Not attempting history load - would exceed maximum history limit of ${new Date(this.historyLoadLimit).toISOString()}`);
    }
    return shouldAttempt;
  }

  /**
   * Handle time range changes (viewport navigation)
   */
  async handleTimeRangeChange(logicalRange) {
    // Skip during initialization or cooldown period
    if (this.isInitializing || this.timeRangeChangeCooldown || this.isLoading) {
      console.log(`⏭️ Skipping time range change - initialization/cooldown/loading in progress`);
      return;
    }

    // If no symbol or interval, skip
    if (!this.symbol || !this.interval || !logicalRange) {
      console.log(`⏭️ Skipping time range change - no symbol or interval`);
      return;
    }

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
        
        // Detect backward scrolling - calculate a significant change threshold
        // For 1m interval, we need a smaller threshold
        const intervalMs = parseInterval(this.interval);
        const scrollThreshold = Math.max(intervalMs * 5, 60000); // At least 5 bars or 1 minute
        
        // Only consider it backward scrolling if we moved back by a significant amount
        const isScrollingBackward = this.lastViewportFrom !== null && 
                                   (this.lastViewportFrom - fromMs > scrollThreshold);
        
        if (isScrollingBackward) {
          console.log(`📜 Backward scroll detected: ${new Date(fromMs).toISOString()} (moved back ${((this.lastViewportFrom - fromMs)/1000/60).toFixed(1)} minutes)`);
        }
        
        // Track the viewport position
        this.lastViewportFrom = fromMs;

        // Check if we need to load more data - only if we're near the edges
        let needsLoading = false;
        let loadStart = fromMs;
        let loadEnd = toMs;
        let forceLoad = false;

        if (this.lastLoadedRange) {
          const { start, end } = this.lastLoadedRange;
          
          // Calculate buffer based on interval - smaller intervals need smaller absolute buffers
          // Use both percentage and absolute minimum to handle different intervals better
          const percentBuffer = (end - start) * 0.1; // 10% buffer
          const minBuffer = Math.max(intervalMs * 10, 300000); // At least 10 bars or 5 minutes
          const buffer = Math.max(percentBuffer, minBuffer);
          
          if (fromMs < start + buffer) {
            // Need to load earlier data
            needsLoading = true;
            loadEnd = start;
            // For smaller intervals, request more history proportionally
            const historyMultiplier = this.interval === '1m' ? 0.5 : 0.3;
            loadStart = fromMs - (end - start) * historyMultiplier;
            console.log(`🔄 Need to load earlier data: ${new Date(loadStart).toISOString()} - ${new Date(loadEnd).toISOString()}`);
            
            // Reset backward scroll counter since we're loading data
            this.backwardScrollAttempts = 0;
          } else if (toMs > end - buffer) {
            // Need to load later data
            needsLoading = true;
            loadStart = end;
            loadEnd = toMs + (toMs - fromMs) * 0.3; // Load 30% more future
            console.log(`🔄 Need to load later data: ${new Date(loadStart).toISOString()} - ${new Date(loadEnd).toISOString()}`);
            
            // Reset backward scroll counter
            this.backwardScrollAttempts = 0;
          } else if (isScrollingBackward) {
            // We're scrolling backward but not hitting the load threshold
            this.backwardScrollAttempts++;
            console.log(`👀 Backward scroll attempt ${this.backwardScrollAttempts}/${this.maxBackwardScrollAttempts}`);
            
            if (this.backwardScrollAttempts >= this.maxBackwardScrollAttempts) {
              // Only attempt to load more history if we haven't reached the limit
              if (this.shouldAttemptHistoryLoad(start)) {
                // Force a load with a bigger range if we've been trying to scroll back multiple times
                needsLoading = true;
                forceLoad = true;
                const currentRange = end - start;
                loadEnd = start;
                
                // Adjust the load amount based on interval - smaller intervals need more aggressive loads
                const forceLoadMultiplier = this.interval === '1m' ? 3 : 2;
                loadStart = Math.max(start - currentRange * forceLoadMultiplier, this.historyLoadLimit);
                
                console.log(`🔄 Forcing load of earlier data after ${this.backwardScrollAttempts} attempts: ${new Date(loadStart).toISOString()} - ${new Date(loadEnd).toISOString()}`);
              } else {
                // We've reached our history limit
                console.log(`⚠️ Reached maximum history limit (${new Date(this.historyLoadLimit).toISOString()}), not loading more data`);
                this.reachedHistoryLimit = true;
              }
              
              // Reset the counter
              this.backwardScrollAttempts = 0;
            }
          } else {
            // Reset the counter if we're not scrolling backward
            this.backwardScrollAttempts = 0;
          }
        } else {
          // No data loaded yet
          needsLoading = true;
        }

        if (needsLoading) {
          // Calculate optimal data range
          const range = calculateDataRange(
            this.interval,
            loadStart,
            loadEnd
          );

          // Check if we should load or if we've reached the history limit
          if (this.shouldAttemptHistoryLoad(range.start) || range.start >= this.lastLoadedRange?.start) {
            await this.loadDataForRange(range.start, range.end, forceLoad);
          } else {
            console.log(`⚠️ Not loading more data, reached history limit or no more data available`);
            this.reachedHistoryLimit = true;
          }
        } else {
          console.log(`✅ No additional data needed for current view`);
        }
      } catch (error) {
        console.error("Error handling time range change:", error);
      }
    }, 500); // 500ms debounce
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
          horzLine: { visible: !isLoading },
        },
      });
    }
  }

  /**
   * Check if requested range overlaps with already loaded data
   */
  isRangeAlreadyLoaded(start, end) {
    if (!this.lastLoadedRange || !this.data.length) return false;
    
    // Allow for some buffer at the edges - adjust based on interval
    const intervalMs = parseInterval(this.interval);
    const buffer = Math.min(
      Math.max(intervalMs * 20, 300000), // At least 20 candles or 5 minutes
      24 * 60 * 60 * 1000 // Maximum 1 day buffer
    );
    
    const loadedStart = this.lastLoadedRange.start - buffer;
    const loadedEnd = this.lastLoadedRange.end + buffer;
    
    const isLoaded = start >= loadedStart && end <= loadedEnd;
    
    return isLoaded;
  }

  /**
   * Load data for a specific time range
   */
  async loadDataForRange(start, end, forceLoad = false) {
    // If already loading, return the existing promise
    if (this.loadingPromise) {
      console.log(`⏭️ Skipping loadDataForRange - already loading data`);
      return this.loadingPromise;
    }

    // For very small intervals, make sure we're not requesting too much data at once
    if (this.interval === '1m') {
      const requestDuration = end - start;
      const maxDuration = 7 * 24 * 60 * 60 * 1000; // 7 days for 1m interval
      
      if (requestDuration > maxDuration && !forceLoad) {
        console.log(`⚠️ Request duration too long for 1m interval (${(requestDuration/1000/60/60/24).toFixed(1)} days), limiting to ${(maxDuration/1000/60/60/24).toFixed(1)} days`);
        start = end - maxDuration;
      }
    }

    // Check if the requested range is already covered by loaded data
    if (!forceLoad && this.isRangeAlreadyLoaded(start, end)) {
      console.log(`✅ Requested range already loaded: ${new Date(start).toISOString()} - ${new Date(end).toISOString()}`);
      return Promise.resolve(this.data);
    }

    console.log(`📈 Loading data: ${this.symbol}@${this.interval}`, {
      requestRange: {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      },
      forceLoad,
    });

    this.setLoadingState(true);

    this.loadingPromise = (async () => {
      try {
        // Fetch instrument data if not available
        if (!this.instrumentData) {
          try {
            this.instrumentData = await this.apiService.fetchInstrument(this.symbol);
            console.log(`📌 Instrument data: ${this.symbol}`, {
              category: this.instrumentData.category,
              hasTradingHours: !!(this.instrumentData.market && this.instrumentData.market.length > 0),
            });
          } catch (error) {
            console.warn("Could not fetch instrument data:", error.message);
          }
        }

        // For instruments with limited trading hours, adjust the start time
        let adjustedStart = start;
        if (this.instrumentData && this.instrumentData.category !== "Crypto") {
          const originalStart = new Date(start).toISOString();
          adjustedStart = findNearestTradingDay(this.instrumentData, adjustedStart);
          
          if (adjustedStart !== start) {
            const dayDiff = Math.round((start - adjustedStart) / (1000 * 60 * 60 * 24));
            console.log(`⏱️ Adjusted start time for ${this.symbol}`, {
              original: originalStart,
              adjusted: new Date(adjustedStart).toISOString(),
              difference: `${dayDiff} days`,
            });
          }
        }

        // Fetch candles
        const candles = await this.apiService.fetchCandles(
          this.symbol,
          this.interval,
          {
            start: adjustedStart,
            end,
          }
        );

        if (candles && candles.length > 0) {
          const firstCandle = candles[0];
          const lastCandle = candles[candles.length - 1];
          console.log(`📊 Received data: ${this.symbol}@${this.interval}`, {
            count: candles.length,
            firstCandle: new Date(firstCandle.timestamp).toISOString(),
            lastCandle: new Date(lastCandle.timestamp).toISOString(),
          });

          // Reset empty response counter since we got data
          this.emptyResponseCounter = 0;
          this.lastEmptyResponseStart = null;

          const formattedCandles = formatCandleData(candles);
          this.data = mergeCandles(this.data, formattedCandles);

          this.updateSeries();

          // Update loaded range - check if we got enough data to move the range
          if (this.lastLoadedRange) {
            if (forceLoad && candles.length == 0 && adjustedStart < this.lastLoadedRange.start) {
              console.log(`⚠️ Received no candles when forcing load, may have reached history limit`);
              this.reachedHistoryLimit = true;
              
              // Show a more accurate history limit based on the earliest data we have
              if (this.data.length > 0) {
                const earliestCandle = this.data.reduce((earliest, candle) => 
                  candle.time < earliest.time ? candle : earliest, this.data[0]);
                console.log(`📅 Setting history limit to earliest available data: ${new Date(earliestCandle.time * 1000).toISOString()}`);
              }
            }
            
            this.lastLoadedRange = {
              start: Math.min(adjustedStart, this.lastLoadedRange.start),
              end: Math.max(end, this.lastLoadedRange.end),
            };
          } else {
            this.lastLoadedRange = {
              start: adjustedStart,
              end: end,
            };
          }
          
          console.log(`📊 Updated data range: ${new Date(this.lastLoadedRange.start).toISOString()} - ${new Date(this.lastLoadedRange.end).toISOString()}`);
        } else {
          console.warn(`⚠️ No candles received: ${this.symbol}@${this.interval}`, {
            start: new Date(adjustedStart).toISOString(),
            end: new Date(end).toISOString(),
          });
          
          // Track consecutive empty responses
          if (this.lastEmptyResponseStart === null || adjustedStart < this.lastEmptyResponseStart) {
            this.emptyResponseCounter++;
            this.lastEmptyResponseStart = adjustedStart;
            console.log(`⚠️ Empty response counter: ${this.emptyResponseCounter}/${this.maxEmptyResponses}`);
          }
          
          // If we have multiple consecutive empty responses for earlier time ranges
          // or if we forced a load and got no data, we've likely reached the limit
          if ((this.emptyResponseCounter >= this.maxEmptyResponses) || 
              (forceLoad && start < this.lastLoadedRange.start)) {
            console.log(`⚠️ No data found when requesting earlier history, setting history limit to current earliest data`);
            this.reachedHistoryLimit = true;
            
            // Update the history limit to the earliest data we have
            if (this.data.length > 0) {
              const earliestCandle = this.data.reduce((earliest, candle) => 
                candle.time < earliest.time ? candle : earliest, this.data[0]);
              console.log(`📅 Setting history limit to earliest available data: ${new Date(earliestCandle.time * 1000).toISOString()}`);
            }
          }
        }

        return this.data;
      } catch (error) {
        console.error("Error loading data:", error);
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
    this.candleSeries.setData(this.data);
  }

  /**
   * Calculate optimal load range based on interval
   */
  calculateInitialLoadRange(interval) {
    const end = Date.now();
    let start;

    // Comprehensive initial data load to prevent multiple requests
    switch (interval) {
      case "1m":
        start = end - 24 * 60 * 60 * 1000; // 24 hours
        break;
      case "5m":
        start = end - 3 * 24 * 60 * 60 * 1000; // 3 days
        break;
      case "15m":
        start = end - 7 * 24 * 60 * 60 * 1000; // 7 days
        break;
      case "30m":
        start = end - 14 * 24 * 60 * 60 * 1000; // 14 days
        break;
      case "1h":
        start = end - 30 * 24 * 60 * 60 * 1000; // 30 days
        break;
      case "2h":
        start = end - 60 * 24 * 60 * 60 * 1000; // 60 days
        break;
      case "4h":
        start = end - 90 * 24 * 60 * 60 * 1000; // 90 days
        break;
      case "12h":
        start = end - 180 * 24 * 60 * 60 * 1000; // 180 days
        break;
      case "1d":
        start = end - 1 * 365 * 24 * 60 * 60 * 1000; // 1 year
        break;
      case "1w":
        start = end - 5 * 365 * 24 * 60 * 60 * 1000; // 5 years
        break;
      case "1mo":
        start = end - 10 * 365 * 24 * 60 * 60 * 1000; // 10 years
        break;
      default:
        console.warn(`⚠️ Unknown interval: ${interval}, defaulting to 1 year`);
        start = end - 365 * 24 * 60 * 60 * 1000; // 1 year
    }

    return { start, end };
  }

  /**
   * Load symbol and interval
   */
  async loadSymbol(symbol, interval) {
    if (this.symbol === symbol && this.interval === interval && this.isLoading) {
      console.log(`⏭️ Skipping loadSymbol - already loading same symbol/interval`);
      return;
    }

    // Set initialization flags and disable time range change events
    this.isInitializing = true;
    this._unsubscribeFromTimeRangeChanges();
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
      const currentKey = this.symbol && this.interval ? `${this.symbol}:${this.interval}` : null;
      if (currentKey && this.data.length > 0) {
        this.dataCache.set(currentKey, {
          data: [...this.data],
          range: this.lastLoadedRange ? { ...this.lastLoadedRange } : null,
          instrumentData: this.instrumentData,
        });
      }

      // Set new symbol/interval
      this.symbol = symbol;
      this.interval = interval;
      
      // Reset backward scroll tracking and history limits
      this.backwardScrollAttempts = 0;
      this.lastViewportFrom = null;
      this.reachedHistoryLimit = false;

      // Check cache for new symbol/interval
      const newKey = `${symbol}:${interval}`;
      const cachedData = this.dataCache.get(newKey);

      if (cachedData) {
        console.log(`📋 Chart data cache HIT for: ${newKey}`);

        // Use cached data
        this.data = [...cachedData.data];
        this.lastLoadedRange = cachedData.range ? { ...cachedData.range } : null;
        this.instrumentData = cachedData.instrumentData;
        this.updateSeries();
      } else {
        console.log(`📋 Chart data cache MISS for: ${newKey}`);

        // Fresh load - reset data
        this.data = [];
        this.lastLoadedRange = null;
        this.instrumentData = null;

        // Get optimal data range for initial load
        const { start, end } = this.calculateInitialLoadRange(interval);

        // Fetch instrument data first
        try {
          this.instrumentData = await this.apiService.fetchInstrument(symbol);
        } catch (error) {
          console.warn("Could not fetch instrument data:", error.message);
          // Continue without instrument data
        }

        // Single comprehensive data load
        await this.loadDataForRange(start, end);
      }

      // Set up realtime subscription
      this.realtimeCallback = (candle) => {
        // Convert to chart format
        const timestamp = Math.floor(candle.timestamp / 1000);

        const candleData = {
          time: timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume || 0,
        };

        // Update or add to data array
        const index = this.data.findIndex((c) => c.time === timestamp);

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
      
      // Prevent immediate follow-up requests by setting a cooldown period
      this.timeRangeChangeCooldown = true;
      setTimeout(() => {
        // Re-enable time range changes after initialization complete
        this.isInitializing = false;
        this.timeRangeChangeCooldown = false;
        this._subscribeToTimeRangeChanges();
        console.log("✅ Chart initialization complete, time range change handling enabled");
      }, 1000); // 1 second cooldown before allowing new requests
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
    window.removeEventListener("resize", this.handleResize.bind(this));

    // Hide tooltip
    if (this.tooltipElement) {
      this.tooltipElement.classList.remove("visible");
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