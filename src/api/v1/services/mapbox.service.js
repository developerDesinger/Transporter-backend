const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

class MapboxService {
  /**
   * Geocode an address to get latitude and longitude
   * @param {string} address - Full address string (e.g., "123 Main St, Sydney NSW 2000")
   * @param {string} state - Optional state code (e.g., "NSW", "VIC")
   * @returns {Promise<{lat: number, lng: number, formattedAddress: string, addressComponents: Array} | null>}
   */
  static async geocodeAddress(address, state = null) {
    const apiKey = process.env.MAPBOX_ACCESS_TOKEN;
    
    if (!apiKey) {
      console.warn('MAPBOX_ACCESS_TOKEN not found in environment variables. Geocoding will be skipped.');
      return null;
    }

    if (!address || address.trim() === '') {
      return null;
    }

    // Build address string with state if provided
    let searchQuery = address.trim();
    if (state && !searchQuery.toLowerCase().includes(state.toLowerCase())) {
      searchQuery = `${searchQuery}, ${state}, Australia`;
    } else if (!searchQuery.toLowerCase().includes('australia')) {
      searchQuery = `${searchQuery}, Australia`;
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json`;
    
    try {
      const response = await axios.get(url, {
        params: {
          access_token: apiKey,
          country: 'AU', // Limit to Australia
          limit: 1,
          types: 'address,poi,place' // Prioritize addresses
        },
        timeout: 5000
      });
      
      if (response.data.features && response.data.features.length > 0) {
        const feature = response.data.features[0];
        const [lng, lat] = feature.center;
        return {
          lat,
          lng,
          formattedAddress: feature.place_name,
          addressComponents: feature.context || [],
          confidence: feature.relevance || 0
        };
      }
      
      console.warn(`No results found for address: ${address}`);
      return null;
    } catch (error) {
      console.error('Mapbox geocoding error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Geocode multiple addresses in batch
   * @param {Array<{address: string, state?: string}>} addresses - Array of address objects
   * @returns {Promise<Array<{lat: number, lng: number, formattedAddress: string} | null>>}
   */
  static async geocodeAddresses(addresses) {
    const results = await Promise.all(
      addresses.map(addr => 
        this.geocodeAddress(addr.address, addr.state)
      )
    );
    return results;
  }

  /**
   * Get route between two points
   * @param {Object} start - {lat: number, lng: number}
   * @param {Object} end - {lat: number, lng: number}
   * @returns {Promise<Object | null>}
   */
  static async getRoute(start, end) {
    const apiKey = process.env.MAPBOX_ACCESS_TOKEN;
    
    if (!apiKey) {
      console.warn('MAPBOX_ACCESS_TOKEN not found. Route calculation will be skipped.');
      return null;
    }

    if (!start || !end || !start.lat || !start.lng || !end.lat || !end.lng) {
      console.warn('Invalid start or end coordinates for route calculation');
      return null;
    }

    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start.lng},${start.lat};${end.lng},${end.lat}`;
    
    try {
      const response = await axios.get(url, {
        params: {
          access_token: apiKey,
          geometries: 'geojson',
          overview: 'full',
          steps: false
        },
        timeout: 10000
      });
      
      if (response.data.routes && response.data.routes.length > 0) {
        const route = response.data.routes[0];
        return {
          geometry: route.geometry,
          distance: route.distance, // meters
          duration: route.duration, // seconds
          distanceKm: (route.distance / 1000).toFixed(2),
          durationMinutes: Math.round(route.duration / 60)
        };
      }
      return null;
    } catch (error) {
      console.error('Mapbox directions error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Geocode pickup and delivery addresses and calculate route
   * @param {string} pickupAddress - Pickup address string
   * @param {string} deliveryAddress - Delivery address string
   * @param {string} pickupState - Optional pickup state code
   * @param {string} deliveryState - Optional delivery state code
   * @returns {Promise<Object>}
   */
  static async geocodeAndRoute(pickupAddress, deliveryAddress, pickupState = null, deliveryState = null) {
    // Geocode both addresses in parallel
    const [pickup, delivery] = await Promise.all([
      this.geocodeAddress(pickupAddress, pickupState),
      this.geocodeAddress(deliveryAddress, deliveryState)
    ]);

    const result = {
      pickup,
      delivery,
      route: null,
      error: null
    };

    // Check if geocoding succeeded
    if (!pickup) {
      result.error = 'Failed to geocode pickup address';
      return result;
    }

    if (!delivery) {
      result.error = 'Failed to geocode delivery address';
      return result;
    }

    // Calculate route if both addresses were geocoded successfully
    const route = await this.getRoute(pickup, delivery);
    result.route = route;

    return result;
  }

  /**
   * Build full address string from components
   * @param {string} suburb - Suburb name
   * @param {string} state - State code (optional)
   * @returns {string} Full address string
   */
  static buildAddressString(suburb, state = null) {
    if (!suburb) return null;
    
    let address = suburb.trim();
    if (state) {
      address = `${address}, ${state}`;
    }
    address = `${address}, Australia`;
    return address;
  }
}

module.exports = MapboxService;

