import * as RadixDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';

export const DrawerRoot = RadixDialog.Root;
export const DrawerTrigger = RadixDialog.Trigger;
export const DrawerClose = RadixDialog.Close;

interface DrawerContentProps {
  children: React.ReactNode;
  title?: string;
  side?: 'left' | 'right';
  widthClassName?: string;
}

export function DrawerContent({ children, title, side = 'right', widthClassName = 'w-[420px]' }: DrawerContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/30 animate-fade-in" />
      <RadixDialog.Content
        className={clsx(
          'fixed inset-y-0 z-50 flex flex-col bg-white shadow-lg',
          side === 'right' ? 'right-0 animate-slide-in-right' : 'left-0 animate-slide-in-left',
          widthClassName
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <RadixDialog.Title className="text-heading text-ink">{title}</RadixDialog.Title>
            <RadixDialog.Close className="btn-ghost !p-1.5" aria-label="Close">
              ✕
            </RadixDialog.Close>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
