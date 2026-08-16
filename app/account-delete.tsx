import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../constants/api';

export default function AccountDeleteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';

  const bg = isDark ? '#111' : '#f8f9fa';
  const card = isDark ? '#1a1a1a' : '#fff';
  const text = isDark ? '#fff' : '#111';
  const sub = isDark ? '#888' : '#666';
  const border = isDark ? '#2a2a2a' : '#eee';
  const danger = '#e53e3e';

  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleDelete = async () => {
    if (!password) {
      Alert.alert('알림', '비밀번호를 입력해주세요.');
      return;
    }
    if (!confirmed) {
      Alert.alert('알림', '안내 사항을 확인했다는 체크가 필요합니다.');
      return;
    }
    Alert.alert(
      '정말 탈퇴하시겠습니까?',
      '계정과 개인정보(성함, 연락처, 자격증 사진 등)가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '탈퇴하기',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              const driverId = await AsyncStorage.getItem('driverId');
              if (!driverId) throw new Error('로그인 정보가 없습니다.');
              await axios.delete(`${API_BASE_URL}/drivers/${driverId}`, {
                data: { password },
              });
              await AsyncStorage.multiRemove(['driverId', 'driverUsername', 'driverName']);
              Alert.alert('탈퇴 완료', '계정이 삭제되었습니다.', [
                { text: '확인', onPress: () => router.replace('/(auth)' as any) },
              ]);
            } catch (e) {
              if (axios.isAxiosError(e) && e.response?.status === 401) {
                Alert.alert('오류', '비밀번호가 일치하지 않습니다.');
              } else {
                Alert.alert('오류', '탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
              }
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <View style={[s.header, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={26} color={text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: text }]}>회원 탈퇴</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ flex: 1, padding: 20 }}>
        <View style={[s.noticeBox, { backgroundColor: isDark ? '#2e1a1a' : '#fef2f2', borderColor: isDark ? '#4a2626' : '#fecaca' }]}>
          <Text style={[s.noticeTitle, { color: danger }]}>탈퇴 시 안내</Text>
          <Text style={[s.noticeText, { color: text }]}>• 계정 정보(아이디, 성함, 연락처, 자격증 사진)가 삭제됩니다.</Text>
          <Text style={[s.noticeText, { color: text }]}>• 이미 완료된 진단 건의 정산 기록은 카비오 정산 규정에 따라 일정 기간 보관됩니다.</Text>
          <Text style={[s.noticeText, { color: text }]}>• 탈퇴 후에는 동일 계정으로 다시 로그인할 수 없습니다.</Text>
        </View>

        <Text style={[s.label, { color: text }]}>비밀번호 확인</Text>
        <TextInput
          style={[s.input, { backgroundColor: card, borderColor: border, color: text }]}
          placeholder="현재 비밀번호를 입력하세요"
          placeholderTextColor={sub}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity style={s.checkRow} onPress={() => setConfirmed(v => !v)}>
          <Ionicons
            name={confirmed ? 'checkbox' : 'square-outline'}
            size={22}
            color={confirmed ? danger : sub}
          />
          <Text style={[s.checkLabel, { color: text }]}>위 안내 사항을 모두 확인했습니다.</Text>
        </TouchableOpacity>
      </View>

      <View style={[s.footer, { backgroundColor: card, borderTopColor: border, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          style={[s.deleteBtn, { backgroundColor: danger, opacity: submitting ? 0.6 : 1 }]}
          onPress={handleDelete}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.deleteBtnText}>계정 탈퇴하기</Text>
          }
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },

  noticeBox: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 24 },
  noticeTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  noticeText: { fontSize: 13, lineHeight: 20, marginBottom: 2 },

  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: { height: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, fontSize: 15, marginBottom: 16 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  checkLabel: { fontSize: 14 },

  footer: { paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1 },
  deleteBtn: { height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
