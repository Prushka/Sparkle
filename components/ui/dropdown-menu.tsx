'use client';

import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

const Root = DropdownMenuPrimitive.Root;
const Trigger = DropdownMenuPrimitive.Trigger;
const Portal = DropdownMenuPrimitive.Portal;
const Group = DropdownMenuPrimitive.Group;
const Sub = DropdownMenuPrimitive.Sub;
const RadioGroup = DropdownMenuPrimitive.RadioGroup;
const CheckboxItem = DropdownMenuPrimitive.CheckboxItem;
const SubTrigger = DropdownMenuPrimitive.SubTrigger;
const SubContent = DropdownMenuPrimitive.SubContent;

const Content = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
	return (
		<Portal>
			<DropdownMenuPrimitive.Content
				ref={ref}
				sideOffset={sideOffset}
				className={cn(
					'z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md focus:outline-none',
					className
				)}
				{...props}
			/>
		</Portal>
	);
});
Content.displayName = 'DropdownMenuContent';

const Item = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => {
	return (
		<DropdownMenuPrimitive.Item
			ref={ref}
			className={cn(
				'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50',
				inset && 'pl-8',
				className
			)}
			{...props}
		/>
	);
});
Item.displayName = 'DropdownMenuItem';

const Label = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Label>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => {
	return (
		<DropdownMenuPrimitive.Label
			ref={ref}
			className={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)}
			{...props}
		/>
	);
});
Label.displayName = 'DropdownMenuLabel';

const Separator = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => {
	return (
		<DropdownMenuPrimitive.Separator
			ref={ref}
			className={cn('-mx-1 my-1 h-px bg-muted', className)}
			{...props}
		/>
	);
});
Separator.displayName = 'DropdownMenuSeparator';

const Shortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
	return (
		<span
			className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
			{...props}
		/>
	);
};

const RadioItem = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => {
	return (
		<DropdownMenuPrimitive.RadioItem
			ref={ref}
			className={cn(
				'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50',
				className
			)}
			{...props}
		>
			<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<span className="h-2 w-2 rounded-full bg-current" />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.RadioItem>
	);
});
RadioItem.displayName = 'DropdownMenuRadioItem';

const RadioIndicator = DropdownMenuPrimitive.ItemIndicator;

export {
	Root,
	Trigger,
	Portal,
	Content,
	Item,
	Label,
	Separator,
	Shortcut,
	Group,
	RadioGroup,
	RadioItem,
	RadioIndicator,
	CheckboxItem,
	Sub,
	SubTrigger,
	SubContent
};
