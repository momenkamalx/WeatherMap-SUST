"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const searchForm = document.querySelector("#location-search-form");
  const locationInput = document.querySelector("#location-search");
  const searchButton = searchForm?.querySelector('button[type="submit"]');
  const searchControls = document.querySelector(".search-controls");
  const suggestionList = document.querySelector("#location-suggestions");
  const suggestionStatus = document.querySelector("#suggestion-status");
  const mapElement = document.querySelector("#map");
  const loadingIndicator = document.querySelector("#loading-indicator");
  const messageArea = document.querySelector("#message-area");
  const weatherResults = document.querySelector("#weather-results");

  if (
    !searchForm ||
    !locationInput ||
    !searchButton ||
    !searchControls ||
    !suggestionList ||
    !suggestionStatus ||
    !mapElement ||
    !loadingIndicator ||
    !messageArea ||
    !weatherResults ||
    typeof L === "undefined"
  ) {
    console.error("WeatherMap could not initialize the map.");
    return;
  }

  const initialCoordinates = [15.5007, 32.5599];
  const initialZoom = 6;
  const nominatimSearchUrl = "https://nominatim.openstreetmap.org/search";
  const openMeteoSearchUrl = "https://geocoding-api.open-meteo.com/v1/search";
  const openWeatherMapUrl = "https://api.openweathermap.org/data/2.5/weather";
  const geocodingCache = new Map();
  const suggestionCache = new Map();
  const requestInterval = 1000;
  const suggestionDelay = 350;
  let lastRequestAt = 0;
  let selectedLocation = null;
  let suggestions = [];
  let activeSuggestionIndex = -1;
  let suggestionTimer = 0;
  let suggestionController = null;
  let searchMarker = null;
  let searchRequestId = 0;

  const map = L.map(mapElement).setView(initialCoordinates, initialZoom);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  function showMessage(message) {
    messageArea.textContent = message;
  }

  function clearMessage() {
    messageArea.textContent = "";
  }

  function setLoading(isLoading) {
    loadingIndicator.hidden = !isLoading;
    searchButton.disabled = isLoading;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function waitForRequestSlot() {
    const elapsed = Date.now() - lastRequestAt;
    const remainingDelay = Math.max(0, requestInterval - elapsed);

    if (remainingDelay > 0) {
      await wait(remainingDelay);
    }

    lastRequestAt = Date.now();
  }

  function createServiceError(code, providerMessage = "") {
    const error = new Error(code);
    error.providerMessage = providerMessage;
    return error;
  }

  function normalizeLocation(result) {
    if (!result || typeof result !== "object" || typeof result.display_name !== "string") {
      return null;
    }

    const latitude = Number.parseFloat(result.lat);
    const longitude = Number.parseFloat(result.lon);
    const name = result.display_name.trim();

    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return { name, latitude, longitude, label: name };
  }

  function formatSuggestion(result) {
    if (!result || typeof result !== "object" || typeof result.name !== "string") {
      return null;
    }

    const latitude = Number.parseFloat(result.latitude);
    const longitude = Number.parseFloat(result.longitude);
    const parts = [result.name, result.admin1, result.country]
      .filter((part) => typeof part === "string" && part.trim())
      .map((part) => part.trim())
      .filter((part, index, values) => values.indexOf(part) === index);

    if (!parts.length || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return {
      name: result.name.trim(),
      latitude,
      longitude,
      label: parts.join(", "),
    };
  }

  function normalizeWeather(payload, fallbackName) {
    const temperature = Number.parseFloat(payload?.main?.temp);
    const cloudCoverage = Number.parseFloat(payload?.clouds?.all);
    const humidity = Number.parseFloat(payload?.main?.humidity);
    const windSpeed = Number.parseFloat(payload?.wind?.speed);
    const iconCode = payload?.weather?.[0]?.icon;
    const conditionDescription = payload?.weather?.[0]?.description;
    const locationName = typeof payload?.name === "string" && payload.name.trim() ? payload.name.trim() : fallbackName;

    if (
      !locationName ||
      !Number.isFinite(temperature) ||
      !Number.isFinite(cloudCoverage) ||
      !Number.isFinite(humidity) ||
      !Number.isFinite(windSpeed) ||
      typeof iconCode !== "string" ||
      !/^[a-z0-9]+$/i.test(iconCode) ||
      typeof conditionDescription !== "string" ||
      !conditionDescription.trim()
    ) {
      throw createServiceError("weather-malformed");
    }

    return {
      locationName,
      temperature,
      cloudCoverage,
      humidity,
      windSpeed,
      iconCode,
      conditionDescription: conditionDescription.trim(),
      iconUrl: `https://openweathermap.org/img/wn/${iconCode}@2x.png`,
    };
  }

  function getApiKey() {
    const apiKey = window.WEATHERMAP_CONFIG?.openWeatherMapApiKey;
    return typeof apiKey === "string" ? apiKey.trim() : "";
  }

  function storeLocation(location) {
    searchForm.dataset.locationName = location.name;
    searchForm.dataset.latitude = String(location.latitude);
    searchForm.dataset.longitude = String(location.longitude);
  }

  function clearStoredLocation() {
    delete searchForm.dataset.locationName;
    delete searchForm.dataset.latitude;
    delete searchForm.dataset.longitude;
  }

  function storeWeather(weather) {
    weatherResults.dataset.locationName = weather.locationName;
    weatherResults.dataset.temperature = String(weather.temperature);
    weatherResults.dataset.cloudCoverage = String(weather.cloudCoverage);
    weatherResults.dataset.humidity = String(weather.humidity);
    weatherResults.dataset.windSpeed = String(weather.windSpeed);
    weatherResults.dataset.iconCode = weather.iconCode;
    weatherResults.dataset.conditionDescription = weather.conditionDescription;
    weatherResults.dataset.iconUrl = weather.iconUrl;
  }

  function clearStoredWeather() {
    delete weatherResults.dataset.locationName;
    delete weatherResults.dataset.temperature;
    delete weatherResults.dataset.cloudCoverage;
    delete weatherResults.dataset.humidity;
    delete weatherResults.dataset.windSpeed;
    delete weatherResults.dataset.iconCode;
    delete weatherResults.dataset.conditionDescription;
    delete weatherResults.dataset.iconUrl;
  }

  function clearSearchMarker() {
    if (searchMarker) {
      map.removeLayer(searchMarker);
      searchMarker = null;
    }
  }

  function appendWeatherDetail(details, label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    details.append(term, description);
  }

  function createWeatherVisual(weather) {
    if (weather.iconCode === "01n") {
      const condition = document.createElement("div");
      condition.className = "weather-popup-condition";

      const symbol = document.createElement("span");
      symbol.className = "weather-popup-condition-symbol";
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = "☾";

      const label = document.createElement("span");
      label.className = "weather-popup-condition-label";
      label.textContent = weather.conditionDescription;

      condition.append(symbol, label);
      return condition;
    }

    const icon = document.createElement("img");
    icon.className = "weather-popup-icon";
    icon.alt = `Weather conditions for ${weather.locationName}`;
    icon.width = 100;
    icon.height = 100;
    icon.hidden = true;
    icon.addEventListener("load", () => {
      icon.hidden = false;
    }, { once: true });
    icon.addEventListener("error", () => {
      icon.remove();
    }, { once: true });
    icon.src = weather.iconUrl;
    return icon;
  }

  function createWeatherPopup(weather) {
    const content = document.createElement("section");
    content.className = "weather-popup-content";

    const heading = document.createElement("h2");
    heading.textContent = weather.locationName;

    const weatherVisual = createWeatherVisual(weather);

    const details = document.createElement("dl");
    details.className = "weather-popup-details";
    appendWeatherDetail(details, "Temperature", `${weather.temperature.toFixed(1)} °C`);
    appendWeatherDetail(details, "Cloud coverage", `${weather.cloudCoverage}%`);
    appendWeatherDetail(details, "Humidity", `${weather.humidity}%`);
    appendWeatherDetail(details, "Wind speed", `${weather.windSpeed} m/s`);

    const shareButton = document.createElement("button");
    shareButton.className = "weather-share-button";
    shareButton.type = "button";
    shareButton.textContent = "Share";

    content.append(heading, weatherVisual, details, shareButton);
    return content;
  }

  function showLocationOnMap(location, weather) {
    const coordinates = [location.latitude, location.longitude];

    if (!searchMarker) {
      map.flyTo(coordinates, 11, { animate: true, duration: 0.8 });
      searchMarker = L.marker(coordinates).addTo(map);
    }

    if (weather) {
      searchMarker
        .bindPopup(createWeatherPopup(weather), { className: "weather-popup" })
        .openPopup();
    }
  }

  async function geocodeLocation(query) {
    const cacheKey = query.toLocaleLowerCase();

    if (geocodingCache.has(cacheKey)) {
      return geocodingCache.get(cacheKey);
    }

    await waitForRequestSlot();

    const parameters = new URLSearchParams({
      format: "jsonv2",
      limit: "1",
      q: query,
    });
    let response;

    try {
      response = await fetch(`${nominatimSearchUrl}?${parameters}`, {
        headers: { Accept: "application/json" },
        referrerPolicy: "strict-origin-when-cross-origin",
      });
    } catch {
      throw createServiceError("network");
    }

    if (!response.ok) {
      throw createServiceError("http");
    }

    let results;

    try {
      results = await response.json();
    } catch {
      throw createServiceError("malformed");
    }

    if (!Array.isArray(results)) {
      throw createServiceError("malformed");
    }

    if (results.length === 0) {
      geocodingCache.set(cacheKey, null);
      return null;
    }

    const location = normalizeLocation(results[0]);

    if (!location) {
      throw createServiceError("malformed");
    }

    geocodingCache.set(cacheKey, location);
    return location;
  }

  async function fetchCurrentWeather(location) {
    const apiKey = getApiKey();

    if (!apiKey) {
      throw createServiceError("missing-key");
    }

    const parameters = new URLSearchParams({
      lat: String(location.latitude),
      lon: String(location.longitude),
      units: "metric",
      appid: apiKey,
    });
    let response;

    try {
      response = await fetch(`${openWeatherMapUrl}?${parameters}`);
    } catch {
      throw createServiceError("weather-network");
    }

    let payload;

    try {
      payload = await response.json();
    } catch {
      throw createServiceError("weather-malformed");
    }

    if (!response.ok) {
      const providerMessage = typeof payload?.message === "string" ? payload.message.trim() : "";
      throw createServiceError("weather-provider", providerMessage);
    }

    return normalizeWeather(payload, location.name);
  }

  async function fetchSuggestions(query, signal) {
    const cacheKey = query.toLocaleLowerCase();

    if (suggestionCache.has(cacheKey)) {
      return suggestionCache.get(cacheKey);
    }

    const parameters = new URLSearchParams({
      name: query,
      count: "5",
      language: "en",
      format: "json",
    });
    let response;

    try {
      response = await fetch(`${openMeteoSearchUrl}?${parameters}`, { signal });
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }

      throw createServiceError("suggestion-network");
    }

    if (!response.ok) {
      throw createServiceError("suggestion-http");
    }

    let payload;

    try {
      payload = await response.json();
    } catch {
      throw createServiceError("suggestion-malformed");
    }

    if (!payload || typeof payload !== "object" || (payload.results !== undefined && !Array.isArray(payload.results))) {
      throw createServiceError("suggestion-malformed");
    }

    const locations = Array.isArray(payload.results)
      ? payload.results.map(formatSuggestion).filter(Boolean)
      : [];

    suggestionCache.set(cacheKey, locations);
    return locations;
  }

  function closeSuggestions() {
    suggestionList.hidden = true;
    locationInput.setAttribute("aria-expanded", "false");
    locationInput.setAttribute("aria-activedescendant", "");
    activeSuggestionIndex = -1;
  }

  function updateActiveSuggestion(index) {
    const options = suggestionList.querySelectorAll('[role="option"]');

    if (!options.length) {
      return;
    }

    activeSuggestionIndex = (index + options.length) % options.length;
    options.forEach((option, optionIndex) => {
      option.setAttribute("aria-selected", String(optionIndex === activeSuggestionIndex));
    });
    const activeOption = options[activeSuggestionIndex];
    locationInput.setAttribute("aria-activedescendant", activeOption.id);
    activeOption.scrollIntoView({ block: "nearest" });
  }

  function renderSuggestions(locations) {
    suggestions = locations;
    activeSuggestionIndex = -1;
    suggestionList.replaceChildren();

    locations.forEach((location, index) => {
      const option = document.createElement("li");
      option.id = `location-suggestion-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.dataset.index = String(index);
      option.textContent = location.label;
      suggestionList.append(option);
    });

    const hasSuggestions = locations.length > 0;
    suggestionList.hidden = !hasSuggestions;
    locationInput.setAttribute("aria-expanded", String(hasSuggestions));
    locationInput.setAttribute("aria-activedescendant", "");
  }

  function selectSuggestion(index) {
    const location = suggestions[index];

    if (!location) {
      return;
    }

    selectedLocation = location;
    locationInput.value = location.label;
    storeLocation(location);
    clearMessage();
    suggestionStatus.textContent = "";
    closeSuggestions();
  }

  function clearSuggestionRequest() {
    window.clearTimeout(suggestionTimer);

    if (suggestionController) {
      suggestionController.abort();
      suggestionController = null;
    }
  }

  function scheduleSuggestions() {
    clearSuggestionRequest();
    const query = locationInput.value.trim();

    if (query.length < 2) {
      suggestions = [];
      suggestionStatus.textContent = "";
      closeSuggestions();
      return;
    }

    suggestionTimer = window.setTimeout(async () => {
      suggestionController = new AbortController();
      suggestionStatus.textContent = "Loading location suggestions.";

      try {
        const locations = await fetchSuggestions(query, suggestionController.signal);

        if (locationInput.value.trim() !== query) {
          return;
        }

        renderSuggestions(locations);
        suggestionStatus.textContent = locations.length ? `${locations.length} location suggestions available.` : "No location suggestions found.";
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        suggestions = [];
        closeSuggestions();
        suggestionStatus.textContent = "Unable to load location suggestions.";
      } finally {
        suggestionController = null;
      }
    }, suggestionDelay);
  }

  function getGeocodingErrorMessage(error) {
    if (error.message === "http") {
      return "The location service could not complete this search. Please try again.";
    }

    if (error.message === "malformed") {
      return "The location service returned an unexpected response. Please try again.";
    }

    return "Unable to reach the location service. Check your connection and try again.";
  }

  function getWeatherErrorMessage(error) {
    if (error.message === "missing-key") {
      return "Weather service configuration is missing. Add an OpenWeatherMap API key to js/config.local.js.";
    }

    if (error.message === "weather-provider" && error.providerMessage) {
      return `The weather service returned: ${error.providerMessage}`;
    }

    if (error.message === "weather-provider") {
      return "The weather service could not complete this request. Please try again.";
    }

    if (error.message === "weather-malformed") {
      return "The weather service returned an unexpected response. Please try again.";
    }

    return "Unable to reach the weather service. Check your connection and try again.";
  }

  locationInput.addEventListener("input", () => {
    selectedLocation = null;
    clearStoredLocation();
    scheduleSuggestions();
  });

  locationInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && !suggestionList.hidden) {
      event.preventDefault();
      updateActiveSuggestion(activeSuggestionIndex + 1);
      return;
    }

    if (event.key === "ArrowUp" && !suggestionList.hidden) {
      event.preventDefault();
      updateActiveSuggestion(activeSuggestionIndex - 1);
      return;
    }

    if (event.key === "Enter" && !suggestionList.hidden && activeSuggestionIndex >= 0) {
      event.preventDefault();
      selectSuggestion(activeSuggestionIndex);
      return;
    }

    if (event.key === "Escape") {
      closeSuggestions();
    }
  });

  suggestionList.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');

    if (!option || !suggestionList.contains(option)) {
      return;
    }

    selectSuggestion(Number.parseInt(option.dataset.index, 10));
    locationInput.focus();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!searchControls.contains(event.target)) {
      closeSuggestions();
    }
  });

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearSuggestionRequest();
    closeSuggestions();

    const query = locationInput.value.trim();

    if (!query) {
      showMessage("Please enter a location to search.");
      locationInput.focus();
      return;
    }

    const requestId = ++searchRequestId;
    const isCurrentSearch = () => requestId === searchRequestId;

    clearMessage();
    clearStoredWeather();
    clearSearchMarker();
    setLoading(true);

    try {
      const location = selectedLocation && selectedLocation.label === query
        ? selectedLocation
        : await geocodeLocation(query);

      if (!isCurrentSearch()) {
        return;
      }

      if (!location) {
        showMessage("No matching location was found.");
        return;
      }

      storeLocation(location);
      showLocationOnMap(location);
      const weather = await fetchCurrentWeather(location);

      if (!isCurrentSearch()) {
        return;
      }

      storeWeather(weather);
      showLocationOnMap(location, weather);
    } catch (error) {
      if (!isCurrentSearch()) {
        return;
      }

      if (error.message === "http" || error.message === "malformed" || error.message === "network") {
        showMessage(getGeocodingErrorMessage(error));
        return;
      }

      showMessage(getWeatherErrorMessage(error));
    } finally {
      if (isCurrentSearch()) {
        setLoading(false);
      }
    }
  });
});
