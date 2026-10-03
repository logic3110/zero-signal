import { useEffect, useState } from "react";
import { KEYS, usePersistent } from "../../lib/store";

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  at: number;
}

/** Watches GPS (no network location needed) and remembers the last fix locally. */
export function useLocation(watch = true) {
  const [last, setLast] = usePersistent<Fix | null>(KEYS.lastLocation, null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!watch) return;
    if (!("geolocation" in navigator)) {
      setError("This device has no location support.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const f: Fix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          altitude: p.coords.altitude,
          altitudeAccuracy: p.coords.altitudeAccuracy,
          at: p.timestamp,
        };
        setFix(f);
        setLast(f);
        setError(null);
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? "Location permission denied." : "Waiting for a GPS fix… move to open sky."),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch]);
  return { fix, last, error };
}
