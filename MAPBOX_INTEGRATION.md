# Mapbox Integration Guide

## Overview
This document describes the Mapbox integration for geocoding addresses and calculating routes for jobs in the TMS system.

## What Was Implemented

### 1. Mapbox Service (`src/api/v1/services/mapbox.service.js`)
A service class that handles:
- **Geocoding**: Converts addresses to latitude/longitude coordinates
- **Route Calculation**: Calculates driving routes between pickup and delivery locations
- **Batch Geocoding**: Processes multiple addresses efficiently

### 2. Database Schema Updates (`src/api/v1/models/job.model.js`)
Added the following fields to the Job model:
- `pickupLatitude` - Latitude of pickup location
- `pickupLongitude` - Longitude of pickup location
- `pickupAddress` - Full formatted address from Mapbox
- `deliveryLatitude` - Latitude of delivery location
- `deliveryLongitude` - Longitude of delivery location
- `deliveryAddress` - Full formatted address from Mapbox
- `routeGeometry` - GeoJSON geometry for route visualization
- `routeDistance` - Route distance in meters
- `routeDuration` - Route duration in seconds

### 3. Job Service Integration (`src/api/v1/services/job.service.js`)
- **Automatic Geocoding**: When creating a job with `pickupSuburb` and `deliverySuburb`, the system automatically:
  - Geocodes both addresses
  - Calculates the route between them
  - Stores all coordinate and route data in the database
- **Helper Method**: `updateJobGeocoding()` - Can be called to update geocoding when addresses change
- **Response Data**: All API responses now include Mapbox geocoding data

## Setup Instructions

### 1. Get Mapbox Access Token
1. Sign up at https://account.mapbox.com/
2. Go to Account → Access tokens
3. Create a new token or use the default public token
4. Copy the token

### 2. Configure Environment Variables
Add to your `.env` file (backend):
```bash
MAPBOX_ACCESS_TOKEN=your_mapbox_access_token_here
```

Add to your `.env` file (frontend root):
```bash
VITE_MAPBOX_ACCESS_TOKEN=your_mapbox_access_token_here
```

### 3. Install Dependencies
The required `axios` package is already installed. No additional packages needed.

## Usage

### Creating a Job with Geocoding
When creating a job, simply provide `pickupSuburb` and `deliverySuburb`:

```javascript
POST /api/v1/jobs
{
  "customerId": "...",
  "jobType": "HOURLY",
  "pickupSuburb": "Sydney CBD",
  "deliverySuburb": "Parramatta",
  "pickupState": "NSW",  // Optional
  "deliveryState": "NSW" // Optional
}
```

The system will automatically:
1. Geocode both addresses
2. Calculate the route
3. Store coordinates and route data

### Response Format
All job responses now include Mapbox data:

```json
{
  "id": "...",
  "jobNumber": "...",
  "pickupSuburb": "Sydney CBD",
  "deliverySuburb": "Parramatta",
  "pickupLatitude": -33.8688,
  "pickupLongitude": 151.2093,
  "pickupAddress": "Sydney NSW, Australia",
  "deliveryLatitude": -33.8145,
  "deliveryLongitude": 151.0035,
  "deliveryAddress": "Parramatta NSW, Australia",
  "routeDistance": 25000,
  "routeDuration": 1800,
  ...
}
```

### Updating Geocoding Manually
If you need to update geocoding for an existing job:

```javascript
const JobService = require('./services/job.service');

await JobService.updateJobGeocoding(
  jobId,
  'Sydney CBD',
  'Parramatta',
  'NSW',
  'NSW'
);
```

## API Methods

### MapboxService.geocodeAddress(address, state)
Geocodes a single address.

**Parameters:**
- `address` (string): Address to geocode
- `state` (string, optional): State code (e.g., "NSW", "VIC")

**Returns:**
```javascript
{
  lat: -33.8688,
  lng: 151.2093,
  formattedAddress: "Sydney NSW, Australia",
  addressComponents: [...],
  confidence: 0.95
}
```

### MapboxService.getRoute(start, end)
Calculates a route between two points.

**Parameters:**
- `start` (object): `{lat: number, lng: number}`
- `end` (object): `{lat: number, lng: number}`

**Returns:**
```javascript
{
  geometry: {...}, // GeoJSON geometry
  distance: 25000, // meters
  duration: 1800, // seconds
  distanceKm: "25.00",
  durationMinutes: 30
}
```

### MapboxService.geocodeAndRoute(pickupAddress, deliveryAddress, pickupState, deliveryState)
Geocodes both addresses and calculates route in one call.

**Returns:**
```javascript
{
  pickup: {...},
  delivery: {...},
  route: {...},
  error: null // or error message if failed
}
```

## Error Handling

- Geocoding failures are logged but **do not fail job creation**
- If geocoding fails, coordinate fields will be `null`
- The system gracefully handles missing Mapbox API token (logs warning, skips geocoding)

## Mapbox Pricing

- **Free Tier**: 100,000 geocoding requests/month
- **After Free Tier**: $0.75 per 1,000 requests
- **Directions API**: Included in free tier for reasonable usage

## Frontend Integration

To use Mapbox on the frontend:

1. Install Mapbox GL JS:
```bash
npm install mapbox-gl
```

2. Use the coordinates from job responses to display routes on maps

3. Example component usage:
```typescript
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Use job.pickupLatitude, job.pickupLongitude, etc.
// Use job.routeGeometry for route visualization
```

## Notes

- Geocoding is performed asynchronously and doesn't block job creation
- If Mapbox API is unavailable, jobs are still created successfully
- Route geometry is stored as GeoJSON and can be used directly with Mapbox GL JS
- All coordinates use the standard format: `[longitude, latitude]` (GeoJSON format)

