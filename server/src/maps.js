// Map provider abstraction. Swap in Google/Mapbox/OSM by implementing the same shape.
export const haversineKm = ([lng1, lat1], [lng2, lat2]) => {
  const r = (d) => (d * Math.PI) / 180, a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
};
export const roundedPoint = ([lng, lat], places = 2) => [+lng.toFixed(places), +lat.toFixed(places)]; // ~1 km: used for vehicles so exact positions are never public
export const mapProvider = {
  distanceKm: haversineKm,
  directionsUrl: ([lng, lat]) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
};
