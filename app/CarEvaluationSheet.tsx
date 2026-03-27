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

import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ImageViewer from 'react-native-image-zoom-viewer'; // 👈 이름 주의!
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import CarEvaluationDamageChecker from '../components/CarEvaluationDamageChecker';

// ─── 상수 ─────────────────────────────────────────────────────────────────────
const { width, height } = Dimensions.get('window');
const API_BASE_URL = 'https://carvior.store/api/v1';
const TILE_SIZE = 85;

// ─── 전역 업로드 싱글톤 (컴포넌트 언마운트 후에도 계속 실행됨) ─────────────────
interface _UploadTask { uri: string; categoryId: string; requestId: string; carNumber: string; }
const _G = {
  queue: [] as _UploadTask[],
  active: 0,
  submittedId: null as string | null,
  onResult: null as unknown as ((uri: string, url: string, cat: string) => void) | undefined,
  onCount: null as unknown as ((n: number) => void) | undefined,
};

const _runTask = async (task: _UploadTask) => {
  const formData = new FormData();
  // @ts-ignore
  formData.append('file', { uri: task.uri, name: `photo_${Date.now()}.jpg`, type: 'image/jpeg' });
  formData.append('requestId', task.requestId);
  formData.append('category', task.categoryId);
  formData.append('carNumber', task.carNumber || '미등록');
  try {
    const res = await fetch(`${API_BASE_URL}/external/inspection/upload`, { method: 'POST', body: formData });
    if (!res.ok) return;
    const data = await res.json();
    const s3url: string = data.url;
    if (!s3url) return;
    _G.onResult?.(task.uri, s3url, task.categoryId);
    if (_G.submittedId === task.requestId) {
      fetch(`${API_BASE_URL}/external/inspection/${task.requestId}/photo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: task.categoryId, url: s3url }),
      }).catch(() => {});
    }
  } catch (_e) {}
};

const _processQueue = () => {
  while (_G.active < 3 && _G.queue.length > 0) {
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
  { symbol: 'X', meaning: '교환' },
  { symbol: 'W', meaning: '판금/도장' },
  { symbol: 'M', meaning: '탈부착/조정' },
  { symbol: 'A', meaning: '흠집' },
  { symbol: 'U', meaning: '요철' },
  { symbol: 'T', meaning: '깨짐' },
  { symbol: 'C', meaning: '부식' },
  { symbol: 'P', meaning: '도장필요' },
];

// 사진 카테고리 (DiagnosisInspection 구조 유지)
const CATEGORIES = [
  { id: 'exterior', label: '외관', min: 4 },
  { id: 'wheel', label: '휠', min: 4 },
  { id: 'undercarriage', label: '하체', min: 2 },
  { id: 'interior', label: '실내', min: 5 },
  { id: 'engine', label: '엔진룸', min: 1 },
  { id: 'damage', label: '외판 데미지', min: 5 },
  { id: 'extra', label: '옵션', min: 5 },
];

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
  val.replace(/[^0-9]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const onlyS3 = (urls: string[]) =>
  (urls || []).filter((url) => url.startsWith('http'));


// ─── 컴포넌트 ──────────────────────────────────────────────────────────────────
export default function CarEvaluationSheet() {
  const { requestId, carNumber, carModel, serviceType, mode } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // serviceType: 'INSPECTION_DELIVERY' | 'EVALUATION_DELIVERY'
  const isInspection = serviceType === 'INSPECTION_DELIVERY';
  const isEditMode = mode === 'edit';
  const isViewMode = mode === 'view';
  const STORAGE_KEY = `evaluation_data_${requestId}`;

  // ── 기본 정보 ────────────────────────────────────────────────────────────
  const [evaluationStarted, setEvaluationStarted] = useState(false);
  const [paperSheet, setPaperSheet] = useState(false);

  // ── 단일 이미지 (기본 사진) ───────────────────────────────────────────────
  const [dashboardImage, setDashboardImage] = useState<string | null>(null); // 계기판
  const [regImage, setRegImage] = useState<string | null>(null);             // 자동차등록증
  const [vinImage, setVinImage] = useState<string | null>(null);             // 차대번호(라벨)

  // 1. 상단에 추가할 상태값 (컴포넌트 내부)
  const [extraPhotos, setExtraPhotos] = useState<string[]>([]);

  // ── 카테고리별 다중 이미지 ────────────────────────────────────────────────
  const [images, setImages] = useState<{ [key: string]: string[] }>({
    exterior: [], wheel: [], undercarriage: [], interior: [], engine: [], paperSheet: [],
  });

  // ── 차량 정보 ────────────────────────────────────────────────────────────
  const [mileage, setMileage] = useState('');
  const [color, setColor] = useState('');
  const [repairCost, setRepairCost] = useState('');     // 검수 전용

  // ── 차키 텍스트 ──────────────────────────────────────────────────────────
  const [keyNote, setKeyNote] = useState('');
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
  const [showDrive, setShowDrive] = useState(false);
  const [warningDesc, setWarningDesc] = useState('');
  const [leakDesc, setLeakDesc] = useState('');
  const [optionsDesc, setOptionsDesc] = useState('');
  const [driveDesc, setDriveDesc] = useState('');

  // ── 기타 메모 ────────────────────────────────────────────────────────────
  const [memo, setMemo] = useState('');

  // ── 사이드 미러 마커 ──────────────────────────────────────────────────────
  const [mirrorMarkers, setMirrorMarkers] = useState<MirrorMarkers>({
    driverCover: [], driverMirror: [], driverRepeater: [],
    passengerCover: [], passengerMirror: [], passengerRepeater: [],
  });

  // ── 손상 체크 (차량 외관 상태 표시) ──────────────────────────────────────
  const [checkedDamages, setCheckedDamages] = useState<string[][]>([]);

  // ── 이미지 뷰어 ──────────────────────────────────────────────────────────
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  // ── 업로드 카운트 (전역 싱글톤 연동) ────────────────────────────────────
  const [uploadPending, setUploadPending] = useState(0);

  useEffect(() => {
    // 컴포넌트 마운트: 콜백 등록
    _G.onResult = (uri, s3url, cat) => {
      if (cat === 'extra_memo') {
        setExtraPhotos((prev) => prev.map((img) => (img === uri ? s3url : img)));
      } else {
        setImages((prev) => ({
          ...prev,
          [cat]: (prev[cat] || []).map((img) => (img === uri ? s3url : img)),
        }));
      }
    };
    _G.onCount = (n) => setUploadPending(n);
    return () => {
      // 언마운트 후에도 업로드는 계속, UI 콜백만 해제
      _G.onResult = undefined;
      _G.onCount = undefined;
    };
  }, []);

  // uploadUri: fetch에 쓸 URI, displayUri: state에 저장된 표시용 URI (생략 시 uploadUri와 동일)
  const enqueueUpload = (uri: string, categoryId: string) => {
    globalEnqueue({
      uri,
      categoryId,
      requestId: String(requestId || ''),
      carNumber: String(carNumber || '미등록'),
    });
  };

  // ── 사이드 미러 심볼 모달 ─────────────────────────────────────────────────
  const [mirrorModalVisible, setMirrorModalVisible] = useState(false);
  const [mirrorSymbols, setMirrorSymbols] = useState<SymbolItem[]>(
    EXTERIOR_SYMBOLS.map((s) => ({ ...s, isSelected: false })),
  );
  const [mirrorTarget, setMirrorTarget] = useState<keyof MirrorMarkers | null>(null);

  // ── 커스텀 앨범 피커 ─────────────────────────────────────────────────────
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerCategoryId, setPickerCategoryId] = useState('');
  const [pickerAlbums, setPickerAlbums] = useState<MediaLibrary.Album[]>([]);
  const [pickerCurrentAlbum, setPickerCurrentAlbum] = useState<MediaLibrary.Album | null>(null);
  const [pickerAssets, setPickerAssets] = useState<MediaLibrary.Asset[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [albumDropdownOpen, setAlbumDropdownOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerEndCursor, setPickerEndCursor] = useState<string | undefined>();
  const [pickerHasMore, setPickerHasMore] = useState(false);

  // ─── edit 모드: 서버에서 기존 데이터 로드 ────────────────────────────────
  const EDIT_LIMIT_MS = 2 * 60 * 60 * 1000; // 2시간

  const loadEditData = async (skipLimitCheck = false) => {
    try {
      const res = await fetch(`${API_BASE_URL}/external/inspection/report/${requestId}`);
      if (!res.ok) return;
      const d = await res.json();

      // ── 2시간 수정 제한 체크 (view 모드는 생략) ──────────────────────────
      if (!skipLimitCheck && d.completedAt) {
        const elapsed = Date.now() - new Date(d.completedAt).getTime();
        if (elapsed > EDIT_LIMIT_MS) {
          const hoursAgo = Math.floor(elapsed / 3600000);
          const minutesAgo = Math.floor((elapsed % 3600000) / 60000);
          Alert.alert(
            '수정 불가',
            `진단 완료 후 2시간이 지나면 수정할 수 없습니다.\n(완료 후 ${hoursAgo}시간 ${minutesAgo}분 경과)`,
            [{ text: '확인', onPress: () => router.back() }],
          );
          return;
        }
      }

      // 기본 정보
      setMileage(String(d.car_info?.mileage ?? ''));
      setColor(d.car_info?.color ?? '');
      setRepairCost(d.car_info?.repairCost ? formatNumber(String(d.car_info.repairCost)) : '');

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
      setShowWarning(ev.warningDesc && ev.warningDesc !== '이상 없음');
      setWarningDesc(ev.warningDesc !== '이상 없음' ? ev.warningDesc ?? '' : '');
      setShowLeak(ev.leakDesc && ev.leakDesc !== '이상 없음');
      setLeakDesc(ev.leakDesc !== '이상 없음' ? ev.leakDesc ?? '' : '');
      setShowOptions(ev.optionsDesc && ev.optionsDesc !== '이상 없음');
      setOptionsDesc(ev.optionsDesc !== '이상 없음' ? ev.optionsDesc ?? '' : '');
      setShowDrive(ev.driveDesc && ev.driveDesc !== '이상 없음');
      setDriveDesc(ev.driveDesc !== '이상 없음' ? ev.driveDesc ?? '' : '');
      setMemo(ev.memo ?? '');

      // 이미지
      const imgs = d.images ?? {};
      setDashboardImage(imgs.dashboard?.[0] ?? null);
      setRegImage(imgs.registration?.[0] ?? null);
      setVinImage(imgs.vin?.[0] ?? null);
      setImages({
        exterior: imgs.exterior ?? [],
        wheel: imgs.wheel ?? [],
        undercarriage: imgs.undercarriage ?? [],
        interior: imgs.interior ?? [],
        engine: imgs.engine ?? [],
        paperSheet: [],
      });

      // 손상 체크 & 미러
      const count = isInspection ? 35 : 37;
      setCheckedDamages(
        d.damages?.length > 0 ? d.damages : Array.from({ length: count }, () => [])
      );
      if (d.mirror_markers) setMirrorMarkers(d.mirror_markers);

      // 이미 완료된 진단이므로 바로 2단계로
      setEvaluationStarted(true);
    } catch (e) {
      console.error('Edit data load error:', e);
    }
  };

  // ─── AsyncStorage 저장/복원 ───────────────────────────────────────────────
  useEffect(() => {
    if (isViewMode) {
      loadEditData(true);
    } else if (isEditMode) {
      loadEditData(false);
    } else {
      loadSavedData();
    }
  }, []);

  useEffect(() => { saveData(); }, [
    evaluationStarted, paperSheet, dashboardImage, regImage, vinImage, images,
    mileage, color, repairCost, keyNote, smartKey, generalKey, foldingKey, specialKey,
    paintNeeded, wheelScratch, frontTire, backTire,
    showWarning, showLeak, showOptions, showDrive,
    warningDesc, leakDesc, optionsDesc, driveDesc,
    memo, mirrorMarkers, checkedDamages,
  ]);

  const saveData = async () => {
    try {
      const data = {
        evaluationStarted, paperSheet, dashboardImage, regImage, vinImage, images,
        mileage, color, repairCost, keyNote, smartKey, generalKey, foldingKey, specialKey,
        paintNeeded, wheelScratch, frontTire, backTire,
        showWarning, showLeak, showOptions, showDrive,
        warningDesc, leakDesc, optionsDesc, driveDesc,
        memo, mirrorMarkers, checkedDamages,
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { console.error('Save Error', e); }
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
        setImages(p.images || { exterior: [], wheel: [], undercarriage: [], interior: [], engine: [], paperSheet: [] });
        setMileage(p.mileage || '');
        setColor(p.color || '');
        setRepairCost(p.repairCost || '');
        setKeyNote(p.keyNote || '');
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
        setShowDrive(p.showDrive || false);
        setWarningDesc(p.warningDesc || '');
        setLeakDesc(p.leakDesc || '');
        setOptionsDesc(p.optionsDesc || '');
        setDriveDesc(p.driveDesc || '');
        setMemo(p.memo || '');
        setMirrorMarkers(p.mirrorMarkers || {
          driverCover: [], driverMirror: [], driverRepeater: [],
          passengerCover: [], passengerMirror: [], passengerRepeater: [],
        });
        const count = isInspection ? 35 : 37;
        setCheckedDamages(p.checkedDamages?.length > 0
          ? p.checkedDamages
          : Array.from({ length: count }, () => []));
      } else {
        const count = isInspection ? 35 : 37;
        setCheckedDamages(Array.from({ length: count }, () => []));
      }
    } catch (e) { console.error('Load Error', e); }
  };

  // 2. 사진 선택 함수
  const pickExtraImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 접근 권한이 필요합니다.');
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
      newUris.forEach(uri => enqueueUpload(uri, 'extra_memo'));
    }
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
        Alert.alert('알림', '기본사진(계기판, 자동차등록증, 차대번호)을 모두 업로드해주세요.');
        return;
      }
      setEvaluationStarted(true);
      return;
    }

    // 평가 완료 단계
    if (!mileage) { Alert.alert('알림', '주행거리를 입력해주세요.'); return; }
    if (isInspection && !repairCost) { Alert.alert('알림', '예상 복구비용을 입력해주세요.'); return; }

    try {
      const payload = {
        requestId,
        carNumber,
        carModel,
        serviceType,
        mileage: parseInt(mileage.replace(/,/g, '')) || 0,
        color,
        repairCost: isInspection ? parseInt(repairCost.replace(/,/g, '')) || 0 : null,
        // 기본 사진
        dashboardImage: onlyS3([dashboardImage || ''])[0] || null,
        regImage: onlyS3([regImage || ''])[0] || null,
        vinImage: onlyS3([vinImage || ''])[0] || null,
        // 차키
        keys: { smart: smartKey, general: generalKey, folding: foldingKey, special: specialKey, note: keyNote },
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
          warningDesc: showWarning ? warningDesc : '이상 없음',
          leakDesc: showLeak ? leakDesc : '이상 없음',
          optionsDesc: showOptions ? optionsDesc : '이상 없음',
          driveDesc: showDrive ? driveDesc : '이상 없음',
        },
        memo,
      };

      const submitRes = await fetch(`${API_BASE_URL}/external/inspection/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!submitRes.ok) throw new Error('데이터 저장 실패');

      await fetch(`${API_BASE_URL}/external/request/${requestId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      // 제출 완료 → 남은 업로드가 자동으로 서버에 패치
      _G.submittedId = String(requestId);

      Alert.alert(isInspection ? '검수 완료' : '평가 완료', '저장 완료! 업로드 중인 사진은 자동으로 추가됩니다.', [
        {
          text: '확인', onPress: () => {
            AsyncStorage.removeItem(STORAGE_KEY);
            router.replace('/(tabs)');
          },
        },
      ]);
    } catch (e) {
      console.error(e);
      Alert.alert('오류', '전송 중 문제가 발생했습니다.');
    }
  };

  // ─── 임시저장 ─────────────────────────────────────────────────────────────
  const handleTempSave = async () => {
    await saveData();
    Alert.alert('임시저장', '내용이 임시저장되었습니다.');
  };

  // ─── 커스텀 앨범 피커 함수 ────────────────────────────────────────────────
  const loadPickerAssets = async (album: MediaLibrary.Album | null, after?: string) => {
    setPickerLoading(true);
    try {
      const result = await MediaLibrary.getAssetsAsync({
        album: album ?? undefined,
        first: 60,
        after,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        mediaType: [MediaLibrary.MediaType.photo],
      });
      setPickerAssets(prev => after ? [...prev, ...result.assets] : result.assets);
      setPickerHasMore(result.hasNextPage);
      setPickerEndCursor(result.endCursor);
    } finally {
      setPickerLoading(false);
    }
  };

  const openCustomPicker = async (categoryId: string) => {
    // 이미지 권한 요청
    const ipPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (ipPerm.status !== 'granted') {
      Alert.alert('권한 필요', '사진첩 접근 권한을 허용해주세요.');
      return;
    }
    // MediaLibrary 내부 권한 상태 동기화
    let mlGranted = false;
    try {
      const mlPerm = await MediaLibrary.requestPermissionsAsync();
      mlGranted = mlPerm.status === 'granted';
    } catch (_) {
      mlGranted = false;
    }
    // MediaLibrary 권한 실패 시 기존 시스템 피커로 폴백
    if (!mlGranted) {
      pickImage(categoryId, 'library', false);
      return;
    }
    setPickerCategoryId(categoryId);
    setPickerSelected(new Set());
    setPickerCurrentAlbum(null);
    setAlbumDropdownOpen(false);
    const albumList = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: false });
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
    setPickerSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const SINGLE_IMG_CATS = ['dashboard', 'registration', 'vin'];

  const confirmPickerSelection = () => {
    const selectedList = pickerAssets.filter(a => pickerSelected.has(a.id));
    const categorySnapshot = pickerCategoryId;
    const uris = selectedList.map(a => a.uri);

    setPickerVisible(false);
    setPickerSelected(new Set());

    if (uris.length === 0) return;

    if (SINGLE_IMG_CATS.includes(categorySnapshot)) {
      const uri = uris[0];
      if (categorySnapshot === 'dashboard') setDashboardImage(uri);
      else if (categorySnapshot === 'registration') setRegImage(uri);
      else if (categorySnapshot === 'vin') setVinImage(uri);
      uploadSingleImage(uri, categorySnapshot);
    } else {
      setImages(prev => ({ ...prev, [categorySnapshot]: [...(prev[categorySnapshot] || []), ...uris] }));
      uris.forEach(uri => enqueueUpload(uri, categorySnapshot));
    }
  };

  const pickerLaunchCamera = () => {
    const isSingle = SINGLE_IMG_CATS.includes(pickerCategoryId);
    setPickerVisible(false);
    setTimeout(() => pickImage(pickerCategoryId, 'camera', isSingle), 300);
  };

  // ─── 이미지 선택/업로드 (DiagnosisInspection 패턴 유지) ──────────────────

  const pickImage = async (categoryId: string, type: 'camera' | 'library', isSingle: boolean) => {
    const options: ImagePicker.ImagePickerOptions = {
      quality: isSingle ? 0.5 : 0.3,
      allowsMultipleSelection: !isSingle,
    };

    try {
      if (type === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') { Alert.alert('권한 필요', '카메라 사용 권한을 허용해주세요.'); return; }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { Alert.alert('권한 필요', '사진첩 접근 권한을 허용해주세요.'); return; }
      }

      const result = type === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled) {
        const newUris = result.assets.map((a) => a.uri);

        // 카메라 촬영 시 갤러리 저장
        if (type === 'camera') {
          try {
            const { status } = await MediaLibrary.requestPermissionsAsync(true);
            if (status === 'granted') {
              for (const uri of newUris) {
                const asset = await MediaLibrary.createAssetAsync(uri);
                const album = await MediaLibrary.getAlbumAsync('Carvior');
                if (album === null) {
                  await MediaLibrary.createAlbumAsync('Carvior', asset, false);
                } else {
                  await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
                }
              }
            }
          } catch (saveError) {
            console.log('갤러리 저장 중 오류(무시):', saveError);
          }
        }

        if (isSingle) {
          const uri = newUris[0];
          // 화면 표시용 (로컬 경로)
          if (categoryId === 'dashboard') setDashboardImage(uri);
          else if (categoryId === 'registration') setRegImage(uri);
          else if (categoryId === 'vin') setVinImage(uri);

          // 서버 업로드 실행
          uploadSingleImage(uri, categoryId);
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
      console.log('사진 작업 중 오류:', e);
      Alert.alert('오류', '사진을 불러오는 중 문제가 발생했습니다.');
    }
  };

  const uploadSingleImage = async (uri: string, categoryId: string) => {
    try {
      const formData = new FormData();
      const fileName = `photo_${Date.now()}.jpg`;

      // @ts-ignore
      formData.append('file', {
        uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
        name: fileName,
        type: 'image/jpeg'
      });
      formData.append('requestId', String(requestId || ''));
      formData.append('category', categoryId);
      formData.append('carNumber', String(carNumber || '미등록'));

      console.log(`[단일] ${categoryId} 업로드 시작...`);

      const res = await fetch(`${API_BASE_URL}/external/inspection/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
          // 🌟 중요: Content-Type은 절대로 적지 않습니다.
        },
      });

      if (!res.ok) {
        const errorDetail = await res.text();
        console.error('❌ 서버 에러 상세:', errorDetail);
        return;
      }

      const result = await res.json();
      console.log(`✅ [단일] ${categoryId} 업로드 성공:`, result.url);

      if (result.url) {
        if (categoryId === 'dashboard') setDashboardImage(result.url);
        else if (categoryId === 'registration') setRegImage(result.url);
        else if (categoryId === 'vin') setVinImage(result.url);
      }
    } catch (e) {
      console.error('🔥 Upload Error (Single):', e);
    }
  };


  // ─── 이미지 삭제 (S3 서버에서도 삭제) ──────────────────
  const handleDeleteImage = async (categoryId: string, index: number) => {
    const targetUrl = images[categoryId][index];

    if (targetUrl.startsWith('file://')) {
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
        { method: 'DELETE' }
      );

      if (res.ok) {
        setImages((p) => ({
          ...p,
          [categoryId]: p[categoryId].filter((_, i) => i !== index),
        }));
      } else {
        Alert.alert('오류', '서버에서 삭제를 거부했습니다.');
      }
    } catch (e) {
      Alert.alert('오류', '네트워크 연결을 확인해주세요.');
    }
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
    setMirrorSymbols(EXTERIOR_SYMBOLS.map((s) => ({
      ...s, isSelected: current.includes(s.symbol),
    })));
    setMirrorTarget(target);
    setMirrorModalVisible(true);
  };

  const confirmMirrorModal = () => {
    if (!mirrorTarget) return;
    const selected = mirrorSymbols.filter((s) => s.isSelected).map((s) => s.symbol);
    setMirrorMarkers((prev) => ({ ...prev, [mirrorTarget]: selected }));
    setMirrorModalVisible(false);
  };


  // ─── 카운터 컴포넌트 ──────────────────────────────────────────────────────
  const Counter = ({
    label, value, onDec, onInc, onType, suffix,
  }: { label: string; value: number; onDec: () => void; onInc: () => void; onType: (n: number) => void; suffix?: string }) => (
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
            onChangeText={(t) => { const n = parseInt(t.replace(/[^0-9]/g, '')) || 0; onType(n); }}
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
    uri, label, categoryId, onRemove,
  }: { uri: string | null; label: string; categoryId: string; onRemove: () => void }) => (
    <View style={styles.singleSlotWrapper}>
      <View style={styles.dashBoxWrapper}>
        <TouchableOpacity
          style={styles.dashBox}
          onPress={() => isViewMode
            ? (uri ? (setViewerImages([uri]), setViewerIndex(0), setViewerVisible(true)) : undefined)
            : openCustomPicker(categoryId)
          }
        >
          {uri
            ? <Image source={{ uri }} style={styles.fullImg} resizeMode="cover" />
            : <><Ionicons name="camera" size={24} color="#666" /><Text style={styles.subTxt}>{label}</Text></>
          }
        </TouchableOpacity>
        {uri && !isViewMode && (
          <TouchableOpacity style={styles.removeBadgeSingle} onPress={onRemove}>
            <Ionicons name="close-circle" size={24} color="#ff4d4d" />
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.slotLabel}>{label}</Text>
    </View>
  );

  // ─── 사이드 미러 섹션 ────────────────────────────────────────────────────
  const SideMirrorSection = ({
    title,
    coverKey, mirrorKey, repeaterKey,
  }: { title: string; coverKey: keyof MirrorMarkers; mirrorKey: keyof MirrorMarkers; repeaterKey: keyof MirrorMarkers }) => (
    <View style={{ marginBottom: 20 }}>
      <Text style={styles.mirrorTitle}>{title}</Text>
      <View style={styles.mirrorTable}>
        {/* 헤더 */}
        <View style={[styles.mirrorRow, { backgroundColor: '#3B82F6' }]}>
          {['커버', '거울', '리피터'].map((h, i) => (
            <View key={h} style={[styles.mirrorCell, i === 1 && styles.mirrorCellCenter]}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{h}</Text>
            </View>
          ))}
        </View>
        {/* 값 */}
        <View style={[styles.mirrorRow, { backgroundColor: '#1a1a1a' }]}>
          {([
            [coverKey, mirrorMarkers[coverKey]],
            [mirrorKey, mirrorMarkers[mirrorKey]],
            [repeaterKey, mirrorMarkers[repeaterKey]],
          ] as [keyof MirrorMarkers, string[]][]).map(([key, val], i) => (
            <TouchableOpacity
              key={key}
              onPress={() => openMirrorModal(key)}
              style={[styles.mirrorCell, i === 1 && styles.mirrorCellCenter, { minHeight: 40 }]}
            >
              <Text style={{ color: '#fff', fontSize: 13 }}>
                {val.length > 0 ? val.join(', ') : '-'}
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
          <TouchableOpacity onPress={() => {
            if (!isViewMode && evaluationStarted) {
              Alert.alert('뒤로 가기', '임시저장 후 나가시겠습니까?', [
                { text: '저장 후 나가기', onPress: async () => { await saveData(); router.back(); } },
                { text: '저장하지 않고 나가기', style: 'destructive', onPress: () => router.back() },
              ]);
            } else {
              router.back();
            }
          }}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>
            {isViewMode ? '진단 내역' : isInspection ? '차량 검수' : '진단 평가'}
          </Text>
          {!isViewMode && uploadPending > 0 ? (
            <View style={styles.uploadBadge}>
              <ActivityIndicator size="small" color="#fff" style={{ marginRight: 4 }} />
              <Text style={styles.uploadBadgeText}>{uploadPending}</Text>
            </View>
          ) : (
            <View style={{ width: 48 }} />
          )}
        </View>

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
                        next[index] = { ...next[index], isSelected: !next[index].isSelected };
                        return next;
                      })
                    }
                    style={[
                      styles.symbolBtn,
                      { backgroundColor: item.isSelected ? '#3B82F6' : '#333' },
                    ]}
                  >
                    <Text style={styles.symbolText}>{item.symbol}</Text>
                    <Text style={styles.symbolMeaning}>({item.meaning})</Text>
                  </TouchableOpacity>
                )}
              />
              <TouchableOpacity onPress={confirmMirrorModal} style={styles.modalConfirmBtn}>
                <Text style={{ color: '#000', fontWeight: '700', fontSize: 16 }}>확인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ── 커스텀 앨범 피커 모달 ── */}
        <Modal visible={pickerVisible} animationType="slide" statusBarTranslucent onRequestClose={() => setPickerVisible(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
            {/* 헤더 */}
            <View style={styles.pickerHeader}>
              <TouchableOpacity
                style={styles.pickerAlbumBtn}
                onPress={() => setAlbumDropdownOpen(v => !v)}
              >
                <Text style={styles.pickerAlbumBtnText}>
                  {pickerCurrentAlbum ? pickerCurrentAlbum.title : '모든 사진'}
                </Text>
                <Ionicons name={albumDropdownOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#fff" />
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
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
                <TouchableOpacity style={styles.pickerAlbumItem} onPress={() => selectPickerAlbum(null)}>
                  <Text style={[styles.pickerAlbumItemText, !pickerCurrentAlbum && styles.pickerAlbumItemActive]}>
                    모든 사진
                  </Text>
                </TouchableOpacity>
                {pickerAlbums.map(album => (
                  <TouchableOpacity key={album.id} style={styles.pickerAlbumItem} onPress={() => selectPickerAlbum(album)}>
                    <Text style={[styles.pickerAlbumItemText, pickerCurrentAlbum?.id === album.id && styles.pickerAlbumItemActive]}>
                      {album.title}  ({album.assetCount})
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* 사진 그리드 */}
            <FlatList
              data={pickerAssets}
              keyExtractor={item => item.id}
              numColumns={3}
              onEndReached={() => {
                if (pickerHasMore && !pickerLoading) loadPickerAssets(pickerCurrentAlbum, pickerEndCursor);
              }}
              onEndReachedThreshold={0.4}
              ListFooterComponent={pickerLoading ? <ActivityIndicator color="#fff" style={{ padding: 24 }} /> : null}
              renderItem={({ item }) => {
                const sel = pickerSelected.has(item.id);
                const selIdx = sel ? [...pickerSelected].indexOf(item.id) + 1 : 0;
                return (
                  <TouchableOpacity onPress={() => togglePickerAsset(item.id)} style={styles.pickerThumbWrap}>
                    <Image source={{ uri: item.uri }} style={styles.pickerThumb} />
                    {sel && <View style={styles.pickerThumbDim} />}
                    <View style={[styles.pickerCheckCircle, sel && styles.pickerCheckCircleActive]}>
                      {sel && <Text style={styles.pickerCheckNum}>{selIdx}</Text>}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />

            {/* 하단 등록 버튼 */}
            {pickerSelected.size > 0 && (
              <View style={[styles.pickerFooter, { paddingBottom: Math.max(insets.bottom, 14) }]}>
                <Text style={styles.pickerFooterCount}>{pickerSelected.size}장 선택됨</Text>
                <TouchableOpacity style={styles.pickerConfirmBtn} onPress={confirmPickerSelection}>
                  <Text style={styles.pickerConfirmText}>등록</Text>
                </TouchableOpacity>
              </View>
            )}
          </SafeAreaView>
        </Modal>

        {/* 이미지 뷰어 모달 */}
        {/* 🏆 뒤로가기 잘 되는 새 이미지 뷰어 */}
        <Modal visible={viewerVisible} transparent={true} onRequestClose={() => setViewerVisible(false)}>
          <ImageViewer
            imageUrls={viewerImages.map((uri) => ({ url: uri }))} // 서버 URL 배열을 매핑
            index={viewerIndex}
            onCancel={() => setViewerVisible(false)}
            enableSwipeDown={true}
            saveToLocalByLongPress={false}
            loadingRender={() => <ActivityIndicator color="white" size="large" />}
            renderHeader={() => (
              <TouchableOpacity
                style={{ position: 'absolute', top: 50, right: 20, zIndex: 999 }}
                onPress={() => setViewerVisible(false)}
              >
                <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>닫기</Text>
              </TouchableOpacity>
            )}
          />
        </Modal>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView style={styles.container} bounces={false}>

            {/* 차량 정보 바 */}
            <View style={styles.carSummaryBar}>
              <Text style={styles.carNumText}>{carNumber || '차량번호'}</Text>
              <Text style={styles.carModelText}>{carModel || '차량모델'}</Text>
            </View>

            {/* ═══ 1. 기본 사진 ═══════════════════════════════════════════════ */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>기본 사진</Text>
            </View>
            <View style={styles.basicPhotoRow}>
              <SingleImageSlot
                uri={regImage} label="자동차등록증" categoryId="registration"
                onRemove={() => setRegImage(null)}
              />
              <SingleImageSlot
                uri={dashboardImage} label="계기판" categoryId="dashboard"
                onRemove={() => setDashboardImage(null)}
              />
              <SingleImageSlot
                uri={vinImage} label="차대번호" categoryId="vin"
                onRemove={() => setVinImage(null)}
              />
            </View>

            <View style={styles.grayDivider} />

            {/* ═══ 2. 주행거리 & 색상 ══════════════════════════════════════════ */}
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>차량 기본 정보</Text></View>

            <View style={styles.mileageSection}>
              <View style={styles.mileageInputBox}>
                <Text style={styles.inputLabel}>주행거리</Text>
                <View style={styles.inputRow}>
                  {isViewMode
                    ? <Text style={[styles.mInput, { color: '#fff', paddingVertical: 8 }]}>{mileage || '0'}</Text>
                    : <TextInput style={styles.mInput} placeholder="0" placeholderTextColor="#444" keyboardType="numeric" value={mileage} onChangeText={(t) => setMileage(formatNumber(t))} />
                  }
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
                    {isViewMode
                      ? <Text style={[styles.mInput, { color: '#fff', fontSize: 18, paddingVertical: 8 }]}>{repairCost || '0'}</Text>
                      : <TextInput style={[styles.mInput, { fontSize: 18 }]} placeholder="0" placeholderTextColor="#444" keyboardType="numeric" value={repairCost} onChangeText={(t) => setRepairCost(formatNumber(t))} />
                    }
                    <Text style={styles.unitText}>원</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.grayDivider} />

            {/* ═══ 3. 차량 내/외관 상태 ════════════════════════════════════════ */}
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>차량 내/외관 상태</Text></View>

            {/* 차키 */}
            <View style={styles.catBox}>
              <View style={styles.catHeader}>
                <Text style={styles.catTitle}>차키</Text>
                <Text style={styles.catCountText}>총 {smartKey + generalKey + foldingKey + specialKey}개</Text>
              </View>
              <View style={styles.cardDark}>
                <Counter label="스마트키" value={smartKey}
                  onDec={() => smartKey > 0 && setSmartKey(smartKey - 1)}
                  onInc={() => setSmartKey(smartKey + 1)}
                  onType={setSmartKey} />
                <View style={styles.thinDivider} />
                <Counter label="리모컨키" value={foldingKey}
                  onDec={() => foldingKey > 0 && setFoldingKey(foldingKey - 1)}
                  onInc={() => setFoldingKey(foldingKey + 1)}
                  onType={setFoldingKey} />
                <View style={styles.thinDivider} />
                <Counter label="일반키" value={generalKey}
                  onDec={() => generalKey > 0 && setGeneralKey(generalKey - 1)}
                  onInc={() => setGeneralKey(generalKey + 1)}
                  onType={setGeneralKey} />
                <View style={styles.thinDivider} />
                <Counter label="특수키" value={specialKey}
                  onDec={() => specialKey > 0 && setSpecialKey(specialKey - 1)}
                  onInc={() => setSpecialKey(specialKey + 1)}
                  onType={setSpecialKey} />
              </View>
            </View>

            {/* 외판도색 / 휠스크래치 */}
            <View style={styles.catBox}>
              <View style={styles.cardDark}>
                <Counter label="외판도색 필요" value={paintNeeded} suffix="판"
                  onDec={() => paintNeeded > 0 && setPaintNeeded(paintNeeded - 1)}
                  onInc={() => setPaintNeeded(paintNeeded + 1)}
                  onType={setPaintNeeded} />
                <View style={styles.thinDivider} />
                <Counter label="휠스크래치" value={wheelScratch} suffix="짝"
                  onDec={() => wheelScratch > 0 && setWheelScratch(wheelScratch - 1)}
                  onInc={() => setWheelScratch(wheelScratch + 1)}
                  onType={setWheelScratch} />
              </View>
            </View>

            {/* 타이어 트레드 */}
            <View style={styles.catBox}>
              <Text style={styles.catTitle}>타이어 트레드 (잔존량)</Text>
              <View style={[styles.cardDark, { marginTop: 8 }]}>
                <View style={styles.counterRow}>
                  <Text style={styles.counterLabel}>앞</Text>
                  <View style={styles.counterControls}>
                    {!isViewMode && <TouchableOpacity onPress={() => frontTire > 0 && setFrontTire(frontTire - 10)} style={styles.counterBtn}><Text style={styles.counterBtnText}>−</Text></TouchableOpacity>}
                    <Text style={styles.counterValue}>{frontTire}%</Text>
                    {!isViewMode && <TouchableOpacity onPress={() => frontTire < 100 && setFrontTire(frontTire + 10)} style={styles.counterBtn}><Text style={styles.counterBtnText}>+</Text></TouchableOpacity>}
                  </View>
                </View>
                <View style={styles.thinDivider} />
                <View style={styles.counterRow}>
                  <Text style={styles.counterLabel}>뒤</Text>
                  <View style={styles.counterControls}>
                    {!isViewMode && <TouchableOpacity onPress={() => backTire > 0 && setBackTire(backTire - 10)} style={styles.counterBtn}><Text style={styles.counterBtnText}>−</Text></TouchableOpacity>}
                    <Text style={styles.counterValue}>{backTire}%</Text>
                    {!isViewMode && <TouchableOpacity onPress={() => backTire < 100 && setBackTire(backTire + 10)} style={styles.counterBtn}><Text style={styles.counterBtnText}>+</Text></TouchableOpacity>}
                  </View>
                </View>
              </View>
            </View>

            {/* 자동차 상태 표시 범례 */}
            <View style={styles.catBox}>
              <View style={styles.legendBox}>
                <View style={styles.legendRow}>
                  {[
                    { label: 'X  교환', color: '#ff6b6b' },
                    { label: 'B  판금', color: '#a78bfa' },
                    { label: 'W  용접', color: '#60a5fa' },
                  ].map((item) => (
                    <View key={item.label} style={styles.legendItem}>
                      <Text style={[styles.legendSymbol, { color: item.color }]}>{item.label.split('  ')[0]}</Text>
                      <Text style={styles.legendText}>  {item.label.split('  ')[1]}</Text>
                    </View>
                  ))}
                </View>
              </View>
              {/* 손상 체크 */}
              <CarEvaluationDamageChecker
                checkedDamages={checkedDamages}
                onChange={isViewMode ? undefined : (index, symbols) =>
                  setCheckedDamages((prev) => {
                    const next = [...prev];
                    next[index] = symbols;
                    return next;
                  })
                }
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
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>확인사항</Text></View>

            {[
              { label: '계기판 경고등 있음', state: showWarning, setState: setShowWarning, val: warningDesc, setVal: setWarningDesc, placeholder: '경고 내용을 입력하세요' },
              { label: '옵션 기능 작동 이상', state: showOptions, setState: setShowOptions, val: optionsDesc, setVal: setOptionsDesc, placeholder: '고장 옵션을 입력하세요' },
              ...(!isInspection ? [{ label: '누유 있음', state: showLeak, setState: setShowLeak, val: leakDesc, setVal: setLeakDesc, placeholder: '누유 부위를 입력하세요' }] : []),
              { label: '주행중 이상 증상', state: showDrive, setState: setShowDrive, val: driveDesc, setVal: setDriveDesc, placeholder: '증상 내용을 입력하세요' },
            ].map((item, idx) => (
              <View key={idx}>
                <TouchableOpacity
                  style={styles.toggleRow}
                  onPress={() => !isViewMode && item.setState(!item.state)}
                  activeOpacity={isViewMode ? 1 : 0.7}
                >
                  <Text style={styles.toggleLabel}>{item.label}</Text>
                  <Ionicons
                    name={item.state ? 'checkbox' : 'square-outline'}
                    size={26}
                    color={item.state ? '#fff' : '#555'}
                  />
                </TouchableOpacity>
                {item.state && (
                  <View style={styles.expandArea}>
                    {isViewMode ? (
                      <Text style={[styles.tArea, { color: '#ccc', paddingVertical: 10 }]}>{item.val || '-'}</Text>
                    ) : (
                      <TextInput
                        style={styles.tArea}
                        placeholder={item.placeholder}
                        placeholderTextColor="#444"
                        multiline
                        value={item.val}
                        onChangeText={item.setVal}
                      />
                    )}
                  </View>
                )}
              </View>
            ))}

            <View style={styles.grayDivider} />

            {/* ═══ 5. 필수 사진 촬영 ══════════════════════════════════════════ */}
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>필수 사진 촬영</Text></View>

            {CATEGORIES.map((cat) => (
              <View key={cat.id} style={styles.catBox}>
                <View style={styles.catHeader}>
                  <Text style={styles.catTitle}>{cat.label} (최소 {cat.min}장)</Text>
                  <Text style={styles.catCountText}>{images[cat.id]?.length || 0}/30</Text>
                </View>
                <View style={styles.photoGrid}>
                  {/* 첫 칸: 사진추가 버튼 (view 모드 숨김) */}
                  {!isViewMode && (
                    <TouchableOpacity
                      style={[styles.photoWrapperGrid, styles.gridAddBtn]}
                      onPress={() => openCustomPicker(cat.id)}
                    >
                      <Ionicons name="camera" size={22} color="#666" />
                      <Text style={styles.gridAddText}>사진추가</Text>
                    </TouchableOpacity>
                  )}

                  {/* 이후 칸: 사진들 */}
                  {(images[cat.id] || []).map((uri, index) => {
                    const isUploading = !uri.startsWith('http');
                    return (
                      <View key={`${cat.id}-${index}`} style={styles.photoWrapperGrid}>
                        <TouchableOpacity
                          style={{ width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden' }}
                          activeOpacity={0.85}
                          onPress={() => openViewer(images[cat.id], index)}
                        >
                          <Image
                            source={{ uri }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                            resizeMethod="resize"
                          />
                          {isUploading && (
                            <View style={styles.uploadingOverlay}>
                              <ActivityIndicator size="small" color="#fff" />
                            </View>
                          )}
                        </TouchableOpacity>
                        {!isViewMode && (
                          <TouchableOpacity
                            style={styles.removeBadgeGrid}
                            onPress={() => handleDeleteImage(cat.id, index)}
                          >
                            <Ionicons name="close-circle" size={22} color="#ff4d4d" />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}

            {/* ═══ 6. 기타 의견 ═══════════════════════════════════════════════ */}
            <View style={styles.catBox}>
              <Text style={styles.catTitle}>기타 의견</Text>
              {isViewMode ? (
                <Text style={[styles.tArea, { color: '#ccc', paddingVertical: 10, minHeight: 60 }]}>{memo || '-'}</Text>
              ) : (
                <TextInput
                  style={[styles.tArea, { marginTop: 8, height: 100 }]}
                  placeholder="예) 정비 이력, 소모품 교환, 구조변경, 보증 연장, 블랙박스, 금연, 튜닝/아래는 도막,사고사진 등 그 외 첨부사진."
                  placeholderTextColor="#444"
                  multiline
                  value={memo}
                  onChangeText={setMemo}
                />
              )}

              {!isViewMode && (
                <TouchableOpacity
                  style={[styles.addBtn, { borderColor: styles.addBtn.borderColor, marginTop: 12 }]}
                  onPress={pickExtraImage}
                >
                  <Ionicons name="add-circle-outline" size={24} color={styles.addBtn.borderColor} />
                  <Text style={[styles.addBtnText, { color: styles.addBtn.borderColor }]}>사진 추가</Text>
                </TouchableOpacity>
              )}

              {/* 추가된 사진 리스트 (클릭 시 뷰어 연결) */}
              <View style={styles.photoGrid}>
                {extraPhotos.map((uri, index) => (
                  <View key={index} style={styles.photoWrapperGrid}>
                    {/* 1. 이미지 클릭 시 뷰어 오픈 */}
                    <TouchableOpacity onPress={() => {
                      setViewerImages(extraPhotos); // 뷰어에 보여줄 사진 배열 설정
                      setViewerIndex(index);        // 클릭한 사진 번호 설정
                      setViewerVisible(true);       // 뷰어 열기
                    }}>
                      <Image source={{ uri }} style={styles.photoItemGrid} />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.removeBadgeGrid}
                      onPress={() => removeExtraPhoto(index)}
                    >
                      <Ionicons name="close-circle" size={22} color="#ff4d4d" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>

            {/* ═══ 하단 버튼 ══════════════════════════════════════════════════ */}
            <View style={styles.bottomBar}>
              {isViewMode ? (
                <TouchableOpacity
                  style={[styles.btnHalf, { backgroundColor: '#fff', width: '100%' }]}
                  onPress={() => router.back()}
                >
                  <Text style={styles.btnTextB}>닫기</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.btnHalf, { backgroundColor: '#fff', flex: evaluationStarted ? 1 : undefined, width: evaluationStarted ? undefined : '100%' }]}
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
  safeArea: { flex: 1, backgroundColor: '#000' },
  navHeader: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15 },
  navTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  container: { flex: 1 },
  carSummaryBar: { backgroundColor: '#111', padding: 18, flexDirection: 'row', alignItems: 'center' },
  carNumText: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginRight: 12 },
  carModelText: { color: '#888', fontSize: 16 },
  grayDivider: { height: 10, backgroundColor: '#111' },
  sectionHeader: { padding: 20, paddingBottom: 10 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

  // 기본 사진
  basicPhotoRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 10, paddingBottom: 20 },
  singleSlotWrapper: { alignItems: 'center' },
  slotLabel: { color: '#888', fontSize: 11, marginTop: 4 },
  dashBoxWrapper: { position: 'relative', padding: 4 },
  dashBox: { width: 95, height: 75, backgroundColor: '#111', borderRadius: 8, borderWidth: 1, borderColor: '#333', justifyContent: 'center', alignItems: 'center' },
  fullImg: { width: '100%', height: '100%', borderRadius: 8 },
  subTxt: { color: '#555', fontSize: 10, marginTop: 3 },
  removeBadgeSingle: { position: 'absolute', top: 0, right: 0, zIndex: 999, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 15 },

  // 주행거리/색상 입력
  mileageSection: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 15, gap: 20 },
  mileageInputBox: { flex: 1 },
  inputLabel: { color: '#666', fontSize: 12, marginBottom: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'baseline', borderBottomWidth: 1, borderBottomColor: '#333' },
  mInput: { color: '#fff', fontSize: 24, fontWeight: 'bold', flex: 1, paddingVertical: 5 },
  unitText: { color: '#fff', fontSize: 16, marginLeft: 5 },

  // 카테고리
  catBox: { paddingHorizontal: 20, marginBottom: 20 },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  catTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  catCountText: { color: '#888', fontSize: 12 },
  imageGrid: { flexDirection: 'row', alignItems: 'center' },
  smallCamBtn: { width: TILE_SIZE, height: TILE_SIZE, backgroundColor: '#111', borderRadius: 8, borderStyle: 'dashed', borderWidth: 1, borderColor: '#444', justifyContent: 'center', alignItems: 'center', marginRight: 12 },

  // 드래거블 이미지
  itemOuterContainer: { width: TILE_SIZE + 20, height: TILE_SIZE + 20, justifyContent: 'center', alignItems: 'center', marginRight: 5 },
  thumbWrapper: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: 8, overflow: 'hidden' },
  smallThumb: { width: '100%', height: '100%' },
  removeBadge: { position: 'absolute', top: 0, right: 0, zIndex: 999, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 15 },

  // 카드 (다크)
  cardDark: { backgroundColor: '#111', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#222' },
  thinDivider: { height: 1, backgroundColor: '#222', marginVertical: 6 },

  // 카운터
  counterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  counterLabel: { color: '#fff', fontSize: 15 },
  counterControls: { flexDirection: 'row', alignItems: 'center' },
  counterBtn: { paddingHorizontal: 14, paddingVertical: 4 },
  counterBtnText: { fontSize: 22, color: '#fff' },
  counterValue: { color: '#3B82F6', fontWeight: 'bold', fontSize: 16, minWidth: 36, textAlign: 'center' },
  unitSmall: { color: '#888', fontSize: 13, marginHorizontal: 4 },

  // 범례
  legendBox: { backgroundColor: '#111', borderRadius: 8, padding: 12, marginBottom: 15 },
  legendRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendSymbol: { fontSize: 14, fontWeight: 'bold' },
  legendText: { color: '#aaa', fontSize: 13 },

  // 손상 체크 플레이스홀더
  damageCheckerPlaceholder: { borderWidth: 1, borderColor: '#333', borderRadius: 8, padding: 20, alignItems: 'center', justifyContent: 'center', minHeight: 80 },
  placeholderText: { color: '#555', fontSize: 13, marginTop: 6 },

  // 사이드 미러
  mirrorTitle: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  mirrorTable: { borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#333' },
  mirrorRow: { flexDirection: 'row' },
  mirrorCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  mirrorCellCenter: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },

  // 토글 확인사항
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  toggleLabel: { color: '#fff', fontSize: 16 },
  expandArea: { paddingHorizontal: 20, paddingBottom: 15 },
  tArea: { backgroundColor: '#111', color: '#fff', borderRadius: 8, padding: 12, height: 70, textAlignVertical: 'top', borderWidth: 1, borderColor: '#222' },

  // 하단 버튼
  bottomBar: { flexDirection: 'row', paddingHorizontal: 20, marginVertical: 20, gap: 10 },
  btnHalf: { flex: 1, padding: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: 'bold' },
  btnTextB: { color: '#000', fontSize: 16, fontWeight: 'bold' },

  // 모달
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '60%' },
  modalTitle: { color: '#fff', fontWeight: '700', fontSize: 16, padding: 18 },
  modalDivider: { height: 1, backgroundColor: '#333' },
  symbolBtn: { flex: 1, margin: 4, borderRadius: 8, padding: 10, alignItems: 'center', justifyContent: 'center', minHeight: 60 },
  symbolText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  symbolMeaning: { color: '#ccc', fontSize: 10, marginTop: 2 },
  modalConfirmBtn: { backgroundColor: '#fff', margin: 12, borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },

  // 뷰어
  viewerContainer: { flex: 1, backgroundColor: '#000' },
  closeViewer: { position: 'absolute', top: 50, right: 20, zIndex: 999 },
  viewerSlide: { width, height, justifyContent: 'center', alignItems: 'center' },
  fullViewerImg: { width: '100%', height: '80%' },
  viewerFooter: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' },
  footerText: { color: '#888', fontSize: 14 },

  extraSection: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(150, 150, 150, 0.1)',
  },
  extraHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  extraTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  extraSub: {
    fontSize: 13,
    marginBottom: 20,
  },
  addBtn: {
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#63489a', // theme.accent 대신 직접 입력
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  addBtnText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
  },
  photoList: {
    flexDirection: 'row',
  },
  photoWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  photoItem: {
    width: 100,
    height: 100,
    borderRadius: 8,
    backgroundColor: '#333',
  },
  submitBtn: {
    margin: 16,
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40, // 하단 여백 충분히
  },
  submitText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  // 한 줄에 4개씩 나오도록 계산된 스타일입니다.
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',    // ✅ 옆으로 안 넘어가고 아래로 내려가게 함
    marginTop: 12,
    gap: 10,             // 사진들 사이의 간격
  },
  photoWrapperGrid: {
    position: 'relative',
    width: (width - 70) / 4,
    height: (width - 70) / 4,
    marginBottom: 10,
  },
  photoItemGrid: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#333',
  },
  removeBadgeGrid: {
    position: 'absolute',
    top: -8,
    right: -8,
    zIndex: 10,
    backgroundColor: '#000',
    borderRadius: 11,
  },
  gridAddBtn: {
    backgroundColor: '#111',
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridAddText: { color: '#666', fontSize: 10, marginTop: 3 },
  uploadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99,72,154,0.85)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 48,
  },
  uploadBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // ── 커스텀 앨범 피커 ─────────────────────────────────────────────────────
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  pickerAlbumBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pickerAlbumBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  pickerAlbumDropdown: {
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    maxHeight: 300,
  },
  pickerAlbumItem: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  pickerAlbumItemText: {
    color: '#ccc',
    fontSize: 15,
  },
  pickerAlbumItemActive: {
    color: '#3B82F6',
    fontWeight: '700',
  },
  pickerThumbWrap: {
    width: width / 3,
    height: width / 3,
    position: 'relative',
  },
  pickerThumb: {
    width: '100%',
    height: '100%',
    borderWidth: 0.5,
    borderColor: '#000',
  },
  pickerThumbDim: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  pickerCheckCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCheckCircleActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  pickerCheckNum: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  pickerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  pickerFooterCount: {
    color: '#ccc',
    fontSize: 15,
  },
  pickerConfirmBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
  },
  pickerConfirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
