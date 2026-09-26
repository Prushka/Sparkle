'use client';

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactElement,
	type ReactNode
} from 'react';
import { IconChevronRight, IconLoader2, IconLogout } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import * as Dialog from '@/components/ui/dialog';
import { Pfp } from '@/components/player/Pfp';
import { joinBackendPath, loadRuntimeConfig } from '@/lib/player/data';
import { plexAccessRequiredEvent } from '@/lib/plex-access';

type PlexSession = {
	enabled: boolean;
	authenticated: boolean;
	canAccessRaw: boolean;
	name?: string;
	profileId?: string;
};
type PlexAuth = PlexSession & {
	ready: boolean;
	busy: boolean;
	error: string;
	revision: number;
	signIn: () => Promise<void>;
	signOut: () => Promise<void>;
	refresh: () => Promise<void>;
};
const anonymous: PlexSession = { enabled: false, authenticated: false, canAccessRaw: false };
const Auth = createContext<PlexAuth | null>(null);

export function PlexAuthProvider({ children }: { children: ReactNode }) {
	const [session, setSession] = useState(anonymous);
	const [ready, setReady] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [revision, setRevision] = useState(0);
	const signature = useRef('');
	const generation = useRef(0);
	const polling = useRef<AbortController | null>(null);
	const active = useRef(false);
	const apply = useCallback((value: PlexSession) => {
		const next = JSON.stringify(value);
		if (next !== signature.current) {
			signature.current = next;
			setSession(value);
			setRevision((v) => v + 1);
		}
		setReady(true);
	}, []);
	const request = useCallback(async (path: string, method = 'GET', signal?: AbortSignal) => {
		const config = await loadRuntimeConfig();
		const response = await fetch(joinBackendPath(config.backendBaseUrl, `/auth/plex/${path}`), {
			method,
			signal,
			credentials: 'include',
			cache: 'no-store',
			...(method === 'POST' ? { headers: { 'X-Sparkle-Auth': '1' } } : {})
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok)
			throw new Error(data.error || 'Plex sign-in is unavailable. Please try again.');
		return { data, pending: response.status === 202 };
	}, []);
	const refresh = useCallback(async () => {
		const current = generation.current;
		try {
			const { data } = await request('session');
			if (current === generation.current) apply(data);
		} catch {
			// Fail closed while preserving the ability to retry the sign-in service.
			if (current === generation.current) apply({ ...anonymous, enabled: true });
		}
	}, [apply, request]);
	useEffect(() => {
		void refresh();
		const update = () => {
			if (document.visibilityState === 'visible') void refresh();
		};
		window.addEventListener('focus', update);
		window.addEventListener(plexAccessRequiredEvent, update);
		const timer = window.setInterval(update, 60_000);
		return () => {
			window.removeEventListener('focus', update);
			window.removeEventListener(plexAccessRequiredEvent, update);
			clearInterval(timer);
			polling.current?.abort();
		};
	}, [refresh]);
	const signIn = useCallback(async () => {
		if (active.current) return;
		// Open synchronously from the user's click so browsers do not block it.
		const popup = window.open('about:blank', '_blank', 'popup,width=640,height=760');
		if (!popup) {
			setError('Allow popups for Sparkle, then try signing in again.');
			return;
		}
		popup.opener = null;
		active.current = true;
		generation.current++;
		setBusy(true);
		setError('');
		const controller = new AbortController();
		polling.current?.abort();
		polling.current = controller;
		try {
			const { data } = await request('start', 'POST', controller.signal);
			const target = new URL(data.url);
			if (target.origin !== 'https://app.plex.tv' || target.pathname !== '/auth')
				throw new Error('Invalid Plex sign-in destination.');
			// Confirm the HttpOnly pending cookie survives a round trip before
			// sending the user to Plex, which cannot detect our cookie restrictions.
			let result = await request('poll', 'POST', controller.signal);
			popup.location.replace(target.href);
			const deadline = Date.now() + 10 * 60_000;
			while (Date.now() < deadline && !controller.signal.aborted) {
				if (!result.pending) {
					// A focus refresh started before this response must not overwrite
					// the newly authenticated session with its anonymous snapshot.
					generation.current++;
					apply(result.data);
					if (!result.data.canAccessRaw)
						setError(
							'This Plex account does not have access to this server. Ask its owner for an invitation.'
						);
					popup.close();
					return;
				}
				// Plex can sever the window handle through its opener policy. Only
				// the server-bound PIN determines whether authorization completed.
				await new Promise<void>((resolve) => setTimeout(resolve, 2000));
				if (controller.signal.aborted) break;
				result = await request('poll', 'POST', controller.signal);
			}
			if (!controller.signal.aborted) setError('Plex sign-in expired. Please try again.');
		} catch (caught) {
			if (!controller.signal.aborted)
				setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
			popup.close();
		} finally {
			active.current = false;
			setBusy(false);
		}
	}, [apply, request]);
	const signOut = useCallback(async () => {
		polling.current?.abort();
		generation.current++;
		setBusy(true);
		setError('');
		try {
			const { data } = await request('logout', 'POST');
			apply(data);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Unable to sign out.');
		} finally {
			setBusy(false);
		}
	}, [apply, request]);
	return (
		<Auth.Provider value={{ ...session, ready, busy, error, revision, signIn, signOut, refresh }}>
			{children}
		</Auth.Provider>
	);
}

export function usePlexAuth() {
	const value = useContext(Auth);
	if (!value) throw new Error('PlexAuthProvider is missing');
	return value;
}

export function PlexAccountButton({ children }: { children?: ReactElement } = {}) {
	const auth = usePlexAuth();
	const [open, setOpen] = useState(false);
	if (auth.ready && !auth.enabled) return null;
	return (
		<Dialog.Root open={open} onOpenChange={setOpen}>
			<Dialog.Trigger asChild>
				{children ?? (
					<Button
						variant="outline"
						size="sm"
						className="h-9 max-w-full gap-2"
						aria-label={auth.authenticated ? 'Plex account' : 'Sign in with Plex'}
					>
						<IconChevronRight className="size-4 text-amber-400" aria-hidden="true" />
						<span className="max-w-36 truncate">
							{auth.authenticated ? auth.name || 'Plex account' : 'Sign in with Plex'}
						</span>
					</Button>
				)}
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.DialogHeader>
					<Dialog.Title>Plex account</Dialog.Title>
					<Dialog.Description>
						{auth.authenticated
							? auth.canAccessRaw
								? 'Raw media is available.'
								: 'This account needs access to this Plex server.'
							: 'Sign in with a server member’s Plex account to browse and play Raw media. Encoded media is available without signing in.'}
					</Dialog.Description>
				</Dialog.DialogHeader>
				<PlexAuthActions />
			</Dialog.Content>
		</Dialog.Root>
	);
}

function PlexAccountIdentity() {
	const auth = usePlexAuth();
	const [staticBaseUrl, setStaticBaseUrl] = useState('');
	useEffect(() => {
		let cancelled = false;
		void loadRuntimeConfig()
			.then((config) => {
				if (!cancelled) setStaticBaseUrl(config.staticBaseUrl);
			})
			.catch(() => {
				// Keep the name/initial visible if the avatar service is unavailable.
			});
		return () => {
			cancelled = true;
		};
	}, []);
	const name = auth.name || 'Plex user';
	return (
		<div
			role="status"
			className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/40 p-4"
		>
			<Pfp
				id={staticBaseUrl ? auth.profileId || '' : ''}
				name={name}
				staticBaseUrl={staticBaseUrl}
				className="size-14 shrink-0 text-xl"
			/>
			<div className="min-w-0">
				<p className="text-sm text-muted-foreground">Signed in as</p>
				<p className="font-semibold [overflow-wrap:anywhere]">{name}</p>
			</div>
		</div>
	);
}

function PlexAuthActions() {
	const auth = usePlexAuth();
	return (
		<>
			{auth.authenticated && <PlexAccountIdentity />}
			{auth.error && (
				<p role="alert" className="text-sm text-destructive">
					{auth.error}
				</p>
			)}
			{auth.busy && (
				<p role="status" className="text-sm text-muted-foreground">
					{auth.authenticated ? 'Signing out…' : 'Complete sign-in in the Plex window.'}
				</p>
			)}
			<Button
				disabled={auth.busy || !auth.ready}
				onClick={() => void (auth.authenticated ? auth.signOut() : auth.signIn())}
			>
				{auth.busy ? (
					<IconLoader2 className="size-4 animate-spin" />
				) : auth.authenticated ? (
					<IconLogout className="size-4" />
				) : (
					<IconChevronRight className="size-4" />
				)}
				{auth.authenticated ? 'Sign out of Plex' : 'Continue with Plex'}
			</Button>
		</>
	);
}

export function PlexRoomGate({ onLeave }: { onLeave: () => void }) {
	const auth = usePlexAuth();
	return (
		<main className="min-h-dvh bg-background">
			<Dialog.Root open>
				<Dialog.Content
					showCloseButton={false}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onInteractOutside={(event) => event.preventDefault()}
				>
					<Dialog.DialogHeader>
						<Dialog.Title>Plex access required</Dialog.Title>
						<Dialog.Description>
							{auth.authenticated
								? 'This room is playing Raw media. Your Plex account needs access to this server to join.'
								: 'This room is playing Raw media. Sign in with a Plex account that has access to this server, or leave the room.'}
						</Dialog.Description>
					</Dialog.DialogHeader>
					<PlexAuthActions />
					<Button variant="outline" onClick={onLeave}>
						Leave room
					</Button>
				</Dialog.Content>
			</Dialog.Root>
		</main>
	);
}
