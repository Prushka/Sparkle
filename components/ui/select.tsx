'use client';

import * as React from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { IconCheck, IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { useFullscreenPortalContainer } from '@/components/ui/fullscreen-portal';

type StyledProps<T> = Omit<T, 'className'> & { className?: string };

// Radix Select always locks document scrolling. Base UI exposes a supported
// non-modal mode while retaining listbox semantics, typeahead and focus handling.
function Select({
	onValueChange,
	...props
}: Omit<SelectPrimitive.Root.Props<string>, 'onValueChange'> & {
	onValueChange?: (value: string) => void;
}) {
	return (
		<SelectPrimitive.Root
			modal={false}
			{...props}
			onValueChange={(value) => {
				if (value !== null) onValueChange?.(value);
			}}
		/>
	);
}

function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
	return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
	className,
	size = 'default',
	children,
	...props
}: StyledProps<React.ComponentProps<typeof SelectPrimitive.Trigger>> & {
	size?: 'sm' | 'default';
}) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			data-size={size}
			className={cn(
				"flex w-fit min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:truncate *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
				className
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon>
				<IconChevronDown className="size-4 opacity-50" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	className,
	children,
	align = 'start',
	...props
}: StyledProps<React.ComponentProps<typeof SelectPrimitive.Popup>> & {
	align?: React.ComponentProps<typeof SelectPrimitive.Positioner>['align'];
}) {
	const container = useFullscreenPortalContainer();
	return (
		<SelectPrimitive.Portal container={(container as HTMLElement | null) ?? undefined}>
			<SelectPrimitive.Positioner
				align={align}
				alignItemWithTrigger={false}
				sideOffset={4}
				collisionPadding={12}
				className="z-[110]"
			>
				<SelectPrimitive.Popup
					data-slot="select-content"
					className={cn(
						'relative max-h-(--available-height) min-w-[max(8rem,var(--anchor-width))] max-w-[calc(100vw-1.5rem)] origin-(--transform-origin) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-none transition-[opacity,transform] duration-150 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
						className
					)}
					{...props}
				>
					<SelectScrollUpButton />
					<SelectPrimitive.List className="max-h-(--available-height) overflow-y-auto overscroll-contain p-1">
						{children}
					</SelectPrimitive.List>
					<SelectScrollDownButton />
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

function SelectLabel({
	className,
	...props
}: StyledProps<React.ComponentProps<typeof SelectPrimitive.GroupLabel>>) {
	return (
		<SelectPrimitive.GroupLabel
			data-slot="select-label"
			className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)}
			{...props}
		/>
	);
}

function SelectItem({
	className,
	children,
	...props
}: StyledProps<React.ComponentProps<typeof SelectPrimitive.Item>>) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				'relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
				className
			)}
			{...props}
		>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
			<SelectPrimitive.ItemIndicator
				data-slot="select-item-indicator"
				className="absolute right-2 flex size-3.5 items-center justify-center"
			>
				<IconCheck className="size-4" />
			</SelectPrimitive.ItemIndicator>
		</SelectPrimitive.Item>
	);
}

function SelectSeparator({
	className,
	...props
}: StyledProps<React.ComponentProps<typeof SelectPrimitive.Separator>>) {
	return (
		<SelectPrimitive.Separator
			data-slot="select-separator"
			className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
			{...props}
		/>
	);
}

function SelectScrollUpButton({
	className,
	...props
}: StyledProps<React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>>) {
	return (
		<SelectPrimitive.ScrollUpArrow
			data-slot="select-scroll-up-button"
			className={cn(
				'absolute top-0 z-10 flex w-full cursor-pointer items-center justify-center bg-popover py-1',
				className
			)}
			{...props}
		>
			<IconChevronUp className="size-4" />
		</SelectPrimitive.ScrollUpArrow>
	);
}

function SelectScrollDownButton({
	className,
	...props
}: StyledProps<React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>>) {
	return (
		<SelectPrimitive.ScrollDownArrow
			data-slot="select-scroll-down-button"
			className={cn(
				'absolute bottom-0 z-10 flex w-full cursor-pointer items-center justify-center bg-popover py-1',
				className
			)}
			{...props}
		>
			<IconChevronDown className="size-4" />
		</SelectPrimitive.ScrollDownArrow>
	);
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue
};
