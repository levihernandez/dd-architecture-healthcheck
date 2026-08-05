import * as RadixPopover from '@radix-ui/react-popover';
import clsx from 'clsx';

export const PopoverRoot = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;

type PopoverContentProps = React.ComponentProps<typeof RadixPopover.Content>;

export function PopoverContent({ children, className, sideOffset = 8, ...props }: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={sideOffset}
        className={clsx(
          'z-50 rounded-lg border border-border bg-surface-subtle shadow-popover animate-scale-in origin-top-right',
          className
        )}
        {...props}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
