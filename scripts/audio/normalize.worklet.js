import LoudnessProcessor from './loudness-meter.js';
import { mixStereo } from './stereo-mix.js';

// One render quantum in, one render quantum out. No lookahead, resampling,
// sample queues or clock changes. The meter's windows/histograms are bounded.
class NormalizeProcessor extends LoudnessProcessor {
	constructor(options) {
		super({ ...options, processorOptions: { interval: 3600, shared: false } });
		// Only momentary loudness drives this effect. The pinned processor
		// exposes these fields: skip its unused integrated/LRA histograms and
		// 4x true-peak FIR analysis to leave headroom for multichannel decoding.
		// Sparkle's linked sample-peak guard measures the final stereo mix.
		this.momentaryHistograms = [{ size: 0, add() {} }];
		this.shortTermHistograms = [{ size: 0, add() {} }];
		this.truePeakFilters = [Array.from({ length: 32 }, () => ({ process() {} }))];
		this.enabled = false;
		this.alive = true;
		this.gain = 1;
		this.target = 1;
		this.peakGain = 1;
		this.volume = 1;
		this.settleUntil = 0;
		this.lastReport = 0;
		this.frames = 0;
		this.stereo = [new Float32Array(128), new Float32Array(128)];
		this.meterInput = [this.stereo];
		this.meterOutput = [[new Float32Array(128), new Float32Array(128)]];
		this.inputChannels = 0;
		this.port.onmessage = ({ data }) => {
			if (data.type === 'dispose') this.alive = false;
			if (data.type === 'configure') {
				if (data.enabled !== undefined && this.enabled !== data.enabled) {
					if (!data.enabled) {
						this.gain *= this.peakGain;
						this.peakGain = 1;
					}
					this.enabled = data.enabled;
					this.lastReport = -Infinity;
					this.settleUntil = currentTime + 0.45;
				}
				if (data.volume !== undefined && this.volume !== data.volume) {
					this.volume = Math.max(0, Math.min(1, data.volume));
					this.settleUntil = currentTime + 0.45;
				}
			}
			if (data.type === 'reset') {
				this.settleUntil = currentTime + 0.45;
				this.target = 1;
			}
		};
	}
	process(inputs, outputs) {
		if (!this.alive) return false;
		const input = inputs[0],
			output = outputs[0];
		if (!input?.length || !output?.length) return true;
		const length = input[0].length;
		if (this.stereo[0].length !== length) {
			this.stereo = [new Float32Array(length), new Float32Array(length)];
			this.meterInput = [this.stereo];
			this.meterOutput = [[new Float32Array(length), new Float32Array(length)]];
		}
		if (this.inputChannels !== input.length) {
			this.inputChannels = input.length;
			this.settleUntil = currentTime + 0.45;
			this.target = 1;
			this.lastReport = -Infinity;
		}
		const supported = mixStereo(input, this.stereo);
		const enabled = this.enabled && supported;
		if (enabled) {
			// Meter the audible mix, including cancellation/summation of channels.
			// Summing their independent powers would normalize to the wrong level.
			super.process(this.meterInput, this.meterOutput);
			const measured = this.views[0][3]; // 400 ms K-weighted momentary loudness.
			const loudness = measured - 20 * Math.log10(Math.max(this.volume, 0.00001));
			if (currentTime >= this.settleUntil && this.volume > 0 && Number.isFinite(loudness)) {
				// Freeze in silence: never chase a noise floor or amplify muted audio.
				if (loudness > -50) this.target = 10 ** (Math.max(-18, Math.min(12, -18 - loudness)) / 20);
			}
		} else this.target = 1;
		let peak = 0;
		for (const channel of this.stereo)
			for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(channel[i]));
		// Guard after downmix: individually safe channels can sum above full scale.
		const ceiling = enabled ? 10 ** (-2 / 20) * this.volume : Infinity;
		const guard = peak > 0 ? Math.min(1, ceiling / (peak * Math.max(this.gain, this.target))) : 1;
		this.peakGain = enabled
			? Math.min(
					guard,
					this.peakGain + (1 - this.peakGain) * (1 - Math.exp(-length / (sampleRate * 0.15)))
				)
			: 1;
		const smoothing =
			1 - Math.exp(-1 / (sampleRate * (!enabled ? 0.005 : this.target < this.gain ? 0.08 : 2)));
		for (let i = 0; i < length; i++) {
			this.gain += (this.target - this.gain) * smoothing;
			if (!enabled && Math.abs(this.gain - 1) < 0.000001) this.gain = 1;
			const gain = this.gain * this.peakGain;
			for (let c = 0; c < output.length; c++) output[c][i] = (this.stereo[c]?.[i] ?? 0) * gain;
		}
		this.frames += length;
		if (currentTime - this.lastReport >= 0.25) {
			this.lastReport = currentTime;
			this.port.postMessage({
				type: 'status',
				active: enabled,
				supported,
				inputChannels: input.length,
				channels: 2,
				gainDB: 20 * Math.log10(this.gain * this.peakGain),
				frames: this.frames
			});
		}
		return true;
	}
}
registerProcessor('sparkle-normalize', NormalizeProcessor);
