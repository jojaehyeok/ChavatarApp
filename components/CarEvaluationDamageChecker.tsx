import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import EvaluationSvg from '../assets/svgs/evaluation_damage_checker_background.svg';

// ─── 체크 박스 위치 (Flutter 원본 좌표) ──────────────────────────────────────
const CHECK_POSITIONS = [
  { x: 311.83, y: 240.14 },
  { x: 260.03, y: 892.29 },
  { x: 509.3,  y: 762.29 },
  { x: 86.64,  y: 1111.77 },
  { x: 508.86, y: 1142.25 },
  { x: 260.03, y: 1333.65 },
  { x: 512.24, y: 1648.91 },
  { x: 374.88, y: 1910.12 },
  { x: 983.46, y: 458.1 },
  { x: 983.46, y: 1212.79 },
  { x: 983.46, y: 1816.54 },
  { x: 1667.97, y: 240.48 },
  { x: 1469.7,  y: 762.29 },
  { x: 1718.76, y: 892.63 },
  { x: 1892.36, y: 1111.77 },
  { x: 1470.94, y: 1142.58 },
  { x: 1718.76, y: 1333.98 },
  { x: 1466.56, y: 1648.24 },
  { x: 1604.92, y: 1910.45 },
  { x: 988.04,  y: 2101.36 },
  { x: 988.04,  y: 2241.4 },
  { x: 723.78,  y: 2411.14 },
  { x: 866.79,  y: 2488.66 },
  { x: 1099.87, y: 2488.4 },
  { x: 1244.45, y: 2411.14 },
  { x: 727.0,   y: 2622.66 },
  { x: 1237.35, y: 2622.66 },
  { x: 991.04,  y: 2784.37 },
  { x: 991.04,  y: 2922.09 },
  { x: 991.04,  y: 3153.39 },
  { x: 995.47,  y: 3403.48 },
  { x: 710.25,  y: 3552.65 },
  { x: 849.93,  y: 3590.53 },
  { x: 987.15,  y: 3590.53 },
  { x: 1124.26, y: 3590.53 },
  { x: 1264.94, y: 3550.65 },
  { x: 992.15,  y: 3764.23 },
];

// ─── 탭 사이클: 빈칸 → X(교환) → B(판금) → W(용접) → 빈칸 ──────────────────
const CYCLE = [
  { symbol: null, label: '',  bgColor: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.35)' },
  { symbol: 'X',  label: 'X', bgColor: '#ef4444', border: '#ef4444' },
  { symbol: 'B',  label: 'B', bgColor: '#8b5cf6', border: '#8b5cf6' },
  { symbol: 'W',  label: 'W', bgColor: '#3b82f6', border: '#3b82f6' },
];

const SYMBOL_TEXT_COLOR: Record<string, string> = {
  X: '#ffffff',
  B: '#ffffff',
  W: '#ffffff',
};

const symbolToIndex = (s: string | null) => {
  if (!s) return 0;
  const i = CYCLE.findIndex((c) => c.symbol === s);
  return i < 0 ? 0 : i;
};

const ORIGINAL_WIDTH  = 2109;
const ORIGINAL_HEIGHT = 4001;
const MAX_ZOOM = 3;
// 터치 영역이 최소 이만큼은 되도록 보정(원본 비율로는 좁은 화면에서 20px 안팎까지
// 작아져서 탭이 어렵다는 얘기가 많았음) — 실제 원 크기는 그대로 두고 탭 판정 영역만 넓힌다
const MIN_HIT_SLOP = 6;

interface Props {
  checkedDamages: string[][];
  onChange?: (index: number, symbols: string[]) => void;
  readonly?: boolean;
  containerWidth?: number;
}

function CarEvaluationDamageChecker({
  checkedDamages,
  onChange,
  readonly = false,
  containerWidth,
}: Props) {
  const screenWidth     = containerWidth ?? Dimensions.get('window').width - 40;
  const containerHeight = (ORIGINAL_HEIGHT / ORIGINAL_WIDTH) * screenWidth;
  const widthRatio      = screenWidth / ORIGINAL_WIDTH;
  const heightRatio     = containerHeight / ORIGINAL_HEIGHT;
  const boxSize         = widthRatio * 165; // 130 -> 165, 원이 작다는 피드백으로 확대

  const handleTap = (index: number) => {
    const current   = checkedDamages[index]?.[0] ?? null;
    const nextIndex = (symbolToIndex(current) + 1) % CYCLE.length;
    const nextSymbol = CYCLE[nextIndex].symbol;
    onChange?.(index, nextSymbol ? [nextSymbol] : []);
  };

  // 뒷부분(하부) 쪽 박스들이 원본 도면에서부터 서로 가까이 몰려있어서, 화면
  // 폭에 맞춰 축소되면 손가락으로 정확히 구분해서 누르기 어렵다는 피드백이
  // 많았음 — 두 손가락 핀치로 확대해서 정확한 위치를 누를 수 있게 한다.
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const resetZoom = () => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.max(1, Math.min(MAX_ZOOM, next));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
    .minPointers(2)
    .maxPointers(2)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const zoomGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedZoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View>
      {!readonly && (
        <View style={styles.hintRow}>
          <Text style={styles.hintText}>손가락 두 개로 확대하면 더 정확하게 누를 수 있어요</Text>
          <TouchableOpacity onPress={resetZoom} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="scan-outline" size={16} color="#999" />
          </TouchableOpacity>
        </View>
      )}
      <View style={{ width: screenWidth, height: containerHeight, overflow: 'hidden' }}>
        <GestureDetector gesture={zoomGesture}>
          <Animated.View style={[{ width: screenWidth, height: containerHeight }, animatedZoomStyle]}>
            {/* ── SVG 배경 ── */}
            <EvaluationSvg width={screenWidth} height={containerHeight} />

            {/* ── 손상 체크 박스들 ── */}
            {CHECK_POSITIONS.map((pos, index) => {
              const current   = checkedDamages[index]?.[0] ?? null;
              const state     = CYCLE[symbolToIndex(current)];
              const hasSymbol = !!state.symbol;

              return (
                <TouchableOpacity
                  key={index}
                  disabled={readonly}
                  onPress={() => handleTap(index)}
                  hitSlop={{ top: MIN_HIT_SLOP, bottom: MIN_HIT_SLOP, left: MIN_HIT_SLOP, right: MIN_HIT_SLOP }}
                  style={[
                    styles.checkBox,
                    {
                      left:            widthRatio * pos.x,
                      top:             heightRatio * pos.y,
                      width:           boxSize,
                      height:          boxSize,
                      borderRadius:    boxSize / 2,
                      borderColor:     state.border,
                      backgroundColor: state.bgColor,
                    },
                  ]}
                >
                  {hasSymbol ? (
                    <Text style={[
                      styles.symbolText,
                      { color: SYMBOL_TEXT_COLOR[state.symbol!], fontSize: boxSize * 0.52 },
                    ]}>
                      {state.label}
                    </Text>
                  ) : (
                    <Text style={[styles.emptyText, { fontSize: boxSize * 0.3 }]}>
                      {index + 1}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  checkBox: {
    position: 'absolute',
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  symbolText: { fontWeight: 'bold' },
  emptyText: { color: 'rgba(255,255,255,0.55)', fontWeight: '600' },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  hintText: { color: '#888', fontSize: 11.5 },
});

// SVG + 37개 터치 영역을 그리는 무거운 컴포넌트라, 부모(폼 전체)가 리렌더될 때마다
// (타이핑, 백그라운드 업로드 진행률 등) 같이 다시 그려지면 렉이 심하다.
// checkedDamages/onChange가 실제로 바뀔 때만 리렌더되도록 memo로 막는다.
export default React.memo(CarEvaluationDamageChecker);
