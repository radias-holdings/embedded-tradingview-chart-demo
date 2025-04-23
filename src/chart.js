import { createChart } from 'lightweight-charts';
import { 
  formatCandleData, 
  mergeCandles, 
  calculateDataRange,
  findNearestTradingDay,
  calculateSubscriptionRange,
  formatPrice,
  formatDate,
  parseInterval
} from './utils';

// Debug logging utility
const DEBUG = true;
function log(...args) {
  if (DEBUG) {
    console.log(`[ChartComponent]`, ...args);
  }
}

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
    
    // New state variables for improved scrolling
    this.scrollAttempts = 0;
    this.maxScrollAttempts = 10;
    this.emptyRanges = new Set(); // Track ranges with no data
    this.requestInProgress = false; // Track if a request is in progress
    this.lastRequestTime = 0; // Timestamp of last request
    this.requestLog = []; // Keep a log of recent requests
    this.lastVisibleFrom = null; // Track last visible from for scroll detection
    
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
    
    log('Initializing chart with dimensions', containerWidth, containerHeight);
    
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
    
    // Add debug info panel
    this.createDebugPanel();
  }
  
  /**
   * Create debug panel for monitoring requests
   */
  createDebugPanel() {
    if (!DEBUG) return;
    
    // Create debug panel if it doesn't exist
    if (!document.getElementById('chart-debug-panel')) {
      const debugPanel = document.createElement('div');
      debugPanel.id = 'chart-debug-panel';
      debugPanel.className = 'chart-debug-panel';
      debugPanel.style.position = 'absolute';
      debugPanel.style.bottom = '10px';
      debugPanel.style.right = '10px';
      debugPanel.style.background = 'rgba(0, 0, 0, 0.6)';
      debugPanel.style.color = '#fff';
      debugPanel.style.padding = '10px';
      debugPanel.style.borderRadius = '5px';
      debugPanel.style.fontSize = '12px';
      debugPanel.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif';
      debugPanel.style.zIndex = '1000';
      debugPanel.style.maxWidth = '350px';
      debugPanel.style.maxHeight = '300px';
      debugPanel.style.overflow = 'auto';
      debugPanel.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
      debugPanel.style.backdropFilter = 'blur(5px)';
      debugPanel.style.display = 'none'; // Start hidden
      
      // Add toggle button
      const toggleButton = document.createElement('button');
      toggleButton.textContent = '🔍 Debug';
      toggleButton.id = 'chart-debug-toggle';
      toggleButton.style.position = 'absolute';
      toggleButton.style.top = '10px';
      toggleButton.style.right = '10px';
      toggleButton.style.zIndex = '1001';
      toggleButton.style.padding = '5px 10px';
      toggleButton.style.fontSize = '12px';
      toggleButton.style.fontWeight = 'bold';
      toggleButton.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
      toggleButton.style.color = 'white';
      toggleButton.style.border = 'none';
      toggleButton.style.borderRadius = '3px';
      toggleButton.style.cursor = 'pointer';
      toggleButton.style.opacity = '0.7';
      toggleButton.style.transition = 'opacity 0.2s';
      
      toggleButton.addEventListener('mouseenter', () => {
        toggleButton.style.opacity = '1';
      });
      
      toggleButton.addEventListener('mouseleave', () => {
        toggleButton.style.opacity = '0.7';
      });
      
      toggleButton.addEventListener('click', () => {
        const panel = document.getElementById('chart-debug-panel');
        if (panel) {
          const isVisible = panel.style.display !== 'none';
          panel.style.display = isVisible ? 'none' : 'block';
          toggleButton.textContent = isVisible ? '🔍 Debug' : '❌ Close';
        }
      });
      
      this.container.style.position = 'relative';
      this.container.appendChild(debugPanel);
      this.container.appendChild(toggleButton);
      
      // Add a refresh button to the debug panel
      const refreshButton = document.createElement('button');
      refreshButton.textContent = '↻ Refresh';
      refreshButton.style.marginLeft = '5px';
      refreshButton.style.padding = '3px 8px';
      refreshButton.style.fontSize = '11px';
      refreshButton.style.backgroundColor = '#2962ff';
      refreshButton.style.color = 'white';
      refreshButton.style.border = 'none';
      refreshButton.style.borderRadius = '3px';
      refreshButton.style.cursor = 'pointer';
      
      refreshButton.addEventListener('click', () => {
        this.updateDebugPanel(true); // Force refresh
      });
      
      debugPanel.appendChild(refreshButton);
    }
    
    // Update debug panel with initial info
    this.updateDebugPanel();
  }
  
  /**
   * Update debug panel with latest request information
   */
  updateDebugPanel(forceRefresh = false) {
    if (!DEBUG) return;
    
    const panel = document.getElementById('chart-debug-panel');
    if (!panel || (panel.style.display === 'none' && !forceRefresh)) return;
    
    // Check if there are more recent requests available from the API service
    const apiRequestHistory = this.apiService.getRequestHistory?.() || [];
    if (apiRequestHistory.length > 0 && this.requestLog.length > 0) {
      // Find any requests in API history that aren't in our requestLog
      const latestApiTimestamp = apiRequestHistory[0].timestamp;
      const latestLogTimestamp = this.requestLog[0]?.timestamp || 0;
      
      if (latestApiTimestamp > latestLogTimestamp) {
        // Add the newer requests to our log
        apiRequestHistory.filter(req => req.timestamp > latestLogTimestamp)
          .forEach(req => {
            this.requestLog.unshift({
              timestamp: req.timestamp,
              symbol: this.symbol,
              interval: this.interval,
              start: req.params?.start || null,
              end: req.params?.end || null,
              result: req.status === 'error' ? 
                `Error: ${req.error}` : 
                `${req.responseSize || 0} items (${req.duration || 0}ms)`
            });
          });
        
        // Keep the log at a reasonable size
        if (this.requestLog.length > 20) {
          this.requestLog = this.requestLog.slice(0, 20);
        }
      }
    }
    
    // Format loaded range dates in a more compact way
    const formatDateCompact = (date) => {
      if (!date) return 'Unknown';
      const d = new Date(date);
      return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
    };
    
    // Build HTML with sections
    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 5px;">
        <div style="font-weight: bold; font-size: 14px;">Chart Debug Info</div>
      </div>
      
      <div style="display: grid; grid-template-columns: max-content 1fr; gap: 5px 10px; margin-bottom: 10px;">
        <div style="font-weight: bold;">Symbol:</div>
        <div>${this.symbol || 'None'}</div>
        
        <div style="font-weight: bold;">Interval:</div>
        <div>${this.interval || 'None'}</div>
        
        <div style="font-weight: bold;">Data points:</div>
        <div>${this.data.length.toLocaleString()}</div>
    `;
    
    // Loaded range with visual indicator
    if (this.lastLoadedRange) {
      const startDate = formatDateCompact(this.lastLoadedRange.start);
      const endDate = formatDateCompact(this.lastLoadedRange.end);
      const now = Date.now();
      const rangeStart = this.lastLoadedRange.start;
      const rangeEnd = this.lastLoadedRange.end;
      const totalTimeSpan = 365 * 24 * 60 * 60 * 1000; // 1 year in ms
      
      // Calculate positions for visual timeline (0-100%)
      const startPercent = Math.max(0, Math.min(100, 100 * (1 - (now - rangeStart) / totalTimeSpan)));
      const endPercent = Math.max(0, Math.min(100, 100 * (1 - (now - rangeEnd) / totalTimeSpan)));
      
      html += `
        <div style="font-weight: bold;">Range:</div>
        <div>
          <div>${startDate} → ${endDate}</div>
          <div style="position: relative; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; margin-top: 5px;">
            <div style="position: absolute; left: ${startPercent}%; right: ${100-endPercent}%; height: 100%; background: linear-gradient(to right, #4caf50, #2196f3); border-radius: 4px;"></div>
            <div style="position: absolute; left: calc(100% - 5px); top: -2px; width: 5px; height: 12px; background: rgba(255,255,255,0.5); border-radius: 2px;" title="Now"></div>
          </div>
        </div>
      `;
    } else {
      html += `
        <div style="font-weight: bold;">Range:</div>
        <div>No data loaded</div>
      `;
    }
    
    html += `
        <div style="font-weight: bold;">Status:</div>
        <div>
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${this.isLoading ? '#ff9800' : '#4caf50'}; margin-right: 5px;"></span>
          ${this.isLoading ? 'Loading...' : 'Idle'}
        </div>
      </div>
    `;
    
    // Recent requests (collapsible section)
    if (this.requestLog.length > 0) {
      html += `
        <div style="margin-top: 10px;">
          <div style="font-weight: bold; cursor: pointer; user-select: none; display: flex; align-items: center;" 
               onclick="document.getElementById('requests-content').style.display = document.getElementById('requests-content').style.display === 'none' ? 'block' : 'none';">
            <span style="transform: rotate(90deg); display: inline-block; margin-right: 5px;">▶</span>
            Recent Requests (${this.requestLog.length})
          </div>
          <div id="requests-content" style="margin-top: 5px; max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 3px; padding: 5px;">
      `;
      
      this.requestLog.slice(0, 5).forEach(req => {
        const time = new Date(req.timestamp).toLocaleTimeString();
        const startTime = req.start ? formatDateCompact(req.start) : 'N/A';
        const endTime = req.end ? formatDateCompact(req.end) : 'N/A';
        const isSuccess = req.result && !req.result.includes('Error');
        
        html += `
          <div style="margin-bottom: 5px; padding-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.1);">
            <div style="display: flex; justify-content: space-between;">
              <div style="font-weight: bold;">${time}</div>
              <div style="color: ${isSuccess ? '#4caf50' : '#f44336'};"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${isSuccess ? '#4caf50' : '#f44336'}; margin-right: 3px;"></span>${isSuccess ? 'Success' : 'Error'}</div>
            </div>
            <div style="font-size: 11px; opacity: 0.8;">${req.symbol}@${req.interval}</div>
            <div style="font-size: 11px; opacity: 0.8;">Range: ${startTime} → ${endTime}</div>
            <div style="font-size: 11px; opacity: 0.8;">${req.result}</div>
          </div>
        `;
      });
      
      html += `</div></div>`;
    }
    
    // Empty ranges (collapsible section)
    if (this.emptyRanges.size > 0) {
      html += `
        <div style="margin-top: 10px;">
          <div style="font-weight: bold; cursor: pointer; user-select: none; display: flex; align-items: center;"
               onclick="document.getElementById('empty-ranges-content').style.display = document.getElementById('empty-ranges-content').style.display === 'none' ? 'block' : 'none';">
            <span style="transform: rotate(90deg); display: inline-block; margin-right: 5px;">▶</span>
            Empty Ranges (${this.emptyRanges.size})
          </div>
          <div id="empty-ranges-content" style="display: none; margin-top: 5px; max-height: 80px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 3px; padding: 5px;">
      `;
      
      Array.from(this.emptyRanges).slice(-5).forEach(range => {
        const startDate = formatDateCompact(range.start);
        const endDate = formatDateCompact(range.end);
        const durationMs = range.end - range.start;
        const durationText = durationMs < 60000 ? 
          `${Math.round(durationMs / 1000)}s` : 
          durationMs < 3600000 ? 
            `${Math.round(durationMs / 60000)}m` : 
            `${Math.round(durationMs / 3600000)}h`;
        
        html += `
          <div style="margin-bottom: 3px; font-size: 11px; opacity: 0.8;">
            ${startDate} → ${endDate} (${durationText})
          </div>
        `;
      });
      
      html += `</div></div>`;
    }
    
    panel.innerHTML = html;
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
    if (!this.symbol || !this.interval || !logicalRange) return;
    
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
        
        log(`Visible range: ${new Date(fromMs).toLocaleString()} to ${new Date(toMs).toLocaleString()}`);
        
        // Detect if the user is rapidly scrolling backward (e.g., looking for old data)
        // In this case, we want to be more aggressive about loading historical data
        const isRapidHistoricalScroll = this.lastVisibleFrom && fromMs < this.lastVisibleFrom - 30 * 24 * 60 * 60 * 1000;
        this.lastVisibleFrom = fromMs;
        
        // If there's an in-progress request, allow overriding it for rapid historical scrolling
        // but otherwise don't start another one
        if (this.requestInProgress && Date.now() - this.lastRequestTime < 1000 && !isRapidHistoricalScroll) {
          log('Skipping request - another request is in progress');
          return;
        }
        
        // Check if we need to load more data
        let needsLoading = false;
        let loadStart = fromMs;
        let loadEnd = toMs;
        let isBackwardScroll = false;
        
        if (this.lastLoadedRange) {
          const { start, end } = this.lastLoadedRange;
          
          // Adaptive buffer based on data range size and scroll direction
          const rangeSize = end - start;
          // Smaller buffer for backward scrolling (historical data)
          const backwardBuffer = rangeSize * 0.2;
          // Larger buffer for forward scrolling (recent data)
          const forwardBuffer = rangeSize * 0.3;
          
          if (fromMs < (start + backwardBuffer)) {
            // Need to load earlier data
            needsLoading = true;
            isBackwardScroll = true;
            loadEnd = start;
            
            // For rapid historical scroll, increase the load amount significantly
            const historyMultiplier = isRapidHistoricalScroll ? 2.0 : 1.0;
            
            // Increased load amount for smoother scrolling
            loadStart = fromMs - (rangeSize * 0.75 * historyMultiplier);
            log(`Loading earlier data: ${new Date(loadStart).toLocaleString()} to ${new Date(loadEnd).toLocaleString()}`);
            
            // For very old data, we can use larger jumps to reduce API calls
            const fiveYearsAgo = Date.now() - (5 * 365 * 24 * 60 * 60 * 1000);
            if (fromMs < fiveYearsAgo) {
              // For data older than 5 years, use larger jumps
              loadStart = fromMs - (rangeSize * 1.5);
              log(`Using larger jump for historical data: ${new Date(loadStart).toLocaleString()}`);
            }
          } else if (toMs > (end - forwardBuffer)) {
            // Need to load later data
            needsLoading = true;
            loadStart = end;
            loadEnd = toMs + (toMs - fromMs) * 0.75;
            log(`Loading later data: ${new Date(loadStart).toLocaleString()} to ${new Date(loadEnd).toLocaleString()}`);
          }
        } else {
          // No data loaded yet
          needsLoading = true;
          log('No data loaded yet, loading initial data');
        }
        
        if (needsLoading) {
          // For backward scrolling, we want to be more permissive with empty ranges
          // Only check for empty ranges if we're not doing rapid historical scrolling
          let skipForEmptyRange = false;
          if (isBackwardScroll && !isRapidHistoricalScroll) {
            skipForEmptyRange = this.isRangeKnownEmpty(loadStart, loadEnd);
            
            if (skipForEmptyRange) {
              log('Skipping request - range is known to be empty');
              
              // Even though we're skipping the API request, we want to update the loaded range
              // to prevent the chart from constantly trying to load this empty area
              if (this.lastLoadedRange) {
                const extendedStart = Math.min(this.lastLoadedRange.start, loadStart);
                this.lastLoadedRange.start = extendedStart;
                log(`Extended loaded range to include empty area: ${new Date(extendedStart).toLocaleString()}`);
                
                // Force update the debug panel to show the extended range
                this.updateDebugPanel(true);
              }
              
              return;
            }
          }
          
          // Calculate optimal data range
          const range = calculateDataRange(
            this.interval,
            this.container.clientWidth,
            loadStart,
            loadEnd
          );
          
          try {
            // If we're already loading, cancel that request for rapid historical scrolling
            if (this.requestInProgress && isRapidHistoricalScroll) {
              log('Overriding in-progress request for rapid historical scrolling');
              // We don't actually cancel the previous request, but we'll ignore its results
              // by setting a new loadingPromise
            }
            
            this.requestInProgress = true;
            this.lastRequestTime = Date.now();
            
            // Log the request
            const requestInfo = {
              timestamp: Date.now(),
              symbol: this.symbol,
              interval: this.interval,
              start: range.start,
              end: range.end,
              limit: range.limit,
              result: 'pending'
            };
            this.requestLog.unshift(requestInfo);
            this.updateDebugPanel();
            
            const newData = await this.loadDataForRange(range.start, range.end, range.limit);
            
            // Update request result
            requestInfo.result = newData.length > 0 ? 
              `Success (${newData.length} candles)` : 
              'No data returned';
            this.updateDebugPanel();
            
            // For backward scrolling with no data, try once more with a bigger jump
            // This helps when there are large gaps in the data (delisted periods)
            if (isBackwardScroll && newData.length === 0 && !skipForEmptyRange) {
              log('No data returned for backward scroll, trying with a bigger jump');
              
              // Try with a much larger range to find any available data
              const bigJumpStart = loadStart - (loadEnd - loadStart) * 5; // 5x bigger jump
              const bigJumpEnd = loadStart;
              
              // Log this second attempt
              const secondRequestInfo = {
                timestamp: Date.now(),
                symbol: this.symbol,
                interval: this.interval,
                start: bigJumpStart,
                end: bigJumpEnd,
                limit: range.limit,
                result: 'pending (big jump)'
              };
              this.requestLog.unshift(secondRequestInfo);
              this.updateDebugPanel();
              
              // Try loading with the bigger jump
              const bigJumpData = await this.loadDataForRange(bigJumpStart, bigJumpEnd, range.limit);
              
              secondRequestInfo.result = bigJumpData.length > 0 ? 
                `Success (${bigJumpData.length} candles)` : 
                'No data returned in big jump';
              this.updateDebugPanel();
              
              if (bigJumpData.length === 0) {
                // If still no data, remember this as a very large empty range
                this.rememberEmptyRange(bigJumpStart, loadEnd);
                log(`Remembered large empty range: ${new Date(bigJumpStart).toLocaleString()} to ${new Date(loadEnd).toLocaleString()}`);
              }
            }
          } catch (error) {
            log('Error loading data:', error);
            // Update request result
            const requestInfo = this.requestLog[0];
            if (requestInfo) {
              requestInfo.result = `Error: ${error.message}`;
              this.updateDebugPanel();
            }
          } finally {
            this.requestInProgress = false;
            this.updateDebugPanel();
          }
        }
      } catch (error) {
        console.error('Error handling time range change:', error);
      }
    }, 150); // Further reduced debounce time for more responsive loading
  }
  
  /**
   * Check if a range is known to be empty (no data available)
   */
  isRangeKnownEmpty(start, end) {
    // Check if this range significantly overlaps with any known empty range
    for (const emptyRange of this.emptyRanges) {
      // Calculate overlap percentage
      const overlapStart = Math.max(start, emptyRange.start);
      const overlapEnd = Math.min(end, emptyRange.end);
      
      if (overlapStart <= overlapEnd) {
        const overlap = overlapEnd - overlapStart;
        const rangeSize = end - start;
        const overlapPercentage = overlap / rangeSize;
        
        // If more than 80% of the requested range is known to be empty, skip the request
        if (overlapPercentage > 0.8) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Remember a range that returned no data
   */
  rememberEmptyRange(start, end) {
    // Don't remember ranges that are too small (less than 1 hour)
    if (end - start < 60 * 60 * 1000) return;
    
    // Add to set of empty ranges
    this.emptyRanges.add({ start, end });
    
    // Limit the number of remembered empty ranges to avoid memory issues
    if (this.emptyRanges.size > 20) {
      const firstEmptyRange = this.emptyRanges.values().next().value;
      this.emptyRanges.delete(firstEmptyRange);
    }
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
    
    this.updateDebugPanel();
  }

  /**
   * Load data for a specific time range
   */
  async loadDataForRange(start, end, limit) {
    // If already loading, return the existing promise
    if (this.loadingPromise) {
      log('Already loading data, returning existing promise');
      return this.loadingPromise;
    }
    
    this.setLoadingState(true);
    log(`Loading data for range: ${new Date(start).toLocaleString()} to ${new Date(end).toLocaleString()}, limit: ${limit}`);
    
    this.loadingPromise = (async () => {
      try {
        // Fetch instrument data if not available
        if (!this.instrumentData) {
          try {
            log(`Fetching instrument data for ${this.symbol}`);
            this.instrumentData = await this.apiService.fetchInstrument(this.symbol);
            log('Instrument data received');
          } catch (error) {
            log('Could not fetch instrument data:', error.message);
            // Continue without instrument data
          }
        }
        
        // For instruments with limited trading hours, adjust the start time
        let adjustedStart = start;
        if (this.instrumentData && this.instrumentData.category !== 'Crypto') {
          adjustedStart = findNearestTradingDay(this.instrumentData, adjustedStart);
          log(`Adjusted start time for trading hours: ${new Date(adjustedStart).toLocaleString()}`);
        }
        
        // Always allow scrolling by extending range even if we previously found no data
        // We don't want to halt scrolling even for delisted periods
        
        // For historical data (more than 2 years ago), we want to reduce API calls
        // by allowing larger jumps in time when no data is found
        const twoYearsAgo = Date.now() - (2 * 365 * 24 * 60 * 60 * 1000);
        const isHistoricalData = start < twoYearsAgo;
        
        // If we're requesting historical data and have empty ranges, check for overlap
        let skipRequest = false;
        if (isHistoricalData && this.emptyRanges.size > 0) {
          // Check if this range is completely contained within an empty range
          for (const emptyRange of this.emptyRanges) {
            if (start >= emptyRange.start && end <= emptyRange.end) {
              skipRequest = true;
              log(`Skipping request - range is completely within known empty range: ${new Date(emptyRange.start).toLocaleString()} to ${new Date(emptyRange.end).toLocaleString()}`);
              
              // Even though we're skipping the request, we should update the loaded range
              // to prevent repeated requests for the same empty data
              if (this.lastLoadedRange) {
                // We extend the loaded range to include this "empty" area
                this.lastLoadedRange = {
                  start: Math.min(adjustedStart, this.lastLoadedRange.start),
                  end: Math.max(end, this.lastLoadedRange.end)
                };
                log(`Extended loaded range to include empty area: ${new Date(this.lastLoadedRange.start).toLocaleString()} to ${new Date(this.lastLoadedRange.end).toLocaleString()}`);
              } else {
                // If we don't have a loaded range yet, create one
                this.lastLoadedRange = {
                  start: adjustedStart,
                  end: end
                };
                log(`Created loaded range from empty area: ${new Date(this.lastLoadedRange.start).toLocaleString()} to ${new Date(this.lastLoadedRange.end).toLocaleString()}`);
              }
              break;
            }
          }
        }
        
        // For non-historical data or if the request isn't being skipped, fetch the candles
        let candles = [];
        if (!skipRequest) {
          log(`Fetching candles for ${this.symbol}@${this.interval} from ${new Date(adjustedStart).toLocaleString()} to ${new Date(end).toLocaleString()}`);
          candles = await this.apiService.fetchCandles(this.symbol, this.interval, {
            start: adjustedStart,
            end,
            limit
          });
          
          log(`Received ${candles ? candles.length : 0} candles from API`);
        }
        
        if (candles && candles.length > 0) {
          const formattedCandles = formatCandleData(candles);
          log(`Formatted ${formattedCandles.length} candles`);
          
          // Calculate data range before merge to detect gaps
          const oldestNewCandle = formattedCandles[0];
          const newestNewCandle = formattedCandles[formattedCandles.length - 1];
          
          this.data = mergeCandles(this.data, formattedCandles);
          log(`After merge: ${this.data.length} total candles`);
          
          this.updateSeries();
          
          // Update loaded range (extended logic to handle partial data and gaps)
          if (!this.lastLoadedRange) {
            this.lastLoadedRange = {
              start: oldestNewCandle.time * 1000,
              end: newestNewCandle.time * 1000
            };
          } else {
            // Always expand the loaded range to include the new data
            // This is crucial for continuous scrolling
            this.lastLoadedRange = {
              start: Math.min(this.lastLoadedRange.start, oldestNewCandle.time * 1000),
              end: Math.max(this.lastLoadedRange.end, newestNewCandle.time * 1000)
            };
            
            log(`Updated loaded range: ${new Date(this.lastLoadedRange.start).toLocaleString()} to ${new Date(this.lastLoadedRange.end).toLocaleString()}`);
          }
        } else {
          log('No candles returned from API');
          
          // Remember this empty range to avoid unnecessary future requests
          if (!skipRequest) {
            // Only remember significant time periods (at least 1 week)
            if (end - adjustedStart >= 7 * 24 * 60 * 60 * 1000) {
              this.rememberEmptyRange(adjustedStart, end);
              log(`Remembered empty range: ${new Date(adjustedStart).toLocaleString()} to ${new Date(end).toLocaleString()}`);
            }
          }
          
          // Even with no data, continue scrolling by expanding the loaded range
          if (this.lastLoadedRange) {
            // We always want to extend the range to enable continuous scrolling
            const newStart = Math.min(this.lastLoadedRange.start, adjustedStart);
            const newEnd = Math.max(this.lastLoadedRange.end, end);
            
            this.lastLoadedRange = {
              start: newStart,
              end: newEnd
            };
            
            log(`Extended loaded range despite no data: ${new Date(newStart).toLocaleString()} to ${new Date(newEnd).toLocaleString()}`);
          } else {
            // If we don't have a loaded range yet, create one even with no data
            // This is important to prevent repeated requests for the same empty data
            this.lastLoadedRange = {
              start: adjustedStart,
              end
            };
            
            log(`Created initial loaded range with no data: ${new Date(adjustedStart).toLocaleString()} to ${new Date(end).toLocaleString()}`);
          }
        }
        
        this.updateDebugPanel();
        return this.data;
      } catch (error) {
        console.error('Error loading data:', error);
        log('Error loading data:', error.message);
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
   * Calculate expected number of candles for a time range
   */
  calculateExpectedCandleCount(start, end) {
    const intervalMs = parseInterval(this.interval);
    const rangeDuration = end - start;
    
    // For market hour aware instruments, adjust by approximately 5/7 for weekdays
    let adjustFactor = 1;
    if (this.instrumentData && this.instrumentData.category !== 'Crypto') {
      adjustFactor = 5/7; // Approximate weekday/weekend ratio
    }
    
    // Calculate expected candles
    return Math.ceil((rangeDuration / intervalMs) * adjustFactor);
  }

  /**
   * Update chart series with current data
   */
  updateSeries() {
    if (!this.data || !this.candleSeries || this.data.length === 0) return;
    
    // Update candlestick series
    this.candleSeries.setData(this.data);
    log(`Updated series with ${this.data.length} candles`);
  }

  /**
   * Load symbol and interval
   */
  async loadSymbol(symbol, interval) {
    if (this.symbol === symbol && this.interval === interval && this.isLoading) {
      log(`Already loading ${symbol}@${interval}, skipping request`);
      return;
    }
    
    this.setLoadingState(true);
    log(`Loading symbol: ${symbol}, interval: ${interval}`);
    
    try {
      // Reset the empty ranges when changing symbols
      this.emptyRanges.clear();
      
      // Unsubscribe from previous
      if (this.symbol && this.interval && this.realtimeCallback) {
        log(`Unsubscribing from ${this.symbol}@${this.interval}`);
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
        log(`Caching ${this.data.length} candles for ${currentKey}`);
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
        log(`Using cached data for ${newKey}: ${cachedData.data.length} candles`);
        this.data = [...cachedData.data];
        this.lastLoadedRange = cachedData.range ? {...cachedData.range} : null;
        this.instrumentData = cachedData.instrumentData;
        this.updateSeries();
      } else {
        // Fresh load - reset data
        log(`No cached data for ${newKey}, loading fresh data`);
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
        
        log(`Calculated initial data range: ${new Date(start).toLocaleString()} to ${new Date(end).toLocaleString()}, limit: ${limit}`);
        
        // Fetch instrument data and initial candles
        try {
          log(`Fetching instrument data for ${symbol}`);
          this.instrumentData = await this.apiService.fetchInstrument(symbol);
          
          // Adjust start time for non-crypto instruments
          if (this.instrumentData && this.instrumentData.category !== 'Crypto') {
            start = findNearestTradingDay(this.instrumentData, start);
            log(`Adjusted start time for trading hours: ${new Date(start).toLocaleString()}`);
          }
        } catch (error) {
          log('Could not fetch instrument data:', error.message);
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
          log(`Updated realtime candle at ${new Date(timestamp * 1000).toLocaleString()}`);
        } else {
          this.data.push(candleData);
          this.data.sort((a, b) => a.time - b.time);
          log(`Added new realtime candle at ${new Date(timestamp * 1000).toLocaleString()}`);
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
        
        this.updateDebugPanel();
      };
      
      // Subscribe to updates for this symbol and interval
      log(`Subscribing to realtime updates for ${symbol}@${interval}`);
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
      log(`Error loading symbol ${symbol} with interval ${interval}:`, error.message);
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
    
    log(`Changing interval from ${this.interval} to ${interval}`);
    return this.loadSymbol(this.symbol, interval);
  }

  /**
   * Force refresh data and clear caches
   * This is useful for debugging and testing
   */
  async forceRefresh() {
    log('Force refreshing chart data');
    
    // Clear chart data cache
    this.dataCache.clear();
    this.emptyRanges.clear();
    
    // Clear API cache for this symbol
    if (this.apiService.clearCache && this.symbol) {
      const clearedCount = this.apiService.clearCache(this.symbol);
      log(`Cleared ${clearedCount} API cache entries for ${this.symbol}`);
    }
    
    // Reset state
    this.data = [];
    this.lastLoadedRange = null;
    
    // Reload current symbol with current interval
    if (this.symbol && this.interval) {
      await this.loadSymbol(this.symbol, this.interval);
      log('Reloaded data after cache clear');
    }
    
    // Update debug panel
    this.updateDebugPanel(true);
  }
  
  /**
   * Clean up resources
   */
  async destroy() {
    log('Destroying chart component');
    
    // Clear timeouts
    if (this._timeRangeChangeTimeout) {
      clearTimeout(this._timeRangeChangeTimeout);
    }
    
    // Unsubscribe from WebSocket
    if (this.symbol && this.interval && this.realtimeCallback) {
      log(`Unsubscribing from ${this.symbol}@${this.interval}`);
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
    this.emptyRanges.clear();
    
    // Remove debug panel and controls
    const debugPanel = document.getElementById('chart-debug-panel');
    if (debugPanel) {
      debugPanel.parentNode.removeChild(debugPanel);
    }
    
    const toggleButton = document.getElementById('chart-debug-toggle');
    if (toggleButton) {
      toggleButton.parentNode.removeChild(toggleButton);
    }
  }
}

export default ChartComponent;