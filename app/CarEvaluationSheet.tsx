/**
 * CarEvaluationSheet.tsx
 *
 * DiagnosisInspection 스타일/구조 기반으로 CarEvaluationSheet 로직 통합
 *
 * 사용 패키지 (DiagnosisInspection 기준):
 *   expo install expo-image-picker expo-media-library
 *   npm install @react-native-async-storage/async-storage
 *   npm install react-native-draggable-flatlist react-native-gesture-handler
 *   npm install @expo/vector-icons
 */

import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ImageViewer from "react-native-image-zoom-viewer"; // 👈 이름 주의!
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import CarEvaluationDamageChecker from "../components/CarEvaluationDamageChecker";
import PhotoAnnotator from "../components/PhotoAnnotator";

// ─── 상수 ─────────────────────────────────────────────────────────────────────
const { width, height } = Dimensions.get("window");
const API_BASE_URL = "https://carvior.store/api/v1";
const TILE_SIZE = 85;

// ─── 전역 업로드 싱글톤 (컴포넌트 언마운트 후에도 계속 실행됨) ─────────────────
interface _UploadTask {
  uri: string;
  categoryId: string;
  requestId: string;
  carNumber: string;
}
const SINGLE_IMG_CATS = ['dashboard', 'registration', 'vin', 'extra_memo'];
// 계기판/등록증/보험이력 — images 맵이 아니라 dashboardImage/regImage/vinImage 별도 state로
// 관리되는 진짜 "단일 슬롯" 카테고리만. extra_memo는 여기 포함하면 안 됨(별도 배열 state라
// SINGLE_IMG_CATS와 처리 로직이 다름).
const SINGLE_SLOT_CATS = ['dashboard', 'registration', 'vin'];

const _G = {
  queue: [] as _UploadTask[],
  active: 0,
  submittedId: null as string | null,
  onResult: null as unknown as
    | ((uri: string, url: string, cat: string) => void)
    | undefined,
  onCount: null as unknown as ((n: number) => void) | undefined,
  onClassified: null as unknown as
    | ((from: string, to: string, label: string) => void)
    | undefined,
  onFailed: null as unknown as ((task: _UploadTask) => void) | undefined,
  // 뒤로가기로 화면이 언마운트된 "사이"에 끝난 업로드는 onResult/onFailed 콜백이 없어서
  // 결과가 조용히 버려졌었다(화면이 영원히 "업로드중"으로 멈춰 보이거나, 다시 들어왔을 때
  // 사진 수가 줄어 보이는 원인). 콜백과 별개로 여기 완료/실패 이력을 남겨두고, 화면이
  // 다시 마운트될 때 이걸로 상태를 맞춘다(reconcileWithBackgroundQueue 참고).
  completed: new Map<string, { s3url: string; cat: string; requestId: string }>(),
  failed: new Map<string, { categoryId: string; requestId: string }>(),
};

const _sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 실측(50장): 병렬 5개는 19.3초·순서역전 12회, 싱글 I/O는 46.5초·역전 0회였는데,
// 역전의 진짜 원인은 동시성 자체가 아니라 flushResults가 완료된 사진을 "끝에 추가"하던
// 방식이었음 — 선택 시점에 이미 놓인 자리에 그대로 바꿔치기하도록 고쳐서 병렬로도 순서가
// 항상 보존되므로 다시 5로 되돌림.
const MAX_CONCURRENT_UPLOADS = 5;

// 현장 네트워크가 불안정할 수 있어 업로드 실패 시 3회까지 재시도한다.
// 그래도 실패하면 조용히 사라지지 않고 onFailed로 알려서 UI에서 재시도할 수 있게 한다.
const _runTask = async (task: _UploadTask, attempt = 1): Promise<void> => {
  const formData = new FormData();
  // @ts-ignore
  formData.append("file", {
    uri: task.uri,
    name: `photo_${Date.now()}.jpg`,
    type: "image/jpeg",
  });
  formData.append("requestId", task.requestId);
  formData.append("category", task.categoryId);
  formData.append("carNumber", task.carNumber || "미등록");
  try {
    const res = await fetch(`${API_BASE_URL}/external/inspection/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const data = await res.json();
    const s3url: string = data.url;
    if (!s3url) throw new Error("no url in response");

    // 평가사가 순서대로 촬영한 걸 개수 기준으로 미리 배정한 카테고리를 그대로 신뢰한다.
    // 현장 업로드 속도가 우선이라 사진마다 AI 분석을 태우지 않는다(대역폭 경쟁 방지).
    const finalCat = task.categoryId;

    _G.completed.set(task.uri, { s3url, cat: finalCat, requestId: task.requestId });
    _G.onResult?.(task.uri, s3url, finalCat);
    if (_G.submittedId === task.requestId) {
      fetch(`${API_BASE_URL}/external/inspection/${task.requestId}/photo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: finalCat, url: s3url }),
      }).catch(() => {});
    }
  } catch (_e) {
    if (attempt < 3) {
      await _sleep(1500 * attempt);
      return _runTask(task, attempt + 1);
    }
    _G.failed.set(task.uri, { categoryId: task.categoryId, requestId: task.requestId });
    _G.onFailed?.(task);
  }
};

const _processQueue = () => {
  while (_G.active < MAX_CONCURRENT_UPLOADS && _G.queue.length > 0) {
    const task = _G.queue.shift()!;
    _G.active++;
    _runTask(task).finally(() => {
      _G.active--;
      _G.onCount?.(_G.active + _G.queue.length);
      _processQueue();
    });
  }
};

const globalEnqueue = (task: _UploadTask) => {
  _G.queue.push(task);
  _G.onCount?.(_G.active + _G.queue.length);
  _processQueue();
};

// 검수(INSPECTION) 35개, 진단평가(EVALUATION) 37개
const DAMAGE_BOX_COUNT = { INSPECTION_DELIVERY: 35, EVALUATION_DELIVERY: 37 };

// 차량 상태 심볼 목록
const EXTERIOR_SYMBOLS = [
  { symbol: "X", meaning: "교환" },
  { symbol: "W", meaning: "용접" },
  { symbol: "B", meaning: "판금" },
  { symbol: "M", meaning: "탈부착/조정" },
  { symbol: "A", meaning: "흠집" },
  { symbol: "U", meaning: "요철" },
  { symbol: "T", meaning: "깨짐" },
  { symbol: "C", meaning: "부식" },
  { symbol: "P", meaning: "도장필요" },
];

// 사진 카테고리 (DiagnosisInspection 구조 유지)
const CATEGORIES = [
  { id: "exterior", label: "외관", min: 4 },
  { id: "wheel", label: "휠", min: 4 },
  { id: "undercarriage", label: "하체", min: 2 },
  { id: "interior", label: "실내", min: 5 },
  { id: "engine", label: "엔진룸", min: 1 },
  { id: "extra", label: "옵션", min: 1 },
  { id: "damage", label: "내외판 데미지", min: 1 },
];

// 진단평가사가 촬영하는 순서(외관→실내→휠&타이어→옵션→엔진룸→하부/기타누유) 그대로
// 개수 기준으로 카테고리를 배정한다. 정해진 개수를 넘어가는 사진은 전부 내외판 데미지로 간다.
// AI 분류는 이 배정을 덮어쓰지 않고, 실제와 다를 때 피드백으로만 쌓인다(_runTask 참고).
const POOL_SEQUENCE: { id: string; count: number }[] = [
  { id: "exterior", count: 6 },
  { id: "wheel", count: 8 },
  { id: "interior", count: 10 },
  { id: "extra", count: 10 },
  { id: "engine", count: 1 },
  { id: "undercarriage", count: 10 },
];
const POOL_CATEGORY_IDS = [...POOL_SEQUENCE.map((s) => s.id), "damage"];

const categoryForPosition = (pos: number): string => {
  let acc = 0;
  for (const seg of POOL_SEQUENCE) {
    acc += seg.count;
    if (pos <= acc) return seg.id;
  }
  return "damage";
};

// 이미 올라간 풀 사진 개수(전 카테고리 합) 기준으로 이번에 추가되는 사진들의 카테고리를 순서대로 배정
const assignPoolCategories = (
  images: { [key: string]: string[] },
  newUris: string[],
): string[] => {
  const already = POOL_CATEGORY_IDS.reduce(
    (sum, id) => sum + (images[id]?.length || 0),
    0,
  );
  return newUris.map((_, i) => categoryForPosition(already + i + 1));
};

// ─── 타입 ─────────────────────────────────────────────────────────────────────
type MirrorMarkers = {
  driverCover: string[];
  driverMirror: string[];
  driverRepeater: string[];
  passengerCover: string[];
  passengerMirror: string[];
  passengerRepeater: string[];
};

type SymbolItem = { symbol: string; meaning: string; isSelected: boolean };

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
const formatNumber = (val: string) =>
  val.replace(/[^0-9]/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const onlyS3 = (urls: string[]) =>
  (urls || []).filter((url) => url.startsWith("http"));

// 그리드 썸네일 하나당 useVideoPlayer 훅이 필요해서(.map 콜백 안에서는 훅 호출 불가)
// 별도 컴포넌트로 분리 — 음소거 미리보기, 탭하면 부모가 전체화면 모달을 띄움
function VideoGridThumb({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

// 전체화면 재생 모달 전용 — 열릴 때만 마운트되고 자동재생
function VideoFullscreenPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={{ flex: 1 }}
      contentFit="contain"
      nativeControls
    />
  );
}

// 이상확인 영상 자체 촬영 — 시스템 카메라 앱(ImagePicker)에 위임하면 videoMaxDuration을
// 기종/제조사 카메라 앱이 무시하는 경우가 있어(특히 삼성), 우리 앱 안에서 직접 CameraView로
// 찍고 recordAsync의 maxDuration으로 확실하게 15초에서 끊는다.
const ISSUE_VIDEO_MAX_SEC = 15;

function IssueVideoRecorderModal({
  visible,
  onClose,
  onRecorded,
}: {
  visible: boolean;
  onClose: () => void;
  onRecorded: (uri: string) => void;
}) {
  const cameraRef = useRef<CameraView>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(ISSUE_VIDEO_MAX_SEC);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (!camPerm?.granted) requestCamPerm();
    if (!micPerm?.granted) requestMicPerm();
  }, [visible]);

  const clearCountdown = () => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = null;
  };

  const startRecording = async () => {
    if (!cameraRef.current || recording) return;
    setRecording(true);
    setCountdown(ISSUE_VIDEO_MAX_SEC);
    countdownTimer.current = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: ISSUE_VIDEO_MAX_SEC });
      clearCountdown();
      setRecording(false);
      if (video?.uri) onRecorded(video.uri);
      onClose();
    } catch (e) {
      console.error("🔥 영상 촬영 실패:", e);
      clearCountdown();
      setRecording(false);
    }
  };

  const stopRecording = () => {
    cameraRef.current?.stopRecording();
  };

  if (!visible) return null;

  const permsGranted = camPerm?.granted && micPerm?.granted;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={recording ? undefined : onClose}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {permsGranted ? (
          // 진단용 영상은 화질보다 발열/버벅임 방지가 우선이라 720p로 낮춰서 인코딩 부하를 줄임
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            mode="video"
            facing="back"
            mute={false}
            videoQuality="720p"
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
            <Text style={{ color: "#fff", textAlign: "center" }}>
              영상 촬영을 위해 카메라/마이크 접근 권한이 필요합니다.
            </Text>
          </View>
        )}

        {!recording && (
          <TouchableOpacity
            style={{ position: "absolute", top: 50, left: 20 }}
            onPress={onClose}
          >
            <Ionicons name="close-circle" size={36} color="#fff" />
          </TouchableOpacity>
        )}

        {recording && (
          <View
            style={{
              position: "absolute", top: 50, alignSelf: "center",
              backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 16 }}>{countdown}초 남음</Text>
          </View>
        )}

        <View style={{ position: "absolute", bottom: 60, alignSelf: "center", alignItems: "center" }}>
          {permsGranted && (
            <TouchableOpacity
              onPress={recording ? stopRecording : startRecording}
              style={{
                width: 76, height: 76, borderRadius: recording ? 14 : 38,
                backgroundColor: "#e53e3e", borderWidth: 5, borderColor: "#fff",
              }}
            />
          )}
          <Text style={{ color: "#fff", marginTop: 12, fontSize: 13 }}>
            {recording ? "탭하면 바로 정지" : `탭해서 촬영 시작 (최대 ${ISSUE_VIDEO_MAX_SEC}초)`}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────────
export default function CarEvaluationSheet() {
  const { requestId, carNumber: carNumberParam, carModel: carModelParam, serviceType, mode, adminRequest, listingUrl } =
    useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // 간편신청(B2B)에서 "미정"으로 접수된 차량번호/차주 성함을 평가사가 현장에서 알게 되면
  // 여기서 바로 고칠 수 있게 한다 — 로컬 상태로 시작해서 이후 모든 곳(업로드/제출 등)에
  // 이 값을 그대로 쓰도록 route param을 초기값으로만 쓰는 로컬 state로 바꿨다.
  const [carNumber, setCarNumber] = useState(String(carNumberParam || ""));
  const [carOwner, setCarOwner] = useState("");
  const [carModel, setCarModel] = useState(String(carModelParam || ""));
  const [carEditVisible, setCarEditVisible] = useState(false);
  const [carEditNumber, setCarEditNumber] = useState("");
  const [carEditOwner, setCarEditOwner] = useState("");
  const [carEditModel, setCarEditModel] = useState("");
  const [savingCarInfo, setSavingCarInfo] = useState(false);

  // serviceType: 'INSPECTION_DELIVERY' | 'EVALUATION_DELIVERY'
  const isInspection = serviceType === "INSPECTION_DELIVERY";
  const isEditMode = mode === "edit";
  const isViewMode = mode === "view";
  // 연습 모드 — 평가사가 실제 진단 화면 흐름을 미리 익혀볼 수 있게 하되,
  // 서버에는 아무것도 저장/업로드하지 않는다(사진도 실제 S3에 안 올라감).
  const isPractice = mode === "practice";
  const STORAGE_KEY = `evaluation_data_${requestId}`;

  // ── 기본 정보 ────────────────────────────────────────────────────────────
  const [evaluationStarted, setEvaluationStarted] = useState(false);
  const [paperSheet, setPaperSheet] = useState(false);

  // ── 단일 이미지 (기본 사진) ───────────────────────────────────────────────
  const [dashboardImage, setDashboardImage] = useState<string | null>(null); // 계기판
  const [regImage, setRegImage] = useState<string | null>(null); // 자동차등록증
  const [vinImage, setVinImage] = useState<string | null>(null); // 차대번호(라벨)

  // 확인사항(경고등/옵션/누유) 항목별 첨부사진 — "기타의견" 사진첩과 안 섞이게
  // 항목별로 따로 관리, 각 항목당 최대 3장. 주행중 이상/엔진룸 이상은 텍스트+사진 대신
  // 아래 "영상 추가"(엔진 이음/조향 이음/옵션작동 이상 등) 하나로 통합됨.
  const MAX_CHECKLIST_PHOTOS = 3;
  const [checklistPhotos, setChecklistPhotos] = useState<Record<string, string[]>>({
    warning: [],
    options: [],
    leak: [],
  });

  // 영상 추가 (엔진 이음/조향 이음/옵션작동 이상 등, 한 건만 등록 — 재촬영 시 교체)
  const [issueVideo, setIssueVideo] = useState<string | null>(null); // 업로드 중엔 로컬 URI, 완료되면 S3 URL
  const [issueVideoUploading, setIssueVideoUploading] = useState(false);
  const [issueVideoModalVisible, setIssueVideoModalVisible] = useState(false);
  const [issueVideoRecorderVisible, setIssueVideoRecorderVisible] = useState(false);

  // 1. 상단에 추가할 상태값 (컴포넌트 내부)
  const [extraPhotos, setExtraPhotos] = useState<string[]>([]);

  // ── 카테고리별 다중 이미지 ────────────────────────────────────────────────
  const [images, setImages] = useState<{ [key: string]: string[] }>({
    exterior: [],
    wheel: [],
    undercarriage: [],
    interior: [],
    engine: [],
    extra: [],
    damage: [],
    paperSheet: [],
  });

  // ── 차량 정보 ────────────────────────────────────────────────────────────
  const [mileage, setMileage] = useState("");
  const [color, setColor] = useState("");
  const [repairCost, setRepairCost] = useState(""); // 검수 전용

  // ── 차키 텍스트 ──────────────────────────────────────────────────────────
  const [keyNote, setKeyNote] = useState("");
  // ── 차키 카운트 ──────────────────────────────────────────────────────────
  const [smartKey, setSmartKey] = useState(0);
  const [generalKey, setGeneralKey] = useState(0);
  const [foldingKey, setFoldingKey] = useState(0);
  const [specialKey, setSpecialKey] = useState(0);

  // ── 외관 수치 ────────────────────────────────────────────────────────────
  const [paintNeeded, setPaintNeeded] = useState(0);
  const [wheelScratch, setWheelScratch] = useState(0);
  const [frontTire, setFrontTire] = useState(50);
  const [backTire, setBackTire] = useState(50);

  // ── 체크박스 항목 ─────────────────────────────────────────────────────────
  const [showWarning, setShowWarning] = useState(false);
  const [showLeak, setShowLeak] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [warningDesc, setWarningDesc] = useState("");
  const [leakDesc, setLeakDesc] = useState("");
  const [optionsDesc, setOptionsDesc] = useState("");

  // ── 기타 메모 ────────────────────────────────────────────────────────────
  const [memo, setMemo] = useState("");
  // 기타의견 TextInput은 defaultValue(비제어)를 쓰는데, 이건 "최초 마운트 시점" 값만
  // 반영하고 이후 memo state가 바뀌어도 화면엔 반영이 안 됨 — loadSavedData/loadEditData가
  // 마운트 후 비동기로 저장된 memo를 복원해도 입력창엔 안 보이던 버그의 원인이었음.
  // 복원이 끝난 뒤 이 값을 바꿔서 TextInput을 한 번 강제로 다시 마운트시켜 반영한다.
  const [dataLoaded, setDataLoaded] = useState(false);
  const memoRef = useRef(""); // 타이핑 중 최신값 (state 업데이트 없이 추적)
  // onBlur나 뒤로가기 버튼 탭에만 저장을 의존하면, 시스템/제스처 뒤로가기처럼
  // 그 핸들러를 아예 안 타는 경로로 나갈 때 저장이 안 되고 사라짐 — 어떻게 나가든
  // 안전하도록 타이핑 멈추면 알아서 백그라운드 저장되게 별도 디바운스 타이머를 둔다
  const memoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [memoHeight, setMemoHeight] = useState(100); // 줄바꿈 많은 입력도 잘리지 않게 내용에 맞춰 자동으로 늘어남
  // 확인사항(경고등/옵션/누유)의 상세 입력창도 동일하게 내용에 맞춰 늘어나도록 —
  // idx별로 따로 관리(항목마다 길이가 다를 수 있음)
  const [checklistFieldHeights, setChecklistFieldHeights] = useState<Record<number, number>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // debounce 타이머
  // 뒤로가기를 연타하면 saveData()가 겹쳐 실행돼서, 나중에 시작된(사진이 더 많이 찍힌) 저장의
  // AsyncStorage 쓰기가 먼저 끝난 저장에 의해 덮어써지는 경우가 있었다 — 한 번 누르면 잠긴다.
  const backNavigatingRef = useRef(false);

  // ── 사이드 미러 마커 ──────────────────────────────────────────────────────
  const [mirrorMarkers, setMirrorMarkers] = useState<MirrorMarkers>({
    driverCover: [],
    driverMirror: [],
    driverRepeater: [],
    passengerCover: [],
    passengerMirror: [],
    passengerRepeater: [],
  });

  // ── 손상 체크 (차량 외관 상태 표시) ──────────────────────────────────────
  const [checkedDamages, setCheckedDamages] = useState<string[][]>([]);

  // ── 이미지 뷰어 ──────────────────────────────────────────────────────────
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  // ── 업로드 카운트 (전역 싱글톤 연동) ────────────────────────────────────
  const [uploadPending, setUploadPending] = useState(0);
  const [failedUploads, setFailedUploads] = useState<{ uri: string; categoryId: string }[]>([]);
  // 시스템 Alert.alert는 안드로이드 DayNight 테마를 그대로 따라가서 이 앱의 다크 UI랑
  // 안 어울리는 흰 팝업으로 뜬다 — 이 화면의 모든 알림을 앱 톤에 맞는 커스텀 모달로 대체.
  // showAlert(title, message, buttons)와 거의 같은 시그니처라 호출부 교체가 쉽다.
  const [customAlert, setCustomAlert] = useState<{
    title: string;
    message: string;
    buttons: { text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }[];
  } | null>(null);
  const showAlert = (
    title: string,
    message: string,
    buttons?: { text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }[],
  ) => {
    setCustomAlert({ title, message, buttons: buttons && buttons.length > 0 ? buttons : [{ text: "확인" }] });
  };
  const [poolVisible, setPoolVisible] = useState(24); // 60장이면 화면에 60개 Image를 동시에 그려서 버벅이므로 페이지네이션
  const [aiToast, setAiToast] = useState<string | null>(null);
  const aiToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<{ uri: string; catId: string; catIdx: number } | null>(null);

  // ─── 차량번호/차주 성함/차량명 수정 ("미정"으로 접수된 건 현장에서 알게 되면 채워넣기) ──
  const openCarEdit = () => {
    setCarEditNumber(carNumber);
    setCarEditOwner(carOwner);
    setCarEditModel(carModel);
    setCarEditVisible(true);
  };

  const saveCarInfo = async () => {
    const nextNumber = carEditNumber.trim();
    if (!nextNumber) {
      showAlert("알림", "차량번호를 입력해주세요.");
      return;
    }
    const nextOwner = carEditOwner.trim() || "미정";
    const nextModel = carEditModel.trim();
    if (isPractice) {
      setCarNumber(nextNumber);
      setCarOwner(nextOwner);
      setCarModel(nextModel);
      setCarEditVisible(false);
      return;
    }
    setSavingCarInfo(true);
    try {
      const res = await fetch(`${API_BASE_URL}/external/request/${requestId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carNumber: nextNumber, carOwner: nextOwner, carModel: nextModel || null }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setCarNumber(nextNumber);
      setCarOwner(nextOwner);
      setCarModel(nextModel);
      setCarEditVisible(false);
    } catch (e) {
      showAlert("오류", "차량정보 저장 중 문제가 발생했습니다.");
    } finally {
      setSavingCarInfo(false);
    }
  };

  // 로컬 URI → S3 교체 후 피드백 전송 대기 큐
  // { localUri, aiCategory, correctCategory }
  const pendingFeedbacks = useRef<{ localUri: string; aiCategory: string; correctCategory: string }[]>([]);

  // 60장 업로드 중엔 완료 콜백이 초당 여러 번 튀는데, 매번 setImages/setUploadPending로
  // 전체(3000줄) 폼을 리렌더하면 체크박스/토글 탭 반응이 버벅인다.
  // 결과를 모아뒀다가 350ms마다 한 번씩만 상태를 갱신한다(업로드 자체 속도는 그대로).
  const pendingResults = useRef<{ uri: string; s3url: string; cat: string }[]>([]);
  const resultFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestUploadCount = useRef(0);

  // "전체 초기화" 시점에 아직 업로드 중이던(로컬 URI만 있고 S3 URL이 없던) 사진들의 uri 모음.
  // 초기화 이후에 뒤늦게 업로드가 끝나도 화면에 되살아나지 않게 막고, 그 S3 파일도 바로 지운다.
  const discardedUris = useRef<Set<string>>(new Set());
  const countFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 모아둔 완료 결과를 한 번에 반영 — 업로드 여러 장이 거의 동시에 끝나도
    // setImages/setExtraPhotos 호출은 최대 350ms에 한 번으로 묶는다.
    const flushResults = () => {
      resultFlushTimer.current = null;
      const batch = pendingResults.current;
      pendingResults.current = [];
      if (batch.length === 0) return;

      // "전체 초기화" 이후 뒤늦게 완료된 업로드는 화면에 되살리지 않고, 방금 올라간
      // S3 파일도 바로 지워서 고아 파일로 안 남게 한다.
      const discarded = batch.filter((b) => discardedUris.current.has(b.uri));
      if (discarded.length > 0) {
        discarded.forEach((b) => discardedUris.current.delete(b.uri));
        discarded.forEach((b) => {
          fetch(`${API_BASE_URL}/external/inspection/upload?url=${encodeURIComponent(b.s3url)}`, {
            method: "DELETE",
          }).catch(() => {});
        });
      }
      const live = batch.filter((b) => !discarded.includes(b));

      const extraMemoBatch = live.filter((b) => b.cat === "extra_memo");
      const normalBatch = live.filter((b) => b.cat !== "extra_memo");

      if (extraMemoBatch.length > 0) {
        setExtraPhotos((prev) => {
          let next = prev;
          extraMemoBatch.forEach(({ uri, s3url }) => {
            next = next.map((img) => (img === uri ? s3url : img));
          });
          return next;
        });
      }
      if (normalBatch.length > 0) {
        setImages((prev) => {
          const updated = { ...prev };
          normalBatch.forEach(({ uri, s3url, cat }) => {
            // 선택한 순간 이미 해당 카테고리의 정확한 위치에 로컬 URI가 놓여 있으므로,
            // 업로드가 어떤 순서로 끝나든 "그 자리"에서 S3 URL로 바꿔치기만 하면 순서가
            // 항상 선택 순서 그대로 유지된다(병렬 업로드로 완료 순서가 뒤섞여도 무관).
            const idx = (updated[cat] || []).indexOf(uri);
            if (idx !== -1) {
              const arr = [...updated[cat]];
              arr[idx] = s3url;
              updated[cat] = arr;
              return;
            }
            // 드문 예외: AI 재분류 등으로 카테고리가 실제로 바뀐 경우만 기존 자리에서
            // 제거하고 새 카테고리 맨 뒤에 추가(이 경우엔 위치 보존이 원래 불가능)
            for (const key of Object.keys(updated)) {
              if (updated[key].includes(uri)) {
                updated[key] = updated[key].filter((img) => img !== uri);
              }
            }
            updated[cat] = [...(updated[cat] || []), s3url];
          });
          return updated;
        });
      }
    };

    // 컴포넌트 마운트: 콜백 등록
    _G.onResult = (uri, s3url, cat) => {
      // 계기판/등록증/보험이력(단일 슬롯)은 images 맵이 아니라 dashboardImage/regImage/vinImage
      // 별도 state를 쓰므로 배치 로직을 안 타고 바로 반영한다 — 그 사이 다른 사진으로
      // 교체됐으면(prev !== uri) 덮어쓰지 않는다.
      if (SINGLE_SLOT_CATS.includes(cat)) {
        if (cat === "dashboard") setDashboardImage((prev) => (prev === uri ? s3url : prev));
        else if (cat === "registration") setRegImage((prev) => (prev === uri ? s3url : prev));
        else if (cat === "vin") setVinImage((prev) => (prev === uri ? s3url : prev));
        return;
      }
      // 업로드 완료 시 대기 중인 피드백 있으면 전송
      const pending = pendingFeedbacks.current.filter(f => f.localUri === uri);
      pending.forEach(f => {
        fetch(`${API_BASE_URL}/classify/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: s3url, aiCategory: f.aiCategory, correctCategory: f.correctCategory }),
        }).catch(() => {});
      });
      pendingFeedbacks.current = pendingFeedbacks.current.filter(f => f.localUri !== uri);

      pendingResults.current.push({ uri, s3url, cat });
      if (!resultFlushTimer.current) {
        resultFlushTimer.current = setTimeout(flushResults, 350);
      }
    };
    _G.onCount = (n) => {
      latestUploadCount.current = n;
      if (countFlushTimer.current) return;
      countFlushTimer.current = setTimeout(() => {
        countFlushTimer.current = null;
        setUploadPending(latestUploadCount.current);
      }, 350);
    };
    _G.onClassified = (_from, _to, label) => {
      if (aiToastTimer.current) clearTimeout(aiToastTimer.current);
      setAiToast(`🤖 ${label}(으)로 자동분류됨`);
      aiToastTimer.current = setTimeout(() => setAiToast(null), 3000);
    };
    // 3회 재시도 후에도 실패하면 조용히 사라지지 않고 재시도 버튼으로 노출한다
    // (사진이 조용히 유실되는 것보다 눈에 보이는 실패가 훨씬 낫다). 이미지 상태(images/
    // dashboardImage 등)에서 지우지 않고 그대로 둔다 — 실패한 로컬 썸네일이 계속 보여야
    // failedUploads에 있는지로 "업로드중"과 "실패"를 구분해서 각 타일에 표시할 수 있다.
    _G.onFailed = (task) => {
      // "전체 초기화"로 이미 버려진 사진이면 실패 재시도 UI에 다시 띄우지 않는다
      if (discardedUris.current.has(task.uri)) {
        discardedUris.current.delete(task.uri);
        return;
      }
      setFailedUploads((prev) => [...prev, { uri: task.uri, categoryId: task.categoryId }]);
    };
    return () => {
      // 언마운트 후에도 업로드는 계속, UI 콜백만 해제
      if (resultFlushTimer.current) clearTimeout(resultFlushTimer.current);
      if (countFlushTimer.current) clearTimeout(countFlushTimer.current);
      _G.onResult = undefined;
      _G.onCount = undefined;
      _G.onClassified = undefined;
      _G.onFailed = undefined;
    };
  }, []);

  // 3회 재시도 후에도 실패한 사진들을 한 번에 다시 큐에 올린다 — 실패해도 상태에서 안 지웠으므로
  // failedUploads만 비우고 그대로 다시 큐에 넣으면 된다.
  const handleRetryFailed = () => {
    const toRetry = failedUploads;
    setFailedUploads([]);
    toRetry.forEach((f) => enqueueUpload(f.uri, f.categoryId));
  };

  // 타일 하나만 콕 집어 재시도(실패 표시를 탭했을 때)
  const retryOneFailed = (uri: string, categoryId: string) => {
    setFailedUploads((prev) => prev.filter((f) => f.uri !== uri));
    enqueueUpload(uri, categoryId);
  };

  // uploadUri: fetch에 쓸 URI, displayUri: state에 저장된 표시용 URI (생략 시 uploadUri와 동일)
  const enqueueUpload = (uri: string, categoryId: string) => {
    // 연습 모드는 사진을 실제 서버(S3)에 올리지 않는다 — 로컬에 이미 표시된 상태로 끝
    if (isPractice) return;
    globalEnqueue({
      uri,
      categoryId,
      requestId: String(requestId || ""),
      carNumber: String(carNumber || "미등록"),
    });
  };

  // ── 카테고리 수동 수정 (피드백 학습) ────────────────────────────────────────
  const handleReclassify = async (newCatId: string) => {
    if (!feedbackTarget) return;
    const { uri, catId: oldCatId, catIdx } = feedbackTarget;
    setFeedbackTarget(null);
    if (newCatId === oldCatId) return;

    // 로컬 상태 이동
    setImages(prev => {
      const updated = { ...prev };
      const photo = updated[oldCatId]?.[catIdx];
      if (!photo) return prev;
      updated[oldCatId] = updated[oldCatId].filter((_, i) => i !== catIdx);
      updated[newCatId] = [...(updated[newCatId] || []), photo];
      return updated;
    });

    // 백엔드에 피드백 전송 (학습용)
    if (uri.startsWith("http")) {
      // 이미 S3 URL → 즉시 전송
      fetch(`${API_BASE_URL}/classify/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: uri, aiCategory: oldCatId, correctCategory: newCatId }),
      }).catch(() => {});

      // 서버 사진 카테고리도 업데이트
      if (_G.submittedId) {
        fetch(`${API_BASE_URL}/external/inspection/${_G.submittedId}/photo`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: newCatId, url: uri }),
        }).catch(() => {});
      }
    } else {
      // 아직 업로드 중인 로컬 URI → S3 완료 후 전송 대기 큐에 추가
      pendingFeedbacks.current.push({ localUri: uri, aiCategory: oldCatId, correctCategory: newCatId });
    }

    setAiToast(`✅ ${CATEGORIES.find(c => c.id === newCatId)?.label ?? newCatId}(으)로 수정됨`);
    if (aiToastTimer.current) clearTimeout(aiToastTimer.current);
    aiToastTimer.current = setTimeout(() => setAiToast(null), 2500);
  };

  // ── 사이드 미러 심볼 모달 ─────────────────────────────────────────────────
  const [mirrorModalVisible, setMirrorModalVisible] = useState(false);
  const [mirrorSymbols, setMirrorSymbols] = useState<SymbolItem[]>(
    EXTERIOR_SYMBOLS.map((s) => ({ ...s, isSelected: false })),
  );
  const [mirrorTarget, setMirrorTarget] = useState<keyof MirrorMarkers | null>(
    null,
  );

  // ── 커스텀 앨범 피커 ─────────────────────────────────────────────────────
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerCategoryId, setPickerCategoryId] = useState("");
  const [pickerAlbums, setPickerAlbums] = useState<MediaLibrary.Album[]>([]);
  const [pickerCurrentAlbum, setPickerCurrentAlbum] =
    useState<MediaLibrary.Album | null>(null);
  const [pickerAssets, setPickerAssets] = useState<MediaLibrary.Asset[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  // 갤러리 그리드에서 꾹 눌러 표시(도형/펜/블러)한 사진 — asset.id → 편집 완료된 로컬 파일 URI.
  // confirmPickerSelection에서 원본 대신 이걸 우선 사용한다.
  const [annotatedUris, setAnnotatedUris] = useState<Record<string, string>>({});
  const [annotatorTarget, setAnnotatorTarget] = useState<MediaLibrary.Asset | null>(null);
  const [albumDropdownOpen, setAlbumDropdownOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerEndCursor, setPickerEndCursor] = useState<string | undefined>();
  const [pickerHasMore, setPickerHasMore] = useState(false);

  // ─── edit 모드: 서버에서 기존 데이터 로드 ────────────────────────────────
  const EDIT_LIMIT_MS = 2 * 60 * 60 * 1000; // 2시간

  const loadEditData = async (skipLimitCheck = false) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/external/inspection/report/${requestId}`,
      );
      if (!res.ok) return;
      const d = await res.json();

      // ── 2시간 수정 제한 체크 (view 모드는 생략) ──────────────────────────
      // firstCompletedAt: 최초 진단완료 후 재저장해도 안 바뀌는 고정 기준점.
      // (완료 시각을 계속 갱신하는 completedAt을 쓰면 저장할 때마다 마감이 2시간씩 밀려버림)
      const lockAnchor = d.firstCompletedAt || d.completedAt;
      if (!skipLimitCheck && lockAnchor) {
        const elapsed = Date.now() - new Date(lockAnchor).getTime();
        if (elapsed > EDIT_LIMIT_MS) {
          const hoursAgo = Math.floor(elapsed / 3600000);
          const minutesAgo = Math.floor((elapsed % 3600000) / 60000);
          showAlert(
            "수정 불가",
            `진단 완료 후 2시간이 지나면 수정할 수 없습니다.\n(완료 후 ${hoursAgo}시간 ${minutesAgo}분 경과)`,
            [{ text: "확인", onPress: () => router.back() }],
          );
          return;
        }
      }

      // 기본 정보
      setMileage(String(d.car_info?.mileage ?? ""));
      setColor(d.car_info?.color ?? "");
      setRepairCost(
        d.car_info?.repairCost
          ? formatNumber(String(d.car_info.repairCost))
          : "",
      );

      // 차키
      setSmartKey(d.car_status?.keys?.smart ?? 0);
      setGeneralKey(d.car_status?.keys?.general ?? 0);
      setFoldingKey(d.car_status?.keys?.folding ?? 0);
      setSpecialKey(d.car_status?.keys?.special ?? 0);

      // 외관 수치
      setPaintNeeded(d.car_status?.paintNeeded ?? 0);
      setWheelScratch(d.car_status?.wheelScratch ?? 0);
      setFrontTire(d.car_status?.tireTread?.front ?? 50);
      setBackTire(d.car_status?.tireTread?.back ?? 50);

      // 확인 사항
      const ev = d.evaluation ?? {};
      setShowWarning(ev.warningDesc && ev.warningDesc !== "이상 없음");
      setWarningDesc(
        ev.warningDesc !== "이상 없음" ? (ev.warningDesc ?? "") : "",
      );
      setShowLeak(ev.leakDesc && ev.leakDesc !== "이상 없음");
      setLeakDesc(ev.leakDesc !== "이상 없음" ? (ev.leakDesc ?? "") : "");
      setShowOptions(ev.optionsDesc && ev.optionsDesc !== "이상 없음");
      setOptionsDesc(
        ev.optionsDesc !== "이상 없음" ? (ev.optionsDesc ?? "") : "",
      );
      setMemo(ev.memo ?? "");

      // 이미지
      const imgs = d.images ?? {};
      setDashboardImage(imgs.dashboard?.[0] ?? null);
      setRegImage(imgs.registration?.[0] ?? null);
      setVinImage(imgs.vin?.[0] ?? null);
      setChecklistPhotos(d.checklistPhotos || { warning: [], options: [], leak: [] });
      setIssueVideo(d.videoUrls?.[0] ?? d.engineNoiseVideoUrl ?? null);
      setImages({
        exterior: imgs.exterior ?? [],
        wheel: imgs.wheel ?? [],
        undercarriage: imgs.undercarriage ?? [],
        interior: imgs.interior ?? [],
        engine: imgs.engine ?? [],
        damage: imgs.damage ?? [],
        extra: imgs.extra ?? [],
        paperSheet: [],
      });
      setExtraPhotos(imgs.extraMemo ?? []);

      // 손상 체크 & 미러
      const count = isInspection ? 35 : 37;
      setCheckedDamages(
        d.damages?.length > 0
          ? d.damages
          : Array.from({ length: count }, () => []),
      );
      if (d.mirror_markers) setMirrorMarkers(d.mirror_markers);

      // 이미 완료된 진단이므로 바로 2단계로
      setEvaluationStarted(true);
    } catch (e) {
      console.error("Edit data load error:", e);
    } finally {
      setDataLoaded(true);
    }
  };

  // ─── AsyncStorage 저장/복원 ───────────────────────────────────────────────
  useEffect(() => {
    // adminRequest: 관리자가 재촬영/수정을 요청한 딥링크로 들어온 경우 —
    // 관리자가 명시적으로 수정을 요청한 것이므로 2시간 제한과 무관하게 편집 허용
    // (진단사 본인은 물론, 이 링크를 받은 매니저도 같은 방식으로 편집 가능)
    const isAdminRequest = adminRequest === "1";
    if (isViewMode) {
      loadEditData(true);
    } else if (isEditMode) {
      loadEditData(isAdminRequest);
    } else {
      loadSavedData();
      // "확인 여부"(대시보드 "배정 진단사" 컬럼)는 이제 여기(진단 시작 화면 진입)가 아니라
      // 목록 화면에서 연락하기/시간 변경을 했을 때 기록한다(app/(tabs)/index.tsx의 markDriverSeen).
    }
  }, []);

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveData, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    evaluationStarted,
    paperSheet,
    dashboardImage,
    regImage,
    vinImage,
    checklistPhotos,
    issueVideo,
    images,
    mileage,
    color,
    repairCost,
    keyNote,
    smartKey,
    generalKey,
    foldingKey,
    specialKey,
    paintNeeded,
    wheelScratch,
    frontTire,
    backTire,
    showWarning,
    showLeak,
    showOptions,
    warningDesc,
    leakDesc,
    optionsDesc,
    mirrorMarkers,
    checkedDamages,
    extraPhotos,
    // memo는 onBlur 시에만 저장 (타이핑 중 re-render/AsyncStorage 방지)
  ]);

  const saveData = async () => {
    try {
      const data = {
        evaluationStarted,
        paperSheet,
        dashboardImage,
        regImage,
        vinImage,
        checklistPhotos,
        issueVideo,
        images,
        mileage,
        color,
        repairCost,
        keyNote,
        smartKey,
        generalKey,
        foldingKey,
        specialKey,
        paintNeeded,
        wheelScratch,
        frontTire,
        backTire,
        showWarning,
        showLeak,
        showOptions,
        warningDesc,
        leakDesc,
        optionsDesc,
        // memo state는 onBlur 시에만 갱신되는데, 뒤로가기 등으로 blur가 안 일어난 채
        // 저장이 트리거되면 방금 타이핑한 내용이 아니라 그 전 값으로 덮어써서 사라져
        // 보이는 버그가 있었음 — 항상 최신인 memoRef를 우선 사용
        memo: memoRef.current || memo,
        mirrorMarkers,
        checkedDamages,
        extraPhotos,
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Save Error", e);
    }
  };

  const loadSavedData = async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        setEvaluationStarted(p.evaluationStarted || false);
        setPaperSheet(p.paperSheet || false);
        setDashboardImage(p.dashboardImage || null);
        setRegImage(p.regImage || null);
        setVinImage(p.vinImage || null);
        setChecklistPhotos(p.checklistPhotos || { warning: [], options: [], leak: [] });
        setIssueVideo(p.issueVideo || null);
        setImages(
          p.images || {
            exterior: [],
            wheel: [],
            undercarriage: [],
            interior: [],
            engine: [],
            extra: [],
            damage: [],
            paperSheet: [],
          },
        );
        setMileage(p.mileage || "");
        setColor(p.color || "");
        setRepairCost(p.repairCost || "");
        setKeyNote(p.keyNote || "");
        setSmartKey(p.smartKey || 0);
        setGeneralKey(p.generalKey || 0);
        setFoldingKey(p.foldingKey || 0);
        setSpecialKey(p.specialKey || 0);
        setPaintNeeded(p.paintNeeded || 0);
        setWheelScratch(p.wheelScratch || 0);
        setFrontTire(p.frontTire ?? 50);
        setBackTire(p.backTire ?? 50);
        setShowWarning(p.showWarning || false);
        setShowLeak(p.showLeak || false);
        setShowOptions(p.showOptions || false);
        setWarningDesc(p.warningDesc || "");
        setLeakDesc(p.leakDesc || "");
        setOptionsDesc(p.optionsDesc || "");
        setMemo(p.memo || "");
        setExtraPhotos(p.extraPhotos || []);
        setMirrorMarkers(
          p.mirrorMarkers || {
            driverCover: [],
            driverMirror: [],
            driverRepeater: [],
            passengerCover: [],
            passengerMirror: [],
            passengerRepeater: [],
          },
        );
        const count = isInspection ? 35 : 37;
        setCheckedDamages(
          p.checkedDamages?.length > 0
            ? p.checkedDamages
            : Array.from({ length: count }, () => []),
        );
      } else {
        const count = isInspection ? 35 : 37;
        setCheckedDamages(Array.from({ length: count }, () => []));
      }
    } catch (e) {
      console.error("Load Error", e);
    } finally {
      setDataLoaded(true);
    }
  };

  // 뒤로가기로 화면이 사라진 "사이"에 배경에서 끝난 업로드는 onResult/onFailed 콜백을 받을
  // 대상이 없어서 결과가 버려진다(_G.completed/_G.failed는 남아있음) — 화면이 다시 마운트되고
  // AsyncStorage draft를 복원한 직후, 이 이력으로 로컬 URI를 S3 URL로 바꿔치기하고 실패건도
  // 다시 표시해서 "영원히 업로드중"이나 "몇 장이 사라짐"처럼 보이는 문제를 없앤다.
  const reconcileWithBackgroundQueue = () => {
    const rid = String(requestId || "");
    if (_G.completed.size === 0 && _G.failed.size === 0) return;

    setImages((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = next[key].map((uri) => {
          const done = _G.completed.get(uri);
          if (done && done.requestId === rid) {
            changed = true;
            return done.s3url;
          }
          return uri;
        });
      }
      return changed ? next : prev;
    });
    setExtraPhotos((prev) =>
      prev.map((uri) => {
        const done = _G.completed.get(uri);
        return done && done.requestId === rid ? done.s3url : uri;
      }),
    );
    setDashboardImage((prev) => {
      const done = prev ? _G.completed.get(prev) : undefined;
      return done && done.requestId === rid ? done.s3url : prev;
    });
    setRegImage((prev) => {
      const done = prev ? _G.completed.get(prev) : undefined;
      return done && done.requestId === rid ? done.s3url : prev;
    });
    setVinImage((prev) => {
      const done = prev ? _G.completed.get(prev) : undefined;
      return done && done.requestId === rid ? done.s3url : prev;
    });

    const newlyFailed: { uri: string; categoryId: string }[] = [];
    _G.failed.forEach((info, uri) => {
      if (info.requestId === rid) newlyFailed.push({ uri, categoryId: info.categoryId });
    });
    if (newlyFailed.length > 0) {
      setFailedUploads((prev) => {
        const existing = new Set(prev.map((f) => f.uri));
        const toAdd = newlyFailed.filter((f) => !existing.has(f.uri));
        return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
      });
    }
  };

  // draft 복원(loadSavedData/loadEditData)이 끝난 뒤에 실행해야 방금 복원한 상태 위에
  // 정확히 덮어쓸 수 있다.
  useEffect(() => {
    if (dataLoaded) reconcileWithBackgroundQueue();
  }, [dataLoaded]);

  // 2. 사진 선택 함수
  const pickExtraImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      showAlert("권한 필요", "사진 접근 권한이 필요합니다.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      // 💡 MediaTypeOptions.Images가 'deprecated'라고 떠도
      // 실제 라이브러리 타입 정의에는 이게 들어있어서 에러가 안 납니다.
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.2, // 로딩 속도를 위해 0.2로 낮춤!
    });

    if (!result.canceled) {
      const newUris = result.assets.map((asset) => asset.uri);
      setExtraPhotos((prev) => [...prev, ...newUris].slice(0, 30));
      newUris.forEach((uri) => enqueueUpload(uri, "extra_memo"));
    }
  };

  // ─── 확인사항 항목별 사진(경고등/옵션/누유, 각 최대 3장) ───────────────
  const pickChecklistPhoto = async (photoKey: string) => {
    const already = checklistPhotos[photoKey]?.length || 0;
    const remaining = MAX_CHECKLIST_PHOTOS - already;
    if (remaining <= 0) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      showAlert("권한 필요", "사진 접근 권한이 필요합니다.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.3,
    });

    if (result.canceled) return;
    const newUris = result.assets.map((a) => a.uri).slice(0, remaining);
    setChecklistPhotos((prev) => ({
      ...prev,
      [photoKey]: [...(prev[photoKey] || []), ...newUris].slice(0, MAX_CHECKLIST_PHOTOS),
    }));
    newUris.forEach((uri) => uploadChecklistPhoto(uri, photoKey));
  };

  const uploadChecklistPhoto = async (uri: string, photoKey: string, attempt = 1) => {
    if (isPractice) return;
    try {
      const formData = new FormData();
      const fileName = `checklist_${photoKey}_${Date.now()}.jpg`;

      // @ts-ignore
      formData.append("file", {
        uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
        name: fileName,
        type: "image/jpeg",
      });
      formData.append("requestId", String(requestId || ""));
      formData.append("category", `checklist_${photoKey}`);
      formData.append("carNumber", String(carNumber || "미등록"));

      const res = await fetch(`${API_BASE_URL}/external/inspection/upload`, {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      });

      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      const result = await res.json();
      if (result.url) {
        setChecklistPhotos((prev) => {
          const arr = prev[photoKey] || [];
          const idx = arr.indexOf(uri);
          if (idx === -1) return prev;
          const next = [...arr];
          next[idx] = result.url;
          return { ...prev, [photoKey]: next };
        });
      }
    } catch (e) {
      console.error("🔥 Upload Error (Checklist Photo):", e);
      if (attempt < 3) {
        setTimeout(() => uploadChecklistPhoto(uri, photoKey, attempt + 1), 1500 * attempt);
        return;
      }
      showAlert("업로드 실패", "사진 업로드에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.");
    }
  };

  const removeChecklistPhoto = (photoKey: string, index: number) => {
    setChecklistPhotos((prev) => ({
      ...prev,
      [photoKey]: (prev[photoKey] || []).filter((_, i) => i !== index),
    }));
  };

  // ─── 영상 추가 (엔진 이음/조향 이음/옵션작동 이상 등, 한 건만 등록) ───────────────
  // 자체 촬영 모달(IssueVideoRecorderModal)에서 녹화가 끝나면 호출됨
  const handleIssueVideoRecorded = (uri: string) => {
    setIssueVideo(uri);
    uploadIssueVideo(uri);
  };

  const uploadIssueVideo = async (uri: string, attempt = 1) => {
    if (isPractice) return;
    setIssueVideoUploading(true);
    try {
      const formData = new FormData();
      const fileName = `issue_video_${Date.now()}.mp4`;

      // @ts-ignore
      formData.append("file", {
        uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
        name: fileName,
        type: "video/mp4",
      });
      formData.append("requestId", String(requestId || ""));
      formData.append("category", "issue_video");
      formData.append("carNumber", String(carNumber || "미등록"));

      const res = await fetch(`${API_BASE_URL}/external/inspection/upload`, {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      });

      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      const result = await res.json();
      if (result.url) {
        setIssueVideo((prev) => (prev === uri ? result.url : prev));
      }
    } catch (e) {
      console.error("🔥 Upload Error (Issue Video):", e);
      if (attempt < 3) {
        setTimeout(() => uploadIssueVideo(uri, attempt + 1), 1500 * attempt);
        return;
      }
      showAlert("업로드 실패", "영상 업로드에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.");
    } finally {
      setIssueVideoUploading(false);
    }
  };

  const handleDeleteIssueVideo = () => {
    setIssueVideo(null);
  };

  // 3. 사진 삭제 함수
  const removeExtraPhoto = (index: number) => {
    setExtraPhotos(extraPhotos.filter((_, i) => i !== index));
  };

  // ─── 평가 완료 제출 ───────────────────────────────────────────────────────
  const handleComplete = async () => {
    if (!evaluationStarted) {
      // 평가 시작 단계
      if (!dashboardImage || !regImage || !vinImage) {
        showAlert("알림", "기본사진(계기판, 자동차등록증, 보험이력)을 모두 업로드해주세요.");
        return;
      }
      if (
        !isPractice &&
        (!dashboardImage.startsWith("http") ||
          !regImage.startsWith("http") ||
          !vinImage.startsWith("http"))
      ) {
        const baseFailed = [dashboardImage, regImage, vinImage].some(
          (uri) => uri && failedUploads.some((f) => f.uri === uri),
        );
        showAlert(
          baseFailed ? "업로드 실패" : "업로드 중",
          baseFailed
            ? "기본사진 중 업로드에 실패한 사진이 있습니다. 빨간 테두리로 표시된 사진을 탭해서 재시도해주세요."
            : "기본사진이 아직 업로드 중입니다. 잠시만 기다려주세요.",
        );
        return;
      }
      setEvaluationStarted(true);
      return;
    }

    // 평가 완료 단계
    // 간편신청(B2B)에서 "미정"으로 접수된 채 현장에서 못 채워넣고 그대로 완료해버리는
    // 사고를 막는다 — 차량번호/차주성함/차량명은 리포트의 기본 식별정보라 비어있으면 안 됨.
    // 알림창으로만 알리면 평가사가 어디를 고쳐야 하는지 다시 찾아야 해서, 아예 차량정보
    // 수정창을 바로 띄워 포커싱시킨다.
    if (!carNumber || carNumber === "미정" || !carOwner || !carModel) {
      openCarEdit();
      return;
    }
    if (!mileage) {
      showAlert("알림", "주행거리를 입력해주세요.");
      return;
    }
    if (isInspection && !repairCost) {
      showAlert("알림", "예상 복구비용을 입력해주세요.");
      return;
    }
    if (failedUploads.length > 0) {
      showAlert(
        "업로드 실패",
        `업로드에 실패한 사진이 ${failedUploads.length}장 있습니다. 빨간 테두리로 표시된 사진을 탭해서 재시도한 뒤 다시 시도해주세요.`,
      );
      return;
    }
    if (uploadPending > 0) {
      showAlert("업로드 중", `아직 사진 ${uploadPending}장이 업로드 중입니다. 완료될 때까지 잠시만 기다려주세요.`);
      return;
    }

    // 연습 모드는 여기서 끝 — 서버에 아무것도 보내지 않고, 다음 연습을 위해 로컬 임시저장도 지운다
    if (isPractice) {
      showAlert("연습 완료", "연습 모드입니다 — 실제로 저장되지 않았습니다.", [
        {
          text: "확인",
          onPress: () => {
            AsyncStorage.removeItem(STORAGE_KEY);
            router.back();
          },
        },
      ]);
      return;
    }

    try {
      const payload = {
        requestId,
        carNumber,
        carModel,
        serviceType,
        mileage: parseInt(mileage.replace(/,/g, "")) || 0,
        color,
        repairCost: isInspection
          ? parseInt(repairCost.replace(/,/g, "")) || 0
          : null,
        // 기본 사진
        dashboardImage: onlyS3([dashboardImage || ""])[0] || null,
        regImage: onlyS3([regImage || ""])[0] || null,
        vinImage: onlyS3([vinImage || ""])[0] || null,
        checklistPhotos: {
          warning: onlyS3(checklistPhotos.warning || []),
          options: onlyS3(checklistPhotos.options || []),
          leak: onlyS3(checklistPhotos.leak || []),
        },
        // 엔진 이음/조향 이음/옵션작동 이상 등 확인용 영상 — 백엔드 Inspection.videoUrls와
        // 짝을 이루는 최상위 필드(photos 안에 넣으면 서버가 무시하고 저장 안 함)
        videoUrls: onlyS3(issueVideo ? [issueVideo] : []),
        // 차키
        keys: {
          smart: smartKey,
          general: generalKey,
          folding: foldingKey,
          special: specialKey,
          note: keyNote,
        },
        // 외관 수치
        paintNeeded,
        wheelScratch,
        frontTire,
        backTire,
        // 카테고리 사진
        photos: {
          exterior: onlyS3(images.exterior),
          wheel: onlyS3(images.wheel),
          undercarriage: onlyS3(images.undercarriage),
          interior: onlyS3(images.interior),
          engine: onlyS3(images.engine),
          damage: onlyS3(images.damage || []),
          extra: onlyS3(images.extra || []),
          extraMemo: onlyS3(extraPhotos),
        },
        // 손상 표시
        checkedDamages,
        // 사이드 미러 (검수 전용)
        ...(isInspection ? { mirrorMarkers } : {}),
        // 확인사항
        inspectionDetails: {
          warningDesc: showWarning ? warningDesc : "이상 없음",
          leakDesc: showLeak ? leakDesc : "이상 없음",
          optionsDesc: showOptions ? optionsDesc : "이상 없음",
          driveDesc: "이상 없음",
          engineDesc: "이상 없음",
        },
        memo: memoRef.current || memo, // onBlur 전 제출 시에도 최신값 반영
      };

      const submitRes = await fetch(
        `${API_BASE_URL}/external/inspection/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!submitRes.ok) throw new Error("데이터 저장 실패");

      await fetch(`${API_BASE_URL}/external/request/${requestId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });

      // 제출 완료 → 남은 업로드가 자동으로 서버에 패치
      _G.submittedId = String(requestId);

      showAlert(
        isInspection ? "검수 완료" : "평가 완료",
        "저장 완료! 업로드 중인 사진은 자동으로 추가됩니다.",
        [
          {
            text: "확인",
            onPress: () => {
              AsyncStorage.removeItem(STORAGE_KEY);
              router.replace("/(tabs)");
            },
          },
        ],
      );
    } catch (e) {
      console.error(e);
      showAlert("오류", "전송 중 문제가 발생했습니다.");
    }
  };

  // ─── 커스텀 앨범 피커 함수 ────────────────────────────────────────────────
  const loadPickerAssets = async (
    album: MediaLibrary.Album | null,
    after?: string,
  ) => {
    setPickerLoading(true);
    try {
      const result = await MediaLibrary.getAssetsAsync({
        album: album ?? undefined,
        first: 60,
        after,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        mediaType: [MediaLibrary.MediaType.photo],
      });
      setPickerAssets((prev) =>
        after ? [...prev, ...result.assets] : result.assets,
      );
      setPickerHasMore(result.hasNextPage);
      setPickerEndCursor(result.endCursor);
    } finally {
      setPickerLoading(false);
    }
  };

  const openCustomPicker = async (categoryId: string) => {
    // 이미지 권한 요청
    const ipPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (ipPerm.status !== "granted") {
      showAlert("권한 필요", "사진첩 접근 권한을 허용해주세요.");
      return;
    }
    // MediaLibrary 내부 권한 상태 동기화
    let mlGranted = false;
    try {
      const mlPerm = await MediaLibrary.requestPermissionsAsync();
      mlGranted = mlPerm.status === "granted";
    } catch (_) {
      mlGranted = false;
    }
    // MediaLibrary 권한 실패 시 기존 시스템 피커로 폴백
    if (!mlGranted) {
      pickImage(categoryId, "library", SINGLE_IMG_CATS.includes(categoryId));
      return;
    }
    setPickerCategoryId(categoryId);
    setPickerSelected(new Set());
    setPickerCurrentAlbum(null);
    setAlbumDropdownOpen(false);
    const albumList = await MediaLibrary.getAlbumsAsync({
      includeSmartAlbums: false,
    });
    setPickerAlbums(albumList.sort((a, b) => a.title.localeCompare(b.title)));
    await loadPickerAssets(null);
    setPickerVisible(true);
  };

  const selectPickerAlbum = async (album: MediaLibrary.Album | null) => {
    setPickerCurrentAlbum(album);
    setAlbumDropdownOpen(false);
    setPickerAssets([]);
    setPickerEndCursor(undefined);
    await loadPickerAssets(album);
  };

  const togglePickerAsset = (id: string) => {
    setPickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const SINGLE_IMG_CATS = ["dashboard", "registration", "vin"];

  const confirmPickerSelection = () => {
    // creationTime 정렬은 같은 초에 연속 촬영하면 순서가 꼬인다(초 단위 정밀도 충돌).
    // 평가사가 화면에서 탭한 순서(pickerSelected Set의 삽입 순서)를 그대로 신뢰한다 —
    // 어떤 순서로 찍었든 탭한 순서대로 카테고리가 배정된다.
    const assetById = new Map(pickerAssets.map((a) => [a.id, a]));
    const selectedList = Array.from(pickerSelected)
      .map((id) => assetById.get(id))
      .filter((a): a is MediaLibrary.Asset => !!a);
    const categorySnapshot = pickerCategoryId;
    // 꾹 눌러서 표시(도형/펜/블러)한 사진은 원본 대신 편집된 버전을 올린다
    const uris = selectedList.map((a) => annotatedUris[a.id] ?? a.uri);

    console.log('[Picker] 확인:', categorySnapshot, uris.length, '장', uris[0]?.slice(0, 60));

    setPickerVisible(false);
    setPickerSelected(new Set());

    if (uris.length === 0) return;

    if (SINGLE_IMG_CATS.includes(categorySnapshot)) {
      const uri = uris[0];
      console.log('[Picker] 단일 이미지 설정:', categorySnapshot, uri?.slice(0, 60));
      if (categorySnapshot === "dashboard") setDashboardImage(uri);
      else if (categorySnapshot === "registration") setRegImage(uri);
      else if (categorySnapshot === "vin") setVinImage(uri);
      enqueueUpload(uri, categorySnapshot);
    } else if (categorySnapshot === "exterior") {
      // 풀(기본 사진)의 단일 "사진추가" 버튼은 항상 "exterior"로 들어온다 —
      // 실제 카테고리는 지금까지 쌓인 개수를 기준으로 순서대로 배정한다.
      const assigned = assignPoolCategories(images, uris);
      setImages((prev) => {
        const next = { ...prev };
        uris.forEach((uri, i) => {
          const cat = assigned[i];
          next[cat] = [...(next[cat] || []), uri];
        });
        return next;
      });
      uris.forEach((uri, i) => enqueueUpload(uri, assigned[i]));
    } else {
      setImages((prev) => ({
        ...prev,
        [categorySnapshot]: [...(prev[categorySnapshot] || []), ...uris],
      }));
      uris.forEach((uri) => enqueueUpload(uri, categorySnapshot));
    }
  };

  const pickerLaunchCamera = () => {
    const isSingle = SINGLE_IMG_CATS.includes(pickerCategoryId);
    setPickerVisible(false);
    setTimeout(() => pickImage(pickerCategoryId, "camera", isSingle), 300);
  };

  // ─── 이미지 선택/업로드 (DiagnosisInspection 패턴 유지) ──────────────────

  const pickImage = async (
    categoryId: string,
    type: "camera" | "library",
    isSingle: boolean,
  ) => {
    const options: ImagePicker.ImagePickerOptions = {
      quality: isSingle ? 0.5 : 0.3,
      allowsMultipleSelection: !isSingle,
    };

    try {
      if (type === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          showAlert("권한 필요", "카메라 사용 권한을 허용해주세요.");
          return;
        }
      } else {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          showAlert("권한 필요", "사진첩 접근 권한을 허용해주세요.");
          return;
        }
      }

      const result =
        type === "camera"
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled) {
        const newUris = result.assets.map((a) => a.uri);

        // 카메라 촬영 시 갤러리 저장
        if (type === "camera") {
          try {
            const { status } = await MediaLibrary.requestPermissionsAsync(true);
            if (status === "granted") {
              for (const uri of newUris) {
                const asset = await MediaLibrary.createAssetAsync(uri);
                const album = await MediaLibrary.getAlbumAsync("Carvior");
                if (album === null) {
                  await MediaLibrary.createAlbumAsync("Carvior", asset, false);
                } else {
                  await MediaLibrary.addAssetsToAlbumAsync(
                    [asset],
                    album,
                    false,
                  );
                }
              }
            }
          } catch (saveError) {
            console.log("갤러리 저장 중 오류(무시):", saveError);
          }
        }

        if (isSingle) {
          const uri = newUris[0];
          // 화면 표시용 (로컬 경로)
          if (categoryId === "dashboard") setDashboardImage(uri);
          else if (categoryId === "registration") setRegImage(uri);
          else if (categoryId === "vin") setVinImage(uri);

          // 서버 업로드 실행 — 전역 큐를 타므로 화면을 나가도 업로드가 계속되고,
          // 완료 결과는 언마운트 여부와 무관하게 _G.onResult에서 dashboardImage 등에 반영된다.
          enqueueUpload(uri, categoryId);
        } else if (categoryId === "exterior") {
          // 풀(기본 사진)의 단일 진입점 — 지금까지 쌓인 개수 기준으로 순서대로 배정
          const assigned = assignPoolCategories(images, newUris);
          setImages((prev) => {
            const next = { ...prev };
            newUris.forEach((uri, i) => {
              const cat = assigned[i];
              next[cat] = [...(next[cat] || []), uri];
            });
            return next;
          });
          newUris.forEach((uri, i) => enqueueUpload(uri, assigned[i]));
        } else {
          // 화면 표시용 (로컬 경로들 추가)
          setImages((prev) => ({
            ...prev,
            [categoryId]: [...(prev[categoryId] || []), ...newUris],
          }));

          // 큐에 등록 (동시 3개 제한 업로드)
          newUris.forEach((uri) => enqueueUpload(uri, categoryId));
        }
      }
    } catch (e) {
      console.log("사진 작업 중 오류:", e);
      showAlert("오류", "사진을 불러오는 중 문제가 발생했습니다.");
    }
  };


  // ─── 이미지 삭제 (S3 서버에서도 삭제) ──────────────────
  const handleDeleteImage = async (categoryId: string, index: number) => {
    const targetUrl = images[categoryId][index];

    if (targetUrl.startsWith("file://")) {
      setImages((p) => ({
        ...p,
        [categoryId]: p[categoryId].filter((_, i) => i !== index),
      }));
      return;
    }

    try {
      // 💡 변경: URL 뒤에 ?url=... 을 붙여서 보냅니다.
      const encodedUrl = encodeURIComponent(targetUrl);
      const res = await fetch(
        `${API_BASE_URL}/external/inspection/upload?url=${encodedUrl}`,
        { method: "DELETE" },
      );

      if (res.ok) {
        setImages((p) => ({
          ...p,
          [categoryId]: p[categoryId].filter((_, i) => i !== index),
        }));
      } else {
        showAlert("오류", "서버에서 삭제를 거부했습니다.");
      }
    } catch (e) {
      showAlert("오류", "네트워크 연결을 확인해주세요.");
    }
  };

  // 매번 새 함수를 만들면 React.memo(CarEvaluationDamageChecker)가 무력화되어
  // 타이핑/백그라운드 업로드 때마다 SVG+37개 터치영역이 통째로 다시 그려진다.
  const handleDamageChange = useCallback((index: number, symbols: string[]) => {
    setCheckedDamages((prev) => {
      const next = [...prev];
      next[index] = symbols;
      return next;
    });
  }, []);

  // ─── 대표(첫번째) 사진 지정 — 길게 누르면 해당 카테고리 맨 앞으로 이동 ─────
  // 드래그 재정렬은 사진이 많을 때(40장+) 애니메이션 렉이 심해서 대신 이 방식으로 처리한다.
  // 경매 목록 썸네일은 exterior[0]을 쓰므로, 외관 사진 중 하나를 꾹 눌러
  // 대표사진으로 지정하면 그 사진이 경매 카드 대표 이미지가 된다.
  const handleSetAsCover = (catId: string, idx: number) => {
    if (idx === 0) return;
    showAlert(
      "대표 사진으로 설정",
      "이 사진을 해당 카테고리의 첫 번째 사진으로 옮깁니다. 경매 목록 대표 이미지는 외관 첫 번째 사진이 쓰입니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "설정",
          onPress: () => {
            setImages((prev) => {
              const list = [...(prev[catId] || [])];
              if (idx >= list.length) return prev;
              const [picked] = list.splice(idx, 1);
              list.unshift(picked);
              return { ...prev, [catId]: list };
            });
          },
        },
      ],
    );
  };

  // ─── 기본 사진 풀 초기화 (전체 삭제) ─────────────────────────────────────
  const handleResetPool = () => {
    const total = POOL_CATEGORY_IDS.reduce(
      (sum, id) => sum + (images[id]?.length || 0),
      0,
    );
    if (total === 0) return;
    showAlert(
      "기본 사진 초기화",
      `기본 사진 ${total}장을 전부 삭제합니다. 되돌릴 수 없습니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "전체 삭제",
          style: "destructive",
          onPress: async () => {
            const all = POOL_CATEGORY_IDS.flatMap((id) => images[id] || []);
            const urls = all.filter((url) => url.startsWith("http"));
            // 아직 업로드 중이라 로컬 URI 그대로인 것들은 지금은 지울 S3 URL이 없다 —
            // 나중에 업로드가 뒤늦게 끝나도 화면에 되살아나지 않고 그 S3 파일도 바로
            // 지워지도록 표시해둔다(flushResults/onFailed에서 처리)
            all.filter((url) => !url.startsWith("http")).forEach((uri) => discardedUris.current.add(uri));
            await Promise.all(
              urls.map((url) =>
                fetch(
                  `${API_BASE_URL}/external/inspection/upload?url=${encodeURIComponent(url)}`,
                  { method: "DELETE" },
                ).catch(() => {}),
              ),
            );
            setImages((prev) => {
              const next = { ...prev };
              POOL_CATEGORY_IDS.forEach((id) => {
                next[id] = [];
              });
              return next;
            });
            // 실패 배너에 남아있는 항목도 같이 지운다 — 안 지우면 방금 삭제한 사진을
            // "재시도"로 눌렀을 때 이미 비운 카테고리에 유령처럼 다시 나타난다.
            setFailedUploads((prev) => prev.filter((f) => !all.includes(f.uri)));
          },
        },
      ],
    );
  };

  // ─── 이미지 뷰어 ──────────────────────────────────────────────────────────
  const openViewer = (imgs: string[], index: number) => {
    setViewerImages(imgs);
    setViewerIndex(index);
    setViewerVisible(true);
  };

  // ─── 사이드 미러 모달 ─────────────────────────────────────────────────────
  const openMirrorModal = (target: keyof MirrorMarkers) => {
    const current = mirrorMarkers[target];
    setMirrorSymbols(
      EXTERIOR_SYMBOLS.map((s) => ({
        ...s,
        isSelected: current.includes(s.symbol),
      })),
    );
    setMirrorTarget(target);
    setMirrorModalVisible(true);
  };

  const confirmMirrorModal = () => {
    if (!mirrorTarget) return;
    const selected = mirrorSymbols
      .filter((s) => s.isSelected)
      .map((s) => s.symbol);
    setMirrorMarkers((prev) => ({ ...prev, [mirrorTarget]: selected }));
    setMirrorModalVisible(false);
  };

  // ─── 카운터 컴포넌트 ──────────────────────────────────────────────────────
  const Counter = ({
    label,
    value,
    onDec,
    onInc,
    onType,
    suffix,
  }: {
    label: string;
    value: number;
    onDec: () => void;
    onInc: () => void;
    onType: (n: number) => void;
    suffix?: string;
  }) => (
    <View style={styles.counterRow}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counterControls}>
        {suffix && <Text style={styles.unitSmall}>총</Text>}
        {!isViewMode && (
          <TouchableOpacity onPress={onDec} style={styles.counterBtn}>
            <Text style={styles.counterBtnText}>−</Text>
          </TouchableOpacity>
        )}
        {isViewMode ? (
          <Text style={styles.counterValue}>{value}</Text>
        ) : (
          <TextInput
            style={styles.counterValue}
            keyboardType="numeric"
            value={String(value)}
            onChangeText={(t) => {
              const n = parseInt(t.replace(/[^0-9]/g, "")) || 0;
              onType(n);
            }}
            selectTextOnFocus
          />
        )}
        {!isViewMode && (
          <TouchableOpacity onPress={onInc} style={styles.counterBtn}>
            <Text style={styles.counterBtnText}>+</Text>
          </TouchableOpacity>
        )}
        {suffix && <Text style={styles.unitSmall}>{suffix}</Text>}
      </View>
    </View>
  );

  // ─── 단일 이미지 슬롯 ────────────────────────────────────────────────────
  const SingleImageSlot = ({
    uri,
    label,
    categoryId,
    onRemove,
  }: {
    uri: string | null;
    label: string;
    categoryId: string;
    onRemove: () => void;
  }) => {
    // "진단 시작"이 이 사진만 계속 막고 있어도 썸네일이 완료된 사진과 똑같이 보여서
    // 현장에서 뭐가 문제인지 못 찾는 경우가 있었다 — 업로드 중인/실패한 슬롯을 빨간
    // 테두리+라벨로 눈에 띄게 표시해 바로 찾을 수 있게 한다. 3회 재시도 후에도 실패하면
    // failedUploads에 남아있으므로(_G.onFailed가 상태를 안 지움) 그걸로 구분한다.
    const isFailed = !!uri && failedUploads.some((f) => f.uri === uri);
    const isUploading = !!uri && !isPractice && !uri.startsWith("http") && !isFailed;
    return (
      <View style={styles.singleSlotWrapper}>
        <View style={styles.dashBoxWrapper}>
          <TouchableOpacity
            style={[styles.dashBox, (isUploading || isFailed) && styles.dashBoxUploading]}
            onPress={() => {
              if (isFailed && uri) {
                retryOneFailed(uri, categoryId);
              } else if (uri) {
                // 이미지 있으면 항상 확대 보기
                setViewerImages([uri]);
                setViewerIndex(0);
                setViewerVisible(true);
              } else if (!isViewMode) {
                openCustomPicker(categoryId);
              }
            }}
            onLongPress={() => {
              if (!isViewMode && !isFailed) openCustomPicker(categoryId);
            }}
          >
            {uri ? (
              <Image
                source={{ uri }}
                style={styles.fullImg}
                resizeMode="cover"
              />
            ) : (
              <>
                <Ionicons name="camera" size={24} color="#666" />
                <Text style={styles.subTxt}>{label}</Text>
              </>
            )}
            {isUploading && (
              <View style={styles.uploadingOverlay}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.uploadingOverlayText}>업로드중</Text>
              </View>
            )}
            {isFailed && (
              <View style={styles.uploadingOverlay}>
                <Ionicons name="warning" size={18} color="#ff4d4d" />
                <Text style={styles.uploadingOverlayText}>실패·탭하여 재시도</Text>
              </View>
            )}
          </TouchableOpacity>
          {uri && !isViewMode && (
            <TouchableOpacity style={styles.removeBadgeSingle} onPress={onRemove}>
              <Ionicons name="close-circle" size={24} color="#ff4d4d" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={[styles.slotLabel, (isUploading || isFailed) && styles.slotLabelUploading]}>
          {label}{isUploading ? " (업로드중)" : isFailed ? " (실패)" : ""}
        </Text>
      </View>
    );
  };

  // ─── 사이드 미러 섹션 ────────────────────────────────────────────────────
  const SideMirrorSection = ({
    title,
    coverKey,
    mirrorKey,
    repeaterKey,
  }: {
    title: string;
    coverKey: keyof MirrorMarkers;
    mirrorKey: keyof MirrorMarkers;
    repeaterKey: keyof MirrorMarkers;
  }) => (
    <View style={{ marginBottom: 20 }}>
      <Text style={styles.mirrorTitle}>{title}</Text>
      <View style={styles.mirrorTable}>
        {/* 헤더 */}
        <View style={[styles.mirrorRow, { backgroundColor: "#3B82F6" }]}>
          {["커버", "거울", "리피터"].map((h, i) => (
            <View
              key={h}
              style={[styles.mirrorCell, i === 1 && styles.mirrorCellCenter]}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
                {h}
              </Text>
            </View>
          ))}
        </View>
        {/* 값 */}
        <View style={[styles.mirrorRow, { backgroundColor: "#1a1a1a" }]}>
          {(
            [
              [coverKey, mirrorMarkers[coverKey]],
              [mirrorKey, mirrorMarkers[mirrorKey]],
              [repeaterKey, mirrorMarkers[repeaterKey]],
            ] as [keyof MirrorMarkers, string[]][]
          ).map(([key, val], i) => (
            <TouchableOpacity
              key={key}
              onPress={() => openMirrorModal(key)}
              style={[
                styles.mirrorCell,
                i === 1 && styles.mirrorCellCenter,
                { minHeight: 40 },
              ]}
            >
              <Text style={{ color: "#fff", fontSize: 13 }}>
                {val.length > 0 ? val.join(", ") : "-"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );

  // ─── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />

        {/* 네비게이션 헤더 */}
        <View style={styles.navHeader}>
          <TouchableOpacity
            onPress={async () => {
              // 연타 방지 — 겹쳐 실행된 saveData()끼리 AsyncStorage 쓰기 순서가 꼬여서
              // 방금 찍은 사진이 적게 저장된 스냅샷에 덮어써지는 걸 막는다.
              if (backNavigatingRef.current) return;
              backNavigatingRef.current = true;
              if (isPractice) {
                // 연습 모드는 저장할 게 없으니 묻지 않고, 지금까지의 임시저장도 지운다
                AsyncStorage.removeItem(STORAGE_KEY);
                router.back();
                return;
              }
              // 확인창 없이 조용히 백그라운드로 저장 — 예전엔 evaluationStarted(평가
              // 시작 버튼을 눌렀는지)일 때만 저장을 시도해서, 시작 전에 기타의견 등을
              // 적고 바로 뒤로가면 저장이 아예 안 되고 사라지는 버그가 있었음
              if (!isViewMode) {
                await saveData();
              }
              router.back();
            }}
          >
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>
            {isViewMode
              ? "진단 내역"
              : isInspection
                ? "차량 검수"
                : "진단 평가"}
          </Text>
          {!isViewMode && uploadPending > 0 ? (
            <View style={styles.uploadBadge}>
              <ActivityIndicator
                size="small"
                color="#fff"
                style={{ marginRight: 4 }}
              />
              <Text style={styles.uploadBadgeText}>{uploadPending}</Text>
            </View>
          ) : (
            <View style={{ width: 48 }} />
          )}
        </View>

        {/* AI 분류 토스트 */}
        {aiToast && (
          <View style={{
            position: 'absolute', top: 60, alignSelf: 'center',
            backgroundColor: 'rgba(30,30,30,0.85)', paddingHorizontal: 16,
            paddingVertical: 8, borderRadius: 20, zIndex: 999,
          }}>
            <Text style={{ color: '#fff', fontSize: 13 }}>{aiToast}</Text>
          </View>
        )}

        {/* 카테고리 수정 모달 (피드백) */}
        <Modal
          visible={!!feedbackTarget}
          transparent
          animationType="slide"
          onRequestClose={() => setFeedbackTarget(null)}
        >
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
            activeOpacity={1}
            onPress={() => setFeedbackTarget(null)}
          >
            <View style={{ backgroundColor: '#1a1a1a', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 4 }}>
                카테고리 수정
              </Text>
              <Text style={{ color: '#666', fontSize: 12, marginBottom: 16 }}>
                AI 분류가 틀렸나요? 올바른 카테고리를 선택하면 다음부터 더 잘 분류해요 🤖
              </Text>
              {CATEGORIES.map((cat) => {
                const badgeColors: Record<string, string> = {
                  exterior: '#16a34a', interior: '#2563eb', wheel: '#d97706',
                  engine: '#dc2626', undercarriage: '#7c3aed', damage: '#be123c', extra: '#475569',
                };
                const isCurrentCat = feedbackTarget?.catId === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    onPress={() => handleReclassify(cat.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
                      paddingHorizontal: 16, borderRadius: 10, marginBottom: 6,
                      backgroundColor: isCurrentCat ? '#2a2a2a' : 'transparent',
                    }}
                  >
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: badgeColors[cat.id], marginRight: 12 }} />
                    <Text style={{ color: isCurrentCat ? '#888' : '#fff', fontSize: 15, flex: 1 }}>
                      {cat.label}
                    </Text>
                    {isCurrentCat && <Text style={{ color: '#555', fontSize: 12 }}>현재</Text>}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                onPress={() => setFeedbackTarget(null)}
                style={{ marginTop: 8, padding: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#555', fontSize: 14 }}>취소</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* 사이드 미러 심볼 모달 */}
        <Modal
          visible={mirrorModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setMirrorModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>차량 외관상태 표기</Text>
              <View style={styles.modalDivider} />
              <FlatList
                data={mirrorSymbols}
                keyExtractor={(item) => item.symbol}
                numColumns={4}
                contentContainerStyle={{ padding: 10 }}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    onPress={() =>
                      setMirrorSymbols((prev) => {
                        const next = [...prev];
                        next[index] = {
                          ...next[index],
                          isSelected: !next[index].isSelected,
                        };
                        return next;
                      })
                    }
                    style={[
                      styles.symbolBtn,
                      { backgroundColor: item.isSelected ? "#3B82F6" : "#333" },
                    ]}
                  >
                    <Text style={styles.symbolText}>{item.symbol}</Text>
                    <Text style={styles.symbolMeaning}>({item.meaning})</Text>
                  </TouchableOpacity>
                )}
              />
              <TouchableOpacity
                onPress={confirmMirrorModal}
                style={styles.modalConfirmBtn}
              >
                <Text
                  style={{ color: "#000", fontWeight: "700", fontSize: 16 }}
                >
                  확인
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ── 알림 (시스템 Alert.alert 대신 앱 다크테마에 맞춘 커스텀 모달) ── */}
        <Modal
          visible={!!customAlert}
          transparent
          animationType="fade"
          onRequestClose={() => setCustomAlert(null)}
        >
          <View style={styles.alertOverlay}>
            <View style={styles.alertBox}>
              <Ionicons
                name={
                  customAlert?.buttons.some((b) => b.style === "destructive") ||
                  /실패|오류|권한/.test(customAlert?.title ?? "")
                    ? "warning"
                    : "information-circle"
                }
                size={28}
                color={
                  customAlert?.buttons.some((b) => b.style === "destructive") ||
                  /실패|오류|권한/.test(customAlert?.title ?? "")
                    ? "#ff4d4d"
                    : "#63489a"
                }
                style={{ alignSelf: "center", marginBottom: 8 }}
              />
              <Text style={styles.alertTitle}>{customAlert?.title}</Text>
              <Text style={styles.alertMessage}>{customAlert?.message}</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {customAlert?.buttons.map((btn, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.alertBtn,
                      { flex: 1 },
                      btn.style === "cancel" && styles.alertBtnCancel,
                      btn.style === "destructive" && styles.alertBtnDestructive,
                    ]}
                    onPress={() => {
                      setCustomAlert(null);
                      btn.onPress?.();
                    }}
                  >
                    <Text
                      style={[
                        styles.alertBtnText,
                        btn.style === "cancel" && styles.alertBtnCancelText,
                        btn.style === "destructive" && styles.alertBtnDestructiveText,
                      ]}
                    >
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </Modal>

        {/* ── 커스텀 앨범 피커 모달 ── */}
        <Modal
          visible={pickerVisible}
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => setPickerVisible(false)}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
            {/* 헤더 */}
            <View style={styles.pickerHeader}>
              <TouchableOpacity
                style={styles.pickerAlbumBtn}
                onPress={() => setAlbumDropdownOpen((v) => !v)}
              >
                <Text style={styles.pickerAlbumBtnText}>
                  {pickerCurrentAlbum ? pickerCurrentAlbum.title : "모든 사진"}
                </Text>
                <Ionicons
                  name={albumDropdownOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color="#fff"
                />
              </TouchableOpacity>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 16 }}
              >
                <TouchableOpacity onPress={pickerLaunchCamera}>
                  <Ionicons name="camera-outline" size={26} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPickerVisible(false)}>
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            {/* 앨범 드롭다운 */}
            {albumDropdownOpen && (
              <View style={styles.pickerAlbumDropdown}>
                <TouchableOpacity
                  style={styles.pickerAlbumItem}
                  onPress={() => selectPickerAlbum(null)}
                >
                  <Text
                    style={[
                      styles.pickerAlbumItemText,
                      !pickerCurrentAlbum && styles.pickerAlbumItemActive,
                    ]}
                  >
                    모든 사진
                  </Text>
                </TouchableOpacity>
                {pickerAlbums.map((album) => (
                  <TouchableOpacity
                    key={album.id}
                    style={styles.pickerAlbumItem}
                    onPress={() => selectPickerAlbum(album)}
                  >
                    <Text
                      style={[
                        styles.pickerAlbumItemText,
                        pickerCurrentAlbum?.id === album.id &&
                          styles.pickerAlbumItemActive,
                      ]}
                    >
                      {album.title} ({album.assetCount})
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* 사진 그리드 */}
            <FlatList
              data={pickerAssets}
              keyExtractor={(item) => item.id}
              numColumns={3}
              removeClippedSubviews={true}
              maxToRenderPerBatch={12}
              windowSize={5}
              initialNumToRender={12}
              onEndReached={() => {
                if (pickerHasMore && !pickerLoading)
                  loadPickerAssets(pickerCurrentAlbum, pickerEndCursor);
              }}
              onEndReachedThreshold={0.4}
              ListFooterComponent={
                pickerLoading ? (
                  <ActivityIndicator color="#fff" style={{ padding: 24 }} />
                ) : null
              }
              renderItem={({ item }) => {
                const sel = pickerSelected.has(item.id);
                const selIdx = sel
                  ? [...pickerSelected].indexOf(item.id) + 1
                  : 0;
                const annotated = !!annotatedUris[item.id];
                return (
                  <TouchableOpacity
                    onPress={() => togglePickerAsset(item.id)}
                    onLongPress={() => setAnnotatorTarget(item)}
                    style={styles.pickerThumbWrap}
                  >
                    <Image
                      source={{ uri: annotatedUris[item.id] ?? item.uri }}
                      style={styles.pickerThumb}
                    />
                    {sel && <View style={styles.pickerThumbDim} />}
                    {annotated && (
                      <View style={styles.pickerAnnotatedBadge}>
                        <Ionicons name="brush" size={11} color="#fff" />
                      </View>
                    )}
                    <View
                      style={[
                        styles.pickerCheckCircle,
                        sel && styles.pickerCheckCircleActive,
                      ]}
                    >
                      {sel && (
                        <Text style={styles.pickerCheckNum}>{selIdx}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
            <Text style={styles.pickerHint}>사진을 꾹 누르면 도형/펜/블러로 표시할 수 있습니다</Text>

            {/* 하단 등록 버튼 */}
            {pickerSelected.size > 0 && (
              <View
                style={[
                  styles.pickerFooter,
                  { paddingBottom: Math.max(insets.bottom, 14) },
                ]}
              >
                <Text style={styles.pickerFooterCount}>
                  {pickerSelected.size}장 선택됨
                </Text>
                <TouchableOpacity
                  style={styles.pickerConfirmBtn}
                  onPress={confirmPickerSelection}
                >
                  <Text style={styles.pickerConfirmText}>등록</Text>
                </TouchableOpacity>
              </View>
            )}
          </SafeAreaView>
        </Modal>

        <PhotoAnnotator
          visible={!!annotatorTarget}
          uri={annotatorTarget?.uri ?? null}
          onCancel={() => setAnnotatorTarget(null)}
          onSave={(newUri) => {
            if (annotatorTarget) {
              setAnnotatedUris((prev) => ({ ...prev, [annotatorTarget.id]: newUri }));
            }
            setAnnotatorTarget(null);
          }}
        />

        {/* 이미지 뷰어 모달 */}
        {/* 🏆 뒤로가기 잘 되는 새 이미지 뷰어 */}
        <Modal
          visible={viewerVisible}
          transparent={true}
          onRequestClose={() => setViewerVisible(false)}
        >
          <ImageViewer
            imageUrls={viewerImages.map((uri) => ({ url: uri }))} // 서버 URL 배열을 매핑
            index={viewerIndex}
            onCancel={() => setViewerVisible(false)}
            enableSwipeDown={true}
            saveToLocalByLongPress={false}
            loadingRender={() => (
              <ActivityIndicator color="white" size="large" />
            )}
            renderHeader={() => (
              <TouchableOpacity
                style={{
                  position: "absolute",
                  top: 50,
                  right: 20,
                  zIndex: 999,
                }}
                onPress={() => setViewerVisible(false)}
              >
                <Text
                  style={{ color: "white", fontSize: 18, fontWeight: "bold" }}
                >
                  닫기
                </Text>
              </TouchableOpacity>
            )}
          />
        </Modal>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView style={styles.container} bounces={false}>
            {/* 차량 정보 바 */}
            <View style={[styles.carSummaryBar, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
              <TouchableOpacity disabled={isViewMode} onPress={openCarEdit} activeOpacity={isViewMode ? 1 : 0.6}>
                <Text style={styles.carNumText}>{carNumber || "차량번호"}</Text>
                <Text style={styles.carModelText}>
                  {carModel || "차량모델"}{carOwner ? ` · 차주 ${carOwner}` : ""}
                </Text>
              </TouchableOpacity>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {!!listingUrl && (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(String(listingUrl))}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "#333" }}
                  >
                    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>매물보기</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  disabled
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "#222" }}
                >
                  <Text style={{ color: "#666", fontSize: 12, fontWeight: "700" }}>상세정보</Text>
                </TouchableOpacity>
              </View>
            </View>

            {carEditVisible && (
              <Modal transparent animationType="fade" onRequestClose={saveCarInfo}>
                {/* Modal은 부모의 KeyboardAvoidingView 밖(별도 네이티브 창)에 렌더되므로
                    여기서 다시 감싸주지 않으면 키보드가 열렸을 때 차량명 입력칸이
                    키보드에 가려도 그대로 방치된다 — 평가사 피드백으로 발견된 버그. */}
                <KeyboardAvoidingView
                  behavior={Platform.OS === "ios" ? "padding" : "height"}
                  style={{ flex: 1 }}
                >
                <Pressable
                  style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 }}
                  onPress={() => setCarEditVisible(false)}
                >
                  <Pressable onPress={() => {}} style={{ backgroundColor: "#181818", borderRadius: 16, padding: 20 }}>
                    <Text style={{ color: "#fff", fontSize: 16, fontWeight: "bold", marginBottom: 16 }}>
                      차량정보 수정
                    </Text>
                    <Text style={{ color: "#888", fontSize: 12, marginBottom: 6 }}>차량번호</Text>
                    <TextInput
                      value={carEditNumber}
                      onChangeText={setCarEditNumber}
                      placeholder="차량번호"
                      placeholderTextColor="#555"
                      style={{ backgroundColor: "#000", color: "#fff", borderRadius: 8, padding: 10, marginBottom: 14 }}
                    />
                    <Text style={{ color: "#888", fontSize: 12, marginBottom: 6 }}>차주 성함</Text>
                    <TextInput
                      value={carEditOwner}
                      onChangeText={setCarEditOwner}
                      placeholder="차주 성함"
                      placeholderTextColor="#555"
                      style={{ backgroundColor: "#000", color: "#fff", borderRadius: 8, padding: 10, marginBottom: 14 }}
                    />
                    <Text style={{ color: "#888", fontSize: 12, marginBottom: 6 }}>차량명</Text>
                    <TextInput
                      value={carEditModel}
                      onChangeText={setCarEditModel}
                      placeholder="예: 그랜저 IG"
                      placeholderTextColor="#555"
                      style={{ backgroundColor: "#000", color: "#fff", borderRadius: 8, padding: 10, marginBottom: 20 }}
                    />
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity
                        onPress={() => setCarEditVisible(false)}
                        style={{ flex: 1, padding: 12, borderRadius: 8, backgroundColor: "#333", alignItems: "center" }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "600" }}>취소</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={saveCarInfo}
                        disabled={savingCarInfo}
                        style={{ flex: 1, padding: 12, borderRadius: 8, backgroundColor: "#fff", alignItems: "center", opacity: savingCarInfo ? 0.5 : 1 }}
                      >
                        {savingCarInfo ? <ActivityIndicator size="small" /> : <Text style={{ color: "#000", fontWeight: "700" }}>저장</Text>}
                      </TouchableOpacity>
                    </View>
                  </Pressable>
                </Pressable>
                </KeyboardAvoidingView>
              </Modal>
            )}

            {!isViewMode && failedUploads.length > 0 && (
              <TouchableOpacity
                onPress={handleRetryFailed}
                style={{
                  backgroundColor: "#3a1a1a",
                  borderWidth: 1,
                  borderColor: "#ff4d4d",
                  borderRadius: 10,
                  marginHorizontal: 20,
                  marginTop: 12,
                  padding: 12,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#ff8080", fontSize: 13, fontWeight: "600" }}>
                  ⚠️ {failedUploads.length}장 업로드 실패 (네트워크 확인)
                </Text>
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>
                  🔄 재시도
                </Text>
              </TouchableOpacity>
            )}

            {/* ═══ 1. 기본 사진 ═══════════════════════════════════════════════ */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>기본 사진</Text>
            </View>
            <View style={styles.basicPhotoRow}>
              <SingleImageSlot
                uri={regImage}
                label="자동차등록증"
                categoryId="registration"
                onRemove={() => setRegImage(null)}
              />
              <SingleImageSlot
                uri={dashboardImage}
                label="계기판"
                categoryId="dashboard"
                onRemove={() => setDashboardImage(null)}
              />
              <SingleImageSlot
                uri={vinImage}
                label="보험이력"
                categoryId="vin"
                onRemove={() => setVinImage(null)}
              />
            </View>

            <View style={styles.grayDivider} />

            {/* ═══ 2. 주행거리 & 색상 ══════════════════════════════════════════ */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>차량 기본 정보</Text>
            </View>

            <View style={styles.mileageSection}>
              <View style={styles.mileageInputBox}>
                <Text style={styles.inputLabel}>주행거리</Text>
                <View style={styles.inputRow}>
                  {isViewMode ? (
                    <Text
                      style={[
                        styles.mInput,
                        { color: "#fff", paddingVertical: 8 },
                      ]}
                    >
                      {mileage || "0"}
                    </Text>
                  ) : (
                    <TextInput
                      style={styles.mInput}
                      placeholder="0"
                      placeholderTextColor="#444"
                      keyboardType="numeric"
                      value={mileage}
                      onChangeText={(t) => setMileage(formatNumber(t))}
                    />
                  )}
                  <Text style={styles.unitText}>km</Text>
                </View>
              </View>
            </View>

            {/* 예상 복구비용 (검수 전용) */}
            {isInspection && (
              <View style={[styles.mileageSection, { paddingTop: 0 }]}>
                <View style={styles.mileageInputBox}>
                  <Text style={styles.inputLabel}>예상 복구비용</Text>
                  <View style={styles.inputRow}>
                    {isViewMode ? (
                      <Text
                        style={[
                          styles.mInput,
                          { color: "#fff", fontSize: 18, paddingVertical: 8 },
                        ]}
                      >
                        {repairCost || "0"}
                      </Text>
                    ) : (
                      <TextInput
                        style={[styles.mInput, { fontSize: 18 }]}
                        placeholder="0"
                        placeholderTextColor="#444"
                        keyboardType="numeric"
                        value={repairCost}
                        onChangeText={(t) => setRepairCost(formatNumber(t))}
                      />
                    )}
                    <Text style={styles.unitText}>원</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.grayDivider} />

            {/* ═══ 3. 차량 내/외관 상태 ════════════════════════════════════════ */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>차량 내/외관 상태</Text>
            </View>

            {/* 차키 */}
            <View style={styles.catBox}>
              <View style={styles.catHeader}>
                <Text style={styles.catTitle}>차키</Text>
                <Text style={styles.catCountText}>
                  총 {smartKey + generalKey + foldingKey + specialKey}개
                </Text>
              </View>
              <View style={styles.cardDark}>
                <Counter
                  label="스마트키"
                  value={smartKey}
                  onDec={() => smartKey > 0 && setSmartKey(smartKey - 1)}
                  onInc={() => setSmartKey(smartKey + 1)}
                  onType={setSmartKey}
                />
                <View style={styles.thinDivider} />
                <Counter
                  label="리모컨키"
                  value={foldingKey}
                  onDec={() => foldingKey > 0 && setFoldingKey(foldingKey - 1)}
                  onInc={() => setFoldingKey(foldingKey + 1)}
                  onType={setFoldingKey}
                />
                <View style={styles.thinDivider} />
                <Counter
                  label="일반키"
                  value={generalKey}
                  onDec={() => generalKey > 0 && setGeneralKey(generalKey - 1)}
                  onInc={() => setGeneralKey(generalKey + 1)}
                  onType={setGeneralKey}
                />
                <View style={styles.thinDivider} />
                <Counter
                  label="특수키"
                  value={specialKey}
                  onDec={() => specialKey > 0 && setSpecialKey(specialKey - 1)}
                  onInc={() => setSpecialKey(specialKey + 1)}
                  onType={setSpecialKey}
                />
              </View>
            </View>

            {/* 외판도색 / 휠스크래치 */}
            <View style={styles.catBox}>
              <View style={styles.cardDark}>
                <Counter
                  label="외판도색 필요"
                  value={paintNeeded}
                  suffix="판"
                  onDec={() =>
                    paintNeeded > 0 && setPaintNeeded(paintNeeded - 1)
                  }
                  onInc={() => setPaintNeeded(paintNeeded + 1)}
                  onType={setPaintNeeded}
                />
                <View style={styles.thinDivider} />
                <Counter
                  label="휠스크래치"
                  value={wheelScratch}
                  suffix="짝"
                  onDec={() =>
                    wheelScratch > 0 && setWheelScratch(wheelScratch - 1)
                  }
                  onInc={() => setWheelScratch(wheelScratch + 1)}
                  onType={setWheelScratch}
                />
              </View>
            </View>

            {/* 타이어 트레드 */}
            <View style={styles.catBox}>
              <Text style={styles.catTitle}>타이어 트레드 (잔존량)</Text>
              <View style={[styles.cardDark, { marginTop: 8 }]}>
                <View style={styles.counterRow}>
                  <Text style={styles.counterLabel}>앞</Text>
                  <View style={styles.counterControls}>
                    {!isViewMode && (
                      <TouchableOpacity
                        onPress={() =>
                          frontTire > 0 && setFrontTire(frontTire - 10)
                        }
                        style={styles.counterBtn}
                      >
                        <Text style={styles.counterBtnText}>−</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={styles.counterValue}>{frontTire}%</Text>
                    {!isViewMode && (
                      <TouchableOpacity
                        onPress={() =>
                          frontTire < 100 && setFrontTire(frontTire + 10)
                        }
                        style={styles.counterBtn}
                      >
                        <Text style={styles.counterBtnText}>+</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <View style={styles.thinDivider} />
                <View style={styles.counterRow}>
                  <Text style={styles.counterLabel}>뒤</Text>
                  <View style={styles.counterControls}>
                    {!isViewMode && (
                      <TouchableOpacity
                        onPress={() =>
                          backTire > 0 && setBackTire(backTire - 10)
                        }
                        style={styles.counterBtn}
                      >
                        <Text style={styles.counterBtnText}>−</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={styles.counterValue}>{backTire}%</Text>
                    {!isViewMode && (
                      <TouchableOpacity
                        onPress={() =>
                          backTire < 100 && setBackTire(backTire + 10)
                        }
                        style={styles.counterBtn}
                      >
                        <Text style={styles.counterBtnText}>+</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            </View>

            {/* 자동차 상태 표시 범례 */}
            <View style={styles.catBox}>
              <View style={styles.legendBox}>
                <View style={styles.legendRow}>
                  {[
                    { label: "X  교환", color: "#ff6b6b" },
                    { label: "B  판금", color: "#a78bfa" },
                    { label: "W  용접", color: "#60a5fa" },
                  ].map((item) => (
                    <View key={item.label} style={styles.legendItem}>
                      <Text
                        style={[styles.legendSymbol, { color: item.color }]}
                      >
                        {item.label.split("  ")[0]}
                      </Text>
                      <Text style={styles.legendText}>
                        {" "}
                        {item.label.split("  ")[1]}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
              {/* 손상 체크 */}
              <CarEvaluationDamageChecker
                checkedDamages={checkedDamages}
                onChange={isViewMode ? undefined : handleDamageChange}
              />
            </View>

            {/* 사이드 미러 (검수 전용) */}
            {isInspection && (
              <View style={styles.catBox}>
                <SideMirrorSection
                  title="운전석 사이드 미러 상태"
                  coverKey="driverCover"
                  mirrorKey="driverMirror"
                  repeaterKey="driverRepeater"
                />
                <SideMirrorSection
                  title="조수석 사이드 미러 상태"
                  coverKey="passengerCover"
                  mirrorKey="passengerMirror"
                  repeaterKey="passengerRepeater"
                />
              </View>
            )}

            <View style={styles.grayDivider} />

            {/* ═══ 4. 확인사항 ════════════════════════════════════════════════ */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>확인사항</Text>
            </View>

            {[
              {
                label: "계기판 경고등 있음",
                state: showWarning,
                setState: setShowWarning,
                val: warningDesc,
                setVal: setWarningDesc,
                placeholder: "경고 내용을 입력하세요",
                photoKey: "warning",
              },
              {
                label: "옵션 기능 작동 이상",
                state: showOptions,
                setState: setShowOptions,
                val: optionsDesc,
                setVal: setOptionsDesc,
                placeholder: "고장 옵션을 입력하세요",
                photoKey: "options",
              },
              ...(!isInspection
                ? [
                    {
                      label: "누유 있음",
                      state: showLeak,
                      setState: setShowLeak,
                      val: leakDesc,
                      setVal: setLeakDesc,
                      placeholder: "누유 부위를 입력하세요",
                      photoKey: "leak",
                    },
                  ]
                : []),
            ].map((item, idx) => (
              <View key={idx}>
                <TouchableOpacity
                  style={styles.toggleRow}
                  onPress={() => !isViewMode && item.setState(!item.state)}
                  activeOpacity={isViewMode ? 1 : 0.7}
                >
                  <Text style={styles.toggleLabel}>{item.label}</Text>
                  <Ionicons
                    name={item.state ? "checkbox" : "square-outline"}
                    size={26}
                    color={item.state ? "#fff" : "#555"}
                  />
                </TouchableOpacity>
                {item.state && (
                  <View style={styles.expandArea}>
                    {isViewMode ? (
                      // 내용이 길어도(줄바꿈 여러 번 등) 고정 높이(70)에 잘려서 안 보이지
                      // 않도록 height 고정을 빼고 minHeight로만 최소 크기를 유지
                      <Text
                        style={[
                          styles.tArea,
                          { color: "#ccc", paddingVertical: 10, height: undefined, minHeight: 70 },
                        ]}
                      >
                        {item.val || "-"}
                      </Text>
                    ) : (
                      <TextInput
                        style={[
                          styles.tArea,
                          { height: Math.max(70, checklistFieldHeights[idx] || 0) },
                        ]}
                        placeholder={item.placeholder}
                        placeholderTextColor="#444"
                        multiline
                        value={item.val}
                        onChangeText={item.setVal}
                        onContentSizeChange={(e) => {
                          const h = e?.nativeEvent?.contentSize?.height;
                          if (h != null) {
                            setChecklistFieldHeights((prev) => ({ ...prev, [idx]: h + 24 }));
                          }
                        }}
                      />
                    )}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
                      {(checklistPhotos[item.photoKey] || []).map((uri, photoIdx) => {
                        const isUploading = !isPractice && !uri.startsWith("http");
                        return (
                          <View key={`${uri}-${photoIdx}`} style={styles.photoWrapperGrid}>
                            <TouchableOpacity
                              style={styles.photoItemGrid}
                              onPress={() => {
                                if (isUploading) return;
                                setViewerImages([uri]);
                                setViewerIndex(0);
                                setViewerVisible(true);
                              }}
                              disabled={isUploading}
                            >
                              {isUploading ? (
                                <View style={[styles.photoItemGrid, { justifyContent: "center", alignItems: "center", backgroundColor: "#111" }]}>
                                  <ActivityIndicator size="small" color="#999" />
                                </View>
                              ) : (
                                <Image source={{ uri }} style={styles.photoItemGrid} />
                              )}
                            </TouchableOpacity>
                            {!isViewMode && (
                              <TouchableOpacity
                                style={styles.removeBadgeGrid}
                                onPress={() => removeChecklistPhoto(item.photoKey, photoIdx)}
                              >
                                <Ionicons name="close-circle" size={22} color="#ff4d4d" />
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}
                      {!isViewMode && (checklistPhotos[item.photoKey]?.length || 0) < MAX_CHECKLIST_PHOTOS && (
                        <View style={styles.photoWrapperGrid}>
                          <TouchableOpacity
                            style={[styles.photoItemGrid, styles.gridAddBtn]}
                            onPress={() => pickChecklistPhoto(item.photoKey)}
                          >
                            <Ionicons name="camera" size={22} color="#666" />
                            <Text style={styles.gridAddText}>사진추가</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              </View>
            ))}

            <View style={styles.grayDivider} />

            {/* ═══ 5. 기본 사진 ══════════════════════════════════════════════ */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>기본 사진</Text>
            </View>

            {useMemo(
              () => {
                // 촬영 순서(POOL_CATEGORY_IDS)와 같은 순서로 그룹핑 — CATEGORIES 원래 순서로 묶으면
                // 실제 촬영 순서와 어긋나 화면에 뒤섞여 보인다.
                const poolPhotos: { uri: string; catId: string; catIdx: number }[] = [];
                for (const catId of POOL_CATEGORY_IDS) {
                  (images[catId] || []).forEach((uri, idx) => {
                    poolPhotos.push({ uri, catId, catIdx: idx });
                  });
                }
                const uploading = poolPhotos.filter((p) => !p.uri.startsWith("http"));
                const uploaded = poolPhotos.filter((p) => p.uri.startsWith("http"));
                // 업로드 중인 사진은 항상 다 보여주고, 완료된 사진은 페이지네이션 —
                // 60장을 한 번에 렌더링하면 Image 디코딩 때문에 스크롤이 버벅인다.
                const visibleUploaded = uploaded.slice(0, Math.max(0, poolVisible - uploading.length));
                const visible = [...uploading, ...visibleUploaded];
                const hiddenCount = poolPhotos.length - visible.length;
                const allUris = poolPhotos.map((p) => p.uri);
                const badgeColors: Record<string, string> = {
                  exterior: "#16a34a", interior: "#2563eb", wheel: "#d97706",
                  engine: "#dc2626", undercarriage: "#7c3aed", damage: "#be123c", extra: "#475569",
                };

                return (
                  <View style={styles.catBox}>
                    {!isViewMode && (
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 8,
                        }}
                      >
                        <Text style={styles.catCountText}>
                          총 {poolPhotos.length}장 · 순서대로 자동 분류됩니다{"\n"}사진을 꾹 누르면 대표사진으로 등록됩니다
                        </Text>
                        {poolPhotos.length > 0 && (
                          <TouchableOpacity onPress={handleResetPool}>
                            <Text style={{ color: "#ff4d4d", fontSize: 12, fontWeight: "600" }}>
                              🗑 전체 초기화
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                    <View style={styles.photoGrid}>
                      {!isViewMode && (
                        <TouchableOpacity
                          style={[styles.photoWrapperGrid, styles.gridAddBtn]}
                          onPress={() => openCustomPicker("exterior")}
                        >
                          <Ionicons name="camera" size={22} color="#666" />
                          <Text style={styles.gridAddText}>사진추가</Text>
                        </TouchableOpacity>
                      )}
                      {visible.map((photo) => {
                        const isFailed = failedUploads.some((f) => f.uri === photo.uri);
                        const isUploading = !isPractice && !photo.uri.startsWith("http") && !isFailed;
                        const globalIdx = poolPhotos.findIndex(
                          (p) => p.catId === photo.catId && p.catIdx === photo.catIdx,
                        );
                        const catInfo = CATEGORIES.find((c) => c.id === photo.catId);
                        const badgeColor = badgeColors[photo.catId] ?? "#475569";
                        return (
                          <View
                            key={`pool-${photo.catId}-${photo.catIdx}`}
                            style={styles.photoWrapperGrid}
                          >
                            <TouchableOpacity
                              style={[
                                { width: "100%", height: "100%", borderRadius: 8, overflow: "hidden" },
                                isFailed && styles.dashBoxUploading,
                              ]}
                              activeOpacity={0.85}
                              onPress={() =>
                                isFailed
                                  ? retryOneFailed(photo.uri, photo.catId)
                                  : openViewer(allUris, globalIdx)
                              }
                              onLongPress={() =>
                                !isViewMode && !isUploading && !isFailed &&
                                handleSetAsCover(photo.catId, photo.catIdx)
                              }
                            >
                              <Image
                                source={{ uri: photo.uri }}
                                style={{ width: "100%", height: "100%" }}
                                resizeMode="cover"
                                resizeMethod="resize"
                                fadeDuration={0}
                              />
                              {isUploading && (
                                <View style={styles.uploadingOverlay}>
                                  <ActivityIndicator size="small" color="#fff" />
                                </View>
                              )}
                              {isFailed && (
                                <View style={[styles.uploadingOverlay, styles.failedOverlay]}>
                                  <Ionicons name="warning" size={16} color="#ff4d4d" />
                                  <Text style={styles.uploadingOverlayText}>재시도</Text>
                                </View>
                              )}
                            </TouchableOpacity>
                            {catInfo && !isUploading && !isFailed && (
                              <TouchableOpacity
                                style={[styles.catBadge, { backgroundColor: badgeColor }]}
                                onPress={() => !isViewMode && setFeedbackTarget(photo)}
                                activeOpacity={isViewMode ? 1 : 0.7}
                              >
                                <Text style={styles.catBadgeText}>{catInfo.label} {!isViewMode ? '✏️' : ''}</Text>
                              </TouchableOpacity>
                            )}
                            {!isViewMode && (
                              <TouchableOpacity
                                style={styles.removeBadgeGrid}
                                onPress={() => handleDeleteImage(photo.catId, photo.catIdx)}
                              >
                                <Ionicons name="close-circle" size={22} color="#ff4d4d" />
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}
                    </View>
                    {hiddenCount > 0 && (
                      <TouchableOpacity
                        style={styles.loadMoreBtn}
                        onPress={() => setPoolVisible((v) => v + 24)}
                      >
                        <Text style={styles.loadMoreText}>
                          사진 더 보기 ({hiddenCount}장 남음)
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              },
              [
                images,
                isViewMode,
                poolVisible,
                openCustomPicker,
                openViewer,
                handleDeleteImage,
                handleResetPool,
                handleSetAsCover,
              ],
            )}

            {/* ═══ 영상 추가 ═══════════════════════════════════════════════ */}
            <View style={styles.catBox}>
              <Text style={styles.catTitle}>영상 추가</Text>
              <Text style={[styles.catCountText, { marginBottom: 8 }]}>
                엔진 이음, 핸들 조향시 이음, 옵션작동 이상 영상등을 올려주세요
              </Text>
              {!isViewMode && (
                <View style={styles.videoGuideBox}>
                  <Text style={styles.videoGuideItem}>✔ 소리가 잘 담기도록 15초 이내로 촬영</Text>
                  <Text style={styles.videoGuideItem}>✔ 문제 부위가 화면에 잘 보이게 촬영</Text>
                </View>
              )}
              <View style={styles.photoGrid}>
                {issueVideo ? (
                  <View style={styles.photoWrapperGrid}>
                    <TouchableOpacity
                      style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden" }}
                      activeOpacity={0.85}
                      onPress={() => !issueVideoUploading && setIssueVideoModalVisible(true)}
                      disabled={issueVideoUploading}
                    >
                      {issueVideoUploading ? (
                        <View style={styles.uploadingOverlay}>
                          <ActivityIndicator size="small" color="#fff" />
                        </View>
                      ) : (
                        <>
                          <VideoGridThumb uri={issueVideo} />
                          <View style={styles.uploadingOverlay}>
                            <Ionicons name="play-circle" size={28} color="rgba(255,255,255,0.9)" />
                          </View>
                        </>
                      )}
                    </TouchableOpacity>
                    {!isViewMode && (
                      <TouchableOpacity
                        style={styles.removeBadgeGrid}
                        onPress={() => showAlert("영상 삭제", "등록된 영상을 삭제할까요?", [
                          { text: "삭제", style: "destructive", onPress: handleDeleteIssueVideo },
                          { text: "취소", style: "cancel" },
                        ])}
                      >
                        <Ionicons name="close-circle" size={22} color="#ff4d4d" />
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  !isViewMode && (
                    <TouchableOpacity
                      style={[styles.photoWrapperGrid, styles.gridAddBtn]}
                      onPress={() => setIssueVideoRecorderVisible(true)}
                    >
                      <Ionicons name="videocam" size={22} color="#666" />
                      <Text style={styles.gridAddText}>영상추가</Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            </View>

            {/* 영상 전체화면 모달 */}
            <Modal visible={issueVideoModalVisible} transparent animationType="fade" onRequestClose={() => setIssueVideoModalVisible(false)}>
              <View style={{ flex: 1, backgroundColor: "#000" }}>
                <TouchableOpacity
                  style={{ position: "absolute", top: 50, right: 20, zIndex: 999 }}
                  onPress={() => setIssueVideoModalVisible(false)}
                >
                  <Ionicons name="close-circle" size={36} color="#fff" />
                </TouchableOpacity>
                {issueVideo && <VideoFullscreenPlayer uri={issueVideo} />}
              </View>
            </Modal>

            {/* 이상확인 영상 자체 촬영 모달 */}
            <IssueVideoRecorderModal
              visible={issueVideoRecorderVisible}
              onClose={() => setIssueVideoRecorderVisible(false)}
              onRecorded={handleIssueVideoRecorded}
            />

            {/* ═══ 6. 기타 의견 ═══════════════════════════════════════════════ */}
            <View style={styles.catBox}>
              <Text style={styles.catTitle}>기타 의견</Text>
              {isViewMode ? (
                // tArea의 고정 height:70이 minHeight보다 우선 적용돼서 긴 내용이 잘려 안 보이던 문제 —
                // height를 명시적으로 없애야 minHeight가 실제로 적용됨
                <Text
                  style={[
                    styles.tArea,
                    { color: "#ccc", paddingVertical: 10, height: undefined, minHeight: 60 },
                  ]}
                >
                  {memo || "-"}
                </Text>
              ) : (
                <TextInput
                  // defaultValue는 최초 마운트 시점 값만 반영하고 이후 memo가 바뀌어도
                  // 화면에 안 나타남 — 저장된 내용 복원(loadSavedData/loadEditData, 비동기)이
                  // 끝난 뒤 key를 바꿔 강제로 다시 마운트시켜서 복원된 값이 실제로 보이게 한다
                  key={dataLoaded ? "memo-loaded" : "memo-loading"}
                  style={[styles.tArea, { marginTop: 8, height: Math.max(100, memoHeight) }]}
                  placeholder="예) 정비 이력, 소모품 교환, 구조변경, 보증 연장, 블랙박스, 금연, 튜닝/아래는 도막,사고사진 등 그 외 첨부사진."
                  placeholderTextColor="#444"
                  multiline
                  defaultValue={memo}
                  onChangeText={(text) => {
                    memoRef.current = text;
                    if (memoSaveTimerRef.current) clearTimeout(memoSaveTimerRef.current);
                    memoSaveTimerRef.current = setTimeout(() => {
                      saveData();
                    }, 1000);
                  }}
                  onBlur={() => setMemo(memoRef.current)}
                  onContentSizeChange={(e) => {
                    const h = e?.nativeEvent?.contentSize?.height;
                    if (h != null) setMemoHeight(h + 24);
                  }}
                />
              )}

              {!isViewMode && (
                <TouchableOpacity
                  style={[
                    styles.addBtn,
                    { borderColor: styles.addBtn.borderColor, marginTop: 12 },
                  ]}
                  onPress={pickExtraImage}
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={24}
                    color={styles.addBtn.borderColor}
                  />
                  <Text
                    style={[
                      styles.addBtnText,
                      { color: styles.addBtn.borderColor },
                    ]}
                  >
                    사진 추가
                  </Text>
                </TouchableOpacity>
              )}

              {/* 추가된 사진 리스트 (클릭 시 뷰어 연결) */}
              <View style={styles.photoGrid}>
                {extraPhotos.map((uri, index) => {
                  const isFailed = failedUploads.some((f) => f.uri === uri);
                  const isUploading = !isPractice && !uri.startsWith("http") && !isFailed;
                  return (
                    <View key={index} style={styles.photoWrapperGrid}>
                      <TouchableOpacity
                        style={isFailed && styles.dashBoxUploading}
                        onPress={() => {
                          if (isFailed) {
                            retryOneFailed(uri, "extra_memo");
                            return;
                          }
                          setViewerImages(extraPhotos);
                          setViewerIndex(index);
                          setViewerVisible(true);
                        }}
                      >
                        <Image source={{ uri }} style={styles.photoItemGrid} />
                        {isUploading && (
                          <View style={styles.uploadingOverlay}>
                            <ActivityIndicator size="small" color="#fff" />
                          </View>
                        )}
                        {isFailed && (
                          <View style={[styles.uploadingOverlay, styles.failedOverlay]}>
                            <Ionicons name="warning" size={16} color="#ff4d4d" />
                            <Text style={styles.uploadingOverlayText}>재시도</Text>
                          </View>
                        )}
                      </TouchableOpacity>

                      {!isViewMode && (
                        <TouchableOpacity
                          style={styles.removeBadgeGrid}
                          onPress={() => removeExtraPhoto(index)}
                        >
                          <Ionicons name="close-circle" size={22} color="#ff4d4d" />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>

            {/* ═══ 하단 버튼 ══════════════════════════════════════════════════ */}
            <View style={styles.bottomBar}>
              {isViewMode ? (
                <TouchableOpacity
                  style={[
                    styles.btnHalf,
                    { backgroundColor: "#fff", width: "100%" },
                  ]}
                  onPress={() => router.back()}
                >
                  <Text style={styles.btnTextB}>닫기</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.btnHalf,
                    {
                      backgroundColor: "#fff",
                      flex: evaluationStarted ? 1 : undefined,
                      width: evaluationStarted ? undefined : "100%",
                    },
                  ]}
                  onPress={handleComplete}
                >
                  <Text style={styles.btnTextB}>진단 완료</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={{ height: 60 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// ─── 스타일 ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#000" },
  navHeader: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 15,
  },
  navTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  container: { flex: 1 },
  carSummaryBar: {
    backgroundColor: "#111",
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
  },
  carNumText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    marginRight: 12,
  },
  carModelText: { color: "#888", fontSize: 16 },
  grayDivider: { height: 10, backgroundColor: "#111" },
  sectionHeader: { padding: 20, paddingBottom: 10 },
  sectionTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },

  // 기본 사진
  basicPhotoRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 10,
    paddingBottom: 20,
  },
  singleSlotWrapper: { alignItems: "center" },
  slotLabel: { color: "#888", fontSize: 11, marginTop: 4 },
  slotLabelUploading: { color: "#ff4d4d", fontWeight: "700" },
  dashBoxWrapper: { position: "relative", padding: 4 },
  dashBox: {
    width: 95,
    height: 75,
    backgroundColor: "#111",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#333",
    justifyContent: "center",
    alignItems: "center",
  },
  dashBoxUploading: { borderWidth: 2, borderColor: "#ff4d4d" },
  fullImg: { width: "100%", height: "100%", borderRadius: 8 },
  subTxt: { color: "#555", fontSize: 10, marginTop: 3 },
  removeBadgeSingle: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 999,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 15,
  },

  // 주행거리/색상 입력
  mileageSection: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 15,
    gap: 20,
  },
  mileageInputBox: { flex: 1 },
  inputLabel: { color: "#666", fontSize: 12, marginBottom: 4 },
  inputRow: {
    flexDirection: "row",
    alignItems: "baseline",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  mInput: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
    flex: 1,
    paddingVertical: 5,
  },
  unitText: { color: "#fff", fontSize: 16, marginLeft: 5 },

  // 카테고리
  catBox: { paddingHorizontal: 20, marginBottom: 20 },
  catHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  catTitle: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  catCountText: { color: "#888", fontSize: 12 },
  videoGuideBox: {
    backgroundColor: "#0d1f3c",
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  videoGuideItem: { color: "#cbd5e1", fontSize: 12, lineHeight: 20 },
  imageGrid: { flexDirection: "row", alignItems: "center" },
  smallCamBtn: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    backgroundColor: "#111",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#444",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  // 드래거블 이미지
  itemOuterContainer: {
    width: TILE_SIZE + 20,
    height: TILE_SIZE + 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 5,
  },
  thumbWrapper: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 8,
    overflow: "hidden",
  },
  smallThumb: { width: "100%", height: "100%" },
  removeBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 999,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 15,
  },

  // 카드 (다크)
  cardDark: {
    backgroundColor: "#111",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#222",
  },
  thinDivider: { height: 1, backgroundColor: "#222", marginVertical: 6 },

  // 카운터
  counterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  counterLabel: { color: "#fff", fontSize: 15 },
  counterControls: { flexDirection: "row", alignItems: "center" },
  counterBtn: { paddingHorizontal: 14, paddingVertical: 4 },
  counterBtnText: { fontSize: 22, color: "#fff" },
  counterValue: {
    color: "#3B82F6",
    fontWeight: "bold",
    fontSize: 16,
    minWidth: 36,
    textAlign: "center",
  },
  unitSmall: { color: "#888", fontSize: 13, marginHorizontal: 4 },

  // 범례
  legendBox: {
    backgroundColor: "#111",
    borderRadius: 8,
    padding: 12,
    marginBottom: 15,
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 4,
  },
  legendItem: { flexDirection: "row", alignItems: "center" },
  legendSymbol: { fontSize: 14, fontWeight: "bold" },
  legendText: { color: "#aaa", fontSize: 13 },

  // 손상 체크 플레이스홀더
  damageCheckerPlaceholder: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
  },
  placeholderText: { color: "#555", fontSize: 13, marginTop: 6 },

  // 사이드 미러
  mirrorTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  mirrorTable: {
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#333",
  },
  mirrorRow: { flexDirection: "row" },
  mirrorCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  mirrorCellCenter: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },

  // 토글 확인사항
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 0.5,
    borderBottomColor: "#1a1a1a",
  },
  // 노안 때문에 글씨가 작아서 안 보인다는 평가사님들 피드백으로 확인사항(경고등/옵션/누유,
  // 기타의견도 같은 스타일 공유) 라벨·입력 텍스트 크기를 키움
  toggleLabel: { color: "#fff", fontSize: 21 },
  expandArea: { paddingHorizontal: 20, paddingBottom: 15 },
  tArea: {
    backgroundColor: "#111",
    color: "#fff",
    fontSize: 19,
    borderRadius: 8,
    padding: 12,
    height: 70,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#222",
  },

  // 하단 버튼
  bottomBar: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginVertical: 20,
    gap: 10,
  },
  btnHalf: {
    flex: 1,
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 16, fontWeight: "bold" },
  btnTextB: { color: "#000", fontSize: 16, fontWeight: "bold" },

  // 모달
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "60%",
  },
  modalTitle: { color: "#fff", fontWeight: "700", fontSize: 16, padding: 18 },
  modalDivider: { height: 1, backgroundColor: "#333" },
  // 업로드 대기/실패 안내용 커스텀 알림(시스템 Alert 대체) — 화면 가운데 작은 카드
  alertOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  alertBox: {
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#333",
    padding: 22,
    width: "100%",
    maxWidth: 320,
  },
  alertTitle: { color: "#fff", fontWeight: "700", fontSize: 17, textAlign: "center", marginBottom: 8 },
  alertMessage: { color: "#ccc", fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 18 },
  alertBtn: { backgroundColor: "#fff", borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  alertBtnText: { color: "#000", fontWeight: "700", fontSize: 15 },
  alertBtnCancel: { backgroundColor: "#333" },
  alertBtnCancelText: { color: "#ccc" },
  alertBtnDestructive: { backgroundColor: "#ff4d4d" },
  alertBtnDestructiveText: { color: "#fff" },
  symbolBtn: {
    flex: 1,
    margin: 4,
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 60,
  },
  symbolText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  symbolMeaning: { color: "#ccc", fontSize: 10, marginTop: 2 },
  modalConfirmBtn: {
    backgroundColor: "#fff",
    margin: 12,
    borderRadius: 12,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },

  // 뷰어
  viewerContainer: { flex: 1, backgroundColor: "#000" },
  closeViewer: { position: "absolute", top: 50, right: 20, zIndex: 999 },
  viewerSlide: {
    width,
    height,
    justifyContent: "center",
    alignItems: "center",
  },
  fullViewerImg: { width: "100%", height: "80%" },
  viewerFooter: {
    position: "absolute",
    bottom: 40,
    width: "100%",
    alignItems: "center",
  },
  footerText: { color: "#888", fontSize: 14 },

  extraSection: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(150, 150, 150, 0.1)",
  },
  extraHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  extraTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  extraSub: {
    fontSize: 13,
    marginBottom: 20,
  },
  addBtn: {
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#63489a", // theme.accent 대신 직접 입력
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  addBtnText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: "600",
  },
  photoList: {
    flexDirection: "row",
  },
  photoWrapper: {
    position: "relative",
    marginRight: 12,
  },
  photoItem: {
    width: 100,
    height: 100,
    borderRadius: 8,
    backgroundColor: "#333",
  },
  submitBtn: {
    margin: 16,
    height: 56,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 40, // 하단 여백 충분히
  },
  submitText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  // 한 줄에 4개씩 나오도록 계산된 스타일입니다.
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap", // ✅ 옆으로 안 넘어가고 아래로 내려가게 함
    marginTop: 12,
    gap: 10, // 사진들 사이의 간격
  },
  photoWrapperGrid: {
    position: "relative",
    width: (width - 70) / 4,
    height: (width - 70) / 4,
    marginBottom: 10,
  },
  photoItemGrid: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
    backgroundColor: "#222",
    borderWidth: 1,
    borderColor: "#333",
  },
  removeBadgeGrid: {
    position: "absolute",
    top: -8,
    right: -8,
    zIndex: 10,
    backgroundColor: "#000",
    borderRadius: 11,
  },
  gridAddBtn: {
    backgroundColor: "#111",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#444",
    justifyContent: "center",
    alignItems: "center",
  },
  gridAddText: { color: "#666", fontSize: 10, marginTop: 3 },
  loadMoreBtn: { marginTop: 12, padding: 12, backgroundColor: "#1a1a1a", borderRadius: 8, alignItems: "center" as const },
  loadMoreText: { color: "#888", fontSize: 13 },
  catBadge: { position: "absolute" as const, bottom: 4, left: 4, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  catBadgeText: { color: "#fff", fontSize: 9, fontWeight: "bold" as const },
  uploadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  uploadingOverlayText: { color: "#fff", fontSize: 9, fontWeight: "700", marginTop: 2 },
  failedOverlay: { backgroundColor: "rgba(255,77,77,0.35)" },
  uploadBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(99,72,154,0.85)",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 48,
  },
  uploadBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },

  // ── 커스텀 앨범 피커 ─────────────────────────────────────────────────────
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  pickerAlbumBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pickerAlbumBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  pickerAlbumDropdown: {
    backgroundColor: "#111",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    maxHeight: 300,
  },
  pickerAlbumItem: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  pickerAlbumItemText: {
    color: "#ccc",
    fontSize: 15,
  },
  pickerAlbumItemActive: {
    color: "#3B82F6",
    fontWeight: "700",
  },
  pickerThumbWrap: {
    width: width / 3,
    height: width / 3,
    position: "relative",
  },
  pickerThumb: {
    width: "100%",
    height: "100%",
    borderWidth: 0.5,
    borderColor: "#000",
  },
  pickerThumbDim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  pickerCheckCircle: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  pickerCheckCircleActive: {
    backgroundColor: "#3B82F6",
    borderColor: "#3B82F6",
  },
  pickerAnnotatedBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#ff3b30",
    alignItems: "center",
    justifyContent: "center",
  },
  pickerHint: {
    color: "#666",
    fontSize: 11,
    textAlign: "center",
    paddingVertical: 8,
  },
  pickerCheckNum: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  pickerFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: "#111",
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  pickerFooterCount: {
    color: "#ccc",
    fontSize: 15,
  },
  pickerConfirmBtn: {
    backgroundColor: "#3B82F6",
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
  },
  pickerConfirmText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
