import { LinearGradient } from 'expo-linear-gradient';
import { VideoView, type VideoPlayer } from 'expo-video';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { type SharedValue } from 'react-native-reanimated';
import { color } from '../design/tokens';
import type { Detection } from '../engine/types';
import { ItemHighlights } from './ItemHighlights';

interface ScanFeedProps {
  player: VideoPlayer;
  timeSv: SharedValue<number>;
  detections: Detection[];
}

/** The live viewfinder: real top-down footage, item highlights, legibility scrims. */
export function ScanFeed({ player, timeSv, detections }: ScanFeedProps) {
  return (
    <View style={styles.feed} pointerEvents="none">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <LinearGradient
        colors={['rgba(10,11,13,0.62)', 'rgba(10,11,13,0)']}
        locations={[0, 1]}
        style={styles.topScrim}
      />
      <LinearGradient
        colors={['rgba(10,11,13,0)', 'rgba(10,11,13,0.5)', 'rgba(10,11,13,0.85)']}
        locations={[0, 0.6, 1]}
        style={styles.bottomScrim}
      />
      <ItemHighlights timeSv={timeSv} detections={detections} />
    </View>
  );
}

const styles = StyleSheet.create({
  feed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.feed,
  },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 200 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 340 },
});
