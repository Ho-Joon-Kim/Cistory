export interface SeedCity {
  cityKey: string;
  cityName: string;
  countryCode: string;
  bbox: [number, number, number, number]; // [west, south, east, north]
}

export const SEED_CITIES: SeedCity[] = [
  // Country-wide fetches (preferred for regions we want full coverage of).
  // bbox covers the entire country; Overpass will return every relation[route=subway] inside.
  { cityKey: "kr", cityName: "한국 전체", countryCode: "KR", bbox: [124.5, 33.0, 132.0, 38.7] },
  { cityKey: "jp", cityName: "日本 全国", countryCode: "JP", bbox: [128.0, 30.0, 146.0, 46.0] },
  { cityKey: "tw", cityName: "台灣 全境", countryCode: "TW", bbox: [119.3, 21.8, 122.1, 25.4] },
  { cityKey: "london", cityName: "London", countryCode: "GB", bbox: [-0.51, 51.28, 0.33, 51.69] },
  { cityKey: "paris", cityName: "Paris", countryCode: "FR", bbox: [2.22, 48.80, 2.47, 48.91] },
  { cityKey: "berlin", cityName: "Berlin", countryCode: "DE", bbox: [13.08, 52.33, 13.76, 52.68] },
  { cityKey: "madrid", cityName: "Madrid", countryCode: "ES", bbox: [-3.85, 40.31, -3.52, 40.56] },
  { cityKey: "barcelona", cityName: "Barcelona", countryCode: "ES", bbox: [2.05, 41.31, 2.23, 41.47] },
  { cityKey: "rome", cityName: "Rome", countryCode: "IT", bbox: [12.39, 41.79, 12.62, 41.99] },
  { cityKey: "milan", cityName: "Milan", countryCode: "IT", bbox: [9.08, 45.38, 9.28, 45.54] },
  { cityKey: "amsterdam", cityName: "Amsterdam", countryCode: "NL", bbox: [4.79, 52.30, 5.00, 52.43] },
  { cityKey: "vienna", cityName: "Vienna", countryCode: "AT", bbox: [16.25, 48.14, 16.52, 48.32] },
  { cityKey: "stockholm", cityName: "Stockholm", countryCode: "SE", bbox: [17.85, 59.25, 18.18, 59.40] },
  { cityKey: "moscow", cityName: "Moscow", countryCode: "RU", bbox: [37.35, 55.57, 37.85, 55.92] },
  { cityKey: "nyc", cityName: "New York", countryCode: "US", bbox: [-74.05, 40.65, -73.70, 40.90] },
  { cityKey: "boston", cityName: "Boston", countryCode: "US", bbox: [-71.20, 42.23, -70.98, 42.40] },
  { cityKey: "chicago", cityName: "Chicago", countryCode: "US", bbox: [-87.82, 41.65, -87.52, 42.02] },
  { cityKey: "washington", cityName: "Washington DC", countryCode: "US", bbox: [-77.12, 38.79, -76.91, 38.99] },
  { cityKey: "sanfrancisco", cityName: "San Francisco", countryCode: "US", bbox: [-122.52, 37.70, -122.35, 37.83] },
  { cityKey: "losangeles", cityName: "Los Angeles", countryCode: "US", bbox: [-118.50, 33.90, -118.10, 34.20] },
  { cityKey: "toronto", cityName: "Toronto", countryCode: "CA", bbox: [-79.65, 43.58, -79.12, 43.85] },
  { cityKey: "montreal", cityName: "Montréal", countryCode: "CA", bbox: [-73.75, 45.42, -73.48, 45.60] },
  { cityKey: "mexico", cityName: "Mexico City", countryCode: "MX", bbox: [-99.30, 19.18, -98.94, 19.58] },
  { cityKey: "saopaulo", cityName: "São Paulo", countryCode: "BR", bbox: [-46.83, -23.80, -46.36, -23.40] },
  { cityKey: "buenosaires", cityName: "Buenos Aires", countryCode: "AR", bbox: [-58.53, -34.71, -58.35, -34.54] },
  { cityKey: "hongkong", cityName: "Hong Kong", countryCode: "HK", bbox: [113.83, 22.15, 114.41, 22.56] },
  { cityKey: "singapore", cityName: "Singapore", countryCode: "SG", bbox: [103.60, 1.16, 104.08, 1.48] },
  { cityKey: "taipei", cityName: "Taipei", countryCode: "TW", bbox: [121.43, 24.96, 121.68, 25.20] },
  { cityKey: "shanghai", cityName: "Shanghai", countryCode: "CN", bbox: [121.18, 30.68, 121.82, 31.52] },
  { cityKey: "beijing", cityName: "Beijing", countryCode: "CN", bbox: [116.18, 39.75, 116.65, 40.10] },
  { cityKey: "guangzhou", cityName: "Guangzhou", countryCode: "CN", bbox: [113.18, 22.98, 113.58, 23.24] },
  { cityKey: "shenzhen", cityName: "Shenzhen", countryCode: "CN", bbox: [113.75, 22.42, 114.30, 22.78] },
  { cityKey: "bangkok", cityName: "Bangkok", countryCode: "TH", bbox: [100.40, 13.55, 100.75, 13.92] },
  { cityKey: "delhi", cityName: "Delhi", countryCode: "IN", bbox: [76.95, 28.40, 77.42, 28.82] },
  { cityKey: "dubai", cityName: "Dubai", countryCode: "AE", bbox: [55.08, 25.02, 55.48, 25.32] },
  { cityKey: "istanbul", cityName: "İstanbul", countryCode: "TR", bbox: [28.72, 40.90, 29.42, 41.22] },
  { cityKey: "cairo", cityName: "Cairo", countryCode: "EG", bbox: [31.14, 29.95, 31.42, 30.15] },
  { cityKey: "sydney", cityName: "Sydney", countryCode: "AU", bbox: [150.95, -34.05, 151.32, -33.75] },
];
