import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        // ✅ 이 옵션이 상단 헤더를 통째로 날려줍니다
        headerShown: false,
        // 애니메이션을 부드럽게 하고 싶다면 추가 (선택사항)
        animation: 'fade', 
      }}
    >
      {/* index는 현재 로그인/로딩 페이지를 의미합니다 */}
      <Stack.Screen name="index" />
    </Stack>
  );
}