/**
 * Utility functions for chart and data handling
 */

// Debug logging utility
const DEBUG = true;
function log(...args) {
  if (DEBUG) {
    console.log(`[Utils]`, ...args);
  }
}

/**
 * Parses interval string into milliseconds
 */
export function parseInterval(interval) {
  if (!interval || typeof interval !== 'string') {
    return 24 * 60 * 60 * 1000; // Default to 1 day
  }
  
  const unit = interval.slice(-1);
  const value = parseInt(interval.slice(0, -1), 10);
  
  if (isNaN(value) || value <= 0) {
    return 24 * 60 * 60 * 1000;
  }
  
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    case 'o': return value * 30 * 24 * 60 * 60 * 1000; // Approximate for months
    default: return 24 * 60 * 60 * 1000;
  }
}

/**
 * Format price with precision based on value.
 * In future, use the digits from instrument data.
 */
export function formatPrice(price, _symbol) {
  if (price === undefined || price === null || isNaN(price)) {
    return 'N/A';
  }
  
  let precision = undefined;

  // Arbitrary... just a guide
  if (price < 0.1) {
    precision = 6;
  } else if (price < 1) {
    precision = 4;
  } else {
    precision = 2;
  }
  
  // Format the price with commas for thousands and fixed precision
  return price.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });
}

/**
 * Format date based on interval
 */
export function formatDate(timestamp, interval) {
  if (!timestamp) return 'N/A';
  
  const date = new Date(timestamp * 1000);
  
  // Get interval details
  let unit = 'd';
  let value = 1;
  
  if (interval && typeof interval === 'string') {
    unit = interval.slice(-1);
    value = parseInt(interval.slice(0, -1), 10);
  }
  
  // Different formats based on interval
  if (unit === 'm') {
    // Minutes
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    }) + ' ' + date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } else if (unit === 'h') {
    // Hours
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    }) + ' ' + date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } else if (unit === 'd') {
    // Days
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric' 
    });
  } else if (unit === 'w') {
    // Weeks
    return 'Week of ' + date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric' 
    });
  } else if (unit === 'o') {
    // Months
    return date.toLocaleDateString('en-US', { 
      month: 'long',
      year: 'numeric' 
    });
  } else {
    // Fallback
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric' 
    }) + ' ' + date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

/**
 * Formats candle data from API to the format required by TradingView
 */
export function formatCandleData(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    log('No candles to format');
    return [];
  }
  
  log(`Formatting ${candles.length} candles`);
  
  const formatted = candles
    .map(candle => {
      if (!candle || typeof candle.timestamp === 'undefined') {
        return null;
      }
      
      // Validate numeric values
      const open = Number(candle.open);
      const high = Number(candle.high);
      const low = Number(candle.low);
      const close = Number(candle.close);
      const volume = Number(candle.volume || 0);
      
      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
        log('Invalid candle data', candle);
        return null;
      }
      
      // Convert timestamp to seconds for TradingView
      const timestamp = Math.floor(candle.timestamp / 1000);
      
      return {
        time: timestamp,
        open,
        high,
        low,
        close,
        volume // Keep volume data for tooltip display
      };
    })
    .filter(candle => candle !== null)
    .sort((a, b) => a.time - b.time);
  
  log(`Formatted ${formatted.length} valid candles, ${candles.length - formatted.length} were invalid`);
  
  // Detect significant gaps in data
  detectAndLogDataGaps(formatted);
  
  return formatted;
}

/**
 * Detect and log significant gaps in candle data
 */
function detectAndLogDataGaps(candles) {
  if (!candles || candles.length < 2) return;
  
  // Calculate expected interval based on first few candles
  let totalInterval = 0;
  let countIntervals = 0;
  
  // Use up to 10 intervals to calculate average
  const sampleSize = Math.min(10, candles.length - 1);
  for (let i = 0; i < sampleSize; i++) {
    const interval = candles[i + 1].time - candles[i].time;
    totalInterval += interval;
    countIntervals++;
  }
  
  const avgInterval = totalInterval / countIntervals;
  
  // Look for gaps that are at least 3x the average interval
  const gaps = [];
  for (let i = 1; i < candles.length; i++) {
    const interval = candles[i].time - candles[i - 1].time;
    
    // Check if gap is significant (3x average or more)
    if (interval > avgInterval * 3) {
      gaps.push({
        startTime: new Date(candles[i - 1].time * 1000).toLocaleString(),
        endTime: new Date(candles[i].time * 1000).toLocaleString(),
        durationSeconds: interval,
        durationAvgIntervals: interval / avgInterval
      });
    }
  }
  
  if (gaps.length > 0) {
    log(`Detected ${gaps.length} significant gaps in data:`);
    gaps.forEach((gap, i) => {
      log(`Gap ${i + 1}: ${gap.startTime} to ${gap.endTime} (${gap.durationSeconds}s, ${gap.durationAvgIntervals.toFixed(1)}x avg interval)`);
    });
  }
}

/**
 * Merge new candle data with existing data, removing duplicates
 * And ensuring proper order
 */
export function mergeCandles(existingData, newData) {
  if (!Array.isArray(existingData)) existingData = [];
  if (!Array.isArray(newData)) newData = [];
  
  log(`Merging ${existingData.length} existing candles with ${newData.length} new candles`);
  
  if (existingData.length === 0) return [...newData];
  if (newData.length === 0) return [...existingData];
  
  // Use Map for deduplication by timestamp
  const candleMap = new Map();
  
  // Track data stats for logging
  let existingAdded = 0;
  let newAdded = 0;
  let duplicates = 0;
  
  existingData.forEach(candle => {
    if (candle && typeof candle.time === 'number') {
      candleMap.set(candle.time, candle);
      existingAdded++;
    }
  });
  
  newData.forEach(candle => {
    if (candle && typeof candle.time === 'number') {
      if (candleMap.has(candle.time)) {
        duplicates++;
      } else {
        newAdded++;
      }
      // Always use the newer data if timestamps match
      candleMap.set(candle.time, candle);
    }
  });
  
  // Sort by timestamp
  const mergedCandles = Array.from(candleMap.values())
    .sort((a, b) => a.time - b.time);
  
  log(`Merge result: ${mergedCandles.length} total candles (${existingAdded} existing, ${newAdded} new, ${duplicates} duplicates/updates)`);
  
  // Look for gaps in merged data
  detectAndLogDataGaps(mergedCandles);
  
  return mergedCandles;
}

/**
 * Calculate optimal data range for a given viewport
 */
export function calculateDataRange(interval, viewportWidth, start, end) {
  const intervalMs = parseInterval(interval);
  
  // Calculate visible bars
  const viewportDuration = end - start;
  const visibleBars = Math.ceil(viewportDuration / intervalMs);
  
  // Request more bars for smooth scrolling
  // Increased padding for better performance when scrolling
  const padding = Math.max(Math.ceil(visibleBars * 2), 300);
  
  const result = {
    start: start - (intervalMs * padding),
    end: end + (intervalMs * padding),
    limit: visibleBars + (padding * 2)
  };
  
  log(`Calculated data range: ${new Date(result.start).toLocaleString()} to ${new Date(result.end).toLocaleString()}, limit: ${result.limit}`);
  
  return result;
}

/**
 * Check if a given day has market hours defined
 */
export function hasMarketHours(instrument, dayOfWeek) {
  if (!instrument || !instrument.market || !Array.isArray(instrument.market)) {
    return false;
  }
  
  return instrument.market.some(m => m.open && m.open.day === dayOfWeek);
}

/**
 * Check if market is open at a given timestamp
 */
export function isMarketOpen(instrument, timestamp) {
  // For 24/7 markets like crypto, always return true
  if (!instrument || instrument.category === 'Crypto') {
    return true;
  }
  
  if (!instrument.market || !Array.isArray(instrument.market)) {
    return false;
  }
  
  const date = new Date(timestamp);
  const day = date.getUTCDay(); // 0-6 (Sunday-Saturday)
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  
  // Check if this day has market hours
  if (!hasMarketHours(instrument, day)) {
    return false;
  }
  
  // Find market hours for the current day
  const marketHours = instrument.market.find(m => m.open && m.open.day === day);
  
  // Check if current time is within market hours
  const openHour = marketHours.open.hour;
  const openMinute = marketHours.open.minute;
  const closeHour = marketHours.close.hour;
  const closeMinute = marketHours.close.minute;
  
  const currentMinutes = hour * 60 + minute;
  const openMinutes = openHour * 60 + openMinute;
  const closeMinutes = closeHour * 60 + closeMinute;
  
  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
}

/**
 * Find the nearest trading day in the past and adjust to market open time
 */
export function findNearestTradingDay(instrument, timestamp) {
  // For 24/7 markets like crypto, return the same timestamp
  if (!instrument || instrument.category === 'Crypto') {
    return timestamp;
  }
  
  if (!instrument.market || !Array.isArray(instrument.market)) {
    return timestamp;
  }
  
  const date = new Date(timestamp);
  const currentDay = date.getUTCDay();
  
  // First, check if this is a trading day but outside market hours
  if (hasMarketHours(instrument, currentDay)) {
    // Get the market hours for this day
    const marketHours = instrument.market.find(m => m.open && m.open.day === currentDay);
    
    // Create a date object for the market open time on this day
    const marketOpenTime = new Date(timestamp);
    marketOpenTime.setUTCHours(marketHours.open.hour, marketHours.open.minute, 0, 0);
    
    // Create a date object for the market close time on this day
    const marketCloseTime = new Date(timestamp);
    marketCloseTime.setUTCHours(marketHours.close.hour, marketHours.close.minute, 0, 0);
    
    // If timestamp is before market open on this day, use market open time
    if (date < marketOpenTime) {
      log(`Adjusting timestamp to market open time: ${marketOpenTime.toLocaleString()}`);
      return marketOpenTime.getTime();
    }
    
    // If timestamp is after market close on this day, find the previous trading day
    if (date > marketCloseTime) {
      // Continue to search for previous day
    } else {
      // Already within market hours, use original timestamp
      return timestamp;
    }
  }
  
  // Find the most recent past day with market hours
  let daysBack = 1;
  const maxDaysBack = 10; // Reasonable limit for finding a trading day
  
  while (daysBack <= maxDaysBack) {
    // Calculate the day of week for "daysBack" days ago
    let prevDay = (currentDay - daysBack) % 7;
    if (prevDay < 0) prevDay += 7; // Handle negative modulo
    
    if (hasMarketHours(instrument, prevDay)) {
      // Get the market hours for this day
      const marketHours = instrument.market.find(m => m.open && m.open.day === prevDay);
      
      // Create date for that day with market close time (most recent time on that day)
      const prevDate = new Date(timestamp - (daysBack * 24 * 60 * 60 * 1000));
      prevDate.setUTCHours(marketHours.close.hour, marketHours.close.minute, 0, 0);
      
      log(`Found previous trading day ${daysBack} days back: ${prevDate.toLocaleString()}`);
      return prevDate.getTime();
    }
    
    daysBack++;
  }
  
  // If no trading day found in the reasonable past, just return a day with valid hours
  // Find any day with market hours
  for (const marketDay of instrument.market) {
    if (marketDay.open && marketDay.close) {
      const anyDate = new Date(timestamp);
      // Set to the found day with market close time
      anyDate.setUTCDate(anyDate.getUTCDate() - ((anyDate.getUTCDay() - marketDay.open.day + 7) % 7));
      anyDate.setUTCHours(marketDay.close.hour, marketDay.close.minute, 0, 0);
      
      log(`Using fallback trading day: ${anyDate.toLocaleString()}`);
      return anyDate.getTime();
    }
  }
  
  // Last resort fallback - return original timestamp
  return timestamp;
}

/**
 * Check if a timestamp is within a range
 */
export function isTimestampInRange(timestamp, start, end) {
  if (typeof timestamp !== 'number' || typeof start !== 'number' || typeof end !== 'number') {
    return false;
  }
  return timestamp >= start && timestamp <= end;
}

/**
 * Calculate subscription range with padding
 */
export function calculateSubscriptionRange(interval, visibleRange) {
  if (!visibleRange || typeof visibleRange.from !== 'number' || typeof visibleRange.to !== 'number') {
    const now = Math.floor(Date.now() / 1000);
    return { from: now - 86400, to: now + 86400 }; // Default 1 day each way
  }
  
  const intervalMs = parseInterval(interval);
  const intervalSec = intervalMs / 1000;
  const { from, to } = visibleRange;
  
  // Add padding (increased from 10 to 20 bars)
  const result = {
    from: from - (intervalSec * 20),
    to: to + (intervalSec * 20)
  };
  
  log(`Calculated subscription range: ${new Date(result.from * 1000).toLocaleString()} to ${new Date(result.to * 1000).toLocaleString()}`);
  
  return result;
}

/**
 * Find data gaps larger than expected interval
 */
export function findDataGaps(candles, interval) {
  if (!candles || candles.length < 2) return [];
  
  const intervalMs = parseInterval(interval) / 1000; // Convert to seconds
  const maxExpectedGap = intervalMs * 1.5; // Allow 50% deviation
  
  const gaps = [];
  
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const gap = curr.time - prev.time;
    
    if (gap > maxExpectedGap) {
      gaps.push({
        start: prev.time,
        end: curr.time,
        gap: gap,
        expectedInterval: intervalMs
      });
    }
  }
  
  if (gaps.length > 0) {
    log(`Found ${gaps.length} gaps in data larger than expected interval:`);
    gaps.forEach((gap, i) => {
      const startDate = new Date(gap.start * 1000).toLocaleString();
      const endDate = new Date(gap.end * 1000).toLocaleString();
      const expectedIntervalFormatted = formatDuration(gap.expectedInterval);
      const gapFormatted = formatDuration(gap.gap);
      
      log(`Gap ${i + 1}: ${startDate} to ${endDate} (expected: ${expectedIntervalFormatted}, actual: ${gapFormatted})`);
    });
  }
  
  return gaps;
}

/**
 * Format duration in seconds to human-readable format
 */
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  } else {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return `${days}d ${hours}h`;
  }
}