'use client';

import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { IconSearch } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

const Root = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => {
	return (
		<CommandPrimitive
			ref={ref}
			className={cn(
				'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
				className
			)}
			{...props}
		/>
	);
});
Root.displayName = 'Command';

const Input = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Input>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => {
	return (
		<div className="flex items-center border-b px-3" data-cmdk-input-wrapper="">
			<IconSearch className="mr-2 h-4 w-4 shrink-0 opacity-50" />
			<CommandPrimitive.Input
				ref={ref}
				className={cn(
					'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
					className
				)}
				{...props}
			/>
		</div>
	);
});
Input.displayName = 'CommandInput';

const List = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => {
	return (
		<CommandPrimitive.List
			ref={ref}
			className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden', className)}
			{...props}
		/>
	);
});
List.displayName = 'CommandList';

const Empty = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Empty>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => {
	return (
		<CommandPrimitive.Empty
			ref={ref}
			className={cn('py-6 text-center text-sm', className)}
			{...props}
		/>
	);
});
Empty.displayName = 'CommandEmpty';

const Group = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Group>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => {
	return (
		<CommandPrimitive.Group
			ref={ref}
			className={cn(
				'overflow-hidden p-1 text-foreground [&_[data-cmdk-group-heading]]:px-2 [&_[data-cmdk-group-heading]]:py-1.5 [&_[data-cmdk-group-heading]]:text-xs [&_[data-cmdk-group-heading]]:font-medium **:data-[cmdk-group-heading]:text-muted-foreground',
				className
			)}
			{...props}
		/>
	);
});
Group.displayName = 'CommandGroup';

const Item = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, children, ...props }, ref) => {
	return (
		<CommandPrimitive.Item
			ref={ref}
			className={cn(
				'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
				className
			)}
			{...props}
		>
			{children}
		</CommandPrimitive.Item>
	);
});
Item.displayName = 'CommandItem';

const Separator = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => {
	return (
		<CommandPrimitive.Separator
			ref={ref}
			className={cn('-mx-1 h-px bg-muted', className)}
			{...props}
		/>
	);
});
Separator.displayName = 'CommandSeparator';

const Shortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
	return (
		<span
			className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
			{...props}
		/>
	);
};

const Command = Object.assign(Root, {
	Input,
	List,
	Empty,
	Group,
	Item,
	Separator,
	Shortcut
});

export { Command, Root, Input, List, Empty, Group, Item, Separator, Shortcut };
