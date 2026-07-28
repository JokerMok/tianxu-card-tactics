import { ChevronLeft, ChevronRight } from 'lucide-react';

const labels = { A: '战场优先', B: '战术仪表', C: '沉浸战线' } as const;
export type Variant = keyof typeof labels;

export function PrototypeSwitcher({
  current,
  visible,
  onChange,
}: {
  current: Variant;
  visible: boolean;
  onChange: (variant: Variant) => void;
}) {
  const variants = Object.keys(labels) as Variant[];
  const cycle = (offset: number) => {
    const index = variants.indexOf(current);
    onChange(variants[(index + offset + variants.length) % variants.length]);
  };
  if (!visible) return null;
  return (
    <nav className="prototype-switcher" aria-label="原型布局切换">
      <button type="button" onClick={() => cycle(-1)} aria-label="上一个布局"><ChevronLeft /></button>
      <span>{current} · {labels[current]}</span>
      <button type="button" onClick={() => cycle(1)} aria-label="下一个布局"><ChevronRight /></button>
    </nav>
  );
}
