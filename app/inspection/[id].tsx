import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  LogBox,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

// 발표 중 노란색 경고창 방지
LogBox.ignoreAllLogs();

const { width, height } = Dimensions.get('window');

// --- 보조 컴포넌트 1: 사진 그룹 (가로 스크롤) ---
// 뷰어 오픈 함수(onPressImage)를 인자로 받도록 수정했습니다.
function PhotoGroup({ title, images, onPressImage }: { title: string; images?: string[]; onPressImage: (index: number) => void }) {
  const hasImages = images && images.length > 0;

  return (
    <View style={styles.photoSection}>
      <View style={styles.photoHeader}>
        <Text style={styles.photoSectionTitle}>{title}</Text>
        <Text style={styles.countText}>{hasImages ? `${images.length}장` : '0장'}</Text>
      </View>

      {hasImages ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: 20 }}>
          {images.map((url, index) => (
            <TouchableOpacity key={index} onPress={() => onPressImage(index)}>
              <Image source={{ uri: url }} style={styles.scrollImg} resizeMode="cover" />
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyPhotoBox}>
          <Ionicons name="images-outline" size={20} color="#333" />
          <Text style={styles.emptyPhotoText}>등록된 사진이 없습니다.</Text>
        </View>
      )}
    </View>
  );
}

// --- 보조 컴포넌트 2: 정보 행 ---
function InfoItem({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '이상 없음 (양호)'}</Text>
    </View>
  );
}

export default function InspectionDetailView() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // --- 🎬 뷰어 관련 상태 ---
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const fetchDetail = async () => {
    try {
      const res = await fetch(`https://carvior.store/api/v1/external/inspection/report/${id}`);
      if (res.ok) {
        const json = await res.json();
        setData({
          carNumber: json.car_info?.number,
          carModel: json.car_info?.type,
          mileage: json.car_info?.mileage,
          dashboardImage: json.images?.dashboard?.[0],
          regImage: json.images?.registration?.[0],
          photos: {
            exterior: json.images?.exterior || [],
            wheel: json.images?.wheel || [],
            undercarriage: json.images?.undercarriage || [],
            interior: json.images?.interior || [],
            engine: json.images?.engine || [],
          },
          inspectionDetails: {
            warningDesc: json.evaluation?.warningDesc,
            leakDesc: json.evaluation?.leakDesc,
            tuningDesc: json.evaluation?.tuningDesc,
            tireDesc: json.evaluation?.tireDesc,
            accidentDesc: json.evaluation?.accidentDesc,
            notice: json.evaluation?.notice,
            merit: json.evaluation?.merit,
          }
        });
      } else {
        loadDummyData();
      }
    } catch (e) {
      loadDummyData();
    } finally {
      setLoading(false);
    }
  };

  const loadDummyData = () => {
    setData({
      carNumber: "123가 4567",
      carModel: "현대 그랜저 GN7 (진단 완료)",
      mileage: 15420,
      dashboardImage: "https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?q=80&w=600",
      regImage: "https://images.unsplash.com/photo-1586281380349-632531db7ed4?q=80&w=600",
      photos: {
        exterior: [
          "https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=400",
          "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?q=80&w=400"
        ],
        wheel: ["https://images.unsplash.com/photo-1551522435-a13afa10f103?q=80&w=400"],
        undercarriage: [],
        interior: ["https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?q=80&w=400"],
        engine: ["https://images.unsplash.com/photo-1486006920555-c77dcf18193c?q=80&w=400"]
      },
      inspectionDetails: {
        warningDesc: "없음 (양호)",
        leakDesc: "없음 (양호)",
        tuningDesc: "순정 상태",
        tireDesc: "앞 80%, 뒤 70% 잔여",
        accidentDesc: "무사고 (단순 외판 교환 없음)",
        notice: "신차급 컨디션 유지 중이며 소모품 교체가 필요 없는 우수한 상태입니다.",
        merit: "1인 신조 차량으로 실내외 관리가 매우 뛰어납니다."
      }
    });
  };

  // ✅ 뷰어 열기 함수
  const openViewer = (imgs: string[], index: number) => {
    if (!imgs || imgs.length === 0) return;
    setViewerImages(imgs);
    setViewerIndex(index);
    setViewerVisible(true);
  };

  const handleEditRequest = () => {
    Alert.alert("수정 확인", "이 진단 내역을 수정하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "수정하기", onPress: () => Alert.alert("알림", "수정 기능 준비 중입니다.") }
    ]);
  };

  if (loading) return (
    <View style={styles.darkContainer}>
      <ActivityIndicator color="#0ea5e9" size="large" />
      <Text style={{ color: '#666', marginTop: 15, fontSize: 16 }}>정밀 리포트 분석 중...</Text>
    </View>
  );

  if (!data) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      <View style={styles.navHeader}>
        <Text style={styles.navTitle}>정밀 진단 리포트</Text>
        <TouchableOpacity onPress={handleEditRequest} style={styles.editBtnWrapper}>
          <Text style={styles.editBtnText}>수정 요청</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.container} bounces={false}>
        <View style={styles.carSummaryBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.carNumText}>{data.carNumber}</Text>
            <Text style={styles.carModelText}>{data.carModel}</Text>
          </View>
          <View style={styles.mileageBadge}>
            <Text style={styles.mileageText}>
              {data.mileage?.toLocaleString()} km
            </Text>
          </View>
        </View>

        <View style={styles.grayDivider} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📄 필수 증빙 사진</Text>
          <View style={styles.mainPhotoRow}>
            <TouchableOpacity style={styles.photoBox} onPress={() => data.dashboardImage && openViewer([data.dashboardImage], 0)}>
              <Text style={styles.photoLabel}>계기판 실사</Text>
              {data.dashboardImage ? (
                <Image source={{ uri: data.dashboardImage }} style={styles.mainImg} />
              ) : (
                <View style={styles.noImgBox}><Text style={styles.noImgText}>미등록</Text></View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoBox} onPress={() => data.regImage && openViewer([data.regImage], 0)}>
              <Text style={styles.photoLabel}>자동차 등록증</Text>
              {data.regImage ? (
                <Image source={{ uri: data.regImage }} style={styles.mainImg} />
              ) : (
                <View style={styles.noImgBox}><Text style={styles.noImgText}>미등록</Text></View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.grayDivider} />

        <PhotoGroup title="📸 외관 (Exterior)" images={data.photos?.exterior} onPressImage={(idx) => openViewer(data.photos.exterior, idx)} />
        <PhotoGroup title="🛞 휠 & 타이어 (Wheels)" images={data.photos?.wheel} onPressImage={(idx) => openViewer(data.photos.wheel, idx)} />
        <PhotoGroup title="🔩 하체 점검 (Undercarriage)" images={data.photos?.undercarriage} onPressImage={(idx) => openViewer(data.photos.undercarriage, idx)} />
        <PhotoGroup title="💺 실내 상태 (Interior)" images={data.photos?.interior} onPressImage={(idx) => openViewer(data.photos.interior, idx)} />
        <PhotoGroup title="⚙️ 엔진룸 (Engine)" images={data.photos?.engine} onPressImage={(idx) => openViewer(data.photos.engine, idx)} />

        <View style={styles.grayDivider} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📋 항목별 점검 결과</Text>
          <InfoItem label="경고등 점등" value={data.inspectionDetails?.warningDesc} />
          <InfoItem label="누유/누수" value={data.inspectionDetails?.leakDesc} />
          <InfoItem label="튜닝/개조" value={data.inspectionDetails?.tuningDesc} />
          <InfoItem label="타이어 상태" value={data.inspectionDetails?.tireDesc} />
          <InfoItem label="사고/수리 이력" value={data.inspectionDetails?.accidentDesc} />
        </View>

        <View style={styles.grayDivider} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>✍️ 진단사 종합 소견</Text>
          <View style={styles.opinionBox}>
            <Text style={styles.opinionLabel}>⚠️ 주의 및 고지사항</Text>
            <Text style={styles.opinionText}>{data.inspectionDetails?.notice || '특이사항 없음'}</Text>
          </View>
          <View style={[styles.opinionBox, { marginTop: 15, borderLeftColor: '#FFD700', borderLeftWidth: 4 }]}>
            <Text style={[styles.opinionLabel, { color: '#FFD700' }]}>✨ 차량 장점</Text>
            <Text style={styles.opinionText}>{data.inspectionDetails?.merit || '내용 없음'}</Text>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* 🎬 갤러리 뷰어 모달 (스와이프 가능) */}
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
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  darkContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  navHeader: { height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15 },
  iconBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  navTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  editBtnWrapper: { backgroundColor: '#333', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  editBtnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  container: { flex: 1 },
  carSummaryBar: { backgroundColor: '#111', padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  carNumText: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  carModelText: { color: '#888', fontSize: 14, marginTop: 4 },
  mileageBadge: { backgroundColor: '#222', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  mileageText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  section: { paddingHorizontal: 20, paddingVertical: 25 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 20 },
  mainPhotoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  photoBox: { width: '48%' },
  photoLabel: { color: '#666', fontSize: 12, marginBottom: 8 },
  mainImg: { width: '100%', height: 120, borderRadius: 10, backgroundColor: '#111' },
  noImgBox: { width: '100%', height: 120, borderRadius: 10, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#222' },
  noImgText: { color: '#444', fontSize: 12 },
  grayDivider: { height: 8, backgroundColor: '#111' },
  photoSection: { paddingVertical: 25 },
  photoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 15 },
  photoSectionTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  countText: { color: '#666', fontSize: 14 },
  scrollImg: { width: 160, height: 120, borderRadius: 8, marginRight: 12, backgroundColor: '#111' },
  emptyPhotoBox: { marginHorizontal: 20, height: 100, backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#1a1a1a', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
  emptyPhotoText: { color: '#444', fontSize: 13, marginLeft: 8 },
  infoRow: { paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#111', marginHorizontal: 20 },
  infoLabel: { color: '#666', fontSize: 14, marginBottom: 8 },
  infoValue: { color: '#fff', fontSize: 16, lineHeight: 22 },
  opinionBox: { backgroundColor: '#111', padding: 20, borderRadius: 12 },
  opinionLabel: { color: '#ff4d4d', fontSize: 13, fontWeight: 'bold', marginBottom: 10 },
  opinionText: { color: '#ddd', fontSize: 15, lineHeight: 24 },
  // 🎬 뷰어 스타일
  viewerContainer: { flex: 1, backgroundColor: '#000' },
  closeViewer: { position: 'absolute', top: 50, right: 20, zIndex: 999, padding: 10 },
  viewerSlide: { width, height, justifyContent: 'center', alignItems: 'center' },
  fullViewerImg: { width: '100%', height: '80%' },
  viewerFooter: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' },
  footerText: { color: '#888', fontSize: 14 }
});