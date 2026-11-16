import { Clapperboard, Keyboard, Frame, Type } from 'lucide-react';
import { useEditor, type LeftTab } from '../state/store';

const TABS: { id: LeftTab; label: string; icon: typeof Type }[] = [
  { id: 'media', label: 'MEDIA', icon: Clapperboard },
  { id: 'text', label: 'TEXT', icon: Type },
  { id: 'canvas', label: 'CANVAS', icon: Frame },
  { id: 'keys', label: 'KEYS', icon: Keyboard },
];

export function SideRail() {
  const tab = useEditor((s) => s.leftTab);
  return (
    <nav className="rail">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`rail-btn ${tab === id ? 'on' : ''}`}
          onClick={() => useEditor.setState({ leftTab: id })}
        >
          <Icon size={19} strokeWidth={1.5} />
          <span>{label}</span>
        </button>
      ))}
      <div className="rail-spacer" />
      <div className="rail-sys">SYS://ONLINE</div>
    </nav>
  );
}
