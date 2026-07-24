import { Ionicons } from "@expo/vector-icons";
import * as ImageManipulator from "expo-image-manipulator";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Polygon } from "react-native-svg";
import ViewShot from "react-native-view-shot";

type Tool = "circle" | "arrow" | "pen" | "blur";

type ShapeItem =
  | { id: string; type: "circle"; cx: number; cy: number; r: number }
  | { id: string; type: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { id: string; type: "pen"; d: string }
  | { id: string; type: "blur"; x: number; y: number; w: number; h: number; pixelUri?: string; loading?: boolean };

interface Props {
  visible: boolean;
  uri: string | null;
  onCancel: () => void;
  onSave: (newUri: string) => void;
}

const SCREEN_W = Dimensions.get("window").width;
const SCREEN_H = Dimensions.get("window").height;
const TOOLBAR_H = 64;
const HEADER_H = 56;
const MAX_ZOOM = 4;

// 드래그로 지정한 사각형 영역을 실제 원본 이미지에서 잘라 아주 작게 축소했다가
// 다시 키워서 모자이크(블러 느낌)를 만든다 — BlurView처럼 화면 캡처와 겹쳐서
// 안 찍히는 문제 없이, 그냥 비트맵 이미지라 최종 캡처에 항상 그대로 합성된다.
async function makePixelPatch(
  sourceUri: string,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
): Promise<string> {
  const tiny = await ImageManipulator.manipulateAsync(
    sourceUri,
    [
      { crop: { originX: Math.round(cropX), originY: Math.round(cropY), width: Math.round(cropW), height: Math.round(cropH) } },
      { resize: { width: 10 } },
    ],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
  );
  const big = await ImageManipulator.manipulateAsync(
    tiny.uri,
    [{ resize: { width: Math.round(cropW), height: Math.round(cropH) } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
  return big.uri;
}

export default function PhotoAnnotator({ visible, uri, onCancel, onSave }: Props) {
  const insets = useSafeAreaInsets();
  const [tool, setTool] = useState<Tool>("circle");
  const [items, setItems] = useState<ShapeItem[]>([]);
  const [draft, setDraft] = useState<ShapeItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [imgLayout, setImgLayout] = useState({ width: SCREEN_W, height: SCREEN_W });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const shotRef = useRef<ViewShot>(null);
  const startPoint = useRef({ x: 0, y: 0 });
  const penD = useRef("");

  // 확대/이동은 화면에 보여지는 용도일 뿐 — shotRef는 이 변환이 안 걸린 안쪽 뷰에 달아서
  // "완료" 눌렀을 때 확대 상태와 무관하게 항상 사진 전체가 원래 배율로 저장되게 한다.
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

  useEffect(() => {
    setItems([]);
    setDraft(null);
    setTool("circle");
    resetZoom();
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => {
        setNaturalSize({ width: w, height: h });
        const maxH = SCREEN_H - HEADER_H - TOOLBAR_H - insets.top - insets.bottom;
        let displayW = SCREEN_W;
        let displayH = (h / w) * displayW;
        if (displayH > maxH) {
          displayH = maxH;
          displayW = (w / h) * displayH;
        }
        setImgLayout({ width: displayW, height: displayH });
      },
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 두 손가락(핀치/이동)은 여기서 가로채지 않고 확대 제스처로 넘긴다 —
  // 한 손가락일 때만 그리기 도구로 처리
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 1,
      onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 1,
      onPanResponderGrant: (evt) => {
        const { locationX: x, locationY: y } = evt.nativeEvent;
        startPoint.current = { x, y };
        if (tool === "pen") {
          penD.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
          setDraft({ id: "draft", type: "pen", d: penD.current });
        } else if (tool === "circle") {
          setDraft({ id: "draft", type: "circle", cx: x, cy: y, r: 1 });
        } else if (tool === "arrow") {
          setDraft({ id: "draft", type: "arrow", x1: x, y1: y, x2: x, y2: y });
        } else if (tool === "blur") {
          setDraft({ id: "draft", type: "blur", x, y, w: 1, h: 1 });
        }
      },
      onPanResponderMove: (evt) => {
        if (evt.nativeEvent.touches.length !== 1) return;
        const { locationX: x, locationY: y } = evt.nativeEvent;
        const sx = startPoint.current.x;
        const sy = startPoint.current.y;
        if (tool === "pen") {
          penD.current += ` L${x.toFixed(1)},${y.toFixed(1)}`;
          setDraft({ id: "draft", type: "pen", d: penD.current });
        } else if (tool === "circle") {
          const r = Math.hypot(x - sx, y - sy);
          setDraft({ id: "draft", type: "circle", cx: sx, cy: sy, r });
        } else if (tool === "arrow") {
          setDraft({ id: "draft", type: "arrow", x1: sx, y1: sy, x2: x, y2: y });
        } else if (tool === "blur") {
          setDraft({
            id: "draft",
            type: "blur",
            x: Math.min(sx, x),
            y: Math.min(sy, y),
            w: Math.abs(x - sx),
            h: Math.abs(y - sy),
          });
        }
      },
      onPanResponderRelease: () => {
        setDraft((d) => {
          if (!d) return null;
          // 너무 작은(실수로 탭만 한) 도형은 버린다
          if (d.type === "circle" && d.r < 4) return null;
          if (d.type === "blur" && (d.w < 6 || d.h < 6)) return null;
          if (d.type === "arrow" && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 4) return null;

          const finalItem: ShapeItem = { ...d, id: genId() };
          setItems((prev) => [...prev, finalItem]);

          if (finalItem.type === "blur" && uri && naturalSize) {
            const scaleX = naturalSize.width / imgLayout.width;
            const scaleY = naturalSize.height / imgLayout.height;
            const b = finalItem as Extract<ShapeItem, { type: "blur" }>;
            setItems((prev) => prev.map((it) => (it.id === b.id ? { ...it, loading: true } : it)));
            makePixelPatch(uri, b.x * scaleX, b.y * scaleY, b.w * scaleX, b.h * scaleY)
              .then((pixelUri) => {
                setItems((prev) => prev.map((it) => (it.id === b.id ? { ...it, pixelUri, loading: false } : it)));
              })
              .catch(() => {
                setItems((prev) => prev.map((it) => (it.id === b.id ? { ...it, loading: false } : it)));
              });
          }
          return null;
        });
      },
    }),
  ).current;

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

  const handleUndo = () => setItems((prev) => prev.slice(0, -1));

  const handleSave = async () => {
    if (!shotRef.current?.capture) return;
    setSaving(true);
    try {
      const capturedUri = await shotRef.current.capture();
      onSave(capturedUri.startsWith("file://") ? capturedUri : `file://${capturedUri}`);
    } catch (e) {
      console.error("[PhotoAnnotator] capture 실패:", e);
    } finally {
      setSaving(false);
    }
  };

  const renderShape = (item: ShapeItem) => {
    if (item.type === "circle") {
      return <Circle key={item.id} cx={item.cx} cy={item.cy} r={item.r} stroke="#ff3b30" strokeWidth={4} fill="none" />;
    }
    if (item.type === "arrow") {
      const angle = Math.atan2(item.y2 - item.y1, item.x2 - item.x1);
      const headLen = 16;
      const p1 = {
        x: item.x2 - headLen * Math.cos(angle - Math.PI / 7),
        y: item.y2 - headLen * Math.sin(angle - Math.PI / 7),
      };
      const p2 = {
        x: item.x2 - headLen * Math.cos(angle + Math.PI / 7),
        y: item.y2 - headLen * Math.sin(angle + Math.PI / 7),
      };
      return (
        <React.Fragment key={item.id}>
          <Line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke="#ff3b30" strokeWidth={4} />
          <Polygon points={`${item.x2},${item.y2} ${p1.x},${p1.y} ${p2.x},${p2.y}`} fill="#ff3b30" />
        </React.Fragment>
      );
    }
    if (item.type === "pen") {
      return <Path key={item.id} d={item.d} stroke="#ff3b30" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    }
    return null;
  };

  const TOOLS: { id: Tool; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { id: "circle", icon: "ellipse-outline", label: "원" },
    { id: "arrow", icon: "arrow-up-outline", label: "화살표" },
    { id: "pen", icon: "pencil-outline", label: "펜" },
    { id: "blur", icon: "square-outline", label: "블러" },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>취소</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>사진 표시하기</Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {/* 리애니메이티드 shared value는 읽어도 리렌더를 안 일으켜서 조건부 노출 대신 항상 노출 —
                확대 안 된 상태에서 눌러도 resetZoom은 그냥 아무 변화 없이 끝나 무해함 */}
            <TouchableOpacity onPress={resetZoom} style={styles.headerBtn}>
              <Ionicons name="scan-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleUndo} style={styles.headerBtn} disabled={items.length === 0}>
              <Ionicons name="arrow-undo-outline" size={22} color={items.length === 0 ? "#555" : "#fff"} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.canvasWrap}>
          {uri && (
            <GestureDetector gesture={zoomGesture}>
              <Animated.View style={[{ width: imgLayout.width, height: imgLayout.height }, animatedZoomStyle]}>
                <ViewShot ref={shotRef} style={{ width: imgLayout.width, height: imgLayout.height }} options={{ format: "jpg", quality: 0.9 }}>
                  <View style={{ width: imgLayout.width, height: imgLayout.height }} {...panResponder.panHandlers}>
                    <Image source={{ uri }} style={{ width: imgLayout.width, height: imgLayout.height }} resizeMode="cover" />
                    {items
                      .filter((it): it is Extract<ShapeItem, { type: "blur" }> => it.type === "blur")
                      .map((b) =>
                        b.pixelUri ? (
                          <Image
                            key={b.id}
                            source={{ uri: b.pixelUri }}
                            style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h }}
                          />
                        ) : (
                          <View
                            key={b.id}
                            style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" }}
                          >
                            {b.loading && <ActivityIndicator size="small" color="#fff" />}
                          </View>
                        ),
                      )}
                    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                      {items.filter((it) => it.type !== "blur").map(renderShape)}
                      {draft && draft.type !== "blur" && renderShape(draft)}
                    </Svg>
                    {draft && draft.type === "blur" && (
                      <View
                        style={{ position: "absolute", left: draft.x, top: draft.y, width: draft.w, height: draft.h, backgroundColor: "rgba(0,0,0,0.4)" }}
                      />
                    )}
                  </View>
                </ViewShot>
              </Animated.View>
            </GestureDetector>
          )}
        </View>
        <Text style={styles.zoomHint}>두 손가락으로 확대/이동 · 한 손가락으로 그리기</Text>

        <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {TOOLS.map((t) => (
            <TouchableOpacity
              key={t.id}
              onPress={() => setTool(t.id)}
              style={[styles.toolBtn, tool === t.id && styles.toolBtnActive]}
            >
              <Ionicons name={t.icon} size={20} color={tool === t.id ? "#000" : "#fff"} />
              <Text style={[styles.toolLabel, tool === t.id && styles.toolLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={handleSave} style={styles.saveBtn} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.saveBtnText}>완료</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  header: {
    height: HEADER_H,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  headerBtn: { padding: 6, minWidth: 40, alignItems: "center" },
  headerBtnText: { color: "#fff", fontSize: 15 },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  canvasWrap: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  zoomHint: { color: "#666", fontSize: 11, textAlign: "center", paddingVertical: 6 },
  toolbar: {
    minHeight: TOOLBAR_H,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#222",
  },
  toolBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#1c1c1e",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 4,
  },
  toolBtnActive: { backgroundColor: "#fff" },
  toolLabel: { color: "#fff", fontSize: 11, fontWeight: "600" },
  toolLabelActive: { color: "#000" },
  saveBtn: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: "#ff3b30",
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
