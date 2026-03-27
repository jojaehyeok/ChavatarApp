import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView, ScrollView,
  StatusBar, StyleSheet, Text,
  TextInput, TouchableOpacity, View
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

const { width, height } = Dimensions.get('window');
const API_BASE_URL = 'https://carvior.store/api/v1';
const TILE_SIZE = 85;

const CATEGORIES = [
  { id: 'exterior', label: '외관', min: 4 },
  { id: 'wheel', label: '휠', min: 4 },
  { id: 'undercarriage', label: '하체', min: 2 },
  { id: 'interior', label: '실내', min: 5 },
  { id: 'engine', label: '엔진룸', min: 1 },
];

export default function DiagnosisInspection() {
  const { requestId, carNumber, carModel } = useLocalSearchParams();
  const router = useRouter();
  const STORAGE_KEY = `inspection_data_${requestId}`;

  // --- 상태 관리 ---
  const [mileage, setMileage] = useState('');
  const [dashboardImage, setDashboardImage] = useState<string | null>(null);
  const [regImage, setRegImage] = useState<string | null>(null);
  const [images, setImages] = useState<{ [key: string]: string[] }>({
    exterior: [], wheel: [], undercarriage: [], interior: [], engine: [], notice: []
  });

  const [showReg, setShowReg] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [showLeak, setShowLeak] = useState(false);
  const [showTuning, setShowTuning] = useState(false);
  const [showTire, setShowTire] = useState(false);
  const [showAccident, setShowAccident] = useState(false);

  const [warningDesc, setWarningDesc] = useState('');
  const [leakDesc, setLeakDesc] = useState('');
  const [tuningDesc, setTuningDesc] = useState('');
  const [tireDesc, setTireDesc] = useState('');
  const [accidentDesc, setAccidentDesc] = useState('');

  // --- 🎬 커스텀 스와이프 뷰어 상태 (라이브러리 대체) ---
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  // --- 데이터 보존 로직 ---
  useEffect(() => { loadSavedData(); }, []);
  useEffect(() => { saveData(); }, [mileage, dashboardImage, regImage, images, warningDesc, leakDesc, tuningDesc, tireDesc, accidentDesc, showReg, showWarning, showLeak, showTuning, showTire, showAccident]);

  const saveData = async () => {
    try {
      const data = { mileage, dashboardImage, regImage, images, warningDesc, leakDesc, tuningDesc, tireDesc, accidentDesc, showReg, showWarning, showLeak, showTuning, showTire, showAccident };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { console.error('Save Error', e); }
  };

  const loadSavedData = async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        setMileage(p.mileage || '');
        setDashboardImage(p.dashboardImage || null);
        setRegImage(p.regImage || null);
        setImages(p.images || { exterior: [], wheel: [], undercarriage: [], interior: [], engine: [], notice: [] });
        setWarningDesc(p.warningDesc || '');
        setLeakDesc(p.leakDesc || '');
        setTuningDesc(p.tuningDesc || '');
        setTireDesc(p.tireDesc || '');
        setAccidentDesc(p.accidentDesc || '');
        setShowReg(p.showReg || false);
        setShowWarning(p.showWarning || false);
        setShowLeak(p.showLeak || false);
        setShowTuning(p.showTuning || false);
        setShowTire(p.showTire || false);
        setShowAccident(p.showAccident || false);
      }
    } catch (e) { console.error('Load Error', e); }
  };

  const handleComplete = async () => {
    // 🌟 [추가] 업로드 안 된 로컬 파일이 있는지 체크
    const hasLocalFile = (urls: string[]) => urls.some(url => url.startsWith('file://'));
    const allImages = [
      ...(dashboardImage ? [dashboardImage] : []),
      ...(regImage ? [regImage] : []),
      ...Object.values(images).flat()
    ];

    if (hasLocalFile(allImages)) {
      Alert.alert("업로드 중", "아직 사진 업로드가 완료되지 않았습니다. 잠시만 기다려주세요.");
      return;
    }

    if (!mileage) {
      Alert.alert("알림", "주행거리를 입력해주세요.");
      return;
    }

    try {
      // S3 URL(http)만 골라내는 안전장치
      const onlyS3 = (urls: string[]) => (urls || []).filter(url => url.startsWith('http'));

      const inspectionData = {
        requestId: requestId,
        carNumber: carNumber,
        carModel: carModel,
        mileage: parseInt(mileage) || 0,
        // 단일 이미지 처리
        dashboardImage: (dashboardImage && dashboardImage.startsWith('http')) ? dashboardImage : null,
        regImage: (regImage && regImage.startsWith('http')) ? regImage : null,
        // 카테고리별 사진 필터링
        photos: {
          exterior: onlyS3(images.exterior),
          wheel: onlyS3(images.wheel),
          undercarriage: onlyS3(images.undercarriage),
          interior: onlyS3(images.interior),
          engine: onlyS3(images.engine),
        },
        inspectionDetails: {
          warningDesc: showWarning ? warningDesc : "이상 없음",
          leakDesc: showLeak ? leakDesc : "이상 없음",
          tuningDesc: showTuning ? tuningDesc : "없음",
          tireDesc: showTire ? tireDesc : "양호",
          accidentDesc: showAccident ? accidentDesc : "무사고",
          notice: "",
          merit: ""
        }
      };

      console.log("최종 제출 데이터:", JSON.stringify(inspectionData));

      // 1. 데이터 제출
      const submitRes = await fetch(`${API_BASE_URL}/external/inspection/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inspectionData),
      });

      if (!submitRes.ok) throw new Error('데이터 저장 실패');

      // 2. 상태 업데이트
      await fetch(`${API_BASE_URL}/external/request/${requestId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      Alert.alert("진단 완료", "서버에 성공적으로 저장되었습니다.", [
        {
          text: "확인", onPress: () => {
            AsyncStorage.removeItem(STORAGE_KEY);
            router.replace('/(tabs)');
          }
        }
      ]);

    } catch (e) {
      console.error(e);
      Alert.alert("오류", "전송 중 문제가 발생했습니다.");
    }
  };

  // --- 📸 사진 선택 및 업로드 ---
  const handlePickImage = (categoryId: string, isSingle: boolean = false) => {
    Alert.alert("사진 선택", "촬영하거나 갤러리에서 가져오세요.", [
      { text: "카메라", onPress: () => pickImage(categoryId, 'camera', isSingle) },
      { text: "갤러리", onPress: () => pickImage(categoryId, 'library', isSingle) },
      { text: "취소", style: "cancel" }
    ]);
  };

  const pickImage = async (categoryId: string, type: 'camera' | 'library', isSingle: boolean) => {
    const options: ImagePicker.ImagePickerOptions = { quality: 0.5, allowsMultipleSelection: !isSingle };

    try {
      if (type === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert("권한 필요", "카메라 사용 권한을 허용해주세요.");
          return;
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert("권한 필요", "사진첩 접근 권한을 허용해주세요.");
          return;
        }
      }

      const result = type === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled) {
        const newUris = result.assets.map(a => a.uri);

        // 🌟 [추가됨] 카메라로 찍었을 때만 갤러리에 저장하는 로직
        if (type === 'camera') {
          try {
            // 미디어 라이브러리 권한 확인 (빌드된 앱에서는 오디오 에러 안 남)
            const { status } = await MediaLibrary.requestPermissionsAsync(true);
            if (status === 'granted') {
              for (const uri of newUris) {
                // 1. 자산 생성
                const asset = await MediaLibrary.createAssetAsync(uri);
                // 2. 'Chavatar'라는 앨범에 저장 (앨범 없으면 자동 생성)
                const album = await MediaLibrary.getAlbumAsync('Chavatar');
                if (album === null) {
                  await MediaLibrary.createAlbumAsync('Chavatar', asset, false);
                } else {
                  await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
                }
                console.log("📸 갤러리 저장 성공:", uri);
              }
            }
          } catch (saveError) {
            console.log("갤러리 저장 중 오류(무시):", saveError);
          }
        }

        if (isSingle) {
          const uri = newUris[0];
          if (categoryId === 'dashboard') setDashboardImage(uri);
          else if (categoryId === 'registration') setRegImage(uri);
          uploadImage(uri, categoryId, true);
        } else {
          setImages(prev => ({
            ...prev,
            [categoryId]: [...(prev[categoryId] || []), ...newUris]
          }));
          newUris.forEach(uri => uploadImage(uri, categoryId, false));
        }
      }
    } catch (e) {
      console.log("사진 작업 중 오류:", e);
      Alert.alert("오류", "사진을 불러오는 중 문제가 발생했습니다.");
    }
  };

  const uploadImage = async (uri: string, categoryId: string, isSingle: boolean) => {
    try {
      const formData = new FormData();
      // @ts-ignore
      formData.append('file', { uri, name: `photo_${Date.now()}.jpg`, type: 'image/jpeg' });
      formData.append('requestId', String(requestId || ''));
      formData.append('category', categoryId);
      formData.append('carNumber', String(carNumber || '미등록'));

      const res = await fetch(`${API_BASE_URL}/external/inspection/upload`, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (!res.ok) throw new Error('서버 업로드 실패');

      const result = await res.json();
      if (result.url) {
        if (isSingle) {
          categoryId === 'dashboard' ? setDashboardImage(result.url) : setRegImage(result.url);
        } else {
          setImages(prev => ({
            ...prev,
            [categoryId]: prev[categoryId].map(img => img === uri ? result.url : img)
          }));
        }
      }
    } catch (e) {
      // 🌟 중요: 네트워크 에러가 나도 이미 화면에는 file:// 경로로 사진이 떠 있습니다.
      // 발표 때는 "업로드 중" 표시가 계속 떠 있어도 사진은 보이니까 당황하지 마세요.
      console.error('Upload Error', e);
    }
  };

  // ✅ 스와이프 뷰어 열기
  const openViewer = (imgs: string[], index: number) => {
    setViewerImages(imgs);
    setViewerIndex(index);
    setViewerVisible(true);
  };

  const renderDraggableItem = useCallback(({ item, drag, isActive, getIndex }: RenderItemParams<string>, categoryId: string) => {
    const index = getIndex();
    return (
      <ScaleDecorator>
        <View style={styles.itemOuterContainer}>
          <TouchableOpacity
            onLongPress={drag}
            onPress={() => openViewer(images[categoryId], index || 0)}
            style={[styles.thumbWrapper, { opacity: isActive ? 0.5 : 1 }]}>
            <Image
              source={{ uri: item }}
              style={[
                styles.smallThumb,
                { opacity: item.startsWith('file://') ? 0.4 : 1 } // 로컬 파일이면 흐리게
              ]}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.removeBadge}
            onPress={() => index !== undefined && setImages(p => ({ ...p, [categoryId]: p[categoryId].filter((_, i) => i !== index) }))}>
            <Ionicons name="close-circle" size={26} color="#ff4d4d" />
          </TouchableOpacity>
        </View>
      </ScaleDecorator>
    );
  }, [images]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <View style={styles.navHeader}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color="#fff" /></TouchableOpacity>
          <Text style={styles.navTitle}>진단 촬영</Text>
          <View style={{ width: 24 }} />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView style={styles.container} bounces={false}>
            <View style={styles.carSummaryBar}>
              <Text style={styles.carNumText}>{carNumber || '차량번호'}</Text>
              <Text style={styles.carModelText}>{carModel || '차량모델'}</Text>
            </View>

            {/* 1. 계기판 & 주행거리 */}
            <View style={styles.mileageSection}>
              <View style={styles.dashBoxWrapper}>
                <TouchableOpacity style={styles.dashBox} onPress={() => handlePickImage('dashboard', true)}>
                  {dashboardImage ? <Image source={{ uri: dashboardImage }} style={styles.fullImg} /> : (
                    <><Ionicons name="camera" size={24} color="#666" /><Text style={styles.subTxt}>계기판</Text></>
                  )}
                </TouchableOpacity>
                {dashboardImage && (
                  <TouchableOpacity style={styles.removeBadgeSingle} onPress={() => setDashboardImage(null)}>
                    <Ionicons name="close-circle" size={24} color="#ff4d4d" />
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.mileageInputBox}>
                <Text style={styles.inputLabel}>주행거리</Text>
                <View style={styles.inputRow}>
                  <TextInput style={styles.mInput} placeholder="0" placeholderTextColor="#444" keyboardType="numeric" value={mileage} onChangeText={setMileage} />
                  <Text style={styles.unitText}>km</Text>
                </View>
              </View>
            </View>

            <View style={styles.grayDivider} />

            {/* 2. 확인사항 */}
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>확인사항</Text></View>
            <TouchableOpacity style={styles.toggleRow} onPress={() => setShowReg(!showReg)}>
              <Text style={styles.toggleLabel}>자동차 등록증</Text>
              <Ionicons name={showReg ? "checkbox" : "square-outline"} size={26} color={showReg ? "#fff" : "#333"} />
            </TouchableOpacity>
            {showReg && (
              <View style={styles.regArea}>
                <View style={styles.dashBoxWrapper}>
                  <TouchableOpacity style={styles.dashBox} onPress={() => handlePickImage('registration', true)}>
                    {regImage ? <Image source={{ uri: regImage }} style={styles.fullImg} /> : <Ionicons name="camera" size={30} color="#666" />}
                  </TouchableOpacity>
                  {regImage && (
                    <TouchableOpacity style={styles.removeBadgeSingle} onPress={() => setRegImage(null)}>
                      <Ionicons name="close-circle" size={24} color="#ff4d4d" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {[
              { label: '경고등 점등 여부', state: showWarning, setState: setShowWarning, val: warningDesc, setVal: setWarningDesc },
              { label: '누유/누수 여부', state: showLeak, setState: setShowLeak, val: leakDesc, setVal: setLeakDesc },
              { label: '튜닝/개조 사항', state: showTuning, setState: setShowTuning, val: tuningDesc, setVal: setTuningDesc },
              { label: '타이어 상태', state: showTire, setState: setShowTire, val: tireDesc, setVal: setTireDesc },
              { label: '사고/수리 이력', state: showAccident, setState: setShowAccident, val: accidentDesc, setVal: setAccidentDesc },
            ].map((item, idx) => (
              <View key={idx}>
                <TouchableOpacity style={styles.toggleRow} onPress={() => item.setState(!item.state)}>
                  <Text style={styles.toggleLabel}>{item.label}</Text>
                  <Ionicons name={item.state ? "checkbox" : "square-outline"} size={26} color={item.state ? "#fff" : "#333"} />
                </TouchableOpacity>
                {item.state && (
                  <View style={styles.expandArea}>
                    <TextInput style={styles.tArea} placeholder="내용을 입력하세요" placeholderTextColor="#444" multiline value={item.val} onChangeText={item.setVal} />
                  </View>
                )}
              </View>
            ))}

            <View style={styles.grayDivider} />

            {/* 3. 필수 사진 촬영 */}
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>필수 사진 촬영</Text></View>
            {CATEGORIES.map((cat) => (
              <View key={cat.id} style={styles.catBox}>
                <View style={styles.catHeader}>
                  <Text style={styles.catTitle}>{cat.label} (최소 {cat.min}장)</Text>
                  <Text style={styles.catCountText}>{images[cat.id]?.length || 0}장</Text>
                </View>
                <View style={styles.imageGrid}>
                  <TouchableOpacity style={styles.smallCamBtn} onPress={() => handlePickImage(cat.id)}>
                    <Ionicons name="camera" size={24} color="#fff" />
                  </TouchableOpacity>
                  <DraggableFlatList
                    horizontal
                    data={images[cat.id] || []}
                    keyExtractor={(item, index) => `${cat.id}-${index}`}
                    onDragEnd={({ data }) => setImages(prev => ({ ...prev, [cat.id]: data }))}
                    renderItem={(params) => renderDraggableItem(params, cat.id)}
                    showsHorizontalScrollIndicator={false}
                    containerStyle={{ flex: 1 }}
                  />
                </View>
              </View>
            ))}

            <View style={styles.bottomBar}>
              <TouchableOpacity style={styles.btnWhite} onPress={handleComplete}>
                <Text style={styles.btnTextB}>진단 완료</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 60 }} />
          </ScrollView>
        </KeyboardAvoidingView>

        {/* 🎬 [에러 방지용 커스텀 스와이프 슬라이더] */}
        <Modal visible={viewerVisible} transparent={true} animationType="fade">
          <View style={styles.viewerContainer}>
            <TouchableOpacity style={styles.closeViewer} onPress={() => setViewerVisible(false)}>
              <Ionicons name="close" size={35} color="#fff" />
            </TouchableOpacity>

            <FlatList
              data={viewerImages}
              horizontal
              pagingEnabled
              initialScrollIndex={viewerIndex}
              getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
              keyExtractor={(_, i) => i.toString()}
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <View style={styles.viewerSlide}>
                  <Image source={{ uri: item }} style={styles.fullViewerImg} resizeMode="contain" />
                </View>
              )}
            />
            <View style={styles.viewerFooter}>
              <Text style={styles.footerText}>좌우로 밀어서 확인</Text>
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  navHeader: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15 },
  navTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  container: { flex: 1 },
  carSummaryBar: { backgroundColor: '#111', padding: 18, flexDirection: 'row', alignItems: 'center' },
  carNumText: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginRight: 12 },
  carModelText: { color: '#888', fontSize: 16 },
  mileageSection: { flexDirection: 'row', padding: 20, alignItems: 'center' },
  dashBoxWrapper: { position: 'relative', padding: 10 },
  dashBox: { width: 100, height: 75, backgroundColor: '#111', borderRadius: 8, borderWidth: 1, borderColor: '#333', justifyContent: 'center', alignItems: 'center' },
  fullImg: { width: '100%', height: '100%', borderRadius: 8 },
  subTxt: { color: '#555', fontSize: 11, marginTop: 4 },
  mileageInputBox: { flex: 1, marginLeft: 15 },
  inputLabel: { color: '#666', fontSize: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'baseline', borderBottomWidth: 1, borderBottomColor: '#333' },
  mInput: { color: '#fff', fontSize: 28, fontWeight: 'bold', flex: 1, paddingVertical: 5 },
  unitText: { color: '#fff', fontSize: 18, marginLeft: 5 },
  grayDivider: { height: 10, backgroundColor: '#111' },
  sectionHeader: { padding: 20, paddingBottom: 10 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: 0.5, borderBottomColor: '#111' },
  toggleLabel: { color: '#fff', fontSize: 16 },
  expandArea: { paddingHorizontal: 20, paddingBottom: 15 },
  regArea: { paddingHorizontal: 20, paddingBottom: 15 },
  tArea: { backgroundColor: '#111', color: '#fff', borderRadius: 8, padding: 12, height: 70, textAlignVertical: 'top', borderWidth: 1, borderColor: '#222' },
  catBox: { paddingHorizontal: 20, marginBottom: 25 },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  catTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  catCountText: { color: '#888', fontSize: 12 },
  imageGrid: { flexDirection: 'row', alignItems: 'center' },
  smallCamBtn: { width: TILE_SIZE, height: TILE_SIZE, backgroundColor: '#111', borderRadius: 8, borderStyle: 'dashed', borderWidth: 1, borderColor: '#444', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  itemOuterContainer: { width: TILE_SIZE + 20, height: TILE_SIZE + 20, justifyContent: 'center', alignItems: 'center', marginRight: 5 },
  thumbWrapper: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: 8, overflow: 'hidden' },
  smallThumb: { width: '100%', height: '100%' },
  removeBadge: { position: 'absolute', top: 0, right: 0, zIndex: 999, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 15 },
  removeBadgeSingle: { position: 'absolute', top: 0, right: 0, zIndex: 999, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 15 },
  bottomBar: { paddingHorizontal: 20, marginVertical: 20 },
  btnWhite: { backgroundColor: '#fff', padding: 18, borderRadius: 12, alignItems: 'center' },
  btnTextB: { color: '#000', fontSize: 16, fontWeight: 'bold' },

  // 🎬 뷰어 스타일
  viewerContainer: { flex: 1, backgroundColor: '#000' },
  closeViewer: { position: 'absolute', top: 50, right: 20, zIndex: 999 },
  viewerSlide: { width, height: height, justifyContent: 'center', alignItems: 'center' },
  fullViewerImg: { width: '100%', height: '80%' },
  viewerFooter: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' },
  footerText: { color: '#888', fontSize: 14 }
});