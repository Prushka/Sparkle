'use client';
import { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { IconLibrary } from '@tabler/icons-react';
import * as Popover from '@/components/ui/popover';
import { CatalogBrowser } from '@/components/catalog-browser';
import { fetchJob } from '@/lib/player/data';
import type { Job, LibraryJob } from '@/lib/player/t';
export type MediaSelectionHandle = {
	updateList: (
		id?: string | null,
		onSuccess?: (jobs: LibraryJob[]) => void
	) => Promise<LibraryJob[]>;
};
export const MediaSelection = forwardRef<
	MediaSelectionHandle,
	{
		data: { jobs: Job[]; job?: Job };
		bounceToOverride?: ((id: string) => void) | null;
		staticBaseUrl: string;
		backendBaseUrl: string;
	}
>(function MediaSelection({ data, bounceToOverride, staticBaseUrl, backendBaseUrl }, ref) {
	const [open, setOpen] = useState(false);
	const router = useRouter();
	const searchParams = useSearchParams();
	const updateList = useCallback(
		async (id?: string | null, onSuccess?: (jobs: LibraryJob[]) => void) => {
			// Direct lookup keeps room joins and media-change prompts independent of library size.
			const items = id ? [await fetchJob(backendBaseUrl, id)] : data.jobs;
			onSuccess?.(items);
			return items;
		},
		[backendBaseUrl, data.jobs]
	);
	useImperativeHandle(ref, () => ({ updateList }), [updateList]);
	function select(id: string) {
		setOpen(false);
		if (bounceToOverride) bounceToOverride(id);
		else {
			const params = new URLSearchParams(searchParams.toString());
			params.set('mediaId', id);
			router.push(`/?${params}`);
		}
	}
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger asChild>
				<Button variant="outline" size="sm" className="max-w-full">
					<IconLibrary className="size-4" />
					{data.job ? 'Change media' : 'Choose media'}
				</Button>
			</Popover.Trigger>
			<Popover.Content
				align="start"
				className="z-[100] max-h-[85dvh] w-[min(94vw,960px)] overflow-auto p-4"
			>
				{open && (
					<CatalogBrowser
						compact
						backendBaseUrl={backendBaseUrl}
						staticBaseUrl={staticBaseUrl}
						onSelect={select}
					/>
				)}
			</Popover.Content>
		</Popover.Root>
	);
});
