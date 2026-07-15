import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = 'https://carvior.store/api/v1';
const INTERVAL_MS = 30_000; // 30초

export type LocationStatus = 'idle' | 'requesting' | 'denied' | 'tracking' | 'error';

export function useLocationTracking() {
  const [status, setStatus] = useState<LocationStatus>('idle');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendLocation = async (driverId: string) => {
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await fetch(`${API}/drivers/${driverId}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
        }),
      });
    } catch {
      // 네트워크 오류 시 조용히 실패 (다음 주기에 재시도)
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
