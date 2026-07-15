import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const VEHICLE_OPTIONS = ['승용차', 'SUV', '트럭', '승합차', '전기차'];

const REGION_OPTIONS = [
  '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

// 30분 단위 시간 슬롯 생성 (08:00 ~ 20:00)
function genTimeSlots(fromH = 8, toH = 20): string[] {
  const slots: string[] = [];
  for (let h = fromH; h <= toH; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    if (h < toH) slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

const AM_SLOTS = genTimeSlots(8, 11).concat(['11:30']);
const PM_SLOTS = genTimeSlots(12, 20);

export default function MyScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';

  const bg = isDark ? '#111' : '#f8f9fa';
  const card = isDark ? '#1a1a1a' : '#fff';
  const text = isDark ? '#fff' : '#111';
  const sub = isDark ? '#888' : '#666';
  const border = isDark ? '#2a2a2a' : '#eee';
  const accent = '#63489a';
  const slotBg = isDark ? '#2a2a2a' : '#f0f0f0';

  const [driverId, setDriverId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [maxDaily, setMaxDaily] = useState(5);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>(['승용차', 'SUV']);

  const load = useCallback(async (id: string) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/drivers/${id}`);
      const d = res.data;
      if (d.availableDays?.length) setSelectedDays(d.availableDays);
      if (d.availableStartTime) setStartTime(d.availableStartTime);
      if (d.availableEndTime) setEndTime(d.availableEndTime);
      if (d.maxDailyBookings) setMaxDaily(d.maxDailyBookings);
      if (d.regions?.length) setSelectedRegions(d.regions);
      if (d.vehicleTypes?.length) setSelectedVehicles(d.vehicleTypes);
    } catch { /* 첫 설정이면 빈 값 유지 */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('driverId').then(id => {
      setDriverId(id);
      if (id) load(id);
      else setLoading(false);
    });
  }, [load]);

  const toggleDay = (day: number) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const toggleRegion = (r: string) => {
    setSelectedRegions(prev =>
      prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]
    );
  };

  const toggleVehicle = (v: string) => {
    setSelectedVehicles(prev =>
      prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
    );
  };

  const handleSave = async () => {
    if (!driverId) return;
    if (selectedDays.length === 0) { Alert.alert('알림', '가능 요일을 1개 이상 선택해주세요.'); return; }
    if (selectedRegions.length === 0) { Alert.alert('알림', '가능 지역을 1개 이상 선택해주세요.'); return; }
    setSaving(true);
    try {
      await axios.patch(`${API_BASE_URL}/drivers/${driverId}/availability`, {
        availableDays: selectedDays,
        availableStartTime: startTime,
        availableEndTime: endTime,
        maxDailyBookings: maxDaily,
        regions: selectedRegions,
        vehicleTypes: selectedVehicles,
      });
      Alert.alert('저장 완료', '스케줄이 업데이트되었습니다.', [{ text: '확인', onPress: () => router.back() }]);
    } catch {
      Alert.alert('오류', '저장에 실패했습니다. 다시 시도해주세요.');
    } finally { setSaving(false); }
  };

  const allSlots = [...AM_SLOTS, ...PM_SLOTS];
  const startIdx = allSlots.indexOf(startTime);
  const endIdx = allSlots.indexOf(endTime);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={accent} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* 헤더 */}
      <View style={[s.header, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={26} color={text} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: text }]}>내 스케줄 설정</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>

        {/* 가능 요일 */}
        <View style={[s.section, { backgroundColor: card, borderColor: border }]}>
          <Text style={[s.sectionTitle, { color: text }]}>가능 요일</Text>
          <View style={s.dayRow}>
            {DAY_LABELS.map((label, idx) => {
              const selected = selectedDays.includes(idx);
              const isSun = idx === 0;
              const isSat = idx === 6;
              return (
                <TouchableOpacity
                  key={idx}
                  style={[s.dayBtn, selected && { backgroundColor: accent }, !selected && { backgroundColor: slotBg }]}
                  onPress={() => toggleDay(idx)}
                >
                  <Text style={[s.dayBtnText, {
                    color: selected ? '#fff' : isSun ? '#e53e3e' : isSat ? '#3182ce' : sub,
                  }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 가능 시간 (시작) */}
        <View style={[s.section, { backgroundColor: card, borderColor: border }]}>
          <Text style={[s.sectionTitle, { color: text }]}>시작 시간</Text>
          <Text style={[s.sectionSub, { color: sub }]}>가능한 첫 시작 시간을 선택하세요</Text>
          <Text style={[s.ampmLabel, { color: text }]}>오전</Text>
          <View style={s.slotGrid}>
            {AM_SLOTS.map(t => {
              const selected = startTime === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[s.slotBtn, { backgroundColor: selected ? accent : slotBg }]}
                  onPress={() => setStartTime(t)}
                >
                  <Text style={[s.slotText, { color: selected ? '#fff' : text }]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[s.ampmLabel, { color: text }]}>오후</Text>
          <View style={s.slotGrid}>
            {PM_SLOTS.filter(t => {
              const idx = allSlots.indexOf(t);
              return idx <= allSlots.indexOf(endTime);
            }).map(t => {
              const selected = startTime === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[s.slotBtn, { backgroundColor: selected ? accent : slotBg }]}
                  onPress={() => setStartTime(t)}
                >
                  <Text style={[s.slotText, { color: selected ? '#fff' : text }]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 가능 시간 (종료) */}
        <View style={[s.section, { backgroundColor: card, borderColor: border }]}>
          <Text style={[s.sectionTitle, { color: text }]}>종료 시간</Text>
          <Text style={[s.sectionSub, { color: sub }]}>마지막으로 가능한 시간을 선택하세요</Text>
          <Text style={[s.ampmLabel, { color: text }]}>오전</Text>
          <View style={s.slotGrid}>
            {AM_SLOTS.filter(t => allSlots.indexOf(t) >= startIdx).map(t => {
              const selected = endTime === t;
              return (
                <TouchableOpacity key={t} style={[s.slotBtn, { backgroundColor: selected ? accent : slotBg }]} onPress={() => setEndTime(t)}>
                  <Text style={[s.slotText, { color: selected ? '#fff' : text }]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[s.ampmLabel, { color: text }]}>오후</Text>
          <View style={s.slotGrid}>
            {PM_SLOTS.filter(t => allSlots.indexOf(t) >= startIdx).map(t => {
              const selected = endTime === t;
              return (
                <TouchableOpacity key={t} style={[s.slotBtn, { backgroundColor: selected ? accent : slotBg }]} onPress={() => setEndTime(t)}>
                  <Text style={[s.slotText, { color: selected ? '#fff' : text }]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 하루 최대 배정 수 */}
        <View style={[s.section, { backgroundColor: card, borderColor: border }]}>
          <Text style={[s.sectionTitle, { color: text }]}>하루 최대 배정 수</Text>
          <View style={s.counterRow}>
            <TouchableOpacity
              style={[s.counterBtn, { backgroundColor: slotBg }]}
              onPress={() => setMaxDaily(v => Math.max(1, v - 1))}
            >
              <Ionicons name="remove" size={20} color={text} />
            </TouchableOpacity>
            <Text style={[s.counterValue, { color: text }]}>{maxDaily}건</Text>
            <TouchableOpacity
              style={[s.counterBtn, { backgroundColor: slotBg }]}
              onPress={() => setMaxDaily(v => Math.min(20, v + 1))}
            >
              <Ionicons name="add" size={20} color={text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 가능 지역 */}
        <View style={[s.section, { backgroundColor: card, borderColor: border }]}>
          <Text style={[s.sectionTitle, { color: text }]}>가능 지역</Text>
          <View style={s.chipWrap}>
            {REGION_OPTIONS.map(r => {
              const selected = selectedRegions.includes(r);
              return (
                <TouchableOpacity
                  key={r}
                  style={[s.chip, { backgroundColor: selected ? accent : slotBg, borderColor: selected ? accent : border }]}
                  onPress={() => toggleRegion(r)}
                >
                  <Text style={[s.chipText, { color: selected ? '#fff' : text }]}>{r}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 가능 차량 유형 */}
        <View style={[s.section, { backgroundColor: card, borderColor: border }]}>
          <Text style={[s.sectionTitle, { color: text }]}>가능 차량 유형</Text>
          <View style={s.chipWrap}>
            {VEHICLE_OPTIONS.map(v => {
              const selected = selectedVehicles.includes(v);
              return (
                <TouchableOpacity
                  key={v}
                  style={[s.chip, { backgroundColor: selected ? accent : slotBg, borderColor: selected ? accent : border }]}
                  onPress={() => toggleVehicle(v)}
                >
                  <Text style={[s.chipText, { color: selected ? '#fff' : text }]}>{v}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 현재 설정 요약 */}
        <View style={[s.summary, { backgroundColor: isDark ? '#1e1a2e' : '#f3f0ff', borderColor: isDark ? '#3d3060' : '#ddd6fe' }]}>
          <Text style={[s.summaryTitle, { color: accent }]}>현재 설정 요약</Text>
          <Text style={[s.summaryRow, { color: text }]}>
            요일: {selectedDays.sort().map(d => DAY_LABELS[d]).join(', ') || '없음'}
          </Text>
          <Text style={[s.summaryRow, { color: text }]}>
            시간: {startTime} ~ {endTime}
          </Text>
          <Text style={[s.summaryRow, { color: text }]}>
            하루 최대: {maxDaily}건
          </Text>
          <Text style={[s.summaryRow, { color: text }]}>
            지역: {selectedRegions.join(', ') || '없음'}
          </Text>
        </View>

      </ScrollView>

      {/* 저장 버튼 */}
      <View style={[s.footer, { backgroundColor: card, borderTopColor: border, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          style={[s.saveBtn, { backgroundColor: accent }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.saveBtnText}>스케줄 저장</Text>
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

  section: { marginHorizontal: 16, marginTop: 16, borderRadius: 16, borderWidth: 1, padding: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sectionSub: { fontSize: 12, marginBottom: 14 },

  dayRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  dayBtn: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dayBtnText: { fontSize: 15, fontWeight: '700' },

  ampmLabel: { fontSize: 13, fontWeight: '700', marginTop: 16, marginBottom: 10 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotBtn: { width: 72, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  slotText: { fontSize: 14, fontWeight: '600' },

  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32, marginTop: 12 },
  counterBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  counterValue: { fontSize: 24, fontWeight: '700', minWidth: 60, textAlign: 'center' },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '600' },

  summary: { marginHorizontal: 16, marginTop: 16, borderRadius: 16, borderWidth: 1, padding: 20 },
  summaryTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  summaryRow: { fontSize: 13, marginBottom: 4 },

  footer: { paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1 },
  saveBtn: { height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
