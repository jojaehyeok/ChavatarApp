import { Ionicons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import { Dimensions, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 4;
const TILE_SIZE = (width - 100) / COLUMN_COUNT; // 삭제 버튼 공간 확보를 위해 사이즈 조정

interface Props {
  title?: string;
  maxCount?: number;
  images: string[];
  onPick: () => void;
  onRemove: (index: number) => void;
  onReorder?: (newData: string[]) => void;
  isSingle?: boolean;
}

export default function ImageUploader({ title, maxCount, images, onPick, onRemove, onReorder, isSingle }: Props) {
  const renderItem = useCallback(({ item, drag, isActive, getIndex }: RenderItemParams<string>) => {
    const index = getIndex();
    return (
      <ScaleDecorator>
        <TouchableOpacity
          onLongPress={drag}
          disabled={isActive || isSingle}
          style={[
            styles.thumbWrapper, 
            { 
              opacity: isActive ? 0.5 : 1, 
              width: isSingle ? 100 : TILE_SIZE, 
              height: isSingle ? 75 : TILE_SIZE 
            }
          ]}
        >
          <Image source={{ uri: item }} style={styles.thumbImg} />
          <TouchableOpacity 
            style={styles.removeBadge} 
            onPress={() => index !== undefined && onRemove(index)}
          >
            <View style={styles.iconBg}>
              <Ionicons name="close" size={14} color="#fff" />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  }, [images, isSingle]);

  return (
    <View style={isSingle ? null : styles.catBox}>
      {title && !isSingle && (
        <View style={styles.catHeader}>
          <Text style={styles.catTitle}>{title} (최소 {maxCount}장)</Text>
          <Text style={styles.catCountText}>{images.length}장</Text>
        </View>
      )}

      <View style={styles.imageGrid}>
        {(!isSingle || images.length === 0) && (
          <TouchableOpacity 
            style={[styles.addBtn, { width: isSingle ? 100 : TILE_SIZE, height: isSingle ? 75 : TILE_SIZE }]} 
            onPress={onPick}
          >
            <Ionicons name="camera" size={24} color="#666" />
            {isSingle && <Text style={styles.subTxt}>{title}</Text>}
          </TouchableOpacity>
        )}

        <DraggableFlatList
          horizontal
          data={images}
          keyExtractor={(item, index) => `${title}-${index}`}
          onDragEnd={({ data }) => onReorder?.(data)}
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          containerStyle={{ flex: 1, overflow: 'visible' }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  catBox: { paddingHorizontal: 20, marginBottom: 25 },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  catTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  catCountText: { color: '#fff', fontSize: 12 },
  imageGrid: { flexDirection: 'row', alignItems: 'center', overflow: 'visible' },
  addBtn: { backgroundColor: '#111', borderRadius: 8, borderStyle: 'dashed', borderWidth: 1, borderColor: '#333', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  subTxt: { color: '#555', fontSize: 11, marginTop: 4 },
  thumbWrapper: { marginRight: 20, marginTop: 10, position: 'relative', overflow: 'visible' },
  thumbImg: { width: '100%', height: '100%', borderRadius: 8, backgroundColor: '#222' },
  removeBadge: { position: 'absolute', top: -12, right: -12, zIndex: 10, padding: 5 },
  iconBg: {
    backgroundColor: '#ff4d4d',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000'
  }
});