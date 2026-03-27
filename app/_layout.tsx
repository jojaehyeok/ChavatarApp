import { useColorScheme } from '@/components/useColorScheme';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// 1. 에러 바운더리 수출 (Expo Router 필수)
export { ErrorBoundary } from 'expo-router';

// 2. 초기 라우트 설정
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// 3. 스플래시 화면 자동 숨김 방지
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [appIsReady, setAppIsReady] = useState(false);

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