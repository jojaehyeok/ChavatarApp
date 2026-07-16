import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Constants from 'expo-constants';
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../../constants/api';

const IS_EXPO_GO = Constants.appOwnership === 'expo';
// eslint-disable-next-line @typescript-eslint/no-var-requires
let Notifications: typeof import('expo-notifications') | null = null;
try {
  Notifications = require('expo-notifications') as typeof import('expo-notifications');
} catch (_) {}

if (!IS_EXPO_GO) {
  Notifications?.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_W = SCREEN_W * 0.72;

const AM_TIMES = ['08:00', '09:00', '10:00', '11:00'];
const PM_TIMES = ['12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

const toYMD = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getDateStrip = (count = 30) => {
  const today = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
};

const formatKoreanDate = (ymd: string) => {
  if (!ymd || ymd.length < 10) return '';
  const d = new Date(ymd);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
};

interface DiagnosisItem {
  id: string | number;
  status: string;
  carOwner: string;
  carNumber: string;
  carModel?: string;
  contact?: string;
  address: string;
  detailAddress: string;
  preferredDateTime: string;
  source: string;
  serviceType?: string;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  phoneNumber?: string;
  updatedAt?: string;
  completedAt?: string;
  firstCompletedAt?: string;
}

interface Theme {
  background: string;
  card: string;
  textMain: string;
  textSub: string;
  border: string;
  accent: string;
  tabBar: string;
  buttonSub: string;
  modalBg: string;
  timeSlotBg: string;
}

interface DateFilterStripProps {
  filterDate: string;
  upcomingDates: string[];
  onSelect: (date: string) => void;
  theme: Theme;
}

function DateFilterStrip({ filterDate, upcomingDates, onSelect, theme }: DateFilterStripProps) {
  const today = new Date();
  const todayYmd = toYMD(today);

  // 이번 주(일~토)에 해당하는 날짜만 칩으로 표시
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekStartYmd = toYMD(weekStart);
  const weekEndYmd = toYMD(weekEnd);
  const thisWeekDates = upcomingDates.filter(ymd => ymd >= weekStartYmd && ymd <= weekEndYmd);

  const selectedShadow = {
    backgroundColor: theme.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[
        styles.dateStripScroll,
        {
          height: 72,
          minHeight: 72,
          maxHeight: 72,
        },
      ]}
      contentContainerStyle={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 6,
        gap: 6,
        height: 72,
      }}
    >
      <TouchableOpacity
        style={[
          styles.dateChip,
          styles.dateChipFixed,
          filterDate === 'all' && selectedShadow,
        ]}
        onPress={() => onSelect('all')}
      >
        <Text
          style={[
            styles.dateChipAllText,
            {
              color: filterDate === 'all' ? theme.accent : theme.textMain,
            },
          ]}
        >
          전체
        </Text>
      </TouchableOpacity>

      {thisWeekDates.map(ymd => {
        const d = new Date(ymd);
        const isSelected = filterDate === ymd;
        const isToday = ymd === todayYmd;

        return (
          <TouchableOpacity
            key={ymd}
            style={[
              styles.dateChip,
              styles.dateChipFixed,
              isSelected && selectedShadow,
            ]}
            onPress={() => onSelect(ymd)}
          >
            <Text
              style={[
                styles.dateChipDay,
                {
                  color: isSelected ? theme.accent : theme.textSub,
                },
              ]}
            >
              {isToday ? '오늘' : DAY_KO[d.getDay()]}
            </Text>

            <Text
              style={[
                styles.dateChipNum,
                {
                  color: isSelected ? theme.accent : theme.textMain,
                },
              ]}
            >
              {d.getDate()}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const CANCEL_REASONS = [
  { id: '진단사 사정', label: '진단사 사정' },
  { id: '판매자의 예약 취소', label: '판매자의 예약 취소' },
  { id: '판매자 노쇼', label: '판매자 노쇼', note: '현장 사진을 꼭 첨부해 주세요.' },
];

export default function DiagnosisManagement() {
  const systemTheme = useColorScheme();
  const isDark = systemTheme === 'dark';
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const theme: Theme = {
    background: isDark ? '#111' : '#f8f9fa',
    card: isDark ? '#1a1a1a' : '#fff',
    textMain: isDark ? '#fff' : '#000',
    textSub: isDark ? '#888' : '#666',
    border: isDark ? '#222' : '#eee',
    accent: '#63489a',
    tabBar: isDark ? '#000' : '#fff',
    buttonSub: isDark ? '#2A2A2A' : '#f1f3f5',
    modalBg: isDark ? '#1a1a1a' : '#fff',
    timeSlotBg: isDark ? '#2a2a2a' : '#f0f0f0',
  };

  const [activeTab, setActiveTab] = useState<'upcoming' | 'request' | 'completed'>('upcoming');
  const [menuVisible, setMenuVisible] = useState(false);
  const drawerAnim = useRef(new Animated.Value(DRAWER_W)).current;

  const openDrawer = useCallback(() => {
    setMenuVisible(true);
    Animated.timing(drawerAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
  }, [drawerAnim]);

  const closeDrawer = useCallback(() => {
    Animated.timing(drawerAnim, { toValue: DRAWER_W, duration: 220, useNativeDriver: true }).start(() => setMenuVisible(false));
  }, [drawerAnim]);

  const [data, setData] = useState<DiagnosisItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [ratingMap, setRatingMap] = useState<Record<string, number>>({});

  const [isNavModalVisible, setNavModalVisible] = useState(false);
  const [isContactModalVisible, setContactModalVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState<DiagnosisItem | null>(null);

  const [currentDriverId, setCurrentDriverId] = useState<string | null>(null);
  const [currentDriverName, setCurrentDriverName] = useState<string | null>(null);

  const [filterDate, setFilterDate] = useState<string>('all');

  const [timeChangeItem, setTimeChangeItem] = useState<DiagnosisItem | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [timeChanging, setTimeChanging] = useState(false);

  const [moreOptionsItem, setMoreOptionsItem] = useState<DiagnosisItem | null>(null);
  const [cancelItem, setCancelItem] = useState<DiagnosisItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const newDateTime = selectedDate && selectedTime ? `${selectedDate} ${selectedTime}` : '';

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={openDrawer} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
          <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, openDrawer]);

  useEffect(() => {
    const getMyInfo = async () => {
      const id = await AsyncStorage.getItem('driverId');
      const name = await AsyncStorage.getItem('driverName');
      setCurrentDriverId(id);
      setCurrentDriverName(name);
    };
    getMyInfo();
  }, []);

  useEffect(() => {
    if (!Notifications || !currentDriverId) return;

    const registerPushToken = async () => {
      try {
        const { status: existing } = await Notifications!.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications!.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') return;

        const tokenData = await Notifications!.getDevicePushTokenAsync();
        await axios.patch(`${API_BASE_URL}/drivers/${currentDriverId}/push-token`, { pushToken: tokenData.data });
      } catch (e) {
        console.error('[FCM] 토큰 등록 실패:', e);
      }
    };

    registerPushToken();

    let sub: { remove: () => void } | null = null;
    try {
      sub = Notifications?.addNotificationResponseReceivedListener(() => setActiveTab('upcoming')) ?? null;
    } catch (_e) {}

    return () => { try { sub?.remove(); } catch (_e) {} };
  }, [currentDriverId]);

  const upcomingDates = useMemo(() => {
    if (activeTab !== 'upcoming') return [];
    const dates = data
      .map(item => (item.preferredDateTime || '').substring(0, 10))
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    return [...new Set(dates)].sort();
  }, [data, activeTab]);

  const filteredData = useMemo(() => {
    if (activeTab !== 'upcoming' || filterDate === 'all') return data;
    return data.filter(item => (item.preferredDateTime || '').startsWith(filterDate));
  }, [data, activeTab, filterDate]);

  const handleContact = async (type: 'tel' | 'sms' | 'confirm') => {
    const rawContact = selectedItem?.contact;
    if (!rawContact) { Alert.alert('오류', '연락처 정보가 없습니다.'); return; }
    const phone = rawContact.replace(/[^0-9]/g, '');
    let url = type === 'tel' ? `tel:${phone}` : `sms:${phone}`;
    if (type === 'confirm') {
      const message = `[카비오] 안녕하세요 진단사 ${currentDriverName}입니다. ${selectedItem?.carNumber} 차량 진단을 위해 ${selectedItem?.preferredDateTime}에 방문 예정입니다.`;
      url += `${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(message)}`;
    }
    setContactModalVisible(false);
    try { await Linking.openURL(url); } catch { Alert.alert('오류', '연결할 수 없습니다.'); }
  };

  const handleLaunchMap = async (app: 'kakao' | 'naver' | 'tmap') => {
    if (!selectedItem) return;
    const encoded = encodeURIComponent(selectedItem.address);
    const url = app === 'kakao'
      ? `kakaomap://search?q=${encoded}`
      : app === 'naver'
        ? `nmap://search?query=${encoded}`
        : `tmap://search?name=${encoded}`;
    setNavModalVisible(false);
    try { await Linking.openURL(url); } catch { Alert.alert('앱 미설치', '해당 지도 앱이 설치되어 있지 않습니다.'); }
  };

  const fetchData = useCallback(async () => {
    if (!currentDriverId) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/external/request/list`);
      const allData: DiagnosisItem[] = Array.isArray(response.data) ? response.data : response.data.data;
      if (!allData) return;
      const filtered = allData.filter(item => {
        const isMy = String(item.assignedDriverId) === String(currentDriverId) || item.assignedDriverName === currentDriverName;
        if (activeTab === 'request') return item.status === 'PENDING';
        if (activeTab === 'upcoming') return (item.status === 'CONFIRMED' || item.status === 'ASSIGNED') && isMy;
        return item.status === 'COMPLETED' && isMy;
      });
      setData(filtered);
    } catch (error) { console.error(error); }
    finally { setLoading(false); setRefreshing(false); }
  }, [activeTab, currentDriverId, currentDriverName]);

  const openTimeChange = (item: DiagnosisItem) => {
    setTimeChangeItem(item);
    const dt = item.preferredDateTime || '';
    const parts = dt.split(' ');
    const today = toYMD(new Date());
    setSelectedDate(parts[0]?.match(/^\d{4}-\d{2}-\d{2}$/) ? parts[0] : today);
    setSelectedTime(parts[1] || '');
  };

  const handleTimeChange = async () => {
    if (!timeChangeItem || !newDateTime) {
      Alert.alert('알림', '날짜와 시간을 모두 선택해주세요.');
      return;
    }
    setTimeChanging(true);
    try {
      await axios.patch(`${API_BASE_URL}/external/request/${timeChangeItem.id}/status`, {
        preferredDateTime: newDateTime,
      });
      Alert.alert('변경 완료', '예약 시간이 변경되었습니다.');
      setTimeChangeItem(null);
      fetchData();
    } catch { Alert.alert('오류', '시간 변경에 실패했습니다.'); }
    finally { setTimeChanging(false); }
  };

  const handleClaim = async (requestId: number) => {
    try {
      await axios.patch(`${API_BASE_URL}/external/request/${requestId}/status`, {
        status: 'CONFIRMED',
        assignedDriverId: currentDriverId,
        assignedDriverName: currentDriverName || '진단사',
      });
      Alert.alert('확정 완료', '내 예약 목록으로 이동합니다.');
      setActiveTab('upcoming');
      fetchData();
    } catch { Alert.alert('오류', '확정 실패'); }
  };

  const handleCancel = async () => {
    if (!cancelItem || !cancelReason) return;
    setCancelling(true);
    try {
      await axios.patch(`${API_BASE_URL}/external/request/${cancelItem.id}/status`, {
        status: 'CANCELLED',
        cancelReason,
        cancelledByDriver: true,
      });
      Alert.alert('취소 완료', '예약이 취소되었습니다.');
      setCancelItem(null);
      setCancelReason('');
      fetchData();
    } catch { Alert.alert('오류', '예약 취소에 실패했습니다.'); }
    finally { setCancelling(false); }
  };

  const handleOpenKakaoMap = useCallback(() => {
    if (filteredData.length === 0) return;
    const items = filteredData.map(item => ({
      address: item.address,
      title: `${item.carModel || ''} ${item.carNumber}`.trim() || '예약',
      dateTime: item.preferredDateTime || '',
    }));
    router.push({ pathname: '/KakaoMapScreen', params: { items: JSON.stringify(items) } } as any);
  }, [filteredData, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (activeTab !== 'completed' || !currentDriverId) return;
    axios.get(`${API_BASE_URL}/reviews/driver/${currentDriverId}/today`)
      .then(res => {
        const reviews: { bookingId: number; rating: number }[] = res.data?.reviews || [];
        const map: Record<string, number> = {};
        reviews.forEach(r => { map[String(r.bookingId)] = r.rating; });
        setRatingMap(map);
      })
      .catch(() => {});
  }, [activeTab, currentDriverId]);

  const renderButtons = (item: DiagnosisItem) => {
    if (activeTab === 'request') {
      return (
        <TouchableOpacity style={[styles.mainBtn, { backgroundColor: theme.accent }]} onPress={() => handleClaim(Number(item.id))}>
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>내 담당으로 확정하기</Text>
        </TouchableOpacity>
      );
    }
    if (activeTab === 'upcoming') {
      return (
        <View style={styles.btnGroup}>
          <TouchableOpacity style={[styles.subCardBtn, { backgroundColor: theme.buttonSub }]} onPress={() => { setSelectedItem(item); setContactModalVisible(true); }}>
            <Text style={{ color: theme.textMain, fontWeight: 'bold' }}>연락하기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.subCardBtn, { backgroundColor: theme.buttonSub }]} onPress={() => { setSelectedItem(item); setNavModalVisible(true); }}>
            <Text style={{ color: theme.textMain, fontWeight: 'bold' }}>길 찾기</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.subCardBtn, { backgroundColor: isDark ? '#fff' : '#2c313c' }]}
            onPress={() => router.push({ pathname: '/CarEvaluationSheet', params: { requestId: item.id, carNumber: item.carNumber, carModel: item.carModel || '', serviceType: item.serviceType || '' } })}
          >
            <Text style={{ color: isDark ? '#000' : '#fff', fontWeight: 'bold' }}>진단 시작</Text>
          </TouchableOpacity>
        </View>
      );
    }
    // firstCompletedAt은 최초 진단완료 후 재저장해도 안 바뀌는 고정 기준점 —
    // completedAt/updatedAt을 쓰면 수정할 때마다 2시간이 계속 늘어나버림.
    // (firstCompletedAt이 없는 과거 데이터는 기존 방식으로 폴백)
    const completedTime = item.firstCompletedAt || item.completedAt || item.updatedAt;
    const canEdit = completedTime ? Date.now() - new Date(completedTime).getTime() < 2 * 60 * 60 * 1000 : false;
    const itemRating = ratingMap[String(item.id)];
    return (
      <View style={{ gap: 8 }}>
        {itemRating !== undefined && (
          <View style={[styles.ratingBadge, { backgroundColor: isDark ? '#1a2a1a' : '#f0fdf4' }]}>
            <Text style={{ fontSize: 14 }}>{'★'.repeat(itemRating)}{'☆'.repeat(5 - itemRating)}</Text>
            <Text style={{ color: '#16a34a', fontSize: 13, fontWeight: '600', marginLeft: 6 }}>{itemRating}점 리뷰 받음</Text>
          </View>
        )}
        <View style={styles.btnGroup}>
          <TouchableOpacity
            style={[styles.subBtn, { flex: canEdit ? 1 : undefined, width: canEdit ? undefined : '100%', backgroundColor: theme.buttonSub }]}
            onPress={() => router.push({ pathname: '/CarEvaluationSheet', params: { requestId: item.id, carNumber: item.carNumber, carModel: item.carModel || '', serviceType: item.serviceType || '', mode: 'view' } })}
          >
            <Text style={[styles.subBtnText, { color: theme.textSub }]}>진단 내역 보기</Text>
          </TouchableOpacity>
          {canEdit && (
            <TouchableOpacity
              style={[styles.subBtn, { flex: 1, backgroundColor: theme.accent }]}
              onPress={() => router.push({ pathname: '/CarEvaluationSheet', params: { requestId: item.id, carNumber: item.carNumber, carModel: item.carModel || '', serviceType: item.serviceType || '', mode: 'edit' } })}
            >
              <Text style={[styles.subBtnText, { color: '#fff' }]}>수정하기</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.tabBar }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={[styles.container, { backgroundColor: theme.background }]}>

        <Modal visible={menuVisible} transparent animationType="none" onRequestClose={closeDrawer}>
          <Pressable style={styles.drawerOverlay} onPress={closeDrawer}>
            <Animated.View style={[styles.drawer, { backgroundColor: theme.card, transform: [{ translateX: drawerAnim }] }]}>
              <Pressable>
                <View style={[styles.drawerHeader, { borderBottomColor: theme.border }]}>
                  <Text style={[styles.drawerTitle, { color: theme.textMain }]}>더보기</Text>
                  <TouchableOpacity onPress={closeDrawer} style={{ padding: 4 }}>
                    <Ionicons name="close" size={22} color={theme.textSub} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[styles.drawerItem, { borderBottomColor: theme.border }]}
                  onPress={() => { closeDrawer(); setTimeout(() => router.push('/my-schedule' as any), 250); }}
                >
                  <View style={[styles.drawerItemIcon, { backgroundColor: isDark ? '#1e1a2e' : '#f3f0ff' }]}>
                    <Ionicons name="calendar-outline" size={20} color={theme.accent} />
                  </View>
                  <Text style={[styles.drawerItemText, { color: theme.textMain }]}>내 스케줄</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.textSub} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.drawerItem, { borderBottomColor: theme.border }]}
                  onPress={() => { closeDrawer(); setTimeout(() => router.push('/PaintMeterScreen' as any), 250); }}
                >
                  <View style={[styles.drawerItemIcon, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9' }]}>
                    <Ionicons name="color-palette-outline" size={20} color={theme.accent} />
                  </View>
                  <Text style={[styles.drawerItemText, { color: theme.textMain }]}>도막측정</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.textSub} />
                </TouchableOpacity>
              </Pressable>
            </Animated.View>
          </Pressable>
        </Modal>

        <View style={[styles.tabBar, { backgroundColor: theme.tabBar, borderBottomColor: theme.border }]}>
          {(['upcoming', 'request', 'completed'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => { setActiveTab(tab); setFilterDate('all'); }}
              style={[styles.tabItem, activeTab === tab && { borderBottomColor: isDark ? theme.accent : '#000', borderBottomWidth: 2 }]}
            >
              <Text style={[styles.tabText, { color: activeTab === tab ? theme.textMain : theme.textSub }]}>
                {tab === 'upcoming' ? '다가오는 예약' : tab === 'request' ? '예약 요청' : '완료된 예약'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'upcoming' && upcomingDates.length > 0 && (
          <DateFilterStrip
            filterDate={filterDate}
            upcomingDates={upcomingDates}
            onSelect={setFilterDate}
            theme={theme}
          />
        )}

        <FlatList
          data={filteredData}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: theme.textMain }]}>{item.carModel || '차량 정보 없음'}</Text>
                {activeTab === 'upcoming'
                  ? <TouchableOpacity onPress={() => setMoreOptionsItem(item)} style={{ padding: 4 }}>
                      <Ionicons name="ellipsis-vertical" size={20} color={theme.textSub} />
                    </TouchableOpacity>
                  : <Text style={[styles.statusBadge, { color: theme.accent }]}>{item.status}</Text>
                }
              </View>
              <View style={styles.infoSection}>
                <View style={styles.infoRow}><Text style={styles.label}>차량번호</Text><Text style={[styles.value, { color: theme.textMain }]}>{item.carNumber}</Text></View>
                <View style={styles.infoRow}><Text style={styles.label}>위치</Text><Text style={[styles.value, { color: theme.textMain }]}>{item.address}</Text></View>
                <View style={styles.infoRow}><Text style={styles.label}>시간</Text><Text style={[styles.value, { color: theme.textMain }]}>{item.preferredDateTime}</Text></View>
              </View>
              {renderButtons(item)}
            </View>
          )}
          keyExtractor={item => item.id.toString()}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={theme.accent} />}
          ListEmptyComponent={!loading ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyText, { color: theme.textSub }]}>
                {filterDate !== 'all' ? `${formatKoreanDate(filterDate)}에 예약이 없습니다.` : '해당 예약이 없습니다.'}
              </Text>
            </View>
          ) : null}
        />

        <Modal visible={!!timeChangeItem} animationType="slide" transparent={false}>
          <SafeAreaView style={[styles.timeModalSafe, { backgroundColor: theme.modalBg }]}>
            <View style={styles.timeModalHeader}>
              <TouchableOpacity onPress={() => setTimeChangeItem(null)} style={styles.timeModalClose}>
                <Ionicons name="close" size={26} color={theme.textMain} />
              </TouchableOpacity>
              <Text style={[styles.timeModalTitle, { color: theme.textMain }]}>예약 시간 변경</Text>
              <View style={{ width: 40 }} />
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={styles.timeModalDateHeader}>
                <Text style={[styles.timeModalDateText, { color: theme.textMain }]}>
                  {selectedDate ? formatKoreanDate(selectedDate) : '날짜를 선택해 주세요.'}
                </Text>
                <Text style={[styles.timeModalSub, { color: theme.textSub }]}>
                  {selectedDate ? '시간을 선택해 주세요.' : ''}
                </Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timeDateScroll} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                {getDateStrip(30).map(d => {
                  const ymd = toYMD(d);
                  const isSelected = selectedDate === ymd;
                  const isToday = ymd === toYMD(new Date());
                  return (
                    <TouchableOpacity
                      key={ymd}
                      style={[styles.timeDateChip, { backgroundColor: isSelected ? theme.textMain : theme.timeSlotBg }]}
                      onPress={() => setSelectedDate(ymd)}
                    >
                      <Text style={[styles.timeDateChipDay, { color: isSelected ? theme.modalBg : theme.textSub }]}>
                        {isToday ? '오늘' : DAY_KO[d.getDay()]}
                      </Text>
                      <Text style={[styles.timeDateChipNum, { color: isSelected ? theme.modalBg : theme.textMain }]}>
                        {d.getDate()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <View style={[styles.timeDivider, { backgroundColor: theme.border }]} />
              <Text style={[styles.ampmLabel, { color: theme.textMain }]}>오전</Text>
              <View style={styles.timeGrid}>
                {AM_TIMES.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.timeSlotBtn, { backgroundColor: selectedTime === t ? theme.textMain : theme.timeSlotBg }]}
                    onPress={() => setSelectedTime(t)}
                  >
                    <Text style={[styles.timeSlotText, { color: selectedTime === t ? theme.modalBg : theme.textMain }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.ampmLabel, { color: theme.textMain }]}>오후</Text>
              <View style={styles.timeGrid}>
                {PM_TIMES.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.timeSlotBtn, { backgroundColor: selectedTime === t ? theme.textMain : theme.timeSlotBg }]}
                    onPress={() => setSelectedTime(t)}
                  >
                    <Text style={[styles.timeSlotText, { color: selectedTime === t ? theme.modalBg : theme.textMain }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ height: 120 }} />
            </ScrollView>
            <View style={[styles.timeModalBottom, { backgroundColor: theme.modalBg, borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
              <TouchableOpacity
                style={[styles.timeConfirmBtn, { backgroundColor: newDateTime ? theme.accent : (isDark ? '#333' : '#ddd') }]}
                onPress={handleTimeChange}
                disabled={!newDateTime || timeChanging}
              >
                {timeChanging
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={[styles.timeConfirmText, { color: newDateTime ? '#fff' : theme.textSub }]}>변경하기</Text>
                }
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>

        <Modal visible={isContactModalVisible || isNavModalVisible} transparent animationType="slide">
          <Pressable style={styles.modalOverlay} onPress={() => { setContactModalVisible(false); setNavModalVisible(false); }}>
            <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
              <View style={[styles.modalHandle, { backgroundColor: isDark ? '#444' : '#ddd' }]} />
              <Text style={[styles.modalTitle, { color: theme.textMain }]}>{isContactModalVisible ? '차주에게 연락' : '길찾기 앱 선택'}</Text>
              {isContactModalVisible ? (
                <>
                  <TouchableOpacity style={styles.contactOption} onPress={() => handleContact('tel')}><Ionicons name="call" size={22} color={theme.accent} /><Text style={[styles.contactOptionText, { color: theme.textMain }]}>전화하기</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.contactOption} onPress={() => handleContact('sms')}><Ionicons name="mail" size={22} color={theme.accent} /><Text style={[styles.contactOptionText, { color: theme.textMain }]}>문자 보내기</Text></TouchableOpacity>
                </>
              ) : (
                <View style={styles.mapGroup}>
                  <TouchableOpacity style={styles.mapItem} onPress={() => handleLaunchMap('kakao')}><View style={[styles.mapIcon, { backgroundColor: '#FEE500' }]}><Ionicons name="chatbubble" size={20} color="#3C1E1E" /></View><Text style={{ color: theme.textMain }}>카카오</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.mapItem} onPress={() => handleLaunchMap('naver')}><View style={[styles.mapIcon, { backgroundColor: '#03C75A' }]}><Text style={{ color: '#fff', fontWeight: 'bold' }}>N</Text></View><Text style={{ color: theme.textMain }}>네이버</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.mapItem} onPress={() => handleLaunchMap('tmap')}><View style={[styles.mapIcon, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee' }]}><Ionicons name="navigate" size={20} color="#FF0000" /></View><Text style={{ color: theme.textMain }}>TMAP</Text></TouchableOpacity>
                </View>
              )}
            </View>
          </Pressable>
        </Modal>

        <Modal visible={!!moreOptionsItem} transparent animationType="slide">
          <Pressable style={styles.modalOverlay} onPress={() => setMoreOptionsItem(null)}>
            <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
              <View style={[styles.modalHandle, { backgroundColor: isDark ? '#444' : '#ddd' }]} />
              <Text style={[styles.modalTitle, { color: theme.textMain }]}>더 보기</Text>
              <TouchableOpacity
                style={styles.contactOption}
                onPress={() => {
                  const item = moreOptionsItem!;
                  setMoreOptionsItem(null);
                  setTimeout(() => openTimeChange(item), 300);
                }}
              >
                <Ionicons name="time-outline" size={22} color={theme.accent} />
                <Text style={[styles.contactOptionText, { color: theme.textMain }]}>시간 변경</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.contactOption, { borderBottomWidth: 0 }]}
                onPress={() => {
                  const item = moreOptionsItem;
                  setMoreOptionsItem(null);
                  setTimeout(() => { setCancelItem(item); setCancelReason(''); }, 300);
                }}
              >
                <Ionicons name="close-circle-outline" size={22} color="#e53e3e" />
                <Text style={[styles.contactOptionText, { color: '#e53e3e' }]}>예약 취소</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>

        <Modal visible={!!cancelItem} animationType="slide" transparent={false}>
          <SafeAreaView style={[styles.timeModalSafe, { backgroundColor: theme.modalBg }]}>
            <View style={styles.timeModalHeader}>
              <TouchableOpacity onPress={() => { setCancelItem(null); setCancelReason(''); }} style={styles.timeModalClose}>
                <Ionicons name="chevron-back" size={26} color={theme.textMain} />
              </TouchableOpacity>
              <View style={{ width: 40 }} />
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <Text style={[styles.timeModalTitle, { color: theme.textMain, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, fontSize: 22 }]}>
                예약 취소 사유를{'\n'}선택해 주세요
              </Text>
              <View style={styles.cancelInfoBox}>
                {[
                  { label: '차종', value: cancelItem?.carModel || '-' },
                  { label: '차량 번호', value: cancelItem?.carNumber || '-' },
                  { label: '위치', value: cancelItem ? `${cancelItem.address}${cancelItem.detailAddress ? ` ${cancelItem.detailAddress}` : ''}` : '-' },
                  { label: '시간', value: cancelItem?.preferredDateTime || '-' },
                ].map(row => (
                  <View key={row.label} style={styles.cancelInfoRow}>
                    <Text style={[styles.cancelInfoLabel, { color: theme.textSub }]}>{row.label}</Text>
                    <Text style={[styles.cancelInfoValue, { color: theme.textMain }]}>{row.value}</Text>
                  </View>
                ))}
              </View>
              <View style={[styles.cancelDivider, { backgroundColor: theme.border }]} />
              {CANCEL_REASONS.map(reason => {
                const selected = cancelReason === reason.id;
                return (
                  <TouchableOpacity key={reason.id} style={styles.cancelOption} onPress={() => setCancelReason(reason.id)}>
                    <View style={[styles.cancelRadio, { borderColor: selected ? theme.accent : '#888' }]}>
                      {selected && <View style={[styles.cancelRadioInner, { backgroundColor: theme.accent }]} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cancelOptionText, { color: theme.textMain }]}>{reason.label}</Text>
                      {reason.note && <Text style={[styles.cancelOptionNote, { color: theme.textSub }]}>{reason.note}</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
              <View style={{ height: 120 }} />
            </ScrollView>
            <View style={[styles.timeModalBottom, { backgroundColor: theme.modalBg, borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
              <TouchableOpacity
                style={[styles.timeConfirmBtn, { backgroundColor: cancelReason ? '#e53e3e' : (isDark ? '#333' : '#ddd') }]}
                onPress={handleCancel}
                disabled={!cancelReason || cancelling}
              >
                {cancelling
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={[styles.timeConfirmText, { color: cancelReason ? '#fff' : theme.textSub }]}>예약 취소</Text>
                }
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>


        {activeTab === 'upcoming' && filteredData.length > 0 && (
          <View style={styles.fabContainer} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.mapFab}
              onPress={handleOpenKakaoMap}
              activeOpacity={0.85}
            >
              <Ionicons name="map" size={22} color="#fff" />
              <Text style={styles.mapFabText}>
                {`지도 보기 (${filteredData.length}곳)`}
              </Text>
            </TouchableOpacity>
          </View>
        )}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },

  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 15 },
  tabText: { fontSize: 15, fontWeight: 'bold' },

  dateStripScroll: { backgroundColor: '#f2f3f5', height: 72, minHeight: 72, maxHeight: 72, flexGrow: 0 },
  dateStripContent: { paddingHorizontal: 12, paddingVertical: 6, gap: 6, alignItems: 'stretch' },
  dateChip: { backgroundColor: '#fff', borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dateChipFixed: { width: 52, height: 56, minHeight: 56, maxHeight: 56 },
  dateChipAllText: { fontSize: 14, fontWeight: '700', lineHeight: 18, includeFontPadding: false, textAlign: 'center' },
  dateChipDay: { fontSize: 12, fontWeight: '600', lineHeight: 16, includeFontPadding: false, textAlign: 'center' },
  dateChipNum: { fontSize: 15, fontWeight: '700', lineHeight: 18, marginTop: 2, includeFontPadding: false, textAlign: 'center' },
  dateChipDot: { width: 3, height: 3, borderRadius: 2, marginTop: 1 },

  card: { padding: 20, borderBottomWidth: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  cardTitle: { fontSize: 18, fontWeight: 'bold' },
  statusBadge: { fontSize: 12, fontWeight: 'bold' },
  infoSection: { marginBottom: 20 },
  infoRow: { flexDirection: 'row', marginBottom: 6 },
  label: { color: '#888', width: 70, fontSize: 14 },
  value: { flex: 1, fontSize: 14 },

  btnGroup: { flexDirection: 'row', gap: 8 },
  subCardBtn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' },
  mainBtn: { padding: 15, borderRadius: 8, alignItems: 'center' },
  subBtn: { padding: 12, borderRadius: 8, alignItems: 'center' },
  subBtnText: { fontWeight: 'bold' },

  emptyWrap: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15 },

  timeModalSafe: { flex: 1 },
  timeModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  timeModalClose: { padding: 4 },
  timeModalTitle: { fontSize: 18, fontWeight: 'bold' },
  timeModalDateHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  timeModalDateText: { fontSize: 22, fontWeight: 'bold' },
  timeModalSub: { fontSize: 14, marginTop: 4 },
  timeDateScroll: { marginTop: 16, marginBottom: 4 },
  timeDateChip: { width: 56, height: 70, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 4 },
  timeDateChipDay: { fontSize: 12, fontWeight: '600' },
  timeDateChipNum: { fontSize: 20, fontWeight: 'bold' },
  timeDivider: { height: 1, marginHorizontal: 20, marginVertical: 16 },
  ampmLabel: { fontSize: 16, fontWeight: 'bold', paddingHorizontal: 20, marginBottom: 12 },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginBottom: 20 },
  timeSlotBtn: { width: (SCREEN_W - 16 * 2 - 10 * 2) / 3, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  timeSlotText: { fontSize: 16, fontWeight: '600' },
  timeModalBottom: { paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1 },
  timeConfirmBtn: { height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  timeConfirmText: { fontSize: 17, fontWeight: 'bold' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 50 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  contactOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18, borderBottomWidth: 0.5, borderBottomColor: '#333' },
  contactOptionText: { fontSize: 16, marginLeft: 15 },
  mapGroup: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10 },
  mapItem: { alignItems: 'center' },
  mapIcon: { width: 50, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },

  moreBtnCard: { width: 46, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 8 },

  cancelInfoBox: { backgroundColor: 'transparent', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 6 },
  cancelInfoRow: { flexDirection: 'row', marginBottom: 4 },
  cancelInfoLabel: { color: '#888', width: 70, fontSize: 14 },
  cancelInfoValue: { flex: 1, fontSize: 14 },
  cancelDivider: { height: 1, marginHorizontal: 20, marginVertical: 8 },
  cancelOption: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingVertical: 18, gap: 14 },
  cancelOptionText: { fontSize: 16, fontWeight: '600' },
  cancelOptionNote: { fontSize: 13, marginTop: 3 },
  cancelRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  cancelRadioInner: { width: 10, height: 10, borderRadius: 5 },

  moreBtn: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  drawerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', flexDirection: 'row', justifyContent: 'flex-end' },
  drawer: { width: DRAWER_W, height: '100%', shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: { width: -3, height: 0 }, shadowRadius: 10, elevation: 20 },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: 1 },
  drawerTitle: { fontSize: 17, fontWeight: '700' },
  drawerItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: 1, gap: 14 },
  drawerItemIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  drawerItemText: { flex: 1, fontSize: 15, fontWeight: '500' },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  menuItemText: { fontSize: 15, fontWeight: '500' },

  fabContainer: { position: 'absolute', bottom: 28, left: 0, right: 0, alignItems: 'center' },
  mapFab: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#63489a', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 30,
    shadowColor: '#63489a', shadowOpacity: 0.4, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 8,
  },
  mapFabText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
