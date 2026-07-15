import Mic from 'lucide-react/dist/esm/icons/mic.mjs'
import Square from 'lucide-react/dist/esm/icons/square.mjs'
import { useEffect, useRef, useState } from 'react'

export function VoiceInputButton({
  disabled,
  isTranscribing,
  onAudio,
  onError
}: {
  disabled: boolean
  isTranscribing: boolean
  onAudio: (blob: Blob) => Promise<void>
  onError: (message: string) => void
}) {
  const [isRecording, setIsRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | undefined>(undefined)
  const streamRef = useRef<MediaStream | undefined>(undefined)
  const chunksRef = useRef<Blob[]>([])
  const timeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => () => cleanupRecorder(), [])

  async function startRecording() {
    if (!('MediaRecorder' in window) || navigator.mediaDevices?.getUserMedia === undefined) {
      onError('Browser audio capture is unavailable.')
      return
    }

    try {
      chunksRef.current = []
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = preferredAudioMimeType()
      const recorder = new MediaRecorder(stream, mimeType === undefined ? undefined : { mimeType })
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        cleanupRecorder()
        if (blob.size > 0) void onAudio(blob)
        else onError('No audio was captured.')
      }
      recorder.start()
      setIsRecording(true)
      timeoutRef.current = window.setTimeout(() => stopRecording(), 60_000)
    } catch (caught) {
      cleanupRecorder()
      onError(caught instanceof Error ? caught.message : 'Unable to start audio capture.')
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    else cleanupRecorder()
  }

  function cleanupRecorder() {
    if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = undefined
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = undefined
    recorderRef.current = undefined
    setIsRecording(false)
  }

  const title = isRecording ? 'Stop recording' : 'Record voice input'
  return (
    <button
      aria-label={title}
      className="rm-button px-2"
      disabled={(disabled && !isRecording) || isTranscribing}
      onClick={() => (isRecording ? stopRecording() : void startRecording())}
      title={title}
      type="button"
    >
      {isRecording ? <Square aria-hidden="true" size={14} /> : <Mic aria-hidden="true" size={14} />}
    </button>
  )
}

function preferredAudioMimeType(): string | undefined {
  const recorder = window.MediaRecorder
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((mimeType) => recorder.isTypeSupported(mimeType))
}
