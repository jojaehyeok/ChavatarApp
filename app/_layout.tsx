import { useColorScheme } from '@/components/useColorScheme';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useLocationTracking } from '@/hooks/useLocationTracking';
import { API_BASE_URL } from '@/constants/api';

// 1. 에러 바운더리 — 화면이 꺼졌다 켜졌다 하는 것처럼 보이는 크래시 루프 등을
// 남의 폰에서는 직접 확인이 안 되니, 잡히는 즉시 서버(client-error-logs)로도
// 보고해서 GET으로 원격 조회 가능하게 한다(기본 expo-router ErrorBoundary는
// 화면에만 보여주고 서버 보고는 안 함).
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const pathname = usePathname();
  // 전역 자동 서버 보고는 일단 꺼둠 — 전체 진단사 대상으로 켜두니 흔한/사소한 에러까지
  // 다 쌓여서 노이즈가 됨. 특정 진단사가 문제를 얘기하면 그때 필요한 범위로 다시 켤 것.
  useEffect(() => {
    // (async () => {
    //   const driverId = await AsyncStorage.getItem('driverId').catch(() => null);
    //   fetch(`${API_BASE_URL}/client-error-logs`, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({
    //       driverId: driverId || undefined,
    //       screen: `global-error-boundary:${pathname}`,
    //       message: `${error?.message}\n${error?.stack || ''}`.slice(0, 2000),
    //     }),
    //   }).catch(() => {});
    // })();
  }, [error]);

  return (
    <View style={errorStyles.container}>
      <Text style={errorStyles.title}>문제가 발생했습니다</Text>
      <Text style={errorStyles.message}>{error?.message}</Text>
      <TouchableOpacity style={errorStyles.retryBtn} onPress={retry}>
        <Text style={errorStyles.retryText}>다시 시도</Text>
      </TouchableOpacity>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  message: { color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 24 },
  retryBtn: { backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  retryText: { color: '#000', fontWeight: '700' },
});

// 2. 초기 라우트 설정
export const unstable_settings = {
  initialRouteName: '(auth)',
};

// 3. 스플래시 화면 자동 숨김 방지
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [appIsReady, setAppIsReady] = useState(false);
  useLocationTracking();

  // 폰트 및 리소스 로딩
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    // 필요시 아이콘 폰트 추가 (예: FontAwesome)
  });

  // 폰트 로딩 에러 처리
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // 로딩 완료 후 스플래시 숨기기
  useEffect(() => {
    if (loaded) {
      setAppIsReady(true);
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // 로딩 중에는 아무것도 렌더링하지 않음 (네비게이션 컨텍스트 에러 방지)
  if (!appIsReady) {
    return null;
  }

  return (
    <SafeAreaProvider>
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          // 전역적으로 제스처 설정을 관리하고 싶다면 여기에 추가
          gestureEnabled: true,
        }}
      >
        {/* 1. 인증 레이아웃 */}
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />

        {/* 2. 메인 탭 레이아웃 */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        {/* 3. 동적 경로 (상세 페이지) */}
        <Stack.Screen 
          name="inspection/[id]" 
          options={{ 
            headerShown: false, 
          }} 
        />
        
        {/* 4. 진단 촬영 페이지 (Full Screen Modal) 
            주의: 파일명이 'DiagnosisInspection.tsx'여야 합니다. 
        */}
        <Stack.Screen 
          name="DiagnosisInspection" 
          options={{ 
            presentation: 'fullScreenModal',
            animation: 'slide_from_bottom',
            gestureEnabled: false, // 촬영 중 실수로 나가는 것 방지
            headerShown: false,
          }} 
        />

        {/* 5. 일반 모달 */}
        <Stack.Screen 
          name="modal" 
          options={{ presentation: 'modal', headerShown: true }} 
        />
      </Stack>
    </ThemeProvider>
    </SafeAreaProvider>
  );
}