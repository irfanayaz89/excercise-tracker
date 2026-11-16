# Real set recordings

Turn on **Settings → Record sets for tuning**, do a set, then share the file from
Settings → Recordings. Hand-count the reps (watch a screen recording if needed) and
add an `expected` block at the top level of the JSON:

```json
"expected": { "reps": 12, "cleanReps": 10, "tolerance": 0, "notes": "side view, 1.8 m, dim room" }
```

Save it here as `<platform>-<setup>-<n>.json`. `npm test` replays every file and
fails if the engine's count drifts from your hand count. Vary people, clothing,
rooms, distances and phones.
