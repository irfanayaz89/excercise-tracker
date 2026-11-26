import { View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { color } from './theme';

interface Props {
  /** One entry per rep: true = clean, false = counted with a fault. */
  reps: boolean[];
  height?: number;
  /** Max groups to show before collapsing into the newest ones. */
  maxGroups?: number;
}

/**
 * Reps as tally marks: four strokes and a slash per group of five. Clean reps
 * are chalk, reps with a form fault are amber.
 */
export function Tally({ reps, height = 34, maxGroups = 8 }: Props) {
  const groups: boolean[][] = [];
  for (let i = 0; i < reps.length; i += 5) groups.push(reps.slice(i, i + 5));
  const shown = groups.slice(-maxGroups);
  const gw = height * 0.9;
  const stroke = Math.max(2.5, height / 10);

  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: height * 0.35 }}
      accessibilityLabel={`${reps.length} reps, ${reps.filter(Boolean).length} clean, ${reps.length - reps.filter(Boolean).length} flagged`}
    >
      {shown.map((g, gi) => (
        <Svg key={gi} width={gw} height={height} viewBox={`0 0 ${gw} ${height}`}>
          {g.slice(0, 4).map((clean, i) => {
            const x = stroke + i * ((gw - stroke * 2) / 3.4);
            return (
              <Line
                key={i}
                x1={x}
                y1={stroke}
                x2={x + 1}
                y2={height - stroke}
                stroke={clean ? color.chalk : color.cue}
                strokeWidth={stroke}
                strokeLinecap="round"
              />
            );
          })}
          {g.length === 5 && (
            <Line
              x1={0 + stroke / 2}
              y1={height * 0.78}
              x2={gw - stroke / 2}
              y2={height * 0.22}
              stroke={g[4] ? color.vial : color.cue}
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          )}
        </Svg>
      ))}
    </View>
  );
}
