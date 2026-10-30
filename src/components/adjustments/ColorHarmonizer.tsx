import { useTranslation } from 'react-i18next';
import Dropdown from '../ui/Dropdown';
import Slider from '../ui/Slider';
import {
  HARMONY_RULES,
  buildHarmonyMesh,
  createHarmonizer,
  harmonyNodes,
  type HarmonizerState,
  type HarmonyRule,
} from '../../utils/colorHarmonizer';
import type { Adjustments } from '../../utils/adjustments';
import {
  OKLAB_COLOR_SPACE,
  RAPIDRAW_DISPLAY_SRGB_D65,
  warperCoordinatesToGamutMappedWorkingRgb,
} from '../../utils/colorWarper';
import { useEditorStore } from '../../store/useEditorStore';

const EMPTY_POINTS: [number, number, number][] = [];

interface Props {
  adjustments: Adjustments;
  setAdjustments(value: Partial<Adjustments> | ((previous: Adjustments) => Adjustments)): void;
  onDragStateChange?(dragging: boolean): void;
}
export default function ColorHarmonizer({ adjustments, setAdjustments, onDragStateChange }: Props) {
  const { t } = useTranslation();
  const state = adjustments.colorWarper.harmonizer ?? createHarmonizer();
  const points = useEditorStore((s) => s.colorWarperDistribution?.points ?? EMPTY_POINTS);
  const nodes = harmonyNodes(state);
  const update = (change: Partial<HarmonizerState>) => {
    setAdjustments((previous) => {
      const next = { ...(previous.colorWarper.harmonizer ?? createHarmonizer()), ...change };
      next.polar = buildHarmonyMesh(next);
      const result = { ...previous, colorWarper: { ...previous.colorWarper, harmonizer: next } };
      return result;
    });
  };
  const slider = (
    key: keyof HarmonizerState,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    suffix = '',
  ) => (
    <Slider
      label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      suffix={suffix}
      onDragStateChange={onDragStateChange}
      onChange={(e) => update({ [key]: Number(e.target.value) })}
    />
  );
  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox="0 0 240 240"
        className="w-full max-w-[280px] self-center rounded-md bg-bg-primary border border-border-color"
        role="img"
        aria-label={t('adjustments.colorWarper.harmonyPlot')}
      >
        {[30, 60, 90].map((r) => (
          <circle key={r} cx="120" cy="120" r={r} fill="none" stroke="currentColor" opacity="0.2" />
        ))}
        {points.slice(0, 8192).map(([l, a, b], i) => (
          <circle
            key={i}
            cx={120 + a * 225}
            cy={120 - b * 225}
            r="0.8"
            fill="currentColor"
            opacity={0.18 + Math.min(0.35, l * 0.35)}
          />
        ))}
        {nodes.map((node, i) => {
          const angle = (node * Math.PI) / 180;
          const { rgb } = warperCoordinatesToGamutMappedWorkingRgb(RAPIDRAW_DISPLAY_SRGB_D65, OKLAB_COLOR_SPACE, [
            0.7,
            0.14 * Math.cos(angle),
            0.14 * Math.sin(angle),
          ]);
          const color = `rgb(${rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255)).join(' ')})`;
          return (
            <g key={i}>
              <line
                x1="120"
                y1="120"
                x2={120 + Math.cos(angle) * 95}
                y2={120 - Math.sin(angle) * 95}
                stroke="currentColor"
                opacity="0.65"
              />
              <circle
                cx={120 + Math.cos(angle) * 95}
                cy={120 - Math.sin(angle) * 95}
                r="5"
                fill={color}
                stroke="currentColor"
              />
            </g>
          );
        })}
      </svg>
      <label className="text-xs text-text-secondary">{t('adjustments.colorWarper.harmonyRule')}</label>
      <Dropdown
        className="w-full"
        triggerClassName="bg-surface"
        value={state.rule}
        options={[...(Object.keys(HARMONY_RULES) as Array<keyof typeof HARMONY_RULES>), 'custom' as const].map(
          (value) => ({ value, label: t(`adjustments.colorWarper.harmonyRules.${value}`) }),
        )}
        onChange={(value) => {
          if (value === 'custom' && state.rule !== 'custom') {
            const customHues = [...state.customHues];
            nodes.forEach((hue, i) => {
              customHues[i] = hue;
            });
            update({ rule: 'custom', count: Math.max(2, nodes.length), customHues });
          } else update({ rule: value as HarmonyRule });
        }}
      />
      {state.rule === 'custom' ? (
        <>
          {slider('count', t('adjustments.colorWarper.harmonyCount'), 2, 4, 1, state.count)}
          {nodes.map((hue, i) => (
            <Slider
              key={i}
              label={t('adjustments.colorWarper.harmonyNode', { number: i + 1 })}
              min={0}
              max={360}
              step={1}
              value={hue}
              suffix="°"
              onDragStateChange={onDragStateChange}
              onChange={(e) => {
                const customHues = [...state.customHues];
                customHues[i] = Number(e.target.value);
                update({ customHues });
              }}
            />
          ))}
        </>
      ) : (
        slider('anchor', t('adjustments.colorWarper.harmonyAnchor'), 0, 360, 1, state.anchor, '°')
      )}
      {slider('strength', t('adjustments.colorWarper.harmonyStrength'), 0, 1, 0.01, state.strength)}
      <details className="group border-t border-border-color pt-2">
        <summary className="cursor-pointer text-xs text-text-secondary hover:text-text-primary">
          {t('adjustments.colorWarper.moreOptions')}
        </summary>
        <div className="flex flex-col gap-3 pt-3">
          {slider('width', t('adjustments.colorWarper.harmonyWidth'), 0.25, 4, 0.05, state.width)}
          {slider('protection', t('adjustments.colorWarper.harmonyProtection'), 0, 1, 0.01, state.protection)}
          {nodes.map((_, i) => (
            <Slider
              key={i}
              label={t('adjustments.colorWarper.harmonySaturation', { number: i + 1 })}
              min={0}
              max={2}
              step={0.01}
              value={state.saturations[i]}
              defaultValue={1}
              onDragStateChange={onDragStateChange}
              onChange={(e) => {
                const saturations = [...state.saturations];
                saturations[i] = Number(e.target.value);
                update({ saturations });
              }}
            />
          ))}
          <p className="text-xs text-text-secondary">{t('adjustments.colorWarper.harmonyHelp')}</p>
        </div>
      </details>
    </div>
  );
}
