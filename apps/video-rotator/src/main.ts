import './styles.css'

type Rotation = 'cw' | 'ccw'
type ExportSize = 'source' | '1080' | '720'
type ExportFormat = 'mp4' | 'webm'
type FFmpegInstance = import('@ffmpeg/ffmpeg').FFmpeg
type FetchFile = typeof import('@ffmpeg/util').fetchFile
type ToBlobUrl = typeof import('@ffmpeg/util').toBlobURL

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Required UI element is missing: ${selector}`)
  }

  return element
}

const fileInput = getElement<HTMLInputElement>('#file-input')
const dropZone = getElement<HTMLButtonElement>('#drop-zone')
const dropZoneMeta = getElement<HTMLElement>('#drop-zone-meta')
const video = getElement<HTMLVideoElement>('#source-video')
const canvas = getElement<HTMLCanvasElement>('#preview-canvas')
const timeline = getElement<HTMLInputElement>('#timeline')
const rangeStart = getElement<HTMLInputElement>('#range-start')
const rangeEnd = getElement<HTMLInputElement>('#range-end')
const rangeFill = getElement<HTMLDivElement>('#range-fill')
const playhead = getElement<HTMLDivElement>('#playhead')
const startInput = getElement<HTMLInputElement>('#start-input')
const endInput = getElement<HTMLInputElement>('#end-input')
const sizeSelect = getElement<HTMLSelectElement>('#size-select')
const formatSelect = getElement<HTMLSelectElement>('#format-select')
const markStartButton = getElement<HTMLButtonElement>('#mark-start')
const markEndButton = getElement<HTMLButtonElement>('#mark-end')
const exportButton = getElement<HTMLButtonElement>('#export-button')
const fileMeta = getElement<HTMLElement>('#file-meta')
const timeMeta = getElement<HTMLSpanElement>('#time-meta')
const clipDuration = getElement<HTMLSpanElement>('#clip-duration')
const statusLine = getElement<HTMLDivElement>('#status')
const downloadLink = getElement<HTMLAnchorElement>('#download-link')

const maybeCtx = canvas.getContext('2d')

if (!maybeCtx) {
  throw new Error('Canvas 2D context is unavailable')
}

const ctx = maybeCtx

let sourceUrl: string | null = null
let sourceName = 'rotated-video'
let isExporting = false
let lastDownloadUrl: string | null = null
let ffmpeg: FFmpegInstance | null = null
let fetchFileForFfmpeg: FetchFile | null = null
let lastFfmpegLog = ''

const ffmpegCoreBaseUrl = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
const rangeInputs = [timeline, rangeStart, rangeEnd]

function getRotation(): Rotation {
  const checked = document.querySelector<HTMLInputElement>('input[name="rotation"]:checked')
  return checked?.value === 'ccw' ? 'ccw' : 'cw'
}

function getExportFormat(): ExportFormat {
  return formatSelect.value === 'webm' ? 'webm' : 'mp4'
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '00:00.0'
  }

  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes.toString().padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

function getDuration(): number {
  return Number.isFinite(video.duration) ? video.duration : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function setStatus(message: string): void {
  statusLine.textContent = message
}

function getClipRange(): { start: number; end: number } {
  const duration = getDuration()
  const start = clamp(Number(startInput.value) || 0, 0, duration)
  const fallbackEnd = duration > 0 ? duration : start
  const end = clamp(Number(endInput.value) || fallbackEnd, start, duration)
  return { start, end }
}

function getCanvasSize(): { width: number; height: number } {
  const sourceWidth = video.videoWidth || 16
  const sourceHeight = video.videoHeight || 9
  const selected = sizeSelect.value as ExportSize

  if (selected === 'source') {
    return {
      width: sourceHeight,
      height: sourceWidth,
    }
  }

  const height = Number(selected)
  return {
    width: Math.round((sourceHeight / sourceWidth) * height),
    height,
  }
}

function resizeCanvas(): void {
  const { width, height } = getCanvasSize()

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
}

function drawFrame(): void {
  resizeCanvas()

  ctx.save()
  ctx.fillStyle = '#101114'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (video.videoWidth > 0 && video.videoHeight > 0) {
    if (getRotation() === 'cw') {
      ctx.translate(canvas.width, 0)
      ctx.rotate(Math.PI / 2)
    } else {
      ctx.translate(0, canvas.height)
      ctx.rotate(-Math.PI / 2)
    }

    ctx.drawImage(video, 0, 0, canvas.height, canvas.width)
  }

  ctx.restore()
}

function updateMeta(): void {
  const duration = getDuration()
  timeline.value = video.currentTime.toString()
  timeMeta.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`
  updateTrimVisuals()
}

function tick(): void {
  drawFrame()
  updateMeta()
  window.requestAnimationFrame(tick)
}

function setDefaultRange(): void {
  const duration = getDuration()
  const end = Math.min(duration, 30)
  startInput.value = '0'
  endInput.value = end.toFixed(1)
  rangeStart.value = '0'
  rangeEnd.value = end.toString()
  updateTrimVisuals()
}

function normalizeRangeInputs(): void {
  const { start, end } = getClipRange()
  startInput.value = start.toFixed(1)
  endInput.value = end.toFixed(1)
  rangeStart.value = start.toString()
  rangeEnd.value = end.toString()
  updateTrimVisuals()
}

function updateRangeLimits(): void {
  const duration = getDuration()

  rangeInputs.forEach((input) => {
    input.max = duration.toString()
    input.disabled = duration <= 0
  })
}

function updateTrimVisuals(): void {
  const duration = getDuration()
  const { start, end } = getClipRange()
  const startPercent = duration > 0 ? (start / duration) * 100 : 0
  const endPercent = duration > 0 ? (end / duration) * 100 : 0
  const playheadPercent = duration > 0 ? (video.currentTime / duration) * 100 : 0

  rangeFill.style.left = `${startPercent}%`
  rangeFill.style.width = `${Math.max(0, endPercent - startPercent)}%`
  playhead.style.left = `${clamp(playheadPercent, 0, 100)}%`
  clipDuration.textContent = `${formatTime(end - start)} clip`
}

function updateRangeFromHandle(activeHandle: 'start' | 'end'): void {
  const duration = getDuration()
  const minGap = duration > 0 ? Math.min(0.1, duration) : 0
  let start = Number(rangeStart.value) || 0
  let end = Number(rangeEnd.value) || 0

  if (activeHandle === 'start') {
    start = clamp(start, 0, Math.max(0, end - minGap))
  } else {
    end = clamp(end, Math.min(duration, start + minGap), duration)
  }

  startInput.value = start.toFixed(1)
  endInput.value = end.toFixed(1)
  rangeStart.value = start.toString()
  rangeEnd.value = end.toString()
  video.currentTime = activeHandle === 'start' ? start : end
  updateTrimVisuals()
}

function revokeDownload(): void {
  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl)
    lastDownloadUrl = null
  }

  downloadLink.hidden = true
  downloadLink.removeAttribute('href')
}

function setSourceFile(file: File): void {
  if (!file.type.startsWith('video/')) {
    setStatus('動画ファイルを選択してください')
    return
  }

  if (sourceUrl) {
    URL.revokeObjectURL(sourceUrl)
  }

  revokeDownload()
  sourceUrl = URL.createObjectURL(file)
  sourceName = file.name.replace(/\.[^.]+$/, '') || 'rotated-video'
  video.src = sourceUrl
  fileMeta.textContent = `${file.name} / ${(file.size / 1024 / 1024).toFixed(1)} MB`
  dropZoneMeta.textContent = file.name
  document.body.classList.add('has-video')
  exportButton.disabled = false
  setStatus('読み込み中')
}

function getDroppedVideoFile(event: DragEvent): File | null {
  const files = Array.from(event.dataTransfer?.files ?? [])
  return files.find((file) => file.type.startsWith('video/')) ?? null
}

function getSupportedMimeType(format: ExportFormat): string {
  const mp4Candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.64001F,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
  ]
  const webmCandidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  const candidates = format === 'mp4' ? [...mp4Candidates, ...webmCandidates] : webmCandidates

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

function captureAudioTracks(): MediaStreamTrack[] {
  const captureStream =
    (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream ??
    (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream

  if (!captureStream) {
    return []
  }

  return captureStream.call(video).getAudioTracks()
}

async function recordRotatedClip(start: number, end: number, mimeType: string): Promise<Blob> {
  const chunks: Blob[] = []

  resizeCanvas()
  await seekVideo(start)

  const canvasStream = canvas.captureStream(30)
  const outputStream = new MediaStream(canvasStream.getVideoTracks())
  captureAudioTracks().forEach((track) => outputStream.addTrack(track))
  const recorder = new MediaRecorder(outputStream, { mimeType })

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  })

  const stopped = once(recorder, 'stop')
  recorder.start(250)
  await video.play()

  const stopWhenDone = () => {
    if (video.currentTime >= end || video.ended) {
      recorder.stop()
      video.pause()
      return
    }

    window.requestAnimationFrame(stopWhenDone)
  }

  stopWhenDone()
  await stopped

  return new Blob(chunks, { type: mimeType })
}

async function loadFfmpeg(): Promise<{ ffmpeg: FFmpegInstance; fetchFile: FetchFile }> {
  if (ffmpeg && fetchFileForFfmpeg) {
    return { ffmpeg, fetchFile: fetchFileForFfmpeg }
  }

  setStatus('MP4変換エンジンを読み込み中')

  const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ])

  ffmpeg = new FFmpeg()
  fetchFileForFfmpeg = fetchFile
  ffmpeg.on('log', ({ message }) => {
    lastFfmpegLog = message
  })
  ffmpeg.on('progress', ({ progress }) => {
    if (progress > 0 && progress <= 1) {
      setStatus(`MP4へ変換中 ${Math.round(progress * 100)}%`)
    }
  })

  await ffmpeg.load(await getFfmpegCoreUrls(toBlobURL))

  return { ffmpeg, fetchFile }
}

async function getFfmpegCoreUrls(
  toBlobURL: ToBlobUrl,
): Promise<{ coreURL: string; wasmURL: string }> {
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(`${ffmpegCoreBaseUrl}/ffmpeg-core.js`, 'text/javascript'),
    toBlobURL(`${ffmpegCoreBaseUrl}/ffmpeg-core.wasm`, 'application/wasm'),
  ])

  return { coreURL, wasmURL }
}

async function convertWebmToMp4(webmBlob: Blob): Promise<Blob> {
  const { ffmpeg: ffmpegInstance, fetchFile } = await loadFfmpeg()
  const inputName = 'input.webm'
  const outputName = 'output.mp4'

  setStatus('MP4へ変換中')
  lastFfmpegLog = ''
  await ffmpegInstance.writeFile(inputName, await fetchFile(webmBlob))

  const exitCode = await ffmpegInstance.exec([
    '-i',
    inputName,
    '-c:v',
    'mpeg4',
    '-q:v',
    '5',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    'faststart',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    outputName,
  ])

  if (exitCode !== 0) {
    const detail = lastFfmpegLog ? `: ${lastFfmpegLog}` : ''
    throw new Error(`MP4変換に失敗しました${detail}`)
  }

  const data = await ffmpegInstance.readFile(outputName)
  await Promise.allSettled([
    ffmpegInstance.deleteFile(inputName),
    ffmpegInstance.deleteFile(outputName),
  ])

  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return new Blob([buffer], { type: 'video/mp4' })
}

function showDownload(blob: Blob, extension: ExportFormat, start: number, end: number): void {
  lastDownloadUrl = URL.createObjectURL(blob)
  downloadLink.href = lastDownloadUrl
  downloadLink.download = `${sourceName}-${Math.round(start * 10)}-${Math.round(end * 10)}.${extension}`
  downloadLink.textContent = `${downloadLink.download} を保存`
  downloadLink.hidden = false
}

async function exportClip(): Promise<void> {
  if (isExporting) {
    return
  }

  const { start, end } = getClipRange()
  const duration = end - start
  const format = getExportFormat()

  if (!video.src || duration <= 0) {
    setStatus('書き出す時間範囲を指定してください')
    return
  }

  const mimeType = getSupportedMimeType(format)

  if (!mimeType) {
    setStatus('このブラウザはMediaRecorderの動画書き出しに対応していません')
    return
  }

  isExporting = true
  exportButton.disabled = true
  revokeDownload()
  setStatus('回転済み動画を書き出し中')

  const wasMuted = video.muted
  const wasPaused = video.paused

  try {
    const recordedBlob = await recordRotatedClip(start, end, mimeType)
    const outputBlob =
      format === 'mp4' && !mimeType.startsWith('video/mp4')
        ? await convertWebmToMp4(recordedBlob)
        : recordedBlob
    showDownload(outputBlob, format, start, end)
    setStatus('書き出し完了')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '書き出しに失敗しました')
  } finally {
    video.muted = wasMuted
    if (wasPaused) {
      video.pause()
    }
    isExporting = false
    exportButton.disabled = !video.src
  }
}

function once<T extends EventTarget>(target: T, type: string): Promise<Event> {
  return new Promise((resolve) => {
    target.addEventListener(type, resolve, { once: true })
  })
}

async function seekVideo(time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.05 && !video.seeking) {
    return
  }

  const seeked = once(video, 'seeked')
  video.currentTime = time
  await seeked
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]

  if (!file) {
    return
  }

  setSourceFile(file)
})

dropZone.addEventListener('click', () => {
  fileInput.click()
})

dropZone.addEventListener('dragenter', (event) => {
  event.preventDefault()
  dropZone.classList.add('is-dragging')
})

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault()
  dropZone.classList.add('is-dragging')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('is-dragging')
})

dropZone.addEventListener('drop', (event) => {
  event.preventDefault()
  dropZone.classList.remove('is-dragging')

  const file = getDroppedVideoFile(event)

  if (!file) {
    setStatus('動画ファイルをドロップしてください')
    return
  }

  setSourceFile(file)
})

window.addEventListener('dragover', (event) => {
  event.preventDefault()
})

window.addEventListener('drop', (event) => {
  event.preventDefault()
})

video.addEventListener('loadedmetadata', () => {
  updateRangeLimits()
  setDefaultRange()
  normalizeRangeInputs()
  resizeCanvas()
  drawFrame()
  setStatus(`${video.videoWidth}x${video.videoHeight} を読み込みました`)
})

timeline.addEventListener('input', () => {
  video.currentTime = Number(timeline.value)
  updateTrimVisuals()
})

startInput.addEventListener('change', normalizeRangeInputs)
endInput.addEventListener('change', normalizeRangeInputs)
rangeStart.addEventListener('input', () => updateRangeFromHandle('start'))
rangeEnd.addEventListener('input', () => updateRangeFromHandle('end'))
sizeSelect.addEventListener('change', drawFrame)
document.querySelectorAll<HTMLInputElement>('input[name="rotation"]').forEach((input) => {
  input.addEventListener('change', drawFrame)
})

markStartButton.addEventListener('click', () => {
  startInput.value = video.currentTime.toFixed(1)
  normalizeRangeInputs()
})

markEndButton.addEventListener('click', () => {
  endInput.value = video.currentTime.toFixed(1)
  normalizeRangeInputs()
})

exportButton.addEventListener('click', () => {
  void exportClip()
})

window.requestAnimationFrame(tick)
