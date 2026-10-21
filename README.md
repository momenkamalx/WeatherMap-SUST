# WeatherMap

Search a place and see the weather on a map.

WeatherMap is a web app that let you search for a location on a map and see the live weather there.

## See it Live

website: [Momen WeatherMap-SUST](https://momenkamalx.github.io/WeatherMap-SUST/)

## Structure
```
WeatherMap-SUST/
├── index.html
├── README.md
├── .gitignore
├── css/
│   └── style.css
└── js/
    ├── app.js
    └── config.js
```


## Features

- **Search a location:** Search for a city by name in english or arabic.
- **Location suggestions:** Suggestions while typing in english or arabic.
- **Current weather:** Temperature, cloud coverage, humidity and wind speed.
- **Map popup:** weather is shown in a popup.
- **Favorit:** save your Favorit locations.s
- **Error messages:** messages for empty input, unknown places, network problems and API errors.
- **Sharing:** share the weather information.


## Technologies

- **HTML:**
- **CSS:**
- **JS**
- **Leaflet:** 
- **API, Promises and await:** 
- **Nominatim:**
- **OpenStreetMap:**
- **Geocoding API:**
- **OpenWeatherMap Current Weather API:**

## JavaScript

- **app.js:**
- **config.js:** 



## How it work

1. The application initializes a map.
2. The user types a location and suggestions appear after two characters.
3. The user submits and JavaScript prevents the default submission so the page does not reload.
4. The application resolves the coordinates using the selected suggestion or an asynchronous request to nominatim.
5. Using coordinates requests current weather data from OpenWeatherMap.
6. The map moves to the location replaces the previous marker and opens a popup with the weather information.

## Do it yourself

### What you need

- web browser.
- Internet.
- OpenWeatherMap API key.

### Installation

1. Clone the repository:

   ```
   git clone https://github.com/momenkamalx/WeatherMap-SUST.git
   ```

2. Go to the project directory:

   ```
   cd WeatherMap-SUST
   ```

3. In `js/config.js`  put your OpenWeatherMap API key.

4. Open local web server


Student: Momen kamal 
SE semester 7
202011577127