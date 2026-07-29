import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
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

interface MonthGroup {
  key: string; // "2026-07" 또는 "기타"
  label: string; // "7월" 칩에 쓰는 짧은 라벨
  title: string; // "2026년 7월 (12건)" 목록 상단 제목
  data: CompletedItem[];
  feeTotal: number;
  claimTotal: number;
  netTotal: number;
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
  const [groups, setGroups] = useState<MonthGroup[]>([]);
  const [baseFee, setBaseFee] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [driverId, driverName] = await Promise.all([
        AsyncStorage.getItem('driverId'),
        AsyncStorage.getItem('driverName'),
      ]);
      if (!driverId) { setGroups([]); return; }

      const [listRes, driverRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/external/request/list`),
        axios.get(`${API_BASE_URL}/drivers/${driverId}`).catch(() => null),
      ]);
      const all: any[] = Array.isArray(listRes.data) ? listRes.data : listRes.data.data;
      const tier: string | undefined = driverRes?.data?.tier;
      const fee = tier ? (BASE_FEE_BY_TIER[tier] ?? 0) : 0;
      setBaseFee(fee);

      const completed = (all || []).filter(item => {
        const isMy = String(item.assignedDriverId) === String(driverId) || item.assignedDriverName === driverName;
        const isAgentAssignedByMe = String(item.assignedByAgentId) === String(driverId);
        return item.status === 'COMPLETED' && (isMy || isAgentAssignedByMe);
      });

      // 완료된 예약 탭과 동일하게 최근에 완료한 건이 위로 오도록 정렬
      const completedTime = (item: CompletedItem) => item.firstCompletedAt || item.completedAt || item.updatedAt || item.preferredDateTime;
      completed.sort((a, b) => (completedTime(b) || '').localeCompare(completedTime(a) || ''));

      // 완료 시점 기준 월별로 묶기
      const byMonth = new Map<string, CompletedItem[]>();
      completed.forEach(item => {
        const dt = completedTime(item) || '';
        const month = dt.length >= 7 ? dt.slice(0, 7) : '기타';
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month)!.push(item);
      });

      const nextGroups = Array.from(byMonth.entries()).map(([month, data]) => {
        const feeTotal = data.reduce((sum, item) => sum + fee + (item.remoteBonus || 0) + (item.extraFee || 0), 0);
        const claimTotal = data.reduce((sum, item) => sum + (item.claimDeduction || 0), 0);
        return {
          key: month,
          label: month === '기타' ? '기타' : `${Number(month.slice(5, 7))}월`,
          title: month === '기타' ? '기타' : `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월 (${data.length}건)`,
          data,
          feeTotal,
          claimTotal,
          netTotal: feeTotal - claimTotal,
        };
      });

      setGroups(nextGroups);
      setSelectedMonth(prev => (prev && nextGroups.some(g => g.key === prev)) ? prev : (nextGroups[0]?.key ?? null));
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalCount = groups.reduce((sum, g) => sum + g.data.length, 0);
  const activeGroup = useMemo(() => groups.find(g => g.key === selectedMonth) ?? null, [groups, selectedMonth]);

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
        <>
          {/* 월 슬라이드 — 좌우로 넘기며 월을 선택 */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[s.monthStrip, { borderBottomColor: border }]}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          >
            {groups.map(g => {
              const active = g.key === selectedMonth;
              return (
                <TouchableOpacity
                  key={g.key}
                  onPress={() => setSelectedMonth(g.key)}
                  style={[
                    s.monthChip,
                    { backgroundColor: active ? accent : (isDark ? '#2a2a2a' : '#f0f0f0') },
                  ]}
                >
                  <Text style={[s.monthChipText, { color: active ? '#fff' : text }]}>{g.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {activeGroup && (
            <>
              <View style={[s.sectionHeader, { backgroundColor: bg, borderBottomColor: border }]}>
                <Text style={[s.sectionHeaderText, { color: accent }]}>{activeGroup.title}</Text>
                <View style={s.sectionTotals}>
                  <Text style={[s.sectionTotalText, { color: sub }]}>진단비 {activeGroup.feeTotal.toLocaleString()}원</Text>
                  {activeGroup.claimTotal > 0 && (
                    <Text style={[s.sectionTotalText, { color: '#e53e3e' }]}>클레임 -{activeGroup.claimTotal.toLocaleString()}원</Text>
                  )}
                  <Text style={[s.sectionTotalTextBold, { color: text }]}>총 {activeGroup.netTotal.toLocaleString()}원</Text>
                </View>
              </View>

              <FlatList
                data={activeGroup.data}
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
                        {itemClaim > 0 && (
                          <Text style={s.claim}>클레임 -{itemClaim.toLocaleString()}원</Text>
                        )}
                      </View>
                    </View>
                  );
                }}
              />
            </>
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

  monthStrip: { flexGrow: 0, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  monthChip: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20 },
  monthChipText: { fontSize: 14, fontWeight: '700' },

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
  claim: { fontSize: 11, fontWeight: '700', color: '#e53e3e', marginTop: 2 },
});
