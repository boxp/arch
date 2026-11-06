export const STT_FINAL_FIELDS: Record<string, string> = {
  language: 'ja',
  temperature: '0.0',
  response_format: 'json',
  vad_speech_pad_ms: '200',
  prompt: 'コハコ。音声入力。',
}
export const STT_PARTIAL_FIELDS: Record<string, string> = STT_FINAL_FIELDS

export function pcmToWav(pcm: Buffer): Buffer {
  const size = pcm.length
  const wav = Buffer.alloc(44 + size)
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + size, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(size, 40)
  pcm.copy(wav, 44)
  return wav
}
