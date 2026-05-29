'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useFullscreenPortalContainer } from '@/components/ui/fullscreen-portal';
import { cn } from '@/lib/utils';

const Root = PopoverPrimitive.Root;
const Trigger = PopoverPrimitive.Trigger;
const Anchor = PopoverPrimitive.Anchor;

const Content = React.forwardRef<
	React.ElementRef<typeof PopoverPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => {
	const fullscreenPortalContainer = useFullscreenPortalContainer();

	return (
		<PopoverPrimitive.Portal container={fullscreenPortalContainer}>
			<PopoverPrimitive.Content
				ref={ref}
				align={align}
				sideOffset={sideOffset}
				className={cn(
					'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none',
					className
				)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	);
});
Content.displayName = 'PopoverContent';

export { Root, Trigger, Anchor, Content };
