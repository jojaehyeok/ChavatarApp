import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../constants/api';

// 등급별 기본 진단비(원) — 대시보드 booking-list.tsx의 BASE_FEE_BY_TIER와 동일하게 유지
const BASE_FEE_BY_TIER: Record<string, number> = { general: 50000, certified: 60000, agent: 65000 };

interface CompletedItem {
  id: string | number;
  carNumber: string;
  carModel?: string;
  preferredDateTime: string;
  updatedAt?: string;
  completedAt?: string;
  firstCompletedAt?: string;
  remoteBonus?: number | null;
  extraFee?: number | null;
  extraFeeMemo?: string | null;
  claimDeduction?: number | null;
}

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

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

  const now = new Date();
  const [loading, setLoading] = useState(true);
  const [baseFee, setBaseFee] = useState(0);
  const [byMonth, setByMonth] = useState<Map<string, CompletedItem[]>>(new Map());
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1); // 1~12

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [driverId, driverName] = await Promise.all([
        AsyncStorage.getItem('driverId'),
        AsyncStorage.getItem('driverName'),
      ]);
      if (!driverId) { setByMonth(new Map()); return; }

      const [listRes, driverRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/external/request/list`),
        axios.get(`${API_BASE_URL}/drivers/${driverId}`).catch(() => null),
      ]);
      const all: any[] = Array.isArray(listRes.data) ? listRes.data : listRes.data.data;
      const tier: string | undefined = driverRes?.data?.tier;
      setBaseFee(tier ? (BASE_FEE_BY_TIER[tier] ?? 0) : 0);

      const completed = (all || []).filter(item => {
        const isMy = String(item.assignedDriverId) === String(driverId) || item.assignedDriverName === driverName;
        const isAgentAssignedByMe = String(item.assignedByAgentId) === String(driverId);
        return item.status === 'COMPLETED' && (isMy || isAgentAssignedByMe);
      });

      // 완료된 예약 탭과 동일하게 최근에 완료한 건이 위로 오도록 정렬
      const completedTime = (item: CompletedItem) => item.firstCompletedAt || item.completedAt || item.updatedAt || item.preferredDateTime;
      completed.sort((a, b) => (completedTime(b) || '').localeCompare(completedTime(a) || ''));

      const grouped = new Map<string, CompletedItem[]>();
      completed.forEach(item => {
        const dt = completedTime(item) || '';
        if (dt.length < 7) return;
        const month = dt.slice(0, 7);
        if (!grouped.has(month)) grouped.set(month, []);
        grouped.get(month)!.push(item);
      });
      setByMonth(grouped);
    } catch {
      setByMonth(new Map());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1;

  const goPrevMonth = () => {
    setViewMonth(m => {
      if (m === 1) { setViewYear(y => y - 1); return 12; }
      return m - 1;
    });
  };
  const goNextMonth = () => {
    if (isCurrentMonth) return; // 미래 달은 데이터가 있을 수 없으니 이동 막음
    setViewMonth(m => {
      if (m === 12) { setViewYear(y => y + 1); return 1; }
      return m + 1;
    });
  };

  const data = useMemo(() => byMonth.get(monthKey(viewYear, viewMonth)) ?? [], [byMonth, viewYear, viewMonth]);
  const feeTotal = useMemo(() => data.reduce((sum, item) => sum + baseFee + (item.remoteBonus || 0) + (item.extraFee || 0), 0), [data, baseFee]);
  const claimTotal = useMemo(() => data.reduce((sum, item) => sum + (item.claimDeduction || 0), 0), [data]);
  const netTotal = feeTotal - claimTotal;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <View style={[s.header, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="close" size={26} color={text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: text }]}>정산 내역</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 월 이동 — < 2026년 7월 > */}
      <View style={[s.monthNav, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={goPrevMonth} style={s.monthNavBtn}>
          <Ionicons name="chevron-back" size={22} color={text} />
        </TouchableOpacity>
        <Text style={[s.monthNavText, { color: text }]}>{viewYear}년 {viewMonth}월</Text>
        <TouchableOpacity onPress={goNextMonth} disabled={isCurrentMonth} style={s.monthNavBtn}>
          <Ionicons name="chevron-forward" size={22} color={isCurrentMonth ? border : text} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={accent} size="large" />
        </View>
      ) : (
        <>
          <View style={[s.sectionHeader, { backgroundColor: bg, borderBottomColor: border }]}>
            <Text style={[s.sectionHeaderText, { color: accent }]}>{data.length}건</Text>
            <View style={s.sectionTotals}>
              <Text style={[s.sectionTotalText, { color: sub }]}>진단비 {feeTotal.toLocaleString()}원</Text>
              {claimTotal > 0 && (
                <Text style={[s.sectionTotalText, { color: '#e53e3e' }]}>클레임 -{claimTotal.toLocaleString()}원</Text>
              )}
              <Text style={[s.sectionTotalTextBold, { color: text }]}>총 {netTotal.toLocaleString()}원</Text>
            </View>
          </View>

          {data.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: sub, fontSize: 15 }}>완료된 진단 내역이 없습니다.</Text>
            </View>
          ) : (
            <FlatList
              data={data}
              keyExtractor={item => item.id.toString()}
              contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 8 }}
              renderItem={({ item }) => {
                const itemFee = baseFee + (item.remoteBonus || 0) + (item.extraFee || 0);
                const itemClaim = item.claimDeduction || 0;
                return (
                  <View style={[s.row, { backgroundColor: card, borderColor: border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.carModel, { color: text }]}>{item.carModel || '차량 정보 없음'}</Text>
                      <Text style={[s.carNumber, { color: sub }]}>{item.carNumber}</Text>
                      {!!item.extraFeeMemo && (
                        <Text style={[s.memo, { color: sub }]}>{item.extraFeeMemo}</Text>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[s.date, { color: sub }]}>{item.preferredDateTime}</Text>
                      <Text style={[s.fee, { color: text }]}>{itemFee.toLocaleString()}원</Text>
                      {/* 오지/준오지·긴급 추가금과 기타비용은 0원이어도 항상 표시해서
                          "빠진 게 아니라 0원이 맞다"를 바로 확인할 수 있게 함 */}
                      <Text style={[s.breakdown, { color: sub }]}>
                        기본 {baseFee.toLocaleString()} · 추가 {(item.remoteBonus || 0).toLocaleString()} · 기타 {(item.extraFee || 0).toLocaleString()}
                      </Text>
                      {itemClaim > 0 && (
                        <Text style={s.claim}>클레임 -{itemClaim.toLocaleString()}원</Text>
                      )}
                    </View>
                  </View>
                );
              }}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },

  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  monthNavBtn: { padding: 6 },
  monthNavText: { fontSize: 17, fontWeight: '800', minWidth: 110, textAlign: 'center' },

  sectionHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  sectionHeaderText: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  sectionTotals: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  sectionTotalText: { fontSize: 12, fontWeight: '600' },
  sectionTotalTextBold: { fontSize: 13, fontWeight: '800' },

  row: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 12, borderWidth: 1,
  },
  carModel: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  carNumber: { fontSize: 13 },
  memo: { fontSize: 11, marginTop: 4 },
  date: { fontSize: 12, marginBottom: 4 },
  fee: { fontSize: 15, fontWeight: '800' },
  breakdown: { fontSize: 10, marginTop: 2 },
  claim: { fontSize: 11, fontWeight: '700', color: '#e53e3e', marginTop: 2 },
});
