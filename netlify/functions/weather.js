/**
 * Netlify Serverless Function: weather.js
 *
 * Acts as a secure proxy between your frontend and the WeatherAPI.
 * Keeping the API key server-side means it's never exposed to the browser.
 *
 * Deployment path: /netlify/functions/weather.js
 * Invocation URL:  /.netlify/functions/weather?city=London
 */

exports.handler = async (event) => {

  // ---------------------------------------------------------------------------
  // 1. CORS HEADERS
  // Returned on every response so browsers allow cross-origin fetch calls from
  // your frontend. Tighten `Access-Control-Allow-Origin` to your domain in
  // production (e.g. "https://yoursite.netlify.app").
  // ---------------------------------------------------------------------------
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // ---------------------------------------------------------------------------
  // 2. PREFLIGHT (OPTIONS) REQUEST
  // Browsers send an OPTIONS request before the real fetch to check CORS policy.
  // We respond immediately with 204 No Content so the actual request can proceed.
  // ---------------------------------------------------------------------------
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  // ---------------------------------------------------------------------------
  // 3. ONLY ALLOW GET
  // All other HTTP methods are rejected with 405 Method Not Allowed.
  // ---------------------------------------------------------------------------
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed. Use GET." }),
    };
  }

  // ---------------------------------------------------------------------------
  // 4. READ THE CITY QUERY PARAMETER
  // The frontend calls: /.netlify/functions/weather?city=Paris
  // `event.queryStringParameters` is null when no params are provided, so we
  // default to an empty object to avoid a TypeError on destructuring.
  // ---------------------------------------------------------------------------
  const { city } = event.queryStringParameters || {};

  if (!city || city.trim() === "") {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "Missing required query parameter: city",
        example: "/.netlify/functions/weather?city=Boston",
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // 5. LOAD THE API KEY FROM ENVIRONMENT VARIABLES
  // Set WEATHER_API_KEY in: Netlify Dashboard → Site → Environment Variables
  // Never hard-code the key here — it would be visible in your source repo.
  // ---------------------------------------------------------------------------
  const API_KEY = process.env.WEATHER_API_KEY;

  if (!API_KEY) {
    console.error("WEATHER_API_KEY environment variable is not set.");
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Server configuration error: API key not set.",
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // 6. BUILD THE WEATHERAPI URL
  // - days=7   → 7-day forecast
  // - aqi=yes  → include Air Quality Index data
  // encodeURIComponent ensures city names with spaces/special chars are safe
  // e.g. "New York" → "New%20York"
  // ---------------------------------------------------------------------------
  const weatherUrl =
    `https://api.weatherapi.com/v1/forecast.json` +
    `?key=${API_KEY}` +
    `&q=${encodeURIComponent(city.trim())}` +
    `&days=7` +
    `&aqi=yes`;

  // ---------------------------------------------------------------------------
  // 7. FETCH FROM WEATHERAPI
  // We use a try/catch to handle two distinct failure modes:
  //   a) Network-level errors (DNS failure, timeout) → caught by catch block
  //   b) API-level errors (bad city, invalid key)   → non-2xx status codes
  // ---------------------------------------------------------------------------
  try {
    const response = await fetch(weatherUrl);
    const data = await response.json();

    // ------------------------------------------------------------------------
    // 7a. HANDLE WEATHERAPI ERROR RESPONSES
    // WeatherAPI returns a JSON body with an `error` key for known failures
    // (e.g. city not found → code 1006, invalid key → code 2006).
    // See full error codes: https://www.weatherapi.com/docs/#intro-error-codes
    // ------------------------------------------------------------------------
    if (!response.ok) {
      const errorCode    = data?.error?.code    ?? "unknown";
      const errorMessage = data?.error?.message ?? "Unknown error from WeatherAPI.";

      // Map WeatherAPI error codes to helpful HTTP status codes
      const statusMap = {
        1006: 404,  // No matching location found
        2006: 401,  // Invalid API key
        2007: 403,  // API key has exceeded monthly quota
        2008: 403,  // API key has been disabled
        9000: 400,  // Json body passed in bulk request is invalid
        9001: 400,  // Json body is too large
      };

      const statusCode = statusMap[errorCode] ?? 502; // 502 = upstream failure

      console.error(`WeatherAPI error [${errorCode}]: ${errorMessage}`);
      return {
        statusCode,
        headers,
        body: JSON.stringify({
          error: errorMessage,
          code: errorCode,
        }),
      };
    }

    // ------------------------------------------------------------------------
    // 7b. SUCCESS — forward the full WeatherAPI payload to the client
    // ------------------------------------------------------------------------
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data),
    };

  } catch (err) {
    // ------------------------------------------------------------------------
    // 7c. NETWORK / RUNTIME ERRORS
    // This fires if the fetch itself fails (no internet, DNS timeout, etc.)
    // or if response.json() throws (malformed response body).
    // ------------------------------------------------------------------------
    console.error("Unexpected error fetching weather data:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Failed to fetch weather data. Please try again later.",
        detail: err.message,
      }),
    };
  }
};