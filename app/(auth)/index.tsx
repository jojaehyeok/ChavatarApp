import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    Image,
    ImageBackground, KeyboardAvoidingView, Modal,
    Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput,
    TouchableOpacity, View
} from 'react-native';

const API_BASE_URL = 'https://carvior.store/api/v1';

export default function LoadingLoginScreen() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true); // ✅ 로딩 상태 추가 (깜빡임 방지)

    // 🌟 자동 로그인 체크 로직
    useEffect(() => {
        const checkLoginStatus = async () => {
            try {
                const driverId = await AsyncStorage.getItem('driverId');
                const driverName = await AsyncStorage.getItem('driverName');

                if (driverId && driverName) {
                    // 기록이 있으면 바로 메인(tabs)으로 이동
                    router.replace('/(tabs)');
                }
            } catch (e) {
                console.error("로그인 상태 체크 실패", e);
            } finally {
                setIsLoading(false); // 체크 끝나면 로그인 화면 보여줌
            }
        };

        checkLoginStatus();
    }, []);
    // --- 로그인 관련 상태 ---
    const [loginId, setLoginId] = useState('');
    const [loginPw, setLoginPw] = useState('');

    // --- 가입 신청 모달 관련 상태 ---
    const [isRegisterModal, setRegisterModal] = useState(false);
    const [licenseImage, setLicenseImage] = useState<string | null>(null);
    const [regInfo, setRegInfo] = useState({
        accountId: '',
        password: '',
        name: '',
        phone: '',
        region: '',
        experience: '',
    });

    // ✅ 공통 알림 함수
    const showAlert = (title: string, message: string) => {
        if (Platform.OS === 'web') {
            alert(`${title}: ${message}`);
        } else {
            Alert.alert(title, message);
        }
    };

    // ✅ 로그인 처리 함수
    const handleLogin = async () => {
        if (!loginId || !loginPw) {
            showAlert("알림", "아이디와 비밀번호를 입력해주세요.");
            return;
        }

        try {
            const res = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: loginId, password: loginPw }),
            });

            const data = await res.json();

            if (res.ok) {
                await AsyncStorage.setItem('driverId', String(data.driverId));
                await AsyncStorage.setItem('driverUsername', loginId);
                await AsyncStorage.setItem('driverName', data.name);
                showAlert("환영합니다", `${data.name} 진단사님, 반갑습니다.`);
                router.replace('/(tabs)');
            } else {
                showAlert("로그인 실패", data.message || "정보를 확인해주세요.");
            }
        } catch (e) {
            showAlert("오류", "서버와 통신할 수 없습니다.");
        }
    };

    // ✅ 자격증 사진 선택
    const pickLicense = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            showAlert("알림", "갤러리 접근 권한이 필요합니다.");
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'], 
            allowsEditing: true,
            quality: 0.7,
        });
        if (!result.canceled) setLicenseImage(result.assets[0].uri);
    };

    // ✅ 가입 신청 제출 함수
    const handleRegisterRequest = async () => {
        const { accountId, password, name, phone } = regInfo;
        if (!accountId || !password || !name || !phone || !licenseImage) {
            showAlert("알림", "필수 정보와 자격증 사진을 모두 입력해주세요.");
            return;
        }

        const formData = new FormData();
        Object.keys(regInfo).forEach(key => formData.append(key, (regInfo as any)[key]));

        const filename = licenseImage.split('/').pop() || 'license.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : `image/jpeg`;

        formData.append('licenseFile', {
            uri: Platform.OS === 'android' ? licenseImage : licenseImage.replace('file://', ''),
            name: filename,
            type: type,
        } as any);

        try {
            const res = await fetch(`${API_BASE_URL}/drivers/register`, {
                method: 'POST',
                body: formData,
            });

            if (res.ok) {
                showAlert("신청 완료", "관리자 승인 후 로그인이 가능합니다.");
                setRegisterModal(false);
            } else {
                const err = await res.json();
                showAlert("오류", err.message || "신청 중 오류가 발생했습니다.");
            }
        } catch (e) {
            showAlert("오류", "서버 연결에 실패했습니다.");
        }
    };

    return (
        <ImageBackground
            source={{ uri: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?q=80&w=1000&auto=format&fit=crop' }}
            style={styles.background}
        >
            <View style={styles.overlay}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex1}>
                    <View style={styles.centerContent}>
                        <View style={styles.logoSection}><Text style={styles.logoMain}>chavatar</Text></View>
                        <View style={styles.inputCard}>
                            <TextInput
                                placeholder="아이디"
                                placeholderTextColor="#888888" // ✅ 더 진한 플레이스홀더
                                style={[styles.input, styles.inputBorder]}
                                value={loginId}
                                onChangeText={setLoginId}
                                autoCapitalize="none"
                            />
                            <TextInput
                                placeholder="비밀번호"
                                placeholderTextColor="#888888" // ✅ 더 진한 플레이스홀더
                                style={styles.input}
                                secureTextEntry
                                value={loginPw}
                                onChangeText={setLoginPw}
                            />
                        </View>
                        <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
                            <Text style={styles.loginButtonText}>로그인</Text>
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
                <View style={styles.footer}>
                    <TouchableOpacity style={styles.registerButton} onPress={() => setRegisterModal(true)}>
                        <Text style={styles.registerButtonText}>진단사 가입신청</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <Modal visible={isRegisterModal} animationType="slide" presentationStyle="pageSheet">
                <SafeAreaView style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalHeaderTitle}>진단사 파트너 신청</Text>
                        <TouchableOpacity onPress={() => setRegisterModal(false)}><Ionicons name="close" size={28} color="#000" /></TouchableOpacity>
                    </View>
                    <ScrollView style={styles.modalBody}>
                        <View style={styles.formGroup}>
                            <Text style={styles.label}>계정 정보</Text>
                            <TextInput 
                                style={styles.modalInput} 
                                placeholder="사용할 아이디" 
                                placeholderTextColor="#888888"
                                onChangeText={(txt) => setRegInfo({ ...regInfo, accountId: txt })} 
                                autoCapitalize="none" 
                            />
                            <TextInput 
                                style={[styles.modalInput, { marginTop: 10 }]} 
                                placeholder="비밀번호" 
                                placeholderTextColor="#888888"
                                secureTextEntry 
                                onChangeText={(txt) => setRegInfo({ ...regInfo, password: txt })} 
                            />
                        </View>
                        <View style={styles.formGroup}>
                            <Text style={styles.label}>인적 사항</Text>
                            <TextInput 
                                style={styles.modalInput} 
                                placeholder="성함" 
                                placeholderTextColor="#888888"
                                onChangeText={(txt) => setRegInfo({ ...regInfo, name: txt })} 
                            />
                            <TextInput 
                                style={[styles.modalInput, { marginTop: 10 }]} 
                                placeholder="연락처" 
                                placeholderTextColor="#888888"
                                keyboardType="phone-pad" 
                                onChangeText={(txt) => setRegInfo({ ...regInfo, phone: txt })} 
                            />
                        </View>
                        <View style={styles.formGroup}>
                            <Text style={styles.label}>자격증 사진</Text>
                            <TouchableOpacity style={styles.licenseBtn} onPress={pickLicense}>
                                {licenseImage ? <Image source={{ uri: licenseImage }} style={{ width: '100%', height: '100%' }} /> : <Ionicons name="camera" size={40} color="#ccc" />}
                            </TouchableOpacity>
                        </View>
                        <TouchableOpacity style={styles.modalSubmitButton} onPress={handleRegisterRequest}>
                            <Text style={styles.modalSubmitButtonText}>신청서 제출</Text>
                        </TouchableOpacity>
                        <View style={{ height: 40 }} />
                    </ScrollView>
                </SafeAreaView>
            </Modal>
        </ImageBackground>
    );
}

const styles = StyleSheet.create({
    background: { flex: 1 },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 30 },
    flex1: { flex: 1 },
    centerContent: { flex: 1, justifyContent: 'center' },
    logoSection: { alignItems: 'center', marginBottom: 40 },
    logoMain: { color: '#fff', fontSize: 48, fontWeight: 'bold' },
    inputCard: { backgroundColor: '#ffffff', borderRadius: 12, overflow: 'hidden' }, // ✅ 배경 흰색 명시
    input: { 
        padding: 16, 
        fontSize: 16, 
        color: '#000000', // ✅ 글자색 검정색 명시
        backgroundColor: '#ffffff' // ✅ 배경색 흰색 명시
    },
    inputBorder: { borderBottomWidth: 1, borderBottomColor: '#eee' },
    loginButton: { backgroundColor: '#2563eb', padding: 16, borderRadius: 12, marginTop: 16, alignItems: 'center' },
    loginButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    footer: { position: 'absolute', bottom: 50, left: 30, right: 30 },
    registerButton: { padding: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#fff' },
    registerButtonText: { color: '#fff', fontSize: 16 },
    modalContainer: { flex: 1, backgroundColor: '#f8f9fa' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, backgroundColor: '#fff', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee' },
    modalHeaderTitle: { fontSize: 18, fontWeight: 'bold', color: '#000' },
    modalBody: { padding: 20 },
    formGroup: { marginBottom: 20 },
    label: { fontSize: 15, fontWeight: '600', marginBottom: 8, color: '#333' },
    modalInput: { 
        backgroundColor: '#ffffff', // ✅ 배경 흰색 명시
        color: '#000000', // ✅ 글자색 검정색 명시
        borderWidth: 1, 
        borderColor: '#ddd', 
        borderRadius: 8, 
        padding: 12, 
        fontSize: 16 
    },
    licenseBtn: { height: 180, backgroundColor: '#eee', borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: '#ccc', overflow: 'hidden' },
    modalSubmitButton: { backgroundColor: '#2563eb', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 10 },
    modalSubmitButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' }
});