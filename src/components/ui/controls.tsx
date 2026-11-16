import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  def?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const { label, value, min, max, step = 1, def, format, onChange } = props;
  const p = ((value - min) / (max - min)) * 100;
  const modified = def !== undefined && Math.abs(value - def) > 1e-6;
  return (
    <div className="field">
      <div className="field-top">
        <span className="label">{label}</span>
        <span
          className={`field-val ${modified ? 'mod' : ''}`}
          onDoubleClick={() => def !== undefined && onChange(def)}
          title={def !== undefined ? 'Double-click to reset' : undefined}
        >
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--p' as string]: `${Math.max(0, Math.min(100, p))}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => def !== undefined && onChange(def)}
      />
    </div>
  );
}

export function Seg<T extends string | number>(props: {
  value: T;
  options: { value: T; label: ReactNode; tip?: string }[];
  onChange: (v: T) => void;
  full?: boolean;
}) {
  return (
    <div className={`seg ${props.full ? 'full' : ''}`}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          className={o.value === props.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
          title={o.tip}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorField(props: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="color">
      <span className="sw" style={{ background: props.value }} />
      <span className="hex">{props.value}</span>
      <input type="color" value={props.value.slice(0, 7)} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

export function Toggle(props: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`toggle ${props.on ? 'on' : ''}`}
      role="switch"
      aria-checked={props.on}
      onClick={() => props.onChange(!props.on)}
    />
  );
}

export function Select<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  mono?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`select ${props.mono ? 'mono' : ''}`} style={props.style}>
      <select
        value={String(props.value)}
        onChange={(e) => {
          const o = props.options.find((x) => String(x.value) === e.target.value);
          if (o) props.onChange(o.value);
        }}
        style={{ width: '100%' }}
      >
        {props.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} />
    </div>
  );
}

export function Section(props: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <div className="section-head">
        <span className="label">{props.title}</span>
        {props.right}
      </div>
      {props.children}
    </div>
  );
}

export function IconButton(props: {
  tip: string;
  onClick?: () => void;
  children: ReactNode;
  on?: boolean;
  disabled?: boolean;
  sm?: boolean;
  tipPos?: 'up' | 'right';
}) {
  return (
    <button
      className={`icon-btn ${props.on ? 'on' : ''} ${props.sm ? 'sm' : ''}`}
      data-tip={props.tip}
      data-tip-pos={props.tipPos}
      aria-label={props.tip}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}
