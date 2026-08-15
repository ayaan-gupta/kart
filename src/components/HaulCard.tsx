import React from 'react';
import { StyleSheet, View } from 'react-native';
import { cardEdge, color, radius, shadow, space } from '../design/tokens';
import { Caption, Headline, Sub, Title } from '../design/type';
import { haulCount } from '../engine/store';
import type { Haul } from '../engine/types';
import { PressableScale } from './PressableScale';
import { ProductImage } from './ProductImage';

export function haulDateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const COLLAGE_GAP = 8;

function Collage({ haul, tile }: { haul: Haul; tile: number }) {
  const categories = haul.items.map((it) => it.category).slice(0, 4);
  while (categories.length < 4 && haul.items.length > 0) {
    categories.push(haul.items[categories.length % haul.items.length].category);
  }
  return (
    <View style={[collage.grid, { width: tile * 2 + COLLAGE_GAP, height: tile * 2 + COLLAGE_GAP }]}>
      {categories.map((category, i) => (
        <ProductImage key={`${category}${i}`} category={category} size={tile} />
      ))}
    </View>
  );
}

const collage = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: COLLAGE_GAP,
  },
});

/** Big hero card for the most recent cart. */
export function HeroHaulCard({ haul, onPress }: { haul: Haul; onPress: () => void }) {
  const count = haulCount(haul.items);
  return (
    <PressableScale onPress={onPress} accessibilityLabel={`Open ${haul.name}`}>
      <View style={styles.hero}>
        <Collage haul={haul} tile={58} />
        <View style={styles.heroText}>
          <Sub>{haulDateLabel(haul.endedAt)}</Sub>
          <Title style={styles.heroName}>{haul.name}</Title>
          <View style={styles.heroMeta}>
            <View style={styles.countChip}>
              <Caption color={color.ink}>{count === 1 ? '1 item' : `${count} items`}</Caption>
            </View>
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

/** Grid card for everything else. */
export function HaulCard({ haul, onPress }: { haul: Haul; onPress: () => void }) {
  const count = haulCount(haul.items);
  return (
    <PressableScale onPress={onPress} accessibilityLabel={`Open ${haul.name}`} containerStyle={styles.gridCell}>
      <View style={styles.card}>
        <Collage haul={haul} tile={44} />
        <View style={styles.cardText}>
          <Headline numberOfLines={1}>{haul.name}</Headline>
          <Sub>{haulDateLabel(haul.endedAt)}</Sub>
        </View>
        <View style={styles.cardMeta}>
          <Caption>{count === 1 ? '1 item' : `${count} items`}</Caption>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: 20,
    ...shadow.raise,
    ...cardEdge,
  },
  heroText: { flex: 1, gap: 4 },
  heroName: { fontSize: 23, lineHeight: 28 },
  heroMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.m,
  },
  countChip: {
    backgroundColor: color.pill,
    borderRadius: radius.pill,
    paddingHorizontal: space.m,
    paddingVertical: 5,
  },
  gridCell: { flexBasis: '46%', flexGrow: 1 },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.l,
    gap: space.m,
    ...shadow.raise,
    ...cardEdge,
  },
  cardText: { gap: 1 },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
