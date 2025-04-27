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
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "w":
      return value * 7 * 24 * 60 * 60 * 1000;
    case "o":
      return value * 30 * 24 * 60 * 60 * 1000; // Approximate for months
    default:
      return 24 * 60 * 60 * 1000;
  }
}

/**
 * Format price with precision based on value.
 * In future, use the digits from instrument data.
 */
export function formatPrice(price, _symbol) {
  if (price === undefined || price === null || isNaN(price)) {
    return "N/A";
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

  // Get interval details
  let unit = "d";
  let value = 1;

  if (interval && typeof interval === "string") {
    unit = interval.slice(-1);
    value = parseInt(interval.slice(0, -1), 10);
  }

  // Different formats based on interval
  if (unit === "m") {
    // Minutes
    return (
      date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) +
      " " +
      date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  } else if (unit === "h") {
    // Hours
    return (
      date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) +
      " " +
      date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  } else if (unit === "d") {
    // Days
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } else if (unit === "w") {
    // Weeks
    return (
      "Week of " +
      date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    );
  } else if (unit === "o") {
    // Months
    return date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  } else {
    // Fallback
    return (
      date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) +
      " " +
      date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
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
        volume, // Keep volume data for tooltip display
      };
    })
    .filter((candle) => candle !== null)
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

  // Pre-sort data to potentially improve merging performance
  const sortedExisting = [...existingData].sort((a, b) => a.time - b.time);
  const sortedNew = [...newData].sort((a, b) => a.time - b.time);

  // Put existing data in the map
  for (const candle of sortedExisting) {
    if (candle && typeof candle.time === "number") {
      candleMap.set(candle.time, candle);
    }
  }

  // Add or update with new data
  for (const candle of sortedNew) {
    if (candle && typeof candle.time === "number") {
      candleMap.set(candle.time, candle);
    }
  }

  // Convert map back to sorted array
  return Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
}

/**
 * Calculate optimal data range for a given viewport
 * With more efficient padding calculation
 */
export function calculateDataRange(interval, viewportWidth, start, end) {
  const intervalMs = parseInterval(interval);

  // Calculate visible bars
  const viewportDuration = end - start;
  const visibleBars = Math.ceil(viewportDuration / intervalMs);

  const paddingFactor = 0.3;
  
  // Calculate padding bars with a cap
  const padding = Math.min(
    Math.ceil(visibleBars * paddingFactor),
    500 // Hard limit on padding bars
  );

  // Calculate optimal range with padding
  const optimalStart = start - intervalMs * padding;
  const optimalEnd = end + intervalMs * padding;
  
  // Cap the limit to a reasonable number
  const limit = Math.min(visibleBars + padding * 2, 1000);

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
 * Check if market is open at a given timestamp
 */
export function isMarketOpen(instrument, timestamp) {
  // For 24/7 markets like crypto, always return true
  if (!instrument || instrument.category === "Crypto") {
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
  const marketHours = instrument.market.find(
    (m) => m.open && m.open.day === day
  );

  if (!marketHours) {
    // No hours defined for this day
    return false;
  }

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
  if (!instrument || instrument.category === "Crypto") {
    return timestamp;
  }

  if (!instrument.market || !Array.isArray(instrument.market)) {
    console.log(
      `⚠️ Market Hours: No market data for ${instrument.symbol || "unknown"}`
    );
    return timestamp;
  }

  const originalDate = new Date(timestamp);
  console.log(
    `🔍 Finding trading day for ${instrument.symbol} from:`,
    originalDate.toISOString()
  );

  let currentTimestamp = timestamp;
  const oneDayMs = 24 * 60 * 60 * 1000;

  // Look back up to 30 days
  for (let i = 0; i < 30; i++) {
    const date = new Date(currentTimestamp);
    const day = date.getUTCDay();
    const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day];

    const isOpen = isMarketOpen(instrument, currentTimestamp);
    console.log(
      `  ${dayName} ${date.toISOString().split("T")[0]}: ${
        isOpen ? "✅ OPEN" : "❌ CLOSED"
      }`
    );

    if (isOpen) {
      console.log(`  ✅ Found trading day: ${date.toISOString()}`);
      return currentTimestamp;
    }

    // Go back one day
    currentTimestamp -= oneDayMs;
  }

  console.log(
    `⚠️ No trading day found in last 30 days for ${instrument.symbol}`
  );
  return timestamp;
}

/**
 * Check if a timestamp is within a range
 */
export function isTimestampInRange(timestamp, start, end) {
  if (
    typeof timestamp !== "number" ||
    typeof start !== "number" ||
    typeof end !== "number"
  ) {
    return false;
  }
  return timestamp >= start && timestamp <= end;
}

/**
 * Calculate subscription range with padding
 */
export function calculateSubscriptionRange(interval, visibleRange) {
  if (
    !visibleRange ||
    typeof visibleRange.from !== "number" ||
    typeof visibleRange.to !== "number"
  ) {
    const now = Math.floor(Date.now() / 1000);
    return { from: now - 86400, to: now + 86400 }; // Default 1 day each way
  }

  const intervalMs = parseInterval(interval);
  const intervalSec = intervalMs / 1000;
  const { from, to } = visibleRange;

  // Add padding (10 bars)
  return {
    from: from - intervalSec * 10,
    to: to + intervalSec * 10,
  };
}