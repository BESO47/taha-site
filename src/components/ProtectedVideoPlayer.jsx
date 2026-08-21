import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize, Minimize, Pause, Play, VideoOff } from 'lucide-react'
import {
  extractGoogleDriveFileId,
  extractYouTubeId,
  isGoogleDriveUrl,
  isYouTubeUrl,
} from '../lib/driveUtils'

function safeMediaUrl(value) {
  if (!value) return ''
  try {
    const parsed = new URL(String(value), window.location.origin)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    return parsed.href
  } catch (_) {
    return ''
  }
}

export default function ProtectedVideoPlayer({
  videoUrl,
  title = 'Physics Hub Lesson',
  studentInfo = { name: 'Physics Hub Student', phone: '01xxxxxxxxx' },
}) {
  const playerContainerRef = useRef(null)
  const videoRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const safeUrl = useMemo(() => safeMediaUrl(videoUrl), [videoUrl])
  const isDrive = isGoogleDriveUrl(safeUrl)
  const driveId = extractGoogleDriveFileId(safeUrl)
  const isYouTube = isYouTubeUrl(safeUrl)
  const youtubeId = extractYouTubeId(safeUrl)
  const isDirectVideo = Boolean(safeUrl && !isDrive && !isYouTube)

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === playerContainerRef.current)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const toggleFullscreen = async () => {
    if (!playerContainerRef.current) return
    if (document.fullscreenElement) await document.exitFullscreen()
    else await playerContainerRef.current.requestFullscreen()
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (videoRef.current.paused) videoRef.current.play().catch(() => {})
    else videoRef.current.pause()
  }

  const handleSeek = (event) => {
    const seekTime = Number(event.target.value)
    if (!videoRef.current || !Number.isFinite(seekTime)) return
    videoRef.current.currentTime = seekTime
    setCurrentTime(seekTime)
  }

  const formatTime = (secondsValue) => {
    if (!Number.isFinite(secondsValue)) return '00:00'
    const minutes = Math.floor(secondsValue / 60)
    const seconds = Math.floor(secondsValue % 60)
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  if (!safeUrl) {
    return (
      <div className="relative w-full aspect-video rounded-3xl bg-slate-950 border border-slate-800 text-slate-300 flex flex-col items-center justify-center gap-3 font-ibm">
        <VideoOff className="w-10 h-10 text-slate-500" />
        <p className="text-sm font-bold">Video unavailable for this account.</p>
      </div>
    )
  }

  return (
    <div
      ref={playerContainerRef}
      className="relative w-full aspect-video rounded-3xl overflow-hidden bg-slate-950 shadow-2xl border border-slate-800 select-none group font-ibm"
    >
      <div className="absolute bottom-12 right-6 pointer-events-none z-40 opacity-55">
        <div className="bg-black/50 px-3.5 py-1.5 rounded-xl border border-white/10 text-white/90 text-xs font-mono font-bold flex flex-col items-end shadow-lg">
          <span className="text-[11px]">{studentInfo.name || 'طالب المنصة'}</span>
          <span className="text-[10px] tracking-wider text-amber-300/90">{studentInfo.phone || 'Physics Hub'}</span>
        </div>
      </div>

      {(isDrive || isYouTube) && (
        <button
          type="button"
          onClick={() => toggleFullscreen().catch(() => {})}
          className="absolute bottom-3 left-3 z-50 bg-black/80 hover:bg-black text-white p-2.5 rounded-xl border border-white/20 transition shadow-xl"
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
      )}

      {isDrive && driveId && (
        <iframe
          src={`https://drive.google.com/file/d/${driveId}/preview`}
          className="w-full h-full border-0"
          allow="autoplay; encrypted-media; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          title={title}
        />
      )}

      {isYouTube && youtubeId && (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=0&rel=0&modestbranding=1&controls=1`}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          title={title}
        />
      )}

      {isDirectVideo && (
        <div className="relative w-full h-full">
          <video
            ref={videoRef}
            src={safeUrl}
            className="w-full h-full object-contain cursor-pointer"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
            onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
            onClick={togglePlay}
            controlsList="nodownload noremoteplayback"
            disablePictureInPicture
            preload="metadata"
            playsInline
          />

          {!isPlaying && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 pointer-events-none">
              <button
                type="button"
                onClick={togglePlay}
                className="pointer-events-auto p-5 rounded-full bg-yellow-400 hover:bg-yellow-300 text-black shadow-2xl"
                aria-label="Play video"
              >
                <Play className="w-8 h-8 fill-current" />
              </button>
            </div>
          )}

          <div className="absolute bottom-0 inset-x-0 z-30 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 space-y-2">
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={currentTime}
              onChange={handleSeek}
              aria-label="Video position"
              className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-yellow-400"
            />
            <div className="flex items-center justify-between text-white text-xs">
              <div className="flex items-center gap-3">
                <button type="button" onClick={togglePlay} className="p-1.5 rounded-lg hover:bg-white/10" aria-label={isPlaying ? 'Pause video' : 'Play video'}>
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                </button>
                <span className="font-mono text-slate-300">{formatTime(currentTime)} / {formatTime(duration)}</span>
              </div>
              <button type="button" onClick={() => toggleFullscreen().catch(() => {})} className="p-1.5 rounded-lg hover:bg-white/10" aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}>
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
