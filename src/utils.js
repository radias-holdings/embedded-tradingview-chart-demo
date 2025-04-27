/**
 * Parses interval string into milliseconds
 */
export function parseInterval(interval) {
  if (!interval || typeof interval !== "string") {
    return 24 * 60 * 60 * 1000; // Default to 1 day
  }

  const unit = interval.slice(-1);
  const value = parseInt(interval.slice(0, -1), 10);

  if (isNaN(value) || value <= 0) {
    return 24 * 60 * 60 * 1000;
  }

  switch (unit) {
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "d": return value * 24 * 60 * 60 * 1000;
    case "w": return value * 7 * 24 * 60 * 60 * 1000;
    case "o": return value * 30 * 24 * 60 * 60 * 1000; // Approximate for months
    default: return 24 * 60 * 60 * 1000;
  }
}

/**
 * Format price with precision based on value
 */
export function formatPrice(price, _symbol) {
  if (price === undefined || price === null || isNaN(price)) {
    return "N/A";
  }

  let precision = price < 0.1 ? 6 : price < 1 ? 4 : 2;

  return price.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/**
 * Format date based on interval
 */
export function formatDate(timestamp, interval) {
  if (!timestamp) return "N/A";

  const date = new Date(timestamp * 1000);

  // Get interval unit
  let unit = "d";
  if (interval && typeof interval === "string") {
    unit = interval.slice(-1);
  }

  // Format based on interval unit
  switch (unit) {
    case "m":
    case "h":
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      }) + " " + 
      date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit"
      });
    case "d":
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    case "w":
      return "Week of " + 
      date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    case "o":
      return date.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric"
      });
    default:
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      }) + " " + 
      date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit"
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
    .map((candle) => {
      if (!candle || typeof candle.timestamp === "undefined") {
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
        volume,
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

  // Fast path: if data ranges don't overlap, use concatenation and sort
  if (newData.length > 0 && existingData.length > 0) {
    const existingMin = existingData[0].time;
    const existingMax = existingData[existingData.length - 1].time;
    const newMin = newData[0].time;
    const newMax = newData[newData.length - 1].time;

    // If data sets don't overlap, we can avoid the map operation
    if (newMax < existingMin) {
      // New data is entirely before existing data
      return [...newData, ...existingData];
    }

    if (newMin > existingMax) {
      // New data is entirely after existing data
      return [...existingData, ...newData];
    }
  }

  // Use Map for deduplication by timestamp
  const candleMap = new Map();

  // Put existing data in the map
  for (const candle of existingData) {
    if (candle && typeof candle.time === "number") {
      candleMap.set(candle.time, candle);
    }
  }

  // Add or update with new data
  for (const candle of newData) {
    if (candle && typeof candle.time === "number") {
      candleMap.set(candle.time, candle);
    }
  }

  // Convert map back to sorted array
  return Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
}

/**
 * Calculate optimal data range for a given viewport
 */
export function calculateDataRange(interval, start, end) {
  const intervalMs = parseInterval(interval);

  // Calculate visible bars
  const viewportDuration = end - start;
  const visibleBars = Math.ceil(viewportDuration / intervalMs);

  // Adjust padding based on interval type
  let paddingFactor;
  
  // Smaller intervals need more aggressive padding
  if (interval === '1m') {
    paddingFactor = 0.5; // 50% padding for 1m intervals
  } else if (['5m', '15m', '30m'].includes(interval)) {
    paddingFactor = 0.4; // 40% padding for smaller intervals
  } else {
    paddingFactor = 0.3; // 30% for larger intervals
  }
  
  // Calculate padding bars with a cap
  const padding = Math.min(
    Math.ceil(visibleBars * paddingFactor),
    // Smaller intervals need higher caps
    interval === '1m' ? 1000 : 
    ['5m', '15m', '30m'].includes(interval) ? 750 : 
    500 // Default limit on padding bars
  );

  // Calculate optimal range with padding
  const optimalStart = start - intervalMs * padding;
  const optimalEnd = end + intervalMs * padding;
  
  // Cap the limit to a reasonable number based on interval
  const maxLimit = 
    interval === '1m' ? 2000 : 
    ['5m', '15m', '30m'].includes(interval) ? 1500 : 
    1000;
  
  const limit = Math.min(visibleBars + padding * 2, maxLimit);

  console.log(`🔢 Calculated data range for ${interval}:`, {
    visibleBars,
    padding,
    paddingFactor,
    requestedRange: {
      start: new Date(optimalStart).toISOString(),
      end: new Date(optimalEnd).toISOString(),
      bars: limit
    }
  });

  return {
    start: optimalStart,
    end: optimalEnd,
    limit
  };
}

/**
 * Check if a day is a trading day for the instrument
 */
export function isTradingDay(instrument, dayIndex) {
  if (!instrument || !instrument.market || !Array.isArray(instrument.market)) {
    return false;
  }
  
  // For crypto, always return true
  if (instrument.category === "Crypto") {
    return true;
  }
  
  // Find if this day has market hours
  return instrument.market.some(m => m.open && m.open.day === dayIndex);
}

/**
 * Get market open time for a specific date
 * Returns timestamp in milliseconds or null if market is closed that day
 */
export function getMarketOpenTime(instrument, date) {
  if (!instrument || !instrument.market || !Array.isArray(instrument.market)) {
    return null;
  }
  
  // For crypto, return the same time (24/7 market)
  if (instrument.category === "Crypto") {
    return date.getTime();
  }
  
  const day = date.getUTCDay();
  
  // Find market hours for this day
  const marketHours = instrument.market.find(m => m.open && m.open.day === day);
  if (!marketHours) {
    return null; // No trading on this day
  }
  
  // Create a new date representing market open time
  const openTime = new Date(date);
  openTime.setUTCHours(marketHours.open.hour, marketHours.open.minute, 0, 0);
  
  return openTime.getTime();
}

/**
 * Find the nearest past trading day for a given timestamp
 * Returns timestamp adjusted to market open time
 */
export function findNearestTradingDay(instrument, timestamp) {
  // For 24/7 markets like crypto, return the same timestamp
  if (!instrument || instrument.category === "Crypto") {
    return timestamp;
  }

  if (!instrument.market || !Array.isArray(instrument.market)) {
    console.log(`⚠️ No market data for ${instrument.symbol || "unknown"}`);
    return timestamp;
  }

  const date = new Date(timestamp);
  const originalDate = new Date(timestamp);
  const dayInMs = 24 * 60 * 60 * 1000;
  
  console.log(`🔍 Finding nearest trading day for ${instrument.symbol} from:`, originalDate.toISOString());
  
  // Try the current day first
  let marketOpen = getMarketOpenTime(instrument, date);
  if (marketOpen !== null) {
    const currentDayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
    console.log(`  ✅ ${currentDayName} ${date.toISOString().split('T')[0]} is a trading day`);
    
    // If the timestamp is before market open on a trading day, 
    // use market open time instead
    if (timestamp < marketOpen) {
      console.log(`  ⏱️ Adjusted to market open time: ${new Date(marketOpen).toISOString()}`);
      return marketOpen;
    }
    
    // If timestamp is after market open, use the timestamp
    return timestamp;
  }
  
  // Look back up to 30 days to find a trading day
  for (let i = 1; i <= 30; i++) {
    date.setTime(originalDate.getTime() - (i * dayInMs));
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
    
    marketOpen = getMarketOpenTime(instrument, date);
    if (marketOpen !== null) {
      console.log(`  ✅ Found trading day: ${dayName} ${date.toISOString().split('T')[0]}`);
      console.log(`  ⏱️ Using market open time: ${new Date(marketOpen).toISOString()}`);
      return marketOpen;
    }
    
    console.log(`  ❌ ${dayName} ${date.toISOString().split('T')[0]} is not a trading day`);
  }
  
  console.log(`⚠️ No trading day found in last 30 days for ${instrument.symbol}, using original timestamp`);
  return timestamp;
}