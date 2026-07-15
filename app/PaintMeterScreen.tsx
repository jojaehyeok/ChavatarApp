/**
 * 도막측정 화면 - LS236 블루투스 연동
 * - 패널별 3회 측정 후 평균값(AVG) 기록
 * - BLE 스캔 → 연결 → 측정값 수신
 * - bytes[8-9] 리틀엔디언 / 10 = µm
 * - 정상 <150 / 도장 150~250 / 판금 >250 (모두 주황 계열)
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

// react-native-ble-plx 는 네이티브 모듈 → Expo Go에서 없으면 조용히 처리
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let BleManagerClass: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let BleState: any = { PoweredOn: 'PoweredOn' };
try {
  const ble = require('react-native-ble-plx');
  BleManagerClass = ble.BleManager;
  BleState = ble.State;
} catch (_) {}

const NOTIFY_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
const NOTIFY_CHAR_UUID    = '0000fff1-0000-1000-8000-00805f9b34fb';
const KEEPALIVE_CHAR_UUID = '0000fff2-0000-1000-8000-00805f9b34fb';

const PANELS = [
  { id: 'hood',        label: '후드' },
  { id: 'roof',        label: '루프' },
  { id: 'trunk',       label: '트렁크' },
  { id: 'front_left',  label: '(좌)앞 휀다' },
  { id: 'front_right', label: '(우)앞 휀다' },
  { id: 'door_fl',     label: '(좌)앞도어 좌' },
  { id: 'door_fr',     label: '(우)앞도어 우' },
  { id: 'door_rl',     label: '(좌)뒷도어 좌' },
  { id: 'door_rr',     label: '(우)뒷도어 우' },
  { id: 'rear_left',   label: '(좌)쿼터패널' },
  { id: 'rear_right',  label: '(우)쿼터패널' },
  { id: 'sill_l',      label: '(좌)사이드실' },
  { id: 'sill_r',      label: '(우)사이드실' },
];

// SVG 다이어그램 측정점 (기준 뷰박스 300×500)
const MEASURE_POINTS = [
  { id: 'hood',        cx: 150, cy: 72,  label: '후드' },
  { id: 'front_left',  cx: 55,  cy: 72,  label: '앞펜더\n좌' },
  { id: 'front_right', cx: 245, cy: 72,  label: '앞펜더\n우' },
  { id: 'door_fl',     cx: 55,  cy: 178, label: '앞도어\n좌' },
  { id: 'door_fr',     cx: 245, cy: 178, label: '앞도어\n우' },
  { id: 'roof',        cx: 150, cy: 250, label: '루프' },
  { id: 'door_rl',     cx: 55,  cy: 302, label: '뒷도어\n좌' },
  { id: 'door_rr',     cx: 245, cy: 302, label: '뒷도어\n우' },
  { id: 'rear_left',   cx: 55,  cy: 418, label: '뒤펜더\n좌' },
  { id: 'rear_right',  cx: 245, cy: 418, label: '뒤펜더\n우' },
  { id: 'trunk',       cx: 150, cy: 428, label: '트렁크' },
];

// 정상=연한주황 / 도장=주황 / 판금=진한주황
const getPaintStatus = (value: number) => {
  if (value === 0)   return { label: '-',   color: '#64748b' };
  if (value < 150)   return { label: '정상', color: '#fdba74' }; // orange-300
  if (value <= 250)  return { label: '도장', color: '#f97316' }; // orange-500
  return               { label: '판금', color: '#9a3412' };      // orange-800
};

const parseMicron = (b64: string): number => {
  try {
    const bin = atob(b64);
    if (bin.length < 10) return 0;
    return ((bin.charCodeAt(9) << 8) | bin.charCodeAt(8)) / 10;
  } catch {
    return 0;
  }
};

type MeasureEntry = { panelId: string; readings: number[]; best: number };

// ── SVG 차량 다이어그램 ────────────────────────────────────────────────────
function CarDiagram({
  measurements,
  selectedPanel,
  onPanelPress,
}: {
  measurements: Record<string, MeasureEntry>;
  selectedPanel: string | null;
  onPanelPress: (id: string) => void;
}) {
  const { width: screenW } = useWindowDimensions();
  const SVG_VW = 300;
  const SVG_VH = 500;
  const svgW = Math.min(screenW - 32, 320);
  const svgH = (SVG_VH / SVG_VW) * svgW;

  // 차체 상수
  const BX = 30, BY = 15, BW = 240, BH = 470, BR = 48; // body rect
  const HOOD_Y = 135;   // 후드/실내 경계
  const TRUNK_Y = 365;  // 트렁크/실내 경계
  const SIDE_LX = 82;   // 왼쪽 사이드 패널 경계
  const SIDE_RX = 218;  // 오른쪽 사이드 패널 경계
  const DOOR_Y = 240;   // 앞도어/뒷도어 경계

  return (
    <View style={{ alignSelf: 'center', marginBottom: 16 }}>
      <Svg width={svgW} height={svgH} viewBox={`0 0 ${SVG_VW} ${SVG_VH}`}>

        {/* ── 차체 외곽 ── */}
        <Rect x={BX} y={BY} width={BW} height={BH} rx={BR} fill="#0f172a" stroke="#475569" strokeWidth="2" />

        {/* ── 후드 영역 하이라이트 ── */}
        <Path
          d={`M${BX + BR},${BY} h${BW - 2 * BR} a${BR},${BR} 0 0 1 ${BR},${BR} v${HOOD_Y - BY - BR} h-${BW} v-${HOOD_Y - BY - BR} a${BR},${BR} 0 0 1 ${BR},-${BR} z`}
          fill="#131f35" stroke="none"
        />

        {/* ── 트렁크 영역 하이라이트 ── */}
        <Path
          d={`M${BX},${TRUNK_Y} h${BW} v${BH - TRUNK_Y + BY - BR} a${BR},${BR} 0 0 1 -${BR},${BR} h-${BW - 2 * BR} a${BR},${BR} 0 0 1 -${BR},-${BR} z`}
          fill="#131f35" stroke="none"
        />

        {/* ── 패널 경계선 ── */}
        {/* 후드/실내 */}
        <Line x1={BX} y1={HOOD_Y} x2={BX + BW} y2={HOOD_Y} stroke="#334155" strokeWidth="1.5" />
        {/* 트렁크/실내 */}
        <Line x1={BX} y1={TRUNK_Y} x2={BX + BW} y2={TRUNK_Y} stroke="#334155" strokeWidth="1.5" />
        {/* 왼쪽 사이드 세로 */}
        <Line x1={SIDE_LX} y1={HOOD_Y} x2={SIDE_LX} y2={TRUNK_Y} stroke="#334155" strokeWidth="1.5" />
        {/* 오른쪽 사이드 세로 */}
        <Line x1={SIDE_RX} y1={HOOD_Y} x2={SIDE_RX} y2={TRUNK_Y} stroke="#334155" strokeWidth="1.5" />
        {/* 앞도어/뒷도어 가로 (사이드만) */}
        <Line x1={BX} y1={DOOR_Y} x2={SIDE_LX} y2={DOOR_Y} stroke="#334155" strokeWidth="1.5" />
        <Line x1={SIDE_RX} y1={DOOR_Y} x2={BX + BW} y2={DOOR_Y} stroke="#334155" strokeWidth="1.5" />

        {/* ── 실내 유리/루프 영역 ── */}
        {/* 앞유리 */}
        <Rect x={SIDE_LX + 2} y={HOOD_Y + 2} width={SIDE_RX - SIDE_LX - 4} height={52} rx="8" fill="#08111f" stroke="#1e3a5f" strokeWidth="1.5" />
        {/* 루프 (사이드 글라스 포함) */}
        <Rect x={SIDE_LX + 2} y={HOOD_Y + 60} width={SIDE_RX - SIDE_LX - 4} height={TRUNK_Y - HOOD_Y - 120} rx="4" fill="#08111f" stroke="#1e3a5f" strokeWidth="1.5" />
        {/* 뒷유리 */}
        <Rect x={SIDE_LX + 2} y={TRUNK_Y - 54} width={SIDE_RX - SIDE_LX - 4} height={52} rx="8" fill="#08111f" stroke="#1e3a5f" strokeWidth="1.5" />

        {/* ── 사이드실 패널 (전개도 스타일: 차체 양옆 긴 스트립) ── */}
        {[
          { id: 'sill_l', x: 11, y: HOOD_Y, w: 17, h: TRUNK_Y - HOOD_Y, tx: 19, ty: 250 },
          { id: 'sill_r', x: BX + BW + 2, y: HOOD_Y, w: 17, h: TRUNK_Y - HOOD_Y, tx: BX + BW + 11, ty: 250 },
        ].map(sill => {
          const entry = measurements[sill.id];
          const status = getPaintStatus(entry?.best ?? 0);
          const isActive = selectedPanel === sill.id;
          return (
            <G key={sill.id} onPress={() => onPanelPress(sill.id)}>
              <Rect
                x={sill.x} y={sill.y} width={sill.w} height={sill.h} rx="4"
                fill={entry ? status.color : (isActive ? '#1e3a5f' : '#1a2535')}
                fillOpacity={entry ? 0.42 : 1}
                stroke={entry ? status.color : (isActive ? '#f97316' : '#334155')}
                strokeWidth="1.5"
              />
              {entry ? (
                <SvgText x={sill.tx} y={sill.ty} textAnchor="middle"
                         fill={status.color} fontSize="9" fontWeight="bold"
                         transform={`rotate(-90,${sill.tx},${sill.ty})`}>
                  {entry.best.toFixed(0)}µm {status.label}
                </SvgText>
              ) : (
                <SvgText x={sill.tx} y={sill.ty} textAnchor="middle"
                         fill={isActive ? '#f97316' : '#475569'} fontSize="8"
                         transform={`rotate(-90,${sill.tx},${sill.ty})`}>
                  사이드실{sill.id === 'sill_l' ? '(좌)' : '(우)'}
                </SvgText>
              )}
            </G>
          );
        })}

        {/* ── 측정 포인트 (원형) ── */}
        {MEASURE_POINTS.map(pt => {
          const entry = measurements[pt.id];
          const status = getPaintStatus(entry?.best ?? 0);
          const isActive = selectedPanel === pt.id;
          const fillColor = entry
            ? status.color
            : isActive ? '#1e3a5f' : '#1e293b';
          const strokeColor = entry
            ? status.color
            : isActive ? '#3b82f6' : '#475569';
          const R = 20;

          return (
            <G key={pt.id} onPress={() => onPanelPress(pt.id)}>
              {/* 활성/측정됨 강조 링 */}
              {(isActive || entry) && (
                <Circle cx={pt.cx} cy={pt.cy} r={R + 4} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeDasharray={entry ? undefined : "4 3"} opacity={0.6} />
              )}
              {/* 메인 원 */}
              <Circle cx={pt.cx} cy={pt.cy} r={R} fill={fillColor} stroke={strokeColor} strokeWidth="2" fillOpacity={entry ? 0.25 : 1} />

              {entry ? (
                <>
                  <SvgText x={pt.cx} y={pt.cy - 3} textAnchor="middle" fill={status.color} fontSize="12" fontWeight="bold">
                    {entry.best.toFixed(0)}
                  </SvgText>
                  <SvgText x={pt.cx} y={pt.cy + 9} textAnchor="middle" fill={status.color} fontSize="7">
                    µm
                  </SvgText>
                </>
              ) : (
                <SvgText x={pt.cx} y={pt.cy + 4} textAnchor="middle" fill={isActive ? '#60a5fa' : '#64748b'} fontSize="9">
                  {pt.label.split('\n')[0]}
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

export default function PaintMeterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manager   = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceRef = useRef<any>(null);
  const keepAlive = useRef<ReturnType<typeof setInterval> | null>(null);
  // selectedPanel ref: BLE 콜백은 클로저를 캡처하므로 ref로 최신값 참조
  const selectedPanelRef = useRef<string | null>(null);

  const [bleState, setBleState]           = useState<'off'|'ready'|'scanning'|'connecting'|'connected'>('off');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [devices, setDevices]             = useState<any[]>([]);
  const [scanVisible, setScanVisible]     = useState(false);
  const [selectedPanel, setSelectedPanel] = useState<string | null>(null);
  const [measurements, setMeasurements]   = useState<Record<string, MeasureEntry>>({});
  const [measuring, setMeasuring]         = useState(false);
  const [currentReadings, setCurrent]     = useState<number[]>([]);
  const readingsRef = useRef<number[]>([]);

  // ── BLE 초기화 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!BleManagerClass) return;
    manager.current = new BleManagerClass();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = manager.current.onStateChange((state: any) => {
      setBleState(state === BleState.PoweredOn ? 'ready' : 'off');
    }, true);
    return () => { sub.remove(); manager.current?.destroy(); };
  }, []);

  // ── 측정값 수신 ──────────────────────────────────────────────────────────
  const onReceiveMeasurement = useCallback((value: number) => {
    const panel = selectedPanelRef.current;
    if (!panel) return;
    const next = [...readingsRef.current, value].slice(-3);
    readingsRef.current = next;
    setCurrent([...next]);
    if (next.length >= 3) {
      const best = Math.max(...next);
      setMeasurements(prev => ({
        ...prev,
        [panel]: { panelId: panel, readings: next, best },
      }));
      readingsRef.current = [];
      setCurrent([]);
      setMeasuring(false);
      setSelectedPanel(null);
      selectedPanelRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 연결 해제 ─────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    if (keepAlive.current) { clearInterval(keepAlive.current); keepAlive.current = null; }
    deviceRef.current?.cancelConnection();
    deviceRef.current = null;
    setBleState('ready');
  }, []);

  // ── 연결 ─────────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectDevice = useCallback(async (device: any) => {
    setScanVisible(false);
    manager.current?.stopDeviceScan();
    setBleState('connecting');
    try {
      const connected = await device.connect({ autoConnect: true });
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;
      setBleState('connected');

      connected.monitorCharacteristicForService(
        NOTIFY_SERVICE_UUID, NOTIFY_CHAR_UUID,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err: any, char: any) => {
          if (err || !char?.value) return;
          onReceiveMeasurement(parseMicron(char.value));
        }
      );

      manager.current?.onDeviceDisconnected(connected.id, () => {
        if (keepAlive.current) { clearInterval(keepAlive.current); keepAlive.current = null; }
        deviceRef.current = null;
        setBleState('ready');
      });

      if (keepAlive.current) clearInterval(keepAlive.current);
      keepAlive.current = setInterval(async () => {
        try { await connected.readCharacteristicForService(NOTIFY_SERVICE_UUID, KEEPALIVE_CHAR_UUID); } catch (_) {}
      }, 5000);

    } catch (_e) {
      setBleState('ready');
      Alert.alert('연결 실패', '장치에 연결할 수 없습니다. 다시 시도해주세요.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 스캔 ─────────────────────────────────────────────────────────────────
  const startScan = async () => {
    if (!BleManagerClass) { Alert.alert('미지원', '네이티브 빌드에서만 지원됩니다.'); return; }
    if (bleState !== 'ready') { Alert.alert('블루투스 꺼짐', '블루투스를 켜주세요.'); return; }
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      if (!Object.values(granted).every(r => r === PermissionsAndroid.RESULTS.GRANTED)) {
        Alert.alert('권한 필요', '블루투스 권한을 허용해주세요.'); return;
      }
    }
    setDevices([]);
    setScanVisible(true);
    setBleState('scanning');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manager.current?.startDeviceScan(null, null, (error: any, device: any) => {
      if (error) { setBleState('ready'); return; }
      if (!device?.name) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setDevices(prev => prev.find((d: any) => d.id === device.id) ? prev : [...prev, device]);
    });
    setTimeout(() => { manager.current?.stopDeviceScan(); setBleState(prev => prev === 'scanning' ? 'ready' : prev); }, 10000);
  };

  const startMeasure = (panelId: string) => {
    if (bleState !== 'connected') { Alert.alert('연결 필요', '먼저 LS236을 블루투스로 연결해주세요.'); return; }
    readingsRef.current = [];
    setCurrent([]);
    selectedPanelRef.current = panelId;
    setSelectedPanel(panelId);
    setMeasuring(true);
  };

  const cancelMeasure = () => {
    readingsRef.current = [];
    setCurrent([]);
    selectedPanelRef.current = null;
    setSelectedPanel(null);
    setMeasuring(false);
  };

  const resetAll = () => {
    Alert.alert('초기화', '모든 측정값을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '초기화', style: 'destructive', onPress: () => setMeasurements({}) },
    ]);
  };

  const panelName = PANELS.find(p => p.id === selectedPanel)?.label;

  return (
    <SafeAreaView style={s.safe}>
      {/* 헤더 */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>도막 측정</Text>
        <View style={s.headerRight}>
          {bleState === 'connected' ? (
            <TouchableOpacity onPress={disconnect} style={s.bleBtn}>
              <Ionicons name="bluetooth" size={16} color="#3b82f6" />
              <Text style={s.bleBtnText}>연결됨</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={startScan} style={s.bleBtn}>
              <Ionicons name="bluetooth-outline" size={16} color="#aaa" />
              <Text style={[s.bleBtnText, { color: '#aaa' }]}>
                {bleState === 'scanning' ? '스캔 중...' : bleState === 'connecting' ? '연결 중...' : '연결'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={resetAll} style={{ marginLeft: 8 }}>
            <Ionicons name="refresh" size={20} color="#aaa" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        {/* 측정 진행 배너 */}
        {measuring && (
          <View style={s.measuringBanner}>
            <ActivityIndicator size="small" color="#f97316" />
            <Text style={s.measuringText}>
              [{panelName}] 측정 중 — LS236 버튼 ({currentReadings.length}/3)
            </Text>
            <TouchableOpacity onPress={cancelMeasure}>
              <Ionicons name="close-circle" size={20} color="#f87171" />
            </TouchableOpacity>
          </View>
        )}
        {currentReadings.length > 0 && (
          <View style={s.readingsRow}>
            {currentReadings.map((v, i) => (
              <View key={i} style={s.readingChip}>
                <Text style={s.readingVal}>{v.toFixed(1)}</Text>
                <Text style={s.readingUnit}>µm</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── SVG 차량 다이어그램 ── */}
        <Text style={s.sectionLabel}>패널을 탭하여 측정 시작 — LS236 버튼을 3회 눌러주세요</Text>
        <CarDiagram
          measurements={measurements}
          selectedPanel={selectedPanel}
          onPanelPress={startMeasure}
        />

        {/* 범례 */}
        <View style={s.legend}>
          {[
            { label: '정상 (< 150µm)',   color: '#fdba74' },
            { label: '도장 (150~250µm)', color: '#f97316' },
            { label: '판금 (> 250µm)',   color: '#9a3412' },
          ].map(l => (
            <View key={l.label} style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: l.color }]} />
              <Text style={s.legendText}>{l.label}</Text>
            </View>
          ))}
        </View>

        {/* ── 패널 그리드 ── */}
        <View style={s.panelGrid}>
          {PANELS.map(panel => {
            const entry = measurements[panel.id];
            const status = getPaintStatus(entry?.best ?? 0);
            const isActive = selectedPanel === panel.id;
            return (
              <TouchableOpacity key={panel.id} style={[s.panelCard, isActive && s.panelCardActive]} onPress={() => startMeasure(panel.id)} activeOpacity={0.8}>
                <Text style={s.panelLabel}>{panel.label}</Text>
                {entry ? (
                  <>
                    <Text style={[s.panelValue, { color: status.color }]}>{entry.best.toFixed(1)}</Text>
                    <Text style={s.panelUnit}>µm</Text>
                    <View style={[s.statusDot, { backgroundColor: status.color }]}>
                      <Text style={s.statusText}>{status.label}</Text>
                    </View>
                    <Text style={s.panelReadings}>{entry.readings.map(r => r.toFixed(1)).join(' / ')}</Text>
                  </>
                ) : (
                  <View style={s.panelEmpty}>
                    <Ionicons name="add-circle-outline" size={24} color={isActive ? '#f97316' : '#444'} />
                    <Text style={[s.panelEmptyText, isActive && { color: '#f97316' }]}>
                      {isActive ? '측정 중...' : '탭하여 측정'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 결과 요약 */}
        {Object.keys(measurements).length > 0 && (
          <View style={s.summaryBox}>
            <Text style={s.summaryTitle}>측정 결과 요약 (AVG)</Text>
            {Object.values(measurements).map(entry => {
              const panel = PANELS.find(p => p.id === entry.panelId);
              const status = getPaintStatus(entry.best);
              return (
                <View key={entry.panelId} style={s.summaryRow}>
                  <Text style={s.summaryPanel}>{panel?.label}</Text>
                  <Text style={[s.summaryVal, { color: status.color }]}>{entry.best.toFixed(1)} µm</Text>
                  <Text style={[s.summaryStatus, { color: status.color }]}>{status.label}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* 스캔 모달 */}
      <Modal
        visible={scanVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { manager.current?.stopDeviceScan(); setScanVisible(false); setBleState('ready'); }}
      >
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>블루투스 장치 검색</Text>
              <TouchableOpacity onPress={() => { manager.current?.stopDeviceScan(); setScanVisible(false); setBleState('ready'); }}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            {bleState === 'scanning' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 }}>
                <ActivityIndicator size="small" color="#3b82f6" />
                <Text style={{ color: '#aaa' }}>주변 장치 스캔 중...</Text>
              </View>
            )}
            <FlatList
              data={devices}
              keyExtractor={d => d.id}
              ListEmptyComponent={<Text style={{ color: '#666', padding: 16, textAlign: 'center' }}>장치가 없습니다. LS236 전원을 확인해주세요.</Text>}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              renderItem={({ item }: { item: any }) => (
                <TouchableOpacity style={s.deviceItem} onPress={() => connectDevice(item)}>
                  <Ionicons name="bluetooth" size={16} color="#3b82f6" />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={s.deviceName}>{item.name || '알 수 없음'}</Text>
                    <Text style={s.deviceId}>{item.id}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#444" />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  bleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  bleBtnText: { color: '#3b82f6', fontSize: 12, fontWeight: '600' },
  body: { padding: 16, paddingBottom: 40 },
  measuringBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#431407', borderRadius: 10, padding: 12, marginBottom: 8 },
  measuringText: { flex: 1, color: '#fdba74', fontSize: 13 },
  readingsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  readingChip: { backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  readingVal: { color: '#fff', fontSize: 16, fontWeight: '700' },
  readingUnit: { color: '#64748b', fontSize: 10 },
  sectionLabel: { color: '#64748b', fontSize: 12, marginBottom: 12 },
  legend: { flexDirection: 'row', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: '#64748b', fontSize: 11 },
  panelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  panelCard: { width: '47%', backgroundColor: '#1e293b', borderRadius: 12, padding: 14, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', minHeight: 100 },
  panelCardActive: { borderColor: '#f97316' },
  panelLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  panelValue: { fontSize: 28, fontWeight: '800' },
  panelUnit: { color: '#64748b', fontSize: 10, marginTop: -2 },
  statusDot: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  panelReadings: { color: '#475569', fontSize: 10, marginTop: 4 },
  panelEmpty: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  panelEmptyText: { color: '#475569', fontSize: 11 },
  summaryBox: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16 },
  summaryTitle: { color: '#fff', fontWeight: '700', fontSize: 14, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#334155' },
  summaryPanel: { flex: 1, color: '#cbd5e1', fontSize: 13 },
  summaryVal: { fontSize: 15, fontWeight: '700', marginRight: 8 },
  summaryStatus: { fontSize: 12, fontWeight: '600', width: 36 },
  modalOverlay: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '65%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#334155' },
  modalTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deviceItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#334155' },
  deviceName: { color: '#fff', fontWeight: '600', fontSize: 14 },
  deviceId: { color: '#64748b', fontSize: 11 },
});
