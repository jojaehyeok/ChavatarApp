import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = 'https://carvior.store/api/v1';
const INTERVAL_MS = 120_000; // 2분

export type LocationStatus = 'idle' | 'requesting' | 'denied' | 'tracking' | 'error';

export function useLocationTracking() {
  const [status, setStatus] = useState<LocationStatus>('idle');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendLocation = async (driverId: string) => {
    try {
      console.log('[GPS] requesting position...');
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('location fix timed out after 15s')), 15000)
        ),
      ]).catch(async (err) => {
        const last = await Location.getLastKnownPositionAsync();
        if (last) return last;
        throw err;
      });
      const res = await fetch(`${API}/drivers/${driverId}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
        }),
      });
      console.log('[GPS] sent', loc.coords.latitude, loc.coords.longitude, 'status', res.status);
    } catch (e) {
      console.log('[GPS] failed', e instanceof Error ? e.message : String(e));
    }
  };

  const startTracking = async () => {
    const driverId = await AsyncStorage.getItem('driverId');
    if (!driverId) return;

    setStatus('requesting');

    const { status: perm } = await Location.requestForegroundPermissionsAsync();
    if (perm !== 'granted') {
      setStatus('denied');
      return;
    }

    setStatus('tracking');
    sendLocation(driverId); // 즉시 1회

    intervalRef.current = setInterval(() => {
      sendLocation(driverId);
    }, INTERVAL_MS);
  };

  const stopTracking = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStatus('idle');
  };

  useEffect(() => {
    startTracking();
    return () => stopTracking();
  }, []);

  return { status, stopTracking, restartTracking: startTracking };
}
