import { useState } from 'react';

// Small (i) badge that reveals a short explanation on hover or click. Click-toggle
// (not just hover) so it also works on touch devices and stays open while reading.
export default function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-surface-sunken text-ink-faint text-[9px] font-bold ml-1 hover:bg-violet-500/15 hover:text-violet-400 leading-none shrink-0"
        aria-label="More info"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-30 left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-56 text-[11px] leading-snug bg-gray-800 text-white border border-gray-700 rounded-lg px-2.5 py-2 shadow-lg pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  );
}
