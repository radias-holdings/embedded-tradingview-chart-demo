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
    return [];
  }
  
  return candles
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
}

/**
 * Merge new candle data with existing data, removing duplicates
 */
export function mergeCandles(existingData, newData) {
  if (!Array.isArray(existingData)) existingData = [];
  if (!Array.isArray(newData)) newData = [];
  
  if (existingData.length === 0) return [...newData];
  if (newData.length === 0) return [...existingData];
  
  // Use Map for deduplication by timestamp
  const candleMap = new Map();
  
  existingData.forEach(candle => {
    if (candle && typeof candle.time === 'number') {
      candleMap.set(candle.time, candle);
    }
  });
  
  newData.forEach(candle => {
    if (candle && typeof candle.time === 'number') {
      candleMap.set(candle.time, candle);
    }
  });
  
  return Array.from(candleMap.values())
    .sort((a, b) => a.time - b.time);
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
  const padding = Math.max(Math.ceil(visibleBars * 1.5), 200);
  
  return {
    start: start - (intervalMs * padding),
    end: end + (intervalMs * padding),
    limit: visibleBars + (padding * 2)
  };
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
  
  // Find market hours for the current day
  const marketHours = instrument.market.find(m => m.open && m.open.day === day);
  
  if (!marketHours) return false;
  
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
 * Find the nearest trading day in the past
 */
export function findNearestTradingDay(instrument, timestamp) {
  // For 24/7 markets like crypto, return the same timestamp
  if (!instrument || instrument.category === 'Crypto') {
    return timestamp;
  }
  
  if (!instrument.market || !Array.isArray(instrument.market)) {
    return timestamp;
  }
  
  let currentTimestamp = timestamp;
  const oneDayMs = 24 * 60 * 60 * 1000;
  
  // Look back up to 30 days
  for (let i = 0; i < 30; i++) {
    if (isMarketOpen(instrument, currentTimestamp)) {
      return currentTimestamp;
    }
    // Go back one day
    currentTimestamp -= oneDayMs;
  }
  
  // If no trading day found, return original timestamp
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
  
  // Add padding (10 bars)
  return {
    from: from - (intervalSec * 10),
    to: to + (intervalSec * 10)
  };
}