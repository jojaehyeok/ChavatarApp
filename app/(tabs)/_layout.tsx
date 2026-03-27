import { Stack } from 'expo-router';
import React from 'react';

export default function TabLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: '#000',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
          fontSize: 18,
        },
        headerShadowVisible: false,
        // ✅ 뒤로가기 화살표 강제 제거
        headerLeft: () => null, 
      }}>
      <Stack.Screen
        name="index"
        options={{
          title: '진단 예약 관리',
        }}
      />
    </Stack>
  );
}