// Reproducible, fail-closed patches against libmedia v1.3.1.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(process.argv[2] || 'cache/libmedia-source');
for (const [directory, revision] of [
	[root, '152f629d3021fd8013efa464fcb7b55f9fbe7753'],
	[resolve(root, 'packages/common'), '00c9c3c481cf7c53ed252cec6ca2dc6e9732ea28'],
	[resolve(root, 'packages/cheap'), '85cc79e032cbd417e3bb4a218bdf26da537b970b']
]) {
	if (
		execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !==
		revision
	)
		throw new Error('Player source revision does not match the pinned build');
}
const touched = new Set();
function patch(file, before, after, all = false) {
	const path = resolve(root, file);
	// This is a disposable, pinned build checkout. Always start each touched file
	// from its committed source so successive patches remain reproducible.
	if (!touched.has(file)) {
		writeFileSync(
			path,
			execFileSync('git', ['-C', dirname(path), 'show', `HEAD:./${basename(path)}`])
		);
		touched.add(file);
	}
	const original = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
	if (original.includes(after)) return;
	if (!original.includes(before)) throw new Error(`Pinned source does not match: ${file}`);
	writeFileSync(path, all ? original.replaceAll(before, after) : original.replace(before, after));
}
const player = 'packages/avplayer/src/AVPlayer.ts';
patch(
	player,
	'export interface AVPlayerOptions {',
	`export interface AVPlayerOptions {
  requireNativeVideo?: boolean
  subtitleSink?: {
    reset: (codec: number, header: Uint8Array) => void
    packet: (data: Uint8Array, pts: number, duration: number) => void
    time: (time: number) => void
    clear: () => void
  }
`
);
patch(
	player,
	'  AVCodecID.AV_CODEC_ID_DTS,',
	'  AVCodecID.AV_CODEC_ID_DTS,\n  AVCodecID.AV_CODEC_ID_TRUEHD,'
);
patch(
	player,
	'  AVCodecID.AV_CODEC_ID_SUBRIP,',
	'  AVCodecID.AV_CODEC_ID_HDMV_PGS_SUBTITLE,\n  AVCodecID.AV_CODEC_ID_SUBRIP,'
);
patch(
	player,
	'        codecpar: subtitleStream.codecpar,',
	'        codecpar: subtitleStream.codecpar,\n        sink: this.options.subtitleSink,'
);
patch(
	player,
	'    this.useMSE = await this.checkUseMSE(options)',
	`    this.useMSE = await this.checkUseMSE(options)
    if (options.video && this.options.requireNativeVideo && !this.useMSE) {
      throw new Error('Native HDR video is not supported on this client')
    }`
);
patch(
	player,
	'  public getStreams() {',
	`  public getEmbeddedFonts() {
    let total = 0
    return this.formatContext.streams.filter((s) => {
      const n = s.codecpar.extradataSize
      if (s.codecpar.codecType !== AVMediaType.AVMEDIA_TYPE_ATTACHMENT || n <= 0 || n > 16 * 1024 * 1024) return false
      total += n
      return total <= 64 * 1024 * 1024 && /font|truetype|opentype/i.test(String(s.metadata['mime'] || s.metadata['title'] || ''))
    }).map((s) => mapUint8Array(s.codecpar.extradata, reinterpret_cast<size>(s.codecpar.extradataSize)).slice())
  }

  public getVideoMimeType() {
    const s = this.findBestStream(this.formatContext.streams, AVMediaType.AVMEDIA_TYPE_VIDEO, true)
    return s ? getVideoMimeType(s.codecpar) : ''
  }

  public getStreams() {`
);
patch(
	'packages/avutil/src/function/getWasmUrl.ts',
	'        // dts',
	`        case AVCodecID.AV_CODEC_ID_TRUEHD:
          return \`\${baseUrl}/decode/truehd.wasm\`
        // dts`
);
const subtitles = 'packages/avplayer/src/subtitle/SubtitleRender.ts';
patch(
	subtitles,
	'export interface SubtitleRenderOptions {',
	`export interface SubtitleRenderOptions {
  sink?: {
    reset: (codec: number, header: Uint8Array) => void
    packet: (data: Uint8Array, pts: number, duration: number) => void
    time: (time: number) => void
    clear: () => void
  }`
);
patch(
	subtitles,
	'  private enable: boolean',
	'  private enable: boolean\n  private packetEnd = 0n'
);
patch(
	subtitles,
	'      if (this.queue.length < 6 && !this.ended) {',
	`      this.options.sink?.time(Number(this.options.getCurrentTime() - this.delay))
      if (this.queue.length < 6 && !this.ended && (!this.options.sink || this.packetEnd < this.options.getCurrentTime() + 30000n)) {`
);
patch(
	subtitles,
	'  private createDecoder() {',
	`  private createDecoder() {
    if (this.options.sink) {
      const c = this.options.codecpar
      this.options.sink.reset(c.codecId, c.extradataSize ? mapUint8Array(c.extradata, reinterpret_cast<size>(c.extradataSize)).slice() : new Uint8Array())
      return
    }`
);
patch(
	subtitles,
	'      const ret = this.decoder.decode(avpacket)',
	`      let ret = 0
      if (this.options.sink) {
        this.packetEnd = avpacket.pts + avpacket.duration
        if (avpacket.size > 16 * 1024 * 1024) { ret = -1 }
        else this.options.sink.packet(mapUint8Array(avpacket.data, reinterpret_cast<size>(avpacket.size)).slice(), Number(avpacket.pts), Number(avpacket.duration))
      }
      else ret = this.decoder.decode(avpacket)`
);
patch(
	subtitles,
	'  public reset() {',
	'  public reset() {\n    this.packetEnd = 0n\n    this.options.sink?.clear()'
);
patch(
	subtitles,
	'    this.decoder.close()\n    this.decoder = null',
	'    this.decoder?.close()\n    this.decoder = null\n    this.options.sink?.clear()'
);
patch(subtitles, '  public stop() {', '  public stop() {\n    this.options.sink?.clear()');
// Keep Matroska mastering and light-level metadata alongside the existing nclx
// colour values through the worker/MSE stream handoff.
patch(
	'packages/avformat/src/formats/IMatroskaFormat.ts',
	'          if (track.video.color) {',
	`          if (track.video.color) {
            stream.metadata['sparkleColor'] = track.video.color`
);
patch(
	'packages/avformat/src/formats/isobmff/writing/stsd.ts',
	'  colr(ioWriter, stream, isobmffContext)',
	`  colr(ioWriter, stream, isobmffContext)
  const color = stream.metadata['sparkleColor']
  if (color?.masteringMeta) {
    const m = color.masteringMeta
    // ISO BMFF mdcv stores mastering primaries in G, B, R order.
    const values = [m.gx, m.gy, m.bx, m.by, m.rx, m.ry, m.whiteX, m.whiteY]
    if (values.every((v) => typeof v === 'number') && typeof m.maxLuminance === 'number' && typeof m.minLuminance === 'number') {
      ioWriter.writeUint32(32); ioWriter.writeString('mdcv')
      values.forEach((v) => ioWriter.writeUint16(Math.round(v * 50000)))
      ioWriter.writeUint32(Math.round(m.maxLuminance * 10000))
      ioWriter.writeUint32(Math.round(m.minLuminance * 10000))
    }
  }
  if (typeof color?.maxCll === 'number' && typeof color?.maxFall === 'number') {
    ioWriter.writeUint32(12); ioWriter.writeString('clli')
    ioWriter.writeUint16(color.maxCll); ioWriter.writeUint16(color.maxFall)
  }`
);
// Fix the upstream array declaration for the scalar mastering minimum luminance.
patch(
	'packages/avformat/src/formats/matroska/imatroska.ts',
	`  [EBMLId.VIDEO_COLOR_LUMINA_NCE_MIN]: {
    type: EbmlType.FLOAT,
    isArray: true,`,
	`  [EBMLId.VIDEO_COLOR_LUMINA_NCE_MIN]: {
    type: EbmlType.FLOAT,`
);
patch(
	'packages/avformat/src/formats/matroska/type.ts',
	'  minLuminance?: float[]',
	'  minLuminance?: float'
);
patch(player, '/font|truetype|opentype/i', '/font|truetype|opentype|\\.(ttf|otf)$/i');
// Do not disguise High 10 as 8-bit High when probing native decoders.
patch(
	'packages/avutil/src/function/getVideoCodec.ts',
	`    if (profile === H264Profile.kHigh10) {
      profile = H264Profile.kHigh
    }`,
	`    // Preserve the exact H.264 profile in browser capability probes.`
);
// Matroska BlockAdditionMapping carries the original Dolby configuration. Keep
// it intact; RPU/EL NAL units and HDR10+ SEI remain in the unchanged video packets.
patch(
	'packages/avformat/src/formats/matroska/type.ts',
	'export interface TrackEntry {',
	`export interface TrackEntry {
  blockMappings?: { type: number, value: number, extra: EbmlBin }[]`
);
patch(
	'packages/avformat/src/formats/matroska/imatroska.ts',
	'export const EbmlSyntaxTrackEntry: Partial<Record<EBMLId, EbmlSyntax<TrackEntry>>> = {',
	`export const EbmlSyntaxTrackEntry: Partial<Record<EBMLId, EbmlSyntax<TrackEntry>>> = {
  [0x41E4 as EBMLId]: {
    type: EbmlType.OBJECT, isArray: true, filedName: 'blockMappings', child: {
      0x41E7: { type: EbmlType.UINT, filedName: 'type' },
      0x41F0: { type: EbmlType.UINT, filedName: 'value' },
      0x41ED: { type: EbmlType.BUFFER, filedName: 'extra' }
    }
  },`
);
patch(
	'packages/avformat/src/formats/IMatroskaFormat.ts',
	'        let extradataOffset = 0',
	`        for (const mapping of track.blockMappings || []) {
          if ((mapping.type === 0x64766343 || mapping.type === 0x64767643) && mapping.extra?.data?.length >= 5 && mapping.extra.data.length <= 1024) {
            stream.metadata['sparkleDovi'] = { type: mapping.type === 0x64766343 ? 'dvcC' : 'dvvC', data: mapping.extra.data.slice() }
          }
        }
        let extradataOffset = 0`
);
patch(
	'packages/avformat/src/formats/isobmff/writing/stsd.ts',
	"  const color = stream.metadata['sparkleColor']",
	`  const dovi = stream.metadata['sparkleDovi']
  if (dovi?.data && !stream.metadata['sparkleBaseHDROnly']) {
    ioWriter.writeUint32(8 + dovi.data.length); ioWriter.writeString(dovi.type); ioWriter.writeBuffer(dovi.data)
  }
  const color = stream.metadata['sparkleColor']`
);
patch(
	player,
	'  public getVideoMimeType() {',
	`  public setBaseHDROnly(enable: boolean) {
    for (const s of this.formatContext.streams) s.metadata['sparkleBaseHDROnly'] = enable
  }

  public getVideoMimeType() {`
);
console.log('Applied Sparkle libmedia v1.3.1 patches');
// MKV cues usually index only video, but point to interleaved cluster starts.
// Audio-only decoding must use that cluster index too, otherwise a distant seek
// scans from the last previously read cluster through gigabytes of video data.
patch(
	'packages/avformat/src/formats/IMatroskaFormat.ts',
	`        if (time > pts) {
          const poses = this.context.cues.entry[Math.max(i - 1, 0)].pos`,
	`        if (time > pts || i === this.context.cues.entry.length - 1) {
          const poses = this.context.cues.entry[time > pts ? Math.max(i - 1, 0) : i].pos`
);
patch(
	'packages/avformat/src/formats/IMatroskaFormat.ts',
	'const matchPos = poses.find((p) => p.track === track.number)',
	'const matchPos = poses.find((p) => p.track === track.number) || poses[0]'
);
// Preserve a useful teardown stack for cancellation failures.
patch(
	'packages/common/src/network/IPCPort.ts',
	"        req.reject('ipc port close')",
	"        req.reject(new Error('ipc port close'))"
);
// The audio renderer also has background/fake-play pulls that can outlive stop.
// Stop their continuations before accessing PCM buffers freed by unregisterTask.
const audioRender = 'packages/avpipeline/src/AudioRenderPipeline.ts';
patch(audioRender, '  stopping: boolean', '  stopping: boolean\n  closed: boolean');
patch(audioRender, '      stopping: false,', '      stopping: false,\n      closed: false,');
patch(
	audioRender,
	'  private async createTask(',
	`  private async pullFrame(task: SelfTask): Promise<pointer<AVFrameRef>> {
    if (task.closed || !task.leftIPCPort) return IOError.END as pointer<AVFrameRef>
    try { return await task.leftIPCPort.request<pointer<AVFrameRef>>('pull') }
    catch (error) {
      if (!task.closed) throw error
      return IOError.END as pointer<AVFrameRef>
    }
  }

  private async createTask(`
);
patch(
	audioRender,
	"audioFrame = await task.leftIPCPort.request<pointer<AVFrameRef>>('pull')",
	'audioFrame = await this.pullFrame(task)',
	true
);
patch(
	audioRender,
	"const audioFrame = task.paddingAVFrame || await task.leftIPCPort.request<pointer<AVFrameRef>>('pull')",
	'const audioFrame = task.paddingAVFrame || await this.pullFrame(task)\n    if (task.closed) return'
);
patch(
	audioRender,
	'      if (audioFrame === IOError.END) {',
	'      if (task.closed) return IOError.END\n      if (audioFrame === IOError.END) {'
);
patch(
	audioRender,
	'        let audioFrame = await this.pullFrame(task)',
	'        let audioFrame = await this.pullFrame(task)\n        if (task.closed) return'
);
patch(
	audioRender,
	'          let ret = await pullNewAudioFrame()',
	'          let ret = await pullNewAudioFrame()\n          if (task.closed) return IOError.END'
);
patch(
	audioRender,
	'            let ret = await pullNewAudioFrame()',
	'            let ret = await pullNewAudioFrame()\n            if (task.closed) return',
	true
);
patch(
	audioRender,
	'          const ret = await receiveToPCMBuffer(pcmBuffer)',
	'          const ret = await receiveToPCMBuffer(pcmBuffer)\n          if (task.closed) return'
);
patch(
	audioRender,
	'          const ret = await receiveToPCMBuffer(addressof(task.outPCMBuffer))',
	'          const ret = await receiveToPCMBuffer(addressof(task.outPCMBuffer))\n          if (task.closed) return'
);
patch(
	audioRender,
	'    rightIPCPort.on(REQUEST, async (request: RpcMessage) => {',
	'    rightIPCPort.on(REQUEST, async (request: RpcMessage) => {\n      if (task.closed) return'
);
patch(
	audioRender,
	'  public async unregisterTask(taskId: string): Promise<void> {\n    const task = this.tasks.get(taskId)\n    if (task) {',
	'  public async unregisterTask(taskId: string): Promise<void> {\n    const task = this.tasks.get(taskId)\n    if (task) {\n      task.closed = true\n      task.stopping = true'
);
// Pending decoder pulls can complete after task teardown. Cancel their IPC
// requests and reject stale packets before touching the freed frame/packet pools.
for (const kind of ['Audio', 'Video']) {
	const file = `packages/avpipeline/src/${kind}DecodePipeline.ts`;
	patch(file, '  inputEnd: boolean', '  inputEnd: boolean\n  closed: boolean');
	patch(file, '      inputEnd: false,', '      inputEnd: false,\n      closed: false,');
	if (kind === 'Audio') {
		patch(
			file,
			'  closed: boolean',
			'  closed: boolean\n  leftIPCPort: IPCPort\n  rightIPCPort: IPCPort'
		);
		patch(
			file,
			'      closed: false,',
			'      closed: false,\n      leftIPCPort,\n      rightIPCPort,'
		);
		patch(
			file,
			'      onReceiveAudioData(audioData) {',
			'      onReceiveAudioData(audioData) {\n        if (task.closed) { audioData.close(); return }'
		);
		patch(
			file,
			'                await task.pending',
			'                await task.pending\n                if (task.closed) return'
		);
	} else {
		patch(
			file,
			'      onReceiveVideoFrame(frame, alpha) {',
			'      onReceiveVideoFrame(frame, alpha) {\n        if (task.closed) { frame.close(); alpha?.close(); return }'
		);
		patch(
			file,
			'      onError: (error) => {',
			'      onError: (error) => {\n        if (task.closed) return'
		);
		patch(
			file,
			'                let ret = await task.decoderFallbackReady',
			'                let ret = await task.decoderFallbackReady\n                if (task.closed) return'
		);
	}
	patch(
		file,
		"    const result = await leftIPCPort.request<pointer<AVPacketRef> | AVPacketSerialize>('pull')",
		`    const result = await leftIPCPort.request<pointer<AVPacketRef> | AVPacketSerialize>('pull').catch((error) => {
      if (task.closed) return IOError.END as pointer<AVPacketRef>
      throw error
    })
    if (task.closed) return IOError.END as pointer<AVPacketRef>`
	);
	patch(
		file,
		'    rightIPCPort.on(REQUEST, async (request: RpcMessage) => {',
		'    rightIPCPort.on(REQUEST, async (request: RpcMessage) => {\n      if (task.closed) return'
	);
	patch(
		file,
		'              const avpacket = await this.pullAVPacketInternal(task, leftIPCPort)',
		'              const avpacket = await this.pullAVPacketInternal(task, leftIPCPort)\n              if (task.closed) return'
	);
	patch(
		file,
		'      task.rightPort.close()\n      task.leftPort.close()',
		`      task.closed = true
      ${kind === 'Audio' ? 'task.pendingResolve?.()' : ''}
      task.rightIPCPort.destroy()
      task.leftIPCPort.destroy()`
	);
}
// Resume must await native play promises so queued pause/seek commands cannot
// interrupt an unobserved play() promise after AVPlayer reports success.
patch(player, '          this.audio.play()', '          promises.push(this.audio.play())');
patch(player, '          this.video.play()', '          promises.push(this.video.play())');
patch(
	player,
	'        element.play()',
	`        void element.play().catch((error) => {
          // A later pause or source change legitimately cancels this retry.
          if (error?.name !== 'AbortError') this.fire(eventType.ERROR, [error])
        })`
);
// Emscripten 4 PIC modules import stack bounds; provide the actual cheap heap
// stack, never independent memory or guessed offsets.
patch(
	'packages/cheap/src/webassembly/WebAssemblyRunner.ts',
	"      'GOT.func': {",
	`      'GOT.mem': {
        __stack_low: new WebAssembly.Global({ mutable: true, value: defined(WASM_64) ? 'i64' : 'i32' }, StackTop),
        __stack_high: new WebAssembly.Global({ mutable: true, value: defined(WASM_64) ? 'i64' : 'i32' }, StackTop + config.STACK_SIZE)
      },
      'GOT.func': {`
);
// Multiple embedded subtitle layers share the existing demuxer and video clock.
patch(
	player,
	'  private selectedSubtitleStream: AVStreamInterface',
	`  private sparkleLayers: { index: number, render: SubtitleRender }[] = []
  private selectedSubtitleStream: AVStreamInterface`
);
patch(
	player,
	'  public getEmbeddedFonts() {',
	`  public async setSubtitleLayers(layers: { id: number, sink: AVPlayerOptions['subtitleSink'] }[]) {
    for (const layer of this.sparkleLayers) {
      await AVPlayer.DemuxerThread.disconnectSubtitleStream(this.taskId, layer.index)
      layer.render.destroy()
    }
    this.sparkleLayers = []
    for (const layer of layers.slice(0, 2)) {
      const stream = this.formatContext.streams.find((s) => s.id === layer.id)
      if (!stream || stream === this.selectedSubtitleStream || stream.codecpar.codecType !== AVMediaType.AVMEDIA_TYPE_SUBTITLE || this.sparkleLayers.some((l) => l.index === stream.index)) continue
      const render = new (await import('./subtitle/SubtitleRender')).default({
        dom: this.canvas || this.video || this.options.container as HTMLDivElement,
        container: this.options.container as HTMLDivElement,
        getCurrentTime: () => this.currentTime,
        avpacketList: addressof(this.GlobalData.avpacketList),
        avpacketListMutex: addressof(this.GlobalData.avpacketListMutex),
        codecpar: stream.codecpar, sink: layer.sink,
        videoWidth: this.selectedVideoStream?.codecpar.width ?? 0,
        videoHeight: this.selectedVideoStream?.codecpar.height ?? 0
      })
      render.setDemuxTask(this.taskId)
      await AVPlayer.DemuxerThread.connectStreamTask.transfer(render.getDemuxerPort(this.taskId))
        .invoke(this.taskId, stream.index, render.getDemuxerPort(this.taskId))
      this.sparkleLayers.push({ index: stream.index, render })
      if (this.status === AVPlayerStatus.PLAYED) render.start()
    }
  }

  public getEmbeddedFonts() {`
);
patch(
	'packages/avpipeline/src/DemuxPipeline.ts',
	'  public async addPendingStream(taskId: string, streamIndex: number) {',
	`  public async disconnectSubtitleStream(taskId: string, streamIndex: number) {
    const task = this.tasks.get(taskId)
    if (!task || task.formatContext.streams[streamIndex]?.codecpar.codecType !== AVMediaType.AVMEDIA_TYPE_SUBTITLE) return
    const running = task.loop?.isStarted()
    if (running) await task.loop.stopBeforeNextTick()
    const port = task.rightIPCPorts.get(streamIndex), request = task.cacheRequests.get(streamIndex)
    if (request) port?.reply(request, IOError.END)
    task.cacheRequests.delete(streamIndex)
    for (const p of task.cacheAVPackets.get(streamIndex) || []) task.avpacketPool.release(p)
    task.cacheAVPackets.delete(streamIndex)
    task.rightIPCPorts.delete(streamIndex)
    port?.destroy()
    if (running) task.loop.start()
  }

  public async addPendingStream(taskId: string, streamIndex: number) {`
);
// Mirror lifecycle changes for all additional renderers. Each patch run starts
// from the pinned source, so these replacements never accumulate.
{
	const file = resolve(root, player);
	let source = readFileSync(file, 'utf8');
	for (const operation of ['start', 'pause', 'reset'])
		source = source.replaceAll(
			`this.subtitleRender.${operation}()`,
			`this.subtitleRender.${operation}()\n      this.sparkleLayers.forEach((layer) => layer.render.${operation}())`
		);
	source = source.replace(
		'    this.selectedSubtitleStream = null',
		'    this.sparkleLayers.forEach((layer) => layer.render.destroy())\n    this.sparkleLayers = []\n    this.selectedSubtitleStream = null'
	);
	writeFileSync(file, source);
}
// A non-isolated demux worker transfers serialized packets, not pointers into
// shared memory. Stock SubtitleRender assumes the latter.
patch(
	subtitles,
	'  destroyAVPacket\n',
	'  destroyAVPacket,\n  createAVPacket,\n  unserializeAVPacket\n'
);
patch(
	subtitles,
	"    const avpacket = await this.leftPorts.get(this.currentPort).request<pointer<AVPacketRef>>('pull')",
	`    const result = await this.leftPorts.get(this.currentPort).request<any>('pull')
    let avpacket: pointer<AVPacketRef>
    if (typeof result === 'object') {
      avpacket = this.avpacketPool ? this.avpacketPool.alloc() : reinterpret_cast<pointer<AVPacketRef>>(createAVPacket())
      unserializeAVPacket(result, avpacket)
    }
    else avpacket = result`
);

// Oversized embedded attachments must be skipped, not interpreted as EBML.
// Enforce the font/attachment memory budget before any allocation takes place.
const matroskaSyntax = 'packages/avformat/src/formats/matroska/imatroska.ts';
patch(
	matroskaSyntax,
	'const MAX_ATTACHMENT_READ_SIZE = static_cast<int64>(20 * 1024 * 1024)',
	`const MAX_ATTACHMENT_READ_SIZE = static_cast<int64>(16 * 1024 * 1024)
const sparkleAttachmentBytes = new WeakMap<AVIFormatContext, bigint>()`
);
patch(
	matroskaSyntax,
	'        case EbmlType.BUFFER:\n          value = {',
	`        case EbmlType.BUFFER:
          if (length >= MAX_ATTACHMENT_READ_SIZE || (id === EBMLId.FILE_DATA && (sparkleAttachmentBytes.get(formatContext) || 0n) + length > 64n * 1024n * 1024n)) {
            await formatContext.ioReader.seek(formatContext.ioReader.getPos() + length)
            value = null
            break
          }
          if (id === EBMLId.FILE_DATA) sparkleAttachmentBytes.set(formatContext, (sparkleAttachmentBytes.get(formatContext) || 0n) + length)
          value = {`
);

// Matroska ContentCompAlgo defaults to zlib (0), including many PGS tracks.
const matroskaInput = 'packages/avformat/src/formats/IMatroskaFormat.ts';
patch(
	matroskaInput,
	'if (entry.compression && isDef(entry.compression.algo)) {',
	'if (entry.compression) {'
);
patch(
	matroskaInput,
	'      let size = frameSize[i]',
	'      let frame = this.blockReader.readBuffer(frameSize[i])\n      let size = frame.length'
);
patch(
	matroskaInput,
	'switch (compression.compression.algo) {',
	`switch (compression.compression.algo ?? 0) {
          case 0: {
            const reader = new Blob([new Uint8Array(frame)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
            const chunks: Uint8Array[] = []
            let total = 0
            while (true) {
              const next = await reader.read()
              if (next.done) break
              total += next.value.length
              if (total > 16 * 1024 * 1024) { await reader.cancel(); throw new Error('Compressed packet exceeds decoding limit') }
              chunks.push(next.value)
            }
            frame = new Uint8Array(total)
            let pos = 0
            chunks.forEach((chunk) => { frame.set(chunk, pos); pos += chunk.length })
            size = total
            break
          }`
);
patch(
	matroskaInput,
	'      memcpyFromUint8Array(data + offset, frameSize[i], this.blockReader.readBuffer(frameSize[i]))',
	'      memcpyFromUint8Array(data + offset, frame.length, frame)'
);
patch(
	matroskaInput,
	'      avpacket.pos = basePos + this.blockReader.getPos()',
	'      avpacket.pos = basePos + this.blockReader.getPos() - BigInt(frameSize[i])'
);

// Optional AV1 codec fields must carry the real color characteristics. Leaving
// them implicit makes a PQ/HLG MediaCapabilities query conflict with SDR defaults.
patch(
	'packages/avutil/src/function/getVideoCodec.ts',
	"        '%s.%d.%02d%s.%02d.%d.%d%d%d',",
	"        '%s.%d.%02d%s.%02d.%d.%d%d%d.%02d.%02d.%02d.%d',"
);
patch(
	'packages/avutil/src/function/getVideoCodec.ts',
	'        params.chromaSamplePosition\n',
	`        params.chromaSamplePosition,
        codecpar.colorPrimaries,
        codecpar.colorTrc,
        codecpar.colorSpace,
        codecpar.colorRange === 2 ? 1 : 0
`
);

// Preserve source MP4 HDR boxes byte-for-byte while remuxing, not just MKV tags.
patch(
	'packages/avformat/src/formats/isobmff/parsing/stsd.ts',
	'        else if (type === mktag(BoxType.COLR)) {',
	`        else if ([mktag('mdcv'), mktag('clli'), mktag('dvcC'), mktag('dvvC'), mktag('hvcE')].includes(type) && size >= 8 && size <= 65536) {
          const data = await ioReader.readBuffer(size - 8)
          const name = String.fromCharCode((type >>> 24) & 255, (type >>> 16) & 255, (type >>> 8) & 255, type & 255)
          if (name === 'dvcC' || name === 'dvvC') stream.metadata['sparkleDovi'] = { type: name, data }
          else {
            stream.metadata['sparkleHDRBoxes'] ||= {}
            stream.metadata['sparkleHDRBoxes'][name] = data
          }
        }
        else if (type === mktag(BoxType.COLR)) {`
);
patch(
	'packages/avformat/src/formats/isobmff/writing/stsd.ts',
	"  const color = stream.metadata['sparkleColor']",
	`  const boxes = stream.metadata['sparkleHDRBoxes']
  for (const name of ['mdcv', 'clli', 'hvcE']) {
    const data = boxes?.[name]
    if (data && !(name === 'hvcE' && stream.metadata['sparkleBaseHDROnly'])) {
      ioWriter.writeUint32(8 + data.length); ioWriter.writeString(name); ioWriter.writeBuffer(data)
    }
  }
  const color = stream.metadata['sparkleColor']`
);

// Subtitle pulls can still be pending when a media switch closes the worker.
// Consume cancellation locally and invalidate packets that belong to a seek or
// previous track before touching the decoder/packet pool again.
patch(
	subtitles,
	'  private pulling: boolean',
	'  private pulling: boolean\n  private pullGeneration = 0'
);
patch(
	subtitles,
	'        this.pull()',
	`        void this.pull().catch(() => {
          this.pulling = false
          this.ended = true
        })`
);
patch(
	subtitles,
	'    const currentPort = this.currentPort',
	'    const currentPort = this.currentPort\n    const generation = this.pullGeneration'
);
patch(
	subtitles,
	'    let avpacket: pointer<AVPacketRef>',
	`    if (!this.loop) return
    let avpacket: pointer<AVPacketRef>`
);
patch(
	subtitles,
	'    else if (this.loop && currentPort === this.currentPort) {',
	'    else if (this.loop && generation === this.pullGeneration && currentPort === this.currentPort) {'
);
patch(subtitles, '  public reset() {', '  public reset() {\n    this.pullGeneration++');
patch(
	subtitles,
	'  public destroy() {\n    this.loop.destroy()',
	`  public destroy() {
    this.pullGeneration++
    for (const port of this.leftPorts.values()) port.destroy()
    this.loop.destroy()`
);

// Select the rendering path after demux, before any frame is played. HDR WASM
// must produce integer AVFrames, not an implicitly converted 8-bit VideoFrame.
patch(
	player,
	'  public setBaseHDROnly(enable: boolean) {',
	`  public setHDRPlayback(path: 'native' | 'software', mime: string, dolbyVision = false) {
    const native = path === 'native'
    this.options.requireNativeVideo = native
    this.options.enableHardware = native
    this.options.enableWebCodecs = native
    this.options.checkUseMSE = () => native
    for (const s of this.formatContext.streams) {
      if (s.codecpar.codecType !== AVMediaType.AVMEDIA_TYPE_VIDEO) continue
      s.metadata['sparkleNativeMime'] = native ? mime : ''
      s.metadata['sparkleSoftwareDovi'] = !native && dolbyVision
      const tag = /codecs="(dvhe|dvh1|hev1|hvc1)\\./.exec(mime)?.[1]
      s.metadata['sparkleVideoTag'] = native && tag ? tag : ''
    }
  }

  public setBaseHDROnly(enable: boolean) {`
);
patch(
	player,
	'getVideoMimeType(videoStream.codecpar)',
	"(videoStream.metadata['sparkleNativeMime'] || getVideoMimeType(videoStream.codecpar))",
	true
);
patch(
	player,
	"return s ? getVideoMimeType(s.codecpar) : ''",
	"return s ? (s.metadata['sparkleNativeMime'] || getVideoMimeType(s.codecpar)) : ''"
);
const mse = 'packages/avplayer/src/mse/MSEPipeline.ts';
writeFileSync(
	resolve(root, 'packages/avplayer/src/mse/hdr-metadata.ts'),
	readFileSync(new URL('./hdr-metadata.ts', import.meta.url))
);
patch(
	mse,
	'import {\n  errorType,',
	"import { hevcHDRBoxes } from './hdr-metadata'\nimport {\n  errorType,"
);
patch(
	mse,
	'          mux.writeHeader(task.video.oformatContext)',
	`          const stream = task.video.oformatContext.streams[0]
          if (stream.codecpar.codecId === AVCodecID.AV_CODEC_ID_HEVC) {
            const config = stream.codecpar.extradataSize
              ? mapUint8Array(stream.codecpar.extradata, reinterpret_cast<size>(stream.codecpar.extradataSize)).slice()
              : new Uint8Array()
            const packet = task.video.backPacket > 0
              ? mapUint8Array(task.video.backPacket.data, reinterpret_cast<size>(task.video.backPacket.size)).slice()
              : undefined
            stream.metadata['sparkleHDRBoxes'] = {
              ...hevcHDRBoxes(config, packet, task.video.backPacket > 0 && !!(task.video.backPacket.flags & AVPacketFlags.AV_PKT_FLAG_H26X_ANNEXB)), ...stream.metadata['sparkleHDRBoxes']
            }
          }
          mux.writeHeader(task.video.oformatContext)`
);
patch(
	'packages/avformat/src/formats/isobmff/writing/stsd.ts',
	'  if (color?.masteringMeta) {',
	'  if (color?.masteringMeta && !boxes?.mdcv) {'
);
patch(
	'packages/avformat/src/formats/isobmff/writing/stsd.ts',
	"  if (typeof color?.maxCll === 'number' && typeof color?.maxFall === 'number') {",
	"  if (!boxes?.clli && typeof color?.maxCll === 'number' && typeof color?.maxFall === 'number') {"
);
// Seeking an ended MediaSource fires sourceopen again. Reinitializing it adds
// duplicate SourceBuffers (QuotaExceededError) and stalls subtitle/track changes.
patch(
	mse,
	`  private getSourceOpenHandler(task: SelfTask, startTimestamp: int64 = 0n) {
    return async () => {`,
	`  private getSourceOpenHandler(task: SelfTask, startTimestamp: int64 = 0n) {
    let initialized = false
    return async () => {
      if (initialized) return
      initialized = true`
);
patch(
	mse,
	'private getMimeType(codecpar: pointer<AVCodecParameters>)',
	'private getMimeType(codecpar: pointer<AVCodecParameters>, metadata: Record<string, any> = {})'
);
patch(
	mse,
	'mimeType = getVideoMimeType(codecpar)',
	"mimeType = metadata['sparkleNativeMime'] || getVideoMimeType(codecpar)"
);
patch(
	mse,
	'private createSourceBuffer(mediaSource: MediaSource, codecpar: pointer<AVCodecParameters>)',
	'private createSourceBuffer(mediaSource: MediaSource, codecpar: pointer<AVCodecParameters>, metadata: Record<string, any> = {})'
);
patch(mse, 'this.getMimeType(codecpar)', 'this.getMimeType(codecpar, metadata)');
patch(
	mse,
	'this.createSourceBuffer(task.mediaSource, addressof(task.video.oformatContext.streams[0].codecpar))',
	'this.createSourceBuffer(task.mediaSource, addressof(task.video.oformatContext.streams[0].codecpar), task.video.oformatContext.streams[0].metadata)'
);
patch(
	mse,
	'this.getMimeType(addressof(codecpar))',
	'this.getMimeType(addressof(codecpar), resource.oformatContext.streams[0].metadata)'
);
patch(
	mse,
	'this.getMimeType(addressof(resource.oformatContext.streams[0].codecpar))',
	'this.getMimeType(addressof(resource.oformatContext.streams[0].codecpar), resource.oformatContext.streams[0].metadata)'
);
patch(
	mse,
	'this.getMimeType(addressof(stream.codecpar))',
	'this.getMimeType(addressof(stream.codecpar), stream.metadata)'
);
patch(
	'packages/avformat/src/formats/isobmff/isobmff.ts',
	"  [mktag('hvc1')]: AVCodecID.AV_CODEC_ID_HEVC,",
	"  [mktag('hvc1')]: AVCodecID.AV_CODEC_ID_HEVC,\n  [mktag('dvh1')]: AVCodecID.AV_CODEC_ID_HEVC,\n  [mktag('dvhe')]: AVCodecID.AV_CODEC_ID_HEVC,"
);
patch(
	'packages/avformat/src/formats/isobmff/writing/stsd.ts',
	`function writeVideoTag(ioWriter: IOWriterSync, stream: AVStream, isobmffContext: IsobmffContext) {
  const pos = ioWriter.getPos()
  const tag = getTag(stream.codecpar)`,
	`function writeVideoTag(ioWriter: IOWriterSync, stream: AVStream, isobmffContext: IsobmffContext) {
  const pos = ioWriter.getPos()
  const tag = stream.metadata['sparkleVideoTag'] || getTag(stream.codecpar)`
);

// Share the exact shader with the reference-pixel tests. Its only output is SDR.
const renderer = 'packages/avrender/src/image/WebGLDefault16Render.ts';
writeFileSync(
	resolve(root, 'packages/avrender/src/image/hdr-sdr.ts'),
	readFileSync(new URL('./hdr-sdr.ts', import.meta.url))
);
patch(
	renderer,
	"import type { WebGLRenderOptions } from './WebGLRender'",
	"import { hdrSDRShader } from './hdr-sdr'\nimport type { WebGLRenderOptions } from './WebGLRender'"
);
patch(
	renderer,
	'const steps = generateSteps(this.srcColorSpace, this.dstColorSpace, colorTransformOptions)',
	`const steps = [16, 18].includes(this.srcColorSpace.getTransferId())
      ? [hdrSDRShader(this.srcColorSpace.getTransferId(), colorTransformOptions.bitDepth, this.srcColorSpace.getRangeId() === 2)]
      : generateSteps(this.srcColorSpace, this.dstColorSpace, colorTransformOptions)`
);

// Dolby Profile 5 must reshape from RPU and decode IPT-PQ; its base layer is
// not HDR10. Only single-layer, no-residual metadata is admitted to SDR output.
writeFileSync(
	resolve(root, 'packages/avrender/src/image/dovi-sdr.ts'),
	readFileSync(new URL('./dovi-sdr.ts', import.meta.url))
);
patch(
	'packages/avutil/src/struct/avframe.ts',
	'  AV_FRAME_DATA_DETECTION_BBOXES\n',
	'  AV_FRAME_DATA_DETECTION_BBOXES,\n  AV_FRAME_DATA_DOVI_RPU_BUFFER,\n  AV_FRAME_DATA_DOVI_METADATA\n'
);
patch(
	player,
	'          enableWebGPU: this.options.enableWebGPU,',
	`          enableWebGPU: this.options.enableWebGPU,
          dolbyVision: videoStream.metadata['sparkleSoftwareDovi'] || (!videoStream.metadata['sparkleBaseHDROnly'] && (videoStream.metadata['sparkleDovi']?.data?.[2] >> 1) === 5),`
);
const videoRender = 'packages/avpipeline/src/VideoRenderPipeline.ts';
patch(
	videoRender,
	'export interface VideoRenderTaskOptions extends TaskOptions {',
	'export interface VideoRenderTaskOptions extends TaskOptions {\n  dolbyVision?: boolean'
);
patch(
	videoRender,
	'devicePixelRatio: task.devicePixelRatio,',
	'devicePixelRatio: task.devicePixelRatio,\n                dolbyVision: task.dolbyVision,',
	true
);
patch(
	'packages/avrender/src/image/ImageRender.ts',
	'export type ImageRenderOptions = {',
	'export type ImageRenderOptions = {\n  dolbyVision?: boolean'
);
patch(
	renderer,
	"import { hdrSDRShader } from './hdr-sdr'",
	"import { hdrSDRShader } from './hdr-sdr'\nimport { readDovi, doviUniforms } from './dovi-sdr'"
);
patch(renderer, '  mapUint16Array,', '  mapUint16Array,\n  mapUint8Array,');
patch(
	renderer,
	'const steps = [16, 18].includes(this.srcColorSpace.getTransferId())',
	'const steps = this.options.dolbyVision || [16, 18].includes(this.srcColorSpace.getTransferId())'
);
patch(
	renderer,
	'hdrSDRShader(this.srcColorSpace.getTransferId(), colorTransformOptions.bitDepth, this.srcColorSpace.getRangeId() === 2)',
	'hdrSDRShader(this.options.dolbyVision ? 16 : this.srcColorSpace.getTransferId(), colorTransformOptions.bitDepth, this.srcColorSpace.getRangeId() === 2, this.options.dolbyVision)'
);
patch(
	renderer,
	'      uniform float offset;',
	"      ${this.options.dolbyVision ? doviUniforms : ''}\n      uniform float offset;"
);
patch(
	renderer,
	'    this.checkFrame(frame)',
	`    this.checkFrame(frame)
    if (this.options.dolbyVision) {
      const sideData = getAVFrameSideData(frame, AVFrameSideDataType.AV_FRAME_DATA_DOVI_METADATA)
      if (!sideData || sideData.size < 12 || sideData.size > 65536) throw new Error('Missing Dolby Vision frame metadata')
      this.program.setDovi(readDovi(mapUint8Array(sideData.data, sideData.size)))
    }`
);
// Changes to transfer/range/primaries must invalidate the shader as well as a
// size/format change. Release replaced programs rather than accumulating them.
patch(
	renderer,
	'  private linesize: int32',
	"  private linesize: int32\n  private sparkleColor = ''"
);
patch(
	renderer,
	'    if (frame.linesize[0] !== this.linesize',
	`    const colorKey = [frame.colorSpace, frame.colorPrimaries, frame.colorTrc, frame.colorRange].join(':')
    if (colorKey !== this.sparkleColor || frame.linesize[0] !== this.linesize`
);
patch(
	renderer,
	'      const descriptor = getAVPixelFormatDescriptor(frame.format as AVPixelFormat)',
	`      this.sparkleColor = colorKey
      if (!this.options.dolbyVision && [16, 18].includes(frame.colorTrc) && (frame.colorPrimaries !== 9 || frame.colorSpace !== 9))
        throw new Error('Unsupported HDR color matrix for SDR rendering')
      const descriptor = getAVPixelFormatDescriptor(frame.format as AVPixelFormat)`
);
patch(
	renderer,
	'      this.program = new VideoProgram16(',
	'      this.program?.stop()\n      this.program = new VideoProgram16('
);
const program16 = 'packages/avrender/src/image/webgl/program/VideoProgram16.ts';
patch(
	program16,
	"import type HdrMetadata from '../../struct/HdrMetadata'",
	"import type HdrMetadata from '../../struct/HdrMetadata'\nimport type { DoviData } from '../../dovi-sdr'"
);
patch(
	program16,
	'  private offsetLocation: WebGLUniformLocation',
	'  private doviLocations: Record<string, WebGLUniformLocation> = {}\n  private offsetLocation: WebGLUniformLocation'
);
patch(
	program16,
	'    super.link(gl)',
	`    super.link(gl)
    for (const name of ['Coefficients', 'Pivots', 'Counts', 'Nonlinear', 'LinearMatrix', 'Offset']) {
      this.doviLocations[name] = this.gl.getUniformLocation(this.program, 'dovi' + name)
    }`
);
patch(
	program16,
	'  setMetaData(data: HdrMetadata) {',
	`  setDovi(data: DoviData) {
    const l = this.doviLocations
    this.gl.uniform4fv(l.Coefficients, data.coefficients)
    this.gl.uniform4fv(l.Pivots, data.pivots)
    this.gl.uniform3fv(l.Counts, data.counts)
    this.gl.uniform3fv(l.Offset, data.offset)
    this.gl.uniformMatrix3fv(l.Nonlinear, false, data.nonlinear)
    this.gl.uniformMatrix3fv(l.LinearMatrix, false, data.linear)
  }

  setMetaData(data: HdrMetadata) {`
);

// Codec probes must use hvcC's actual profile/tier/level and bit-reversed RFC
// compatibility flags, including DV MP4s whose SPS omits redundant VUI tags.
patch(
	'packages/avutil/src/function/getVideoCodec.ts',
	'      if (extradata.length > 13) {',
	`      if (extradata.length > 13) {
        let compatibility = 0
        for (let i = 0; i < 32; i++) {
          if (extradata[2 + (i >>> 3)] & (1 << (7 - (i & 7)))) compatibility += 2 ** i
        }
        const constraints = Array.from(extradata.subarray(6, 12))
        while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop()
        return entry + '.' + ['', 'A', 'B', 'C'][extradata[1] >>> 6] + (extradata[1] & 31)
          + '.' + compatibility.toString(16).toUpperCase()
          + '.' + ((extradata[1] & 32) ? 'H' : 'L') + extradata[12]
          + (constraints.length ? '.' + constraints.map((value) => value.toString(16).toUpperCase()).join('.') : '')
      }
      if (extradata.length > 13) {`
);
