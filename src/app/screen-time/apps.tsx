import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenTime, type InstalledApp } from '../../../modules/screen-time/src';
import { finishPick } from '@/screentime/edit';
import { EMPTY_SELECTION } from '@/screentime/rules';
import type { Selection } from '@/screentime/types';
import { Body, Button, Display, Label, Mono, Strong } from '@/ui/primitives';
import { color, font, radius, space } from '@/ui/theme';

/** Android's app picker (iPhone uses Apple's own). Lists launchable apps with their categories. */
export default function AppPicker() {
  const insets = useSafeAreaInsets();
  const { title, current } = useLocalSearchParams<{ title?: string; current?: string }>();
  const start = useMemo<Selection>(() => {
    try {
      return current ? { ...EMPTY_SELECTION, ...(JSON.parse(current) as Selection) } : EMPTY_SELECTION;
    } catch {
      return EMPTY_SELECTION;
    }
  }, [current]);
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [picked, setPicked] = useState(() => new Set(start.apps));
  const [cats, setCats] = useState(() => new Set(start.categories));
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    void (ScreenTime?.installedApps?.() ?? Promise.resolve([])).then((a) => live && setApps(a)).catch(() => live && setApps([]));
    return () => {
      live = false;
      // Leaving any other way counts as cancel.
      finishPick(null);
    };
  }, []);

  const categories = useMemo(() => [...new Set((apps ?? []).map((a) => a.category).filter(Boolean))].sort(), [apps]);
  const shown = (apps ?? []).filter((a) => !q || a.label.toLowerCase().includes(q.toLowerCase()));
  const toggle = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.ground, paddingTop: insets.top + space.lg }}>
      <View style={[styles.pad, { gap: space.md }]}>
        <View style={styles.header}>
          <Display size={30}>{title ?? 'Pick apps'}</Display>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
            <Label tone="chalk">Cancel</Label>
          </Pressable>
        </View>
        {categories.length > 0 && (
          <View style={styles.chips}>
            {categories.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: cats.has(c) }}
                onPress={() => setCats((s) => toggle(s, c))}
                style={[styles.chip, cats.has(c) && styles.chipOn]}
              >
                <Mono size={12} tone={cats.has(c) ? 'ink' : 'chalk'}>
                  {`All ${c}`}
                </Mono>
              </Pressable>
            ))}
          </View>
        )}
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search apps"
          placeholderTextColor={color.faint}
          style={styles.search}
          accessibilityLabel="Search apps"
        />
      </View>
      {apps === null ? (
        <ActivityIndicator color={color.vial} style={{ marginTop: space.xxl }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(a) => a.packageName}
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.huge }}
          ListEmptyComponent={<Body tone="muted">No apps found.</Body>}
          renderItem={({ item }) => {
            const viaCat = cats.has(item.category);
            const on = picked.has(item.packageName) || viaCat;
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: viaCat }}
                disabled={viaCat}
                onPress={() => setPicked((s) => toggle(s, item.packageName))}
                style={styles.row}
              >
                <View style={[styles.box, on && styles.boxOn]} />
                <View style={{ flex: 1 }}>
                  <Strong size={15}>{item.label}</Strong>
                  <Mono size={11} tone="muted">
                    {viaCat ? `in ${item.category}` : item.category || item.packageName}
                  </Mono>
                </View>
              </Pressable>
            );
          }}
        />
      )}
      <View style={[styles.pad, { paddingBottom: insets.bottom + space.lg }]}>
        <Button
          label={`Done · ${picked.size} app${picked.size === 1 ? '' : 's'}${cats.size ? `, ${cats.size} categor${cats.size === 1 ? 'y' : 'ies'}` : ''}`}
          onPress={() => {
            finishPick({ apps: [...picked].sort(), categories: [...cats].sort(), domains: [] });
            router.back();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: space.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.md, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, justifyContent: 'center' },
  chipOn: { backgroundColor: color.vial, borderColor: color.vial },
  search: { height: 44, borderRadius: radius.md, backgroundColor: color.surface, paddingHorizontal: space.md, color: color.chalk, fontFamily: font.body },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: color.line },
  boxOn: { backgroundColor: color.vial, borderColor: color.vial },
});
