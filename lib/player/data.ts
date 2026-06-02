import {
	preprocessJob,
	preprocessLibraryJobs,
	type Job,
	type LibraryJob,
	type ServerData
} from '@/lib/player/t';

export type RoomRecord = {
	roomId: string;
	mediaId: string;
	mediaUpdated?: number;
};

export type RuntimeConfig = {
	backendBaseUrl: string;
	staticBaseUrl: string;
};

type RuntimeConfigPayload = Partial<RuntimeConfig>;

let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;
let jobsPromise: Promise<LibraryJob[]> | null = null;

export function joinBackendPath(base: string, path: string) {
	if (!base) {
		return path.startsWith('/') ? path : `/${path}`;
	}
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function resetClientDataCache() {
	runtimeConfigPromise = null;
	jobsPromise = null;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
	if (!runtimeConfigPromise) {
		runtimeConfigPromise = fetch('/api/runtime-env', { cache: 'no-store' }).then(
			async (response) => {
				if (!response.ok) {
					throw new Error(`Failed to load runtime config: ${response.status}`);
				}
				const payload = (await response.json()) as RuntimeConfigPayload;
				if (!payload.backendBaseUrl || !payload.staticBaseUrl) {
					throw new Error('Runtime config is missing backend or static base URL');
				}
				return {
					backendBaseUrl: payload.backendBaseUrl,
					staticBaseUrl: payload.staticBaseUrl
				};
			}
		);
	}
	return runtimeConfigPromise;
}

export async function fetchRoomRecord(
	backendBaseUrl: string,
	roomId: string
): Promise<RoomRecord | null> {
	const response = await fetch(
		joinBackendPath(backendBaseUrl, `/rooms/${encodeURIComponent(roomId)}`),
		{
			cache: 'no-store'
		}
	);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`Failed to load room ${roomId}: ${response.status}`);
	}
	return response.json();
}

export async function createRoomRecord(
	backendBaseUrl: string,
	mediaId?: string,
	roomId?: string
): Promise<RoomRecord> {
	const response = await fetch(joinBackendPath(backendBaseUrl, '/rooms'), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			...(mediaId ? { mediaId } : {}),
			...(roomId ? { roomId } : {})
		})
	});
	if (!response.ok) {
		throw new Error(`Failed to create room: ${response.status}`);
	}
	return response.json();
}

export async function updateRoomRecord(
	backendBaseUrl: string,
	roomId: string,
	mediaId: string
): Promise<RoomRecord> {
	const response = await fetch(
		joinBackendPath(backendBaseUrl, `/rooms/${encodeURIComponent(roomId)}`),
		{
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ mediaId })
		}
	);
	if (!response.ok) {
		throw new Error(`Failed to update room ${roomId}: ${response.status}`);
	}
	return response.json();
}

export async function fetchJobs(backendBaseUrl: string, force = false): Promise<LibraryJob[]> {
	if (force) {
		jobsPromise = null;
	}
	if (!jobsPromise) {
		jobsPromise = fetch(joinBackendPath(backendBaseUrl, '/all'), { cache: 'no-store' }).then(
			async (response) => {
				if (!response.ok) {
					throw new Error(`Failed to load media library: ${response.status}`);
				}
				return preprocessLibraryJobs(await response.json());
			}
		);
	}
	return jobsPromise;
}

export async function fetchJob(backendBaseUrl: string, mediaId: string): Promise<Job> {
	const response = await fetch(
		joinBackendPath(backendBaseUrl, `/media/${encodeURIComponent(mediaId)}`),
		{
			cache: 'no-store'
		}
	);
	if (!response.ok) {
		throw new Error(`Failed to load media ${mediaId}: ${response.status}`);
	}
	return preprocessJob(await response.json());
}

export async function fetchMediaData(
	mediaId: string,
	roomId: string,
	config?: RuntimeConfig
): Promise<ServerData> {
	const runtimeConfig = config ?? (await loadRuntimeConfig());
	const job = await fetchJob(runtimeConfig.backendBaseUrl, mediaId);
	const codec = job.EncodedCodecs?.includes('h264-8bit')
		? 'h264-8bit'
		: (job.EncodedCodecs?.[0] ?? 'h264-8bit');
	const base = `${runtimeConfig.staticBaseUrl}/${job.Id}`;

	return {
		jobs: [job],
		job,
		video: `${base}/${codec}.mp4`,
		preview: `${base}/poster.jpg`,
		icon: `${base}/poster.jpg`,
		rating: -1,
		title: job.Title.episode
			? `${job.Title.title} - ${job.Title.episode.se} - ${job.Title.episode.title}`
			: job.Title.title,
		displayTitle: job.Title.episode
			? `${job.Title.episode.se} - ${job.Title.episode.title}`
			: job.Title.title,
		plot: '',
		dominantColor: job.DominantColors?.[0] ?? '#EC275F',
		oembedJson: `/json/${encodeURIComponent(roomId)}`,
		staticBaseUrl: runtimeConfig.staticBaseUrl,
		backendBaseUrl: runtimeConfig.backendBaseUrl,
		roomId
	};
}
