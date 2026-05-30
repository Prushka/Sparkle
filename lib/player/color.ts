export function hashString(value: string) {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

export function getPlayerFallbackColor(name: string) {
	const hash = hashString(name.trim().toLocaleLowerCase());
	const hue = hash % 360;
	const saturation = 56 + (hash % 14);
	const lightness = 36 + ((hash >> 8) % 12);
	return `hsl(${hue} ${saturation}% ${lightness}%)`;
}
