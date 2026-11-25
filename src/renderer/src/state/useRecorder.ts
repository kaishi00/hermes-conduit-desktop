import { useCallback, useEffect, useRef, useState } from 'react'

export interface Recording {
  blob: Blob
  mime: string
  /** Seconds. */
  duration: number
}

/** The phone's longest voice message. */
export const MAX_RECORDING_S = 10 * 60

const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

/**
 * The microphone, for a recording: started, then stopped for its audio or
 * cancelled. Its level (0 to 1) moves the meter while it records: heard
 * each frame through `onLevel`, never React state, so the composer and the
 * call aren't drawn again sixty times a second (desktop#545).
 */
export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const level = useRef(0)
  const levelListeners = useRef(new Set<(level: number) => void>())
  const hearLevel = (value: number) => {
    level.current = value
    for (const listener of [...levelListeners.current]) listener(value)
  }
  const [error, setError] = useState<string | null>(null)
  const parts = useRef<{
    recorder: MediaRecorder
    stream: MediaStream
    context: AudioContext
    chunks: Blob[]
    started: number
    timer: number
    frame: number
  } | null>(null)
  const stopping = useRef<((recording: Recording | null) => void) | null>(null)
  // Counts starts and cancels: a start whose microphone arrives after a cancel (or a hang-up) lets it go.
  const generation = useRef(0)

  const release = useCallback(() => {
    const current = parts.current
    parts.current = null
    if (!current) return
    window.clearInterval(current.timer)
    cancelAnimationFrame(current.frame)
    current.stream.getTracks().forEach(track => track.stop())
    void current.context.close().catch(() => undefined)
    setRecording(false)
    hearLevel(0)
  }, [])

  useEffect(
    () => () => {
      generation.current++
      release()
    },
    [release]
  )

  const stop = useCallback((): Promise<Recording | null> => {
    const current = parts.current
    if (!current || current.recorder.state === 'inactive') return Promise.resolve(null)
    return new Promise(resolve => {
      stopping.current = resolve
      current.recorder.stop()
    })
  }, [])

  const start = useCallback(async (): Promise<boolean> => {
    if (parts.current) return true
    setError(null)
    setElapsed(0)
    const mine = ++generation.current
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch (e) {
      // Cancelled meanwhile: not a failure.
      if (mine !== generation.current) return true
      const name = (e as { name?: string }).name
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'missing' : String((e as Error).message ?? e))
      return false
    }
    if (mine !== generation.current || parts.current) {
      stream.getTracks().forEach(track => track.stop())
      return true
    }
    const mime = MIME.find(type => MediaRecorder.isTypeSupported(type)) ?? ''
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const chunks: Blob[] = []
    const started = performance.now()
    const current = { recorder, stream, context, chunks, started, timer: 0, frame: 0 }
    const meter = () => {
      analyser.getByteTimeDomainData(samples)
      let peak = 0
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128)
      hearLevel(Math.max(peak, level.current * 0.85))
      current.frame = requestAnimationFrame(meter)
    }
    current.frame = requestAnimationFrame(meter)
    current.timer = window.setInterval(() => {
      const seconds = (performance.now() - started) / 1000
      setElapsed(seconds)
      if (seconds >= MAX_RECORDING_S && recorder.state === 'recording') recorder.stop()
    }, 250)
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = () => {
      const duration = (performance.now() - started) / 1000
      const type = recorder.mimeType || mime || 'audio/webm'
      release()
      const done = stopping.current
      stopping.current = null
      const result = chunks.length ? { blob: new Blob(chunks, { type }), mime: type.split(';')[0]!, duration } : null
      if (done) done(result)
    }
    parts.current = current
    recorder.start(1000)
    setRecording(true)
    return true
  }, [release])

  const cancel = useCallback(() => {
    generation.current++
    const current = parts.current
    stopping.current = null
    if (current && current.recorder.state !== 'inactive') {
      current.recorder.onstop = null
      current.recorder.stop()
    }
    release()
  }, [release])

  /** Hears the level each frame while recording, and 0 when it ends; returns the unsubscribe. */
  const onLevel = useCallback((listener: (level: number) => void) => {
    levelListeners.current.add(listener)
    return () => void levelListeners.current.delete(listener)
  }, [])

  return { recording, elapsed, onLevel, error, start, stop, cancel, clearError: () => setError(null) }
}
