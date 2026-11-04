import type { CSSProperties } from 'react';
import type { PromotionAudience } from '../types';
import { PROMOTION_AUDIENCE_LABELS } from '../utils/promotionAudience';

export default function PromotionAudienceSelect({ value, onChange, style }: {
  value?: PromotionAudience;
  onChange: (value: PromotionAudience) => void;
  style?: CSSProperties;
}) {
  return <label style={{ fontWeight: 800 }}>
    Visible to
    <select style={style} value={value ?? 'both'} onChange={event => onChange(event.target.value as PromotionAudience)}>
      {(Object.entries(PROMOTION_AUDIENCE_LABELS) as Array<[PromotionAudience, string]>).map(([value, label]) =>
        <option key={value} value={value}>{label}</option>)}
    </select>
  </label>;
}
