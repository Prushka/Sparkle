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
  if (execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== revision) throw new Error('Player source revision does not match the pinned build');
}
const touched = new Set();
function patch(file, before, after, all = false) {
	const path = resolve(root, file);
	// This is a disposable, pinned build checkout. Always start each touched file
	// from its committed source so successive patches remain reproducible.
	if (!touched.has(file)) {
		writeFileSync(path, execFileSync('git', ['-C', dirname(path), 'show', `HEAD:./${basename(path)}`]));
		touched.add(file);
	}
	const original = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
	if (original.includes(after)) return;
	if (!original.includes(before)) throw new Error(`Pinned source does not match: ${file}`);
	writeFileSync(path, all ? original.replaceAll(before, after) : original.replace(before, after));
}
const player = 'packages/avplayer/src/AVPlayer.ts';
patch(player, 'export interface AVPlayerOptions {', `export interface AVPlayerOptions {
  requireNativeVideo?: boolean
  subtitleSink?: {
    reset: (codec: number, header: Uint8Array) => void
    packet: (data: Uint8Array, pts: number, duration: number) => void
    time: (time: number) => void
    clear: () => void
  }
`);
patch(player, '  AVCodecID.AV_CODEC_ID_DTS,', '  AVCodecID.AV_CODEC_ID_DTS,\n  AVCodecID.AV_CODEC_ID_TRUEHD,');
patch(player, '  AVCodecID.AV_CODEC_ID_SUBRIP,', '  AVCodecID.AV_CODEC_ID_HDMV_PGS_SUBTITLE,\n  AVCodecID.AV_CODEC_ID_SUBRIP,');
patch(player, '        codecpar: subtitleStream.codecpar,', '        codecpar: subtitleStream.codecpar,\n        sink: this.options.subtitleSink,');
patch(player, '    this.useMSE = await this.checkUseMSE(options)', `    this.useMSE = await this.checkUseMSE(options)
    if (options.video && this.options.requireNativeVideo && !this.useMSE) {
      throw new Error('Native HDR video is not supported on this client')
    }`);
patch(player, '  public getStreams() {', `  public getEmbeddedFonts() {
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

  public getStreams() {`);
patch('packages/avutil/src/function/getWasmUrl.ts', '        // dts', `        case AVCodecID.AV_CODEC_ID_TRUEHD:
          return \`\${baseUrl}/decode/truehd.wasm\`
        // dts`);
const subtitles = 'packages/avplayer/src/subtitle/SubtitleRender.ts';
patch(subtitles, 'export interface SubtitleRenderOptions {', `export interface SubtitleRenderOptions {
  sink?: {
    reset: (codec: number, header: Uint8Array) => void
    packet: (data: Uint8Array, pts: number, duration: number) => void
    time: (time: number) => void
    clear: () => void
  }`);
patch(subtitles, '  private enable: boolean', '  private enable: boolean\n  private packetEnd = 0n');
patch(subtitles, '      if (this.queue.length < 6 && !this.ended) {', `      this.options.sink?.time(Number(this.options.getCurrentTime() - this.delay))
      if (this.queue.length < 6 && !this.ended && (!this.options.sink || this.packetEnd < this.options.getCurrentTime() + 30000n)) {`);
patch(subtitles, '  private createDecoder() {', `  private createDecoder() {
    if (this.options.sink) {
      const c = this.options.codecpar
      this.options.sink.reset(c.codecId, c.extradataSize ? mapUint8Array(c.extradata, reinterpret_cast<size>(c.extradataSize)).slice() : new Uint8Array())
      return
    }`);
patch(subtitles, '      const ret = this.decoder.decode(avpacket)', `      let ret = 0
      if (this.options.sink) {
        this.packetEnd = avpacket.pts + avpacket.duration
        if (avpacket.size > 16 * 1024 * 1024) { ret = -1 }
        else this.options.sink.packet(mapUint8Array(avpacket.data, reinterpret_cast<size>(avpacket.size)).slice(), Number(avpacket.pts), Number(avpacket.duration))
      }
      else ret = this.decoder.decode(avpacket)`);
patch(subtitles, '  public reset() {', '  public reset() {\n    this.packetEnd = 0n\n    this.options.sink?.clear()');
patch(subtitles, '    this.decoder.close()\n    this.decoder = null', '    this.decoder?.close()\n    this.decoder = null\n    this.options.sink?.clear()');
patch(subtitles, '  public stop() {', '  public stop() {\n    this.options.sink?.clear()');
// Keep Matroska mastering and light-level metadata alongside the existing nclx
// colour values through the worker/MSE stream handoff.
patch('packages/avformat/src/formats/IMatroskaFormat.ts', '          if (track.video.color) {', `          if (track.video.color) {
            stream.metadata['sparkleColor'] = track.video.color`);
patch('packages/avformat/src/formats/isobmff/writing/stsd.ts', '  colr(ioWriter, stream, isobmffContext)', `  colr(ioWriter, stream, isobmffContext)
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
  }`);
// Fix the upstream array declaration for the scalar mastering minimum luminance.
patch('packages/avformat/src/formats/matroska/imatroska.ts', `  [EBMLId.VIDEO_COLOR_LUMINA_NCE_MIN]: {
    type: EbmlType.FLOAT,
    isArray: true,`, `  [EBMLId.VIDEO_COLOR_LUMINA_NCE_MIN]: {
    type: EbmlType.FLOAT,`);
patch('packages/avformat/src/formats/matroska/type.ts', '  minLuminance?: float[]', '  minLuminance?: float');
patch(player, '/font|truetype|opentype/i', '/font|truetype|opentype|\\.(ttf|otf)$/i');
// Do not disguise High 10 as 8-bit High when probing native decoders.
patch('packages/avutil/src/function/getVideoCodec.ts', `    if (profile === H264Profile.kHigh10) {
      profile = H264Profile.kHigh
    }`, `    // Preserve the exact H.264 profile in browser capability probes.`);
// Matroska BlockAdditionMapping carries the original Dolby configuration. Keep
// it intact; RPU/EL NAL units and HDR10+ SEI remain in the unchanged video packets.
patch('packages/avformat/src/formats/matroska/type.ts', 'export interface TrackEntry {', `export interface TrackEntry {
  blockMappings?: { type: number, value: number, extra: EbmlBin }[]`);
patch('packages/avformat/src/formats/matroska/imatroska.ts', 'export const EbmlSyntaxTrackEntry: Partial<Record<EBMLId, EbmlSyntax<TrackEntry>>> = {', `export const EbmlSyntaxTrackEntry: Partial<Record<EBMLId, EbmlSyntax<TrackEntry>>> = {
  [0x41E4 as EBMLId]: {
    type: EbmlType.OBJECT, isArray: true, filedName: 'blockMappings', child: {
      0x41E7: { type: EbmlType.UINT, filedName: 'type' },
      0x41F0: { type: EbmlType.UINT, filedName: 'value' },
      0x41ED: { type: EbmlType.BUFFER, filedName: 'extra' }
    }
  },`);
patch('packages/avformat/src/formats/IMatroskaFormat.ts', '        let extradataOffset = 0', `        for (const mapping of track.blockMappings || []) {
          if ((mapping.type === 0x64766343 || mapping.type === 0x64767643) && mapping.extra?.data?.length >= 5 && mapping.extra.data.length <= 1024) {
            stream.metadata['sparkleDovi'] = { type: mapping.type === 0x64766343 ? 'dvcC' : 'dvvC', data: mapping.extra.data.slice() }
          }
        }
        let extradataOffset = 0`);
patch('packages/avformat/src/formats/isobmff/writing/stsd.ts', '  const color = stream.metadata[\'sparkleColor\']', `  const dovi = stream.metadata['sparkleDovi']
  if (dovi?.data && !stream.metadata['sparkleBaseHDROnly']) {
    ioWriter.writeUint32(8 + dovi.data.length); ioWriter.writeString(dovi.type); ioWriter.writeBuffer(dovi.data)
  }
  const color = stream.metadata['sparkleColor']`);
patch(player, '  public getVideoMimeType() {', `  public setBaseHDROnly(enable: boolean) {
    for (const s of this.formatContext.streams) s.metadata['sparkleBaseHDROnly'] = enable
  }

  public getVideoMimeType() {`);
console.log('Applied Sparkle libmedia v1.3.1 patches');
// Preserve a useful teardown stack for cancellation failures.
patch('packages/common/src/network/IPCPort.ts', "        req.reject('ipc port close')", "        req.reject(new Error('ipc port close'))");
// The audio renderer also has background/fake-play pulls that can outlive stop.
// Stop their continuations before accessing PCM buffers freed by unregisterTask.
const audioRender = 'packages/avpipeline/src/AudioRenderPipeline.ts';
patch(audioRender, '  stopping: boolean', '  stopping: boolean\n  closed: boolean');
patch(audioRender, '      stopping: false,', '      stopping: false,\n      closed: false,');
patch(audioRender, '  private async createTask(', `  private async pullFrame(task: SelfTask): Promise<pointer<AVFrameRef>> {
    if (task.closed || !task.leftIPCPort) return IOError.END as pointer<AVFrameRef>
    try { return await task.leftIPCPort.request<pointer<AVFrameRef>>('pull') }
    catch (error) {
      if (!task.closed) throw error
      return IOError.END as pointer<AVFrameRef>
    }
  }

  private async createTask(`);
patch(audioRender, "audioFrame = await task.leftIPCPort.request<pointer<AVFrameRef>>('pull')", 'audioFrame = await this.pullFrame(task)', true);
patch(audioRender, "const audioFrame = task.paddingAVFrame || await task.leftIPCPort.request<pointer<AVFrameRef>>('pull')", 'const audioFrame = task.paddingAVFrame || await this.pullFrame(task)\n    if (task.closed) return');
patch(audioRender, '      if (audioFrame === IOError.END) {', '      if (task.closed) return IOError.END\n      if (audioFrame === IOError.END) {');
patch(audioRender, '        let audioFrame = await this.pullFrame(task)', '        let audioFrame = await this.pullFrame(task)\n        if (task.closed) return');
patch(audioRender, '          let ret = await pullNewAudioFrame()', '          let ret = await pullNewAudioFrame()\n          if (task.closed) return IOError.END');
patch(audioRender, '            let ret = await pullNewAudioFrame()', '            let ret = await pullNewAudioFrame()\n            if (task.closed) return', true);
patch(audioRender, '          const ret = await receiveToPCMBuffer(pcmBuffer)', '          const ret = await receiveToPCMBuffer(pcmBuffer)\n          if (task.closed) return');
patch(audioRender, '          const ret = await receiveToPCMBuffer(addressof(task.outPCMBuffer))', '          const ret = await receiveToPCMBuffer(addressof(task.outPCMBuffer))\n          if (task.closed) return');
patch(audioRender, '    rightIPCPort.on(REQUEST, async (request: RpcMessage) => {', '    rightIPCPort.on(REQUEST, async (request: RpcMessage) => {\n      if (task.closed) return');
patch(audioRender, '  public async unregisterTask(taskId: string): Promise<void> {\n    const task = this.tasks.get(taskId)\n    if (task) {', '  public async unregisterTask(taskId: string): Promise<void> {\n    const task = this.tasks.get(taskId)\n    if (task) {\n      task.closed = true\n      task.stopping = true');
// Pending decoder pulls can complete after task teardown. Cancel their IPC
// requests and reject stale packets before touching the freed frame/packet pools.
for (const kind of ['Audio', 'Video']) {
  const file = `packages/avpipeline/src/${kind}DecodePipeline.ts`;
  patch(file, '  inputEnd: boolean', '  inputEnd: boolean\n  closed: boolean');
  patch(file, '      inputEnd: false,', '      inputEnd: false,\n      closed: false,');
  if (kind === 'Audio') {
    patch(file, '  closed: boolean', '  closed: boolean\n  leftIPCPort: IPCPort\n  rightIPCPort: IPCPort');
    patch(file, '      closed: false,', '      closed: false,\n      leftIPCPort,\n      rightIPCPort,');
    patch(file, '      onReceiveAudioData(audioData) {', '      onReceiveAudioData(audioData) {\n        if (task.closed) { audioData.close(); return }');
    patch(file, '                await task.pending', '                await task.pending\n                if (task.closed) return');
  } else {
    patch(file, '      onReceiveVideoFrame(frame, alpha) {', '      onReceiveVideoFrame(frame, alpha) {\n        if (task.closed) { frame.close(); alpha?.close(); return }');
    patch(file, '      onError: (error) => {', '      onError: (error) => {\n        if (task.closed) return');
    patch(file, '                let ret = await task.decoderFallbackReady', '                let ret = await task.decoderFallbackReady\n                if (task.closed) return');
  }
  patch(file, "    const result = await leftIPCPort.request<pointer<AVPacketRef> | AVPacketSerialize>('pull')", `    const result = await leftIPCPort.request<pointer<AVPacketRef> | AVPacketSerialize>('pull').catch((error) => {
      if (task.closed) return IOError.END as pointer<AVPacketRef>
      throw error
    })
    if (task.closed) return IOError.END as pointer<AVPacketRef>`);
  patch(file, '    rightIPCPort.on(REQUEST, async (request: RpcMessage) => {', '    rightIPCPort.on(REQUEST, async (request: RpcMessage) => {\n      if (task.closed) return');
  patch(file, '              const avpacket = await this.pullAVPacketInternal(task, leftIPCPort)', '              const avpacket = await this.pullAVPacketInternal(task, leftIPCPort)\n              if (task.closed) return');
  patch(file, '      task.rightPort.close()\n      task.leftPort.close()', `      task.closed = true
      ${kind === 'Audio' ? 'task.pendingResolve?.()' : ''}
      task.rightIPCPort.destroy()
      task.leftIPCPort.destroy()`);
}
// Resume must await native play promises so queued pause/seek commands cannot
// interrupt an unobserved play() promise after AVPlayer reports success.
patch(player, '          this.audio.play()', '          promises.push(this.audio.play())');
patch(player, '          this.video.play()', '          promises.push(this.video.play())');
patch(player, '        element.play()', `        void element.play().catch((error) => {
          // A later pause or source change legitimately cancels this retry.
          if (error?.name !== 'AbortError') this.fire(eventType.ERROR, [error])
        })`);
// Emscripten 4 PIC modules import stack bounds; provide the actual cheap heap
// stack, never independent memory or guessed offsets.
patch('packages/cheap/src/webassembly/WebAssemblyRunner.ts', "      'GOT.func': {", `      'GOT.mem': {
        __stack_low: new WebAssembly.Global({ mutable: true, value: defined(WASM_64) ? 'i64' : 'i32' }, StackTop),
        __stack_high: new WebAssembly.Global({ mutable: true, value: defined(WASM_64) ? 'i64' : 'i32' }, StackTop + config.STACK_SIZE)
      },
      'GOT.func': {`);
// Multiple embedded subtitle layers share the existing demuxer and video clock.
patch(player, '  private selectedSubtitleStream: AVStreamInterface', `  private sparkleLayers: { index: number, render: SubtitleRender }[] = []
  private selectedSubtitleStream: AVStreamInterface`);
patch(player, '  public getEmbeddedFonts() {', `  public async setSubtitleLayers(layers: { id: number, sink: AVPlayerOptions['subtitleSink'] }[]) {
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

  public getEmbeddedFonts() {`);
patch('packages/avpipeline/src/DemuxPipeline.ts', '  public async addPendingStream(taskId: string, streamIndex: number) {', `  public async disconnectSubtitleStream(taskId: string, streamIndex: number) {
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

  public async addPendingStream(taskId: string, streamIndex: number) {`);
// Mirror lifecycle changes for all additional renderers. Each patch run starts
// from the pinned source, so these replacements never accumulate.
{
 const file = resolve(root,player); let source = readFileSync(file,'utf8');
 for (const operation of ['start','pause','reset']) source=source.replaceAll(`this.subtitleRender.${operation}()`, `this.subtitleRender.${operation}()\n      this.sparkleLayers.forEach((layer) => layer.render.${operation}())`);
 source=source.replace('    this.selectedSubtitleStream = null', '    this.sparkleLayers.forEach((layer) => layer.render.destroy())\n    this.sparkleLayers = []\n    this.selectedSubtitleStream = null');
 writeFileSync(file,source);
}
// A non-isolated demux worker transfers serialized packets, not pointers into
// shared memory. Stock SubtitleRender assumes the latter.
patch(subtitles, '  destroyAVPacket\n', '  destroyAVPacket,\n  createAVPacket,\n  unserializeAVPacket\n');
patch(subtitles, "    const avpacket = await this.leftPorts.get(this.currentPort).request<pointer<AVPacketRef>>('pull')", `    const result = await this.leftPorts.get(this.currentPort).request<any>('pull')
    let avpacket: pointer<AVPacketRef>
    if (typeof result === 'object') {
      avpacket = this.avpacketPool ? this.avpacketPool.alloc() : reinterpret_cast<pointer<AVPacketRef>>(createAVPacket())
      unserializeAVPacket(result, avpacket)
    }
    else avpacket = result`);

// Oversized embedded attachments must be skipped, not interpreted as EBML.
// Enforce the font/attachment memory budget before any allocation takes place.
const matroskaSyntax = 'packages/avformat/src/formats/matroska/imatroska.ts';
patch(matroskaSyntax, 'const MAX_ATTACHMENT_READ_SIZE = static_cast<int64>(20 * 1024 * 1024)', `const MAX_ATTACHMENT_READ_SIZE = static_cast<int64>(16 * 1024 * 1024)
const sparkleAttachmentBytes = new WeakMap<AVIFormatContext, bigint>()`);
patch(matroskaSyntax, '        case EbmlType.BUFFER:\n          value = {', `        case EbmlType.BUFFER:
          if (length >= MAX_ATTACHMENT_READ_SIZE || (id === EBMLId.FILE_DATA && (sparkleAttachmentBytes.get(formatContext) || 0n) + length > 64n * 1024n * 1024n)) {
            await formatContext.ioReader.seek(formatContext.ioReader.getPos() + length)
            value = null
            break
          }
          if (id === EBMLId.FILE_DATA) sparkleAttachmentBytes.set(formatContext, (sparkleAttachmentBytes.get(formatContext) || 0n) + length)
          value = {`);

// Matroska ContentCompAlgo defaults to zlib (0), including many PGS tracks.
const matroskaInput = 'packages/avformat/src/formats/IMatroskaFormat.ts';
patch(matroskaInput, 'if (entry.compression && isDef(entry.compression.algo)) {', 'if (entry.compression) {');
patch(matroskaInput, '      let size = frameSize[i]', '      let frame = this.blockReader.readBuffer(frameSize[i])\n      let size = frame.length');
patch(matroskaInput, 'switch (compression.compression.algo) {', `switch (compression.compression.algo ?? 0) {
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
          }`);
patch(matroskaInput, '      memcpyFromUint8Array(data + offset, frameSize[i], this.blockReader.readBuffer(frameSize[i]))', '      memcpyFromUint8Array(data + offset, frame.length, frame)');
patch(matroskaInput, '      avpacket.pos = basePos + this.blockReader.getPos()', '      avpacket.pos = basePos + this.blockReader.getPos() - BigInt(frameSize[i])');

// Optional AV1 codec fields must carry the real color characteristics. Leaving
// them implicit makes a PQ/HLG MediaCapabilities query conflict with SDR defaults.
patch('packages/avutil/src/function/getVideoCodec.ts', "        '%s.%d.%02d%s.%02d.%d.%d%d%d',", "        '%s.%d.%02d%s.%02d.%d.%d%d%d.%02d.%02d.%02d.%d',");
patch('packages/avutil/src/function/getVideoCodec.ts', '        params.chromaSamplePosition\n', `        params.chromaSamplePosition,
        codecpar.colorPrimaries,
        codecpar.colorTrc,
        codecpar.colorSpace,
        codecpar.colorRange === 2 ? 1 : 0
`);

// Preserve source MP4 HDR boxes byte-for-byte while remuxing, not just MKV tags.
patch('packages/avformat/src/formats/isobmff/parsing/stsd.ts', '        else if (type === mktag(BoxType.COLR)) {', `        else if ([mktag('mdcv'), mktag('clli'), mktag('dvcC'), mktag('dvvC'), mktag('hvcE')].includes(type) && size >= 8 && size <= 65536) {
          const data = await ioReader.readBuffer(size - 8)
          const name = String.fromCharCode((type >>> 24) & 255, (type >>> 16) & 255, (type >>> 8) & 255, type & 255)
          if (name === 'dvcC' || name === 'dvvC') stream.metadata['sparkleDovi'] = { type: name, data }
          else {
            stream.metadata['sparkleHDRBoxes'] ||= {}
            stream.metadata['sparkleHDRBoxes'][name] = data
          }
        }
        else if (type === mktag(BoxType.COLR)) {`);
patch('packages/avformat/src/formats/isobmff/writing/stsd.ts', "  const color = stream.metadata['sparkleColor']", `  const boxes = stream.metadata['sparkleHDRBoxes']
  for (const name of ['mdcv', 'clli', 'hvcE']) {
    const data = boxes?.[name]
    if (data && !(name === 'hvcE' && stream.metadata['sparkleBaseHDROnly'])) {
      ioWriter.writeUint32(8 + data.length); ioWriter.writeString(name); ioWriter.writeBuffer(data)
    }
  }
  const color = stream.metadata['sparkleColor']`);

// Subtitle pulls can still be pending when a media switch closes the worker.
// Consume cancellation locally and invalidate packets that belong to a seek or
// previous track before touching the decoder/packet pool again.
patch(subtitles, '  private pulling: boolean', '  private pulling: boolean\n  private pullGeneration = 0');
patch(subtitles, '        this.pull()', `        void this.pull().catch(() => {
          this.pulling = false
          this.ended = true
        })`);
patch(subtitles, '    const currentPort = this.currentPort', '    const currentPort = this.currentPort\n    const generation = this.pullGeneration');
patch(subtitles, '    let avpacket: pointer<AVPacketRef>', `    if (!this.loop) return
    let avpacket: pointer<AVPacketRef>`);
patch(subtitles, '    else if (this.loop && currentPort === this.currentPort) {', '    else if (this.loop && generation === this.pullGeneration && currentPort === this.currentPort) {');
patch(subtitles, '  public reset() {', '  public reset() {\n    this.pullGeneration++');
patch(subtitles, '  public destroy() {\n    this.loop.destroy()', `  public destroy() {
    this.pullGeneration++
    for (const port of this.leftPorts.values()) port.destroy()
    this.loop.destroy()`);
