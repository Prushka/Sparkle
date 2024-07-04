import { type Writable, writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface Discord {
	access_token: string;
	user: DiscordUser;
	scopes: (-1 | "identify" | "email" | "connections" | "guilds" | "guilds.join" | "guilds.members.read" | "gdm.join" | "rpc" | "rpc.notifications.read" | "rpc.voice.read" | "rpc.voice.write" | "rpc.video.read" | "rpc.video.write" | "rpc.screenshare.read" | "rpc.screenshare.write" | "rpc.activities.write" | "bot" | "webhook.incoming" | "messages.read" | "applications.builds.upload" | "applications.builds.read" | "applications.commands" | "applications.commands.update" | "applications.commands.permissions.update" | "applications.store.update" | "applications.entitlements" | "activities.read" | "activities.write" | "relationships.read" | "voice" | "dm_channels.read" | "role_connections.write")[];
	expires: string;
	application: {
		id: string;
		description: string;
		name: string;
		icon?: string | null | undefined;
		rpc_origins?: string[] | undefined;
	};
}

export interface DiscordUser {
	username: string;
	discriminator: string;
	id: string;
	public_flags: number;
	avatar?: string | null | undefined;
	global_name?: string | null | undefined;
}

export function getName(discord : DiscordUser | null | undefined) : string | undefined {
	if (discord?.global_name) {
		return discord.global_name;
	}
	return discord?.username;
}

export function getAvatarUrl(discord : DiscordUser) {
	if (discord.avatar) {
		if (discord.avatar.startsWith('a_')) {
			return `https://cdn.discordapp.com/avatars/${discord.id}/${discord.avatar}.gif`;
		}
		return `https://cdn.discordapp.com/avatars/${discord.id}/${discord.avatar}.webp`;
	}
	if (discord.username) {
		return `https://cdn.discordapp.com/embed/avatars/${(parseInt(discord.id) >> 22) % 6}.png`;
	}
	return `https://cdn.discordapp.com/embed/avatars/${parseInt(discord.discriminator) % 5}.png`;
}

export function isExpired(datetimeString: string): boolean {
	const currentDateTime = new Date();
	const givenDateTime = new Date(datetimeString);
	if (givenDateTime < currentDateTime) {
		console.log('Token expired');
	}
	return givenDateTime < currentDateTime;
}

export const pfpLastFetched : Writable<{[key:string]:number}> = writable({});
export const chatLayoutStore = writable(browser && localStorage.getItem('chatLayout') || 'simple');
export const chatFocusedStore = writable(false);
export const pageReloadCounterStore = writable(0);
export const interactedStore = writable(false);
export const playersStore = writable(-1);
export function updatePfp(id: string) {
			pfpLastFetched.update((store) => {
				return { ...store, [id]: Date.now() };
		});
}
