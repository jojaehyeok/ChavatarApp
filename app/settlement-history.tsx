import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../constants/api';

interface CompletedItem {
  id: string | number;
  carNumber: string;
  carModel?: string;
  preferredDateTime: string;
  updatedAt?: string;
  completedAt?: string;
  firstCompletedAt?: string;
}

interface Section {
  title: string;
  data: CompletedItem[];
}

export default function SettlementHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';

  const bg = isDark ? '#111' : '#f8f9fa';
  const card = isDark ? '#1a1a1a' : '#fff';
  const text = isDark ? '#fff' : '#111';
  const sub = isDark ? '#888' : '#666';
  const border = isDark ? '#2a2a2a' : '#eee';
  const accent = '#63489a';

  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<Section[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [driverId, driverName] = await Promise.all([
        AsyncStorage.getItem('driverId'),
        AsyncStorage.getItem('driverName'),
      ]);
      if (!driverId) { setSections([]); return; }

      const res = await axios.get(`${API_BASE_URL}/external/request/list`);
      const all: any[] = Array.isArray(res.data) ? res.data : res.data.data;

      const completed = (all || []).filter(item => {
        const isMy = String(item.assignedDriverId) === String(driverId) || item.assignedDriverName === driverName;
        const isAgentAssignedByMe = String(item.assignedByAgentId) === String(driverId);
        return item.status === 'COMPLETED' && (isMy || isAgentAssignedByMe);
      });

      // 완료된 예약 탭과 동일하게 최근에 완료한 건이 위로 오도록 정렬
      const completedTime = (item: CompletedItem) => item.firstCompletedAt || item.completedAt || item.updatedAt || item.preferredDateTime;
      completed.sort((a, b) => (completedTime(b) || '').localeCompare(completedTime(a) || ''));

      // 완료 시점 기준 월별로 묶기
      const groups = new Map<string, CompletedItem[]>();
      completed.forEach(item => {
        const dt = completedTime(item) || '';
        const month = dt.length >= 7 ? dt.slice(0, 7) : '기타';
        if (!groups.has(month)) groups.set(month, []);
        groups.get(month)!.push(item);
      });

      setSections(
        Array.from(groups.entries()).map(([month, data]) => ({
          title: month === '기타' ? '기타' : `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월 (${data.length}건)`,
          data,
        })),
      );
    } catch {
      setSections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalCount = sections.reduce((sum, s) => sum + s.data.length, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <View style={[s.header, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={26} color={text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: text }]}>정산 내역</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={accent} size="large" />
        </View>
      ) : totalCount === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: sub, fontSize: 15 }}>완료된 진단 내역이 없습니다.</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderSectionHeader={({ section }) => (
            <View style={[s.sectionHeader, { backgroundColor: bg }]}>
              <Text style={[s.sectionHeaderText, { color: accent }]}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={[s.row, { backgroundColor: card, borderColor: border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.carModel, { color: text }]}>{item.carModel || '차량 정보 없음'}</Text>
                <Text style={[s.carNumber, { color: sub }]}>{item.carNumber}</Text>
              </View>
              <Text style={[s.date, { color: sub }]}>{item.preferredDateTime}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },

  sectionHeader: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  sectionHeaderText: { fontSize: 14, fontWeight: '700' },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 12, borderWidth: 1,
  },
  carModel: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  carNumber: { fontSize: 13 },
  date: { fontSize: 13 },
});
