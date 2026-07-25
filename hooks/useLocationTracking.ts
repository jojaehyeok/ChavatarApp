import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = 'https://carvior.store/api/v1';
const INTERVAL_MS = 120_000; // 2분

export type LocationStatus = 'idle' | 'requesting' | 'denied' | 'tracking' | 'error';

export function useLocationTracking() {
  const [status, setStatus] = useState<LocationStatus>('idle');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitForLoginRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    if (!driverId) {
      // 이 훅은 루트 레이아웃 마운트 시 딱 한 번만 실행되는데, 그 시점엔 아직
      // 로그인 전이라 driverId가 없는 경우가 많다(로그인은 이후 별도 화면에서
      // 이루어짐) — 예전엔 여기서 그냥 포기해서, 로그인 후 앱을 완전히 껐다 켜지
      // 않는 한 위치 추적이 그 세션 내내 한 번도 시작되지 않는 진단사가 있었음
      // (예: 위치 null, pushToken은 있어서 로그인은 됐지만 추적만 안 되는 케이스).
      // 로그인될 때까지 몇 초 간격으로 재확인해서 로그인되면 자동으로 시작한다.
      if (!waitForLoginRef.current) {
        waitForLoginRef.current = setInterval(async () => {
          const id = await AsyncStorage.getItem('driverId');
          if (id) {
            if (waitForLoginRef.current) {
              clearInterval(waitForLoginRef.current);
              waitForLoginRef.current = null;
            }
            startTracking();
          }
        }, 5000);
      }
      return;
    }

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
    if (waitForLoginRef.current) {
      clearInterval(waitForLoginRef.current);
      waitForLoginRef.current = null;
    }
    setStatus('idle');
  };

  useEffect(() => {
    startTracking();
    return () => stopTracking();
  }, []);

  return { status, stopTracking, restartTracking: startTracking };
}
