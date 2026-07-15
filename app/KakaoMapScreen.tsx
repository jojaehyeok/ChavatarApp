import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { KAKAO_JS_API_KEY, KAKAO_REST_API_KEY } from '../constants/api';

interface MarkerInfo {
  lat: number;
  lng: number;
  title: string;
  address: string;
  dateTime: string;
}

const geocodeKakao = async (address: string): Promise<{ lat: number; lng: number } | null> => {
  try {
    const headers = { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` };
    const res = await axios.get('https://dapi.kakao.com/v2/local/search/address.json', {
      params: { query: address }, headers,
    });
    const doc = res.data?.documents?.[0];
    if (doc) return { lat: parseFloat(doc.y), lng: parseFloat(doc.x) };
    const res2 = await axios.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
      params: { query: address }, headers,
    });
    const doc2 = res2.data?.documents?.[0];
    if (doc2) return { lat: parseFloat(doc2.y), lng: parseFloat(doc2.x) };
    return null;
  } catch { return null; }
};

function buildMapHtml(markers: MarkerInfo[]): string {
  const center =
    markers.length > 0
      ? {
          lat: markers.reduce((s, m) => s + m.lat, 0) / markers.length,
          lng: markers.reduce((s, m) => s + m.lng, 0) / markers.length,
        }
      : { lat: 37.5665, lng: 126.978 };

  const level = markers.length > 1 ? 9 : 4;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; background:#f0f0f0; }
    #map { width:100%; height:100%; }
    .badge {
      position:fixed; top:10px; left:50%; transform:translateX(-50%);
      background:rgba(99,72,154,0.92); color:#fff;
      padding:6px 16px; border-radius:20px; font-size:13px;
      font-weight:600; letter-spacing:0.3px; z-index:9999;
      box-shadow:0 2px 8px rgba(0,0,0,0.25);
    }
    #errbox {
      display:none; position:fixed; inset:0; background:#fff;
      flex-direction:column; align-items:center; justify-content:center;
      padding:24px; z-index:9998; text-align:center;
    }
    #errbox .title { font-size:17px; font-weight:700; color:#e53e3e; margin-bottom:10px; }
    #errbox .desc { font-size:13px; color:#555; line-height:1.7; }
    #errbox .hint { margin-top:16px; font-size:12px; color:#999; line-height:1.6; background:#f7f7f7; padding:12px; border-radius:8px; }
  </style>
  <script>
    window.onerror = function(msg, src, line, col, err) {
      var box = document.getElementById('errbox');
      if (box) {
        box.style.display = 'flex';
        document.getElementById('errmsg').textContent = msg;
      }
      return true;
    };
  </script>
  <script
    src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_API_KEY}&autoload=false"
    onerror="document.getElementById('errbox').style.display='flex'; document.getElementById('errmsg').textContent='Kakao Maps SDK 로드 실패 — 도메인 미등록 또는 키 오류';">
  </script>
</head>
<body>
  <div id="map"></div>
  <div class="badge">${markers.length}개 예약 위치</div>
  <div id="errbox">
    <div class="title">지도 로드 실패</div>
    <div class="desc" id="errmsg">알 수 없는 오류</div>
    <div class="hint">
      카카오 개발자 콘솔 → 내 애플리케이션 → 플랫폼 → Web<br>
      사이트 도메인에 <b>https://carvior.store</b> 등록 후 재시도
    </div>
  </div>
  <script>
    var markerData = ${JSON.stringify(markers)};

    if (typeof kakao === 'undefined') {
      document.getElementById('errbox').style.display = 'flex';
      document.getElementById('errmsg').textContent = 'kakao 객체 없음 — SDK 로드 실패 (도메인 미등록 가능성)';
    } else {
      kakao.maps.load(function() {
        try {
          var mapContainer = document.getElementById('map');
          var map = new kakao.maps.Map(mapContainer, {
            center: new kakao.maps.LatLng(${center.lat}, ${center.lng}),
            level: ${level}
          });

          var bounds = new kakao.maps.LatLngBounds();
          var infoOverlays = [];

          // 네이티브로 URL 오픈 요청 (WebView는 target=_blank를 못 엶)
          function openExternal(url) {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'openUrl', url: url }));
            }
          }

          // 카비오 로고 핀 HTML 생성 함수
          function logoPin(num) {
            return '<div onclick="toggleInfo(' + num + ')" style="cursor:pointer;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 3px 8px rgba(0,0,0,0.35));">'
              + '<div style="width:46px;height:46px;background:#7C3AED;border-radius:14px;border:3px solid white;display:flex;align-items:center;justify-content:center;">'
              + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="26" height="26">'
              + '<path d="M67 36C57 27 33 30 30 50C27 70 46 75 60 70" stroke="white" stroke-width="12" stroke-linecap="round" fill="none"/>'
              + '<line x1="70" y1="44" x2="58" y2="44" stroke="white" stroke-width="6" stroke-linecap="round" opacity="0.55"/>'
              + '<line x1="70" y1="56" x2="53" y2="56" stroke="white" stroke-width="6" stroke-linecap="round" opacity="0.55"/>'
              + '</svg>'
              + '</div>'
              + '<div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:11px solid #7C3AED;margin-top:-2px;"></div>'
              + '<div style="background:#7C3AED;color:white;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:700;font-family:sans-serif;margin-top:3px;min-width:20px;text-align:center;">' + num + '</div>'
              + '</div>';
          }

          for (var i = 0; i < markerData.length; i++) {
            (function(info, idx) {
              var pos = new kakao.maps.LatLng(info.lat, info.lng);
              bounds.extend(pos);

              new kakao.maps.CustomOverlay({
                map: map,
                position: pos,
                content: logoPin(idx + 1),
                yAnchor: 1.0,
                zIndex: 3
              });

              var navUrl = 'https://map.kakao.com/link/to/' + encodeURIComponent(info.title) + ',' + info.lat + ',' + info.lng;
              var roadviewUrl = 'https://map.kakao.com/link/roadview/' + info.lat + ',' + info.lng;

              var infoDiv = '<div style="position:relative;background:white;border-radius:14px;padding:14px 16px 12px;min-width:210px;max-width:260px;box-shadow:0 4px 20px rgba(0,0,0,0.22);font-family:sans-serif;">'
                + '<div onclick="toggleInfo(' + idx + ')" style="position:absolute;top:9px;right:11px;cursor:pointer;font-size:18px;color:#aaa;line-height:1;">×</div>'
                + '<div style="font-size:14px;font-weight:700;color:#63489a;margin-bottom:6px;padding-right:18px;">' + info.title + '</div>'
                + '<div style="font-size:12px;color:#555;margin-bottom:3px;">📍 ' + info.address + '</div>'
                + '<div style="font-size:12px;color:#888;margin-bottom:10px;">🕐 ' + info.dateTime + '</div>'
                + '<div style="display:flex;gap:7px;">'
                + '<div onclick="openExternal(\\'' + navUrl + '\\')" style="flex:1;background:#63489a;color:white;text-align:center;padding:7px 0;border-radius:8px;font-size:12px;font-weight:700;">🚗 길찾기</div>'
                + '<div onclick="openExternal(\\'' + roadviewUrl + '\\')" style="flex:1;background:#f1f0f7;color:#63489a;text-align:center;padding:7px 0;border-radius:8px;font-size:12px;font-weight:700;">🔭 로드뷰</div>'
                + '</div>'
                + '</div>';

              var infoOverlay = new kakao.maps.CustomOverlay({
                position: pos,
                content: infoDiv,
                yAnchor: 1.6,
                zIndex: 5
              });
              infoOverlays.push(infoOverlay);
            })(markerData[i], i);
          }

          window.toggleInfo = function(idx) {
            var zero = idx - 1;
            for (var j = 0; j < infoOverlays.length; j++) {
              if (j === zero) {
                infoOverlays[j].setMap(infoOverlays[j].getMap() ? null : map);
              } else {
                infoOverlays[j].setMap(null);
              }
            }
          };

          if (markerData.length > 1) { map.setBounds(bounds, 70); }
          map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        } catch(e) {
          document.getElementById('errbox').style.display = 'flex';
          document.getElementById('errmsg').textContent = e.message;
        }
      });
    }
  </script>
</body>
</html>`;
}

export default function KakaoMapScreen() {
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const params = useLocalSearchParams<{ items: string }>();
  const [markers, setMarkers] = useState<MarkerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const handleWebViewMessage = (event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload?.type === 'openUrl' && payload.url) {
        Linking.openURL(payload.url);
      }
    } catch {
      // 무시 (예상치 못한 메시지 포맷)
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const raw = JSON.parse(params.items || '[]') as Array<{
          address: string;
          title: string;
          dateTime: string;
        }>;
        const results = await Promise.all(
          raw.map(async item => {
            const coords = await geocodeKakao(item.address);
            return coords
              ? { ...coords, title: item.title, address: item.address, dateTime: item.dateTime }
              : null;
          })
        );
        const valid = results.filter((r): r is MarkerInfo => r !== null);
        if (valid.length === 0) setError('주소를 지도에서 찾을 수 없습니다.');
        else setMarkers(valid);
      } catch {
        setError('데이터를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    })();
  }, [params.items]);

  const bg = isDark ? '#111' : '#fff';
  const textMain = isDark ? '#fff' : '#000';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <View style={[styles.header, { backgroundColor: bg, borderBottomColor: isDark ? '#222' : '#eee' }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={textMain} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: textMain }]}>예약 위치 지도</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#63489a" />
          <Text style={[styles.msg, { color: isDark ? '#aaa' : '#666' }]}>주소 변환 중...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color="#e53e3e" />
          <Text style={[styles.msg, { color: '#e53e3e' }]}>{error}</Text>
        </View>
      ) : (
        <WebView
          style={styles.webview}
          source={{ html: buildMapHtml(markers), baseUrl: 'https://carvior.store' }}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
          mixedContentMode="always"
          allowFileAccess
          allowUniversalAccessFromFileURLs
          onMessage={handleWebViewMessage}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 14, borderBottomWidth: 1,
  },
  backBtn: { padding: 4, width: 40 },
  title: { fontSize: 17, fontWeight: '700' },
  webview: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  msg: { fontSize: 14 },
});
