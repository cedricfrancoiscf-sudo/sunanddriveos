export interface GeoMeta {
  latitude: number;
  longitude: number;
  accuracy: number;
  takenAt: string;
  deviceInfo: string;
}

export function captureGPS(): Promise<GeoMeta | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          takenAt: new Date().toISOString(),
          deviceInfo: navigator.userAgent,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
    );
  });
}
