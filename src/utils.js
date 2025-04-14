/**
 * Utility functions for working with candle data and time intervals
 */

/**
 * Parses interval string into milliseconds
 * @param {string} interval - Interval string (e.g., '1m', '5m', '1d')
 * @returns {number} Interval in milliseconds
 */
export function parseInterval(interval) {
  // Ensure valid input
  if (!interval || typeof interval !== 'string') {
    console.error('Invalid interval:', interval);
    return 24 * 60 * 60 * 1000; // Default to 1 day if invalid
  }
  
  const unit = interval.slice(-1);
  const value = parseInt(interval.slice(0, -1), 10);
  
  if (isNaN(value) || value <= 0) {
    console.error('Invalid interval value:', interval);
    return 24 * 60 * 60 * 1000; // Default to 1 day if invalid
  }
  
  switch (unit) {
    case 'm': // minutes
      return value * 60 * 1000;
    case 'h': // hours
      return value * 60 * 60 * 1000;
    case 'd': // days
      return value * 24 * 60 * 60 * 1000;
    case 'w': // weeks
      return value * 7 * 24 * 60 * 60 * 1000;
    case 'o': // months (approximate)
      return value * 30 * 24 * 60 * 60 * 1000;
    default:
      console.error(`Unknown interval unit: ${unit}, using default 1 day`);
      return 24 * 60 * 60 * 1000; // Default to 1 day for unknown units
  }
}

/**
 * Formats candle data from API to the format required by TradingView
 * @param {Array} candles - Array of candle data from API
 * @returns {Array} Formatted candle data for TradingView
 */
export function formatCandleData(candles) {
  console.log('Formatting candle data, count:', candles?.length);
  
  if (!Array.isArray(candles)) {
    console.warn('Invalid candle data format, expected array:', candles);
    return [];
  }
  
  if (candles.length === 0) {
    console.warn('Empty candle data array');
    return [];
  }
  
  // Log a sample candle to help debug structure issues
  if (candles.length > 0) {
    console.log('Sample candle structure:', candles[0]);
  }
  
  const formattedCandles = candles.map(candle => {
    // Validate required fields
    if (!candle || typeof candle.timestamp === 'undefined') {
      console.warn('Invalid candle object missing timestamp:', candle);
      return null;
    }
    
    // Validate numeric values
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.volume || 0);
    
    if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
      console.warn('Invalid numeric values in candle:', candle);
      return null;
    }
    
    // Convert timestamp to seconds for TradingView Lightweight Charts
    // Make sure it's a whole number to avoid fractional timestamps
    const timestamp = Math.floor(candle.timestamp / 1000);
    
    return {
      time: timestamp,
      open,
      high,
      low,
      close,
      volume
    };
  }).filter(candle => candle !== null); // Remove invalid candles
  
  console.log(`Formatted ${formattedCandles.length} valid candles out of ${candles.length} total`);
  
  // Return sorted candles to ensure they're in chronological order
  return formattedCandles.sort((a, b) => a.time - b.time);
}

/**
 * Calculate optimal data range for a given viewport
 * @param {string} interval - Candle interval (e.g., '1m', '5m', '1d')
 * @param {number} viewportWidth - Width of the viewport in pixels
 * @param {number} start - Current viewport start timestamp
 * @param {number} end - Current viewport end timestamp
 * @returns {Object} Optimized data range
 */
export function calculateDataRange(interval, viewportWidth, start, end) {
  const intervalMs = parseInterval(interval);
  
  // Calculate how many bars would be visible in the current viewport
  const viewportDuration = end - start;
  const visibleBars = Math.ceil(viewportDuration / intervalMs);
  
  // Request more bars than needed for smooth scrolling
  // Use at least 500 bars or twice the visible bars, whichever is larger
  const padding = Math.max(Math.ceil(visibleBars * 2), 500);
  
  // Calculate expanded range
  return {
    start: start - (intervalMs * padding),
    end: end + (intervalMs * padding),
    limit: visibleBars + (padding * 2)
  };
}

/**
 * Handle special intervals like 12h and 1mo correctly
 * @param {string} interval - Candle interval
 * @returns {string} Normalized interval
 */
export function normalizeInterval(interval) {
  // Handle special cases
  if (interval === '12h') {
    return '12h';
  } else if (interval === '1mo') {
    return '1mo';
  }
  return interval;
}

/**
 * Determines if an instrument is trading at a given timestamp
 * based on its market hours
 * @param {Object} instrument - Instrument data with market hours
 * @param {number} timestamp - Timestamp to check
 * @returns {boolean} True if the market is open at the given timestamp
 */
export function isMarketOpen(instrument, timestamp) {
  // For 24/7 markets like crypto, always return true
  if (!instrument || instrument.category === 'Crypto') {
    return true;
  }
  
  // Guard against missing market data
  if (!instrument.market || !Array.isArray(instrument.market)) {
    console.warn('Instrument is missing market hours data:', instrument);
    return false;
  }
  
  const date = new Date(timestamp);
  const day = date.getUTCDay(); // 0-6 (Sunday-Saturday)
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  
  // Find the market hours for the current day
  const marketHours = instrument.market.find(m => m.open && m.open.day === day);
  
  if (!marketHours) {
    return false;
  }
  
  // Check if current time is within market hours
  const openHour = marketHours.open.hour;
  const openMinute = marketHours.open.minute;
  const closeHour = marketHours.close.hour;
  const closeMinute = marketHours.close.minute;
  
  // Compute minutes since start of day
  const currentMinutes = hour * 60 + minute;
  const openMinutes = openHour * 60 + openMinute;
  const closeMinutes = closeHour * 60 + closeMinute;
  
  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
}

/**
 * Find the nearest trading day in the past
 * @param {Object} instrument - Instrument data with market hours
 * @param {number} timestamp - Timestamp to start from
 * @param {number} maxDays - Maximum number of days to look back
 * @returns {number} Timestamp of the nearest trading day
 */
export function findNearestTradingDay(instrument, timestamp, maxDays = 30) {
  // For 24/7 markets like crypto, just return the same timestamp
  if (!instrument || instrument.category === 'Crypto') {
    return timestamp;
  }
  
  // Guard against missing market data
  if (!instrument.market || !Array.isArray(instrument.market)) {
    console.warn('Instrument is missing market hours data:', instrument);
    return timestamp;
  }
  
  let currentTimestamp = timestamp;
  const oneDayMs = 24 * 60 * 60 * 1000;
  
  for (let i = 0; i < maxDays; i++) {
    if (isMarketOpen(instrument, currentTimestamp)) {
      return currentTimestamp;
    }
    // Go back one day
    currentTimestamp -= oneDayMs;
  }
  
  // If no trading day found within maxDays, return original timestamp
  console.warn(`No trading day found within ${maxDays} days, using original timestamp`);
  return timestamp;
}

/**
 * Merge new candle data with existing data, removing duplicates
 * @param {Array} existingData - Existing candle data
 * @param {Array} newData - New candle data to merge
 * @returns {Array} Merged and sorted candle data
 */
export function mergeCandles(existingData, newData) {
  // Handle invalid inputs
  if (!Array.isArray(existingData)) existingData = [];
  if (!Array.isArray(newData)) newData = [];
  
  if (existingData.length === 0) {
    return [...newData]; // Return a new array to avoid reference issues
  }
  
  if (newData.length === 0) {
    return [...existingData]; // Return a new array to avoid reference issues
  }
  
  // Use a Map to deduplicate by timestamp
  const candleMap = new Map();
  
  // Add existing data to the map
  existingData.forEach(candle => {
    if (candle && typeof candle.time === 'number') {
      candleMap.set(candle.time, candle);
    }
  });
  
  // Add or update with new data
  newData.forEach(candle => {
    if (candle && typeof candle.time === 'number') {
      candleMap.set(candle.time, candle);
    }
  });
  
  // Convert back to array and sort by time
  return Array.from(candleMap.values())
    .sort((a, b) => a.time - b.time);
}

/**
 * Checks if a given timestamp is within a specific time range
 * @param {number} timestamp - Timestamp to check
 * @param {number} start - Start timestamp
 * @param {number} end - End timestamp
 * @returns {boolean} True if timestamp is within the range
 */
export function isTimestampInRange(timestamp, start, end) {
  if (typeof timestamp !== 'number' || typeof start !== 'number' || typeof end !== 'number') {
    return false;
  }
  return timestamp >= start && timestamp <= end;
}

/**
 * Calculate visible range for subscription optimization
 * @param {string} interval - Candle interval (e.g., '1m', '5m', '1d')
 * @param {Object} visibleRange - Visible range in timestamps
 * @returns {Object} Subscription range with padding
 */
export function calculateSubscriptionRange(interval, visibleRange) {
  if (!visibleRange || typeof visibleRange.from !== 'number' || typeof visibleRange.to !== 'number') {
    // Return a default range if input is invalid
    const now = Math.floor(Date.now() / 1000);
    return { from: now - 86400, to: now + 86400 }; // Default 1 day each way
  }
  
  const intervalMs = parseInterval(interval);
  const intervalSec = intervalMs / 1000;
  const { from, to } = visibleRange;
  
  // Add padding to ensure we have enough data
  const paddingBars = 10;
  
  return {
    from: from - (intervalSec * paddingBars),
    to: to + (intervalSec * paddingBars)
  };
}