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
  const favoritesPanel = document.querySelector("#favorites-panel");
  const favoritesList = document.querySelector("#favorites-list");

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
    !favoritesPanel ||
    !favoritesList ||
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
  const favoritesStorageKey = "weathermap-favorites";
  const maxFavorites = 12;
  let favorites = [];
  let activeFavoriteButton = null;

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

  function getSearchLanguage(query) {
    return /[\u0600-\u06FF]/.test(query) ? "ar" : "en";
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

  const weatherLabels = {
    en: {
      temperature: "Temperature",
      cloudCoverage: "Cloud coverage",
      humidity: "Humidity",
      windSpeed: "Wind speed",
      windUnit: "m/s",
    },
    ar: {
      temperature: "درجة الحرارة",
      cloudCoverage: "الغيوم",
      humidity: "الرطوبة",
      windSpeed: "سرعة الرياح",
      windUnit: "م/ث",
    },
  };

  function appendWeatherDetail(details, label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    details.append(term, description);
  }

  function createWeatherVisual(weather) {
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

  function getAppUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    return /^https?:$/.test(url.protocol) ? url.href : "";
  }

  function buildShareSummary(weather) {
    return `${weather.locationName}: ${weather.temperature.toFixed(1)} °C, ${weather.conditionDescription}. Cloud coverage ${weather.cloudCoverage}%, humidity ${weather.humidity}%, wind speed ${weather.windSpeed} m/s.`;
  }

  async function copyToClipboard(text) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function shareWeather(weather, statusElement) {
    const summary = buildShareSummary(weather);
    const appUrl = getAppUrl();

    if (typeof navigator.share === "function") {
      const shareData = { title: `WeatherMap: ${weather.locationName}`, text: summary };

      if (appUrl) {
        shareData.url = appUrl;
      }

      try {
        if (typeof navigator.canShare !== "function" || navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return;
        }
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }
      }
    }

    const copied = await copyToClipboard(appUrl ? `${summary} ${appUrl}` : summary);
    statusElement.textContent = copied
      ? "Weather summary copied to clipboard."
      : "Sharing is not available in this browser.";
  }

  function normalizeFavorite(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const label = typeof item.label === "string" ? item.label.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const latitude = Number.parseFloat(item.latitude);
    const longitude = Number.parseFloat(item.longitude);

    if (
      !label ||
      !name ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return null;
    }

    return { name, latitude, longitude, label };
  }

  function loadFavorites() {
    try {
      const stored = window.localStorage.getItem(favoritesStorageKey);

      if (!stored) {
        return [];
      }

      const parsed = JSON.parse(stored);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map(normalizeFavorite)
        .filter(Boolean)
        .filter((favorite, index, values) => {
          const key = favorite.label.toLocaleLowerCase();
          return values.findIndex((item) => item.label.toLocaleLowerCase() === key) === index;
        })
        .slice(0, maxFavorites);
    } catch {
      return [];
    }
  }

  function saveFavorites() {
    try {
      window.localStorage.setItem(favoritesStorageKey, JSON.stringify(favorites));
      return true;
    } catch {
      return false;
    }
  }

  function isFavorite(label) {
    const key = label.toLocaleLowerCase();
    return favorites.some((favorite) => favorite.label.toLocaleLowerCase() === key);
  }

  function syncFavoriteButton() {
    if (!activeFavoriteButton) {
      return;
    }

    activeFavoriteButton.textContent = isFavorite(activeFavoriteButton.dataset.label)
      ? "Remove favorite"
      : "Save favorite";
  }

  function renderFavorites() {
    favoritesList.replaceChildren();
    favoritesPanel.hidden = favorites.length === 0;

    favorites.forEach((favorite, index) => {
      const item = document.createElement("li");
      item.className = "favorite-item";

      const shortName = favorite.label.split(",")[0].trim() || favorite.label;

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "favorite-select";
      selectButton.dataset.index = String(index);
      selectButton.title = favorite.label;
      selectButton.textContent = shortName;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "favorite-remove";
      removeButton.dataset.index = String(index);
      removeButton.setAttribute("aria-label", `Remove ${shortName}`);
      removeButton.textContent = "×";

      item.append(selectButton, removeButton);
      favoritesList.append(item);
    });

    syncFavoriteButton();
  }

  function commitFavorites() {
    const saved = saveFavorites();
    renderFavorites();

    if (!saved) {
      showMessage("Favorites could not be saved in this browser.");
    }
  }

  function toggleFavorite(location) {
    const key = location.label.toLocaleLowerCase();
    const existingIndex = favorites.findIndex((favorite) => favorite.label.toLocaleLowerCase() === key);

    if (existingIndex >= 0) {
      favorites.splice(existingIndex, 1);
    } else {
      if (favorites.length >= maxFavorites) {
        showMessage(`You can save up to ${maxFavorites} favorites. Remove one first.`);
        return;
      }

      favorites.push({
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        label: location.label,
      });
    }

    commitFavorites();
  }

  function createWeatherPopup(weather, location) {
    const content = document.createElement("section");
    content.className = "weather-popup-content";

    const heading = document.createElement("h2");
    heading.textContent = weather.locationName;

    const weatherVisual = createWeatherVisual(weather);

    const labels = weatherLabels[weather.language] || weatherLabels.en;

    if (weather.language === "ar") {
      content.dir = "rtl";
      content.lang = "ar";
    }

    const details = document.createElement("dl");
    details.className = "weather-popup-details";
    appendWeatherDetail(details, labels.temperature, `${weather.temperature.toFixed(1)} °C`);
    appendWeatherDetail(details, labels.cloudCoverage, `${weather.cloudCoverage}%`);
    appendWeatherDetail(details, labels.humidity, `${weather.humidity}%`);
    appendWeatherDetail(details, labels.windSpeed, `${weather.windSpeed} ${labels.windUnit}`);

    const actions = document.createElement("div");
    actions.className = "weather-popup-actions";

    const shareButton = document.createElement("button");
    shareButton.className = "weather-share-button";
    shareButton.type = "button";
    shareButton.textContent = "Share";

    const shareStatus = document.createElement("p");
    shareStatus.className = "weather-share-status";
    shareStatus.setAttribute("role", "status");
    shareStatus.setAttribute("aria-live", "polite");

    shareButton.addEventListener("click", () => {
      shareStatus.textContent = "";
      shareWeather(weather, shareStatus);
    });

    const favoriteButton = document.createElement("button");
    favoriteButton.className = "weather-share-button weather-favorite-button";
    favoriteButton.type = "button";
    favoriteButton.dataset.label = location.label;
    favoriteButton.textContent = isFavorite(location.label) ? "Remove favorite" : "Save favorite";
    favoriteButton.addEventListener("click", () => {
      toggleFavorite(location);
    });
    activeFavoriteButton = favoriteButton;

    actions.append(shareButton, favoriteButton);
    content.append(heading, weatherVisual, details, actions, shareStatus);
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
        .bindPopup(createWeatherPopup(weather, location), { className: "weather-popup" })
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
      "accept-language": getSearchLanguage(query),
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

  async function fetchCurrentWeather(location, language = "en") {
    const apiKey = getApiKey();

    if (!apiKey) {
      throw createServiceError("missing-key");
    }

    const parameters = new URLSearchParams({
      lat: String(location.latitude),
      lon: String(location.longitude),
      units: "metric",
      lang: language,
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
      language: getSearchLanguage(query),
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
      option.dir = "auto";
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
    const language = getSearchLanguage(query);
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
      const weather = await fetchCurrentWeather(location, language);

      if (!isCurrentSearch()) {
        return;
      }

      weather.language = language;

      if (language === "ar") {
        weather.locationName = location.name.split(",")[0].trim() || weather.locationName;
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

  favoritesList.addEventListener("click", (event) => {
    const button = event.target.closest("button");

    if (!button || !favoritesList.contains(button)) {
      return;
    }

    const index = Number.parseInt(button.dataset.index, 10);
    const favorite = favorites[index];

    if (!favorite) {
      return;
    }

    if (button.classList.contains("favorite-remove")) {
      favorites.splice(index, 1);
      commitFavorites();
      return;
    }

    if (searchButton.disabled) {
      return;
    }

    selectedLocation = favorite;
    locationInput.value = favorite.label;
    searchForm.requestSubmit();
  });

  favorites = loadFavorites();
  renderFavorites();
});