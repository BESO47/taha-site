import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Play,
  Pause,
  Maximize,
  Minimize,
  Lock,
  AlertOctagon,
  RefreshCw,
} from 'lucide-react'
import {
  extractGoogleDriveFileId,
  extractYouTubeId,
  isGoogleDriveUrl,
  isYouTubeUrl,
} from '../lib/driveUtils'

export default function ProtectedVideoPlayer({
  videoUrl,
  title = 'Physics Hub Lesson',
  studentInfo = { name: 'Physics Hub Student', phone: '01xxxxxxxxx' },
}) {
  const playerContainerRef = useRef(null)
  const videoRef = useRef(null)

  // Security Detection State
  const [isDevToolsDetected, setIsDevToolsDetected] = useState(false)

  // Native MP4 Video Player States
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // URL Types Detection
  const isDrive = isGoogleDriveUrl(videoUrl)
  const driveId = extractGoogleDriveFileId(videoUrl)
  const isYouTube = isYouTubeUrl(videoUrl)
  const ytId = extractYouTubeId(videoUrl)
  const isDirectVideo = !isDrive && !isYouTube

  // Ultra-Strict Anti-DevTools & Inspect Protection
  useEffect(() => {
    const blockShortcuts = (e) => {
      const code = e.keyCode || e.which
      const key = e.key

      if (
        code === 123 ||
        key === 'F12' ||
        code === 122 ||
        key === 'F11' ||
        (e.ctrlKey && e.shiftKey && (key === 'I' || key === 'i' || key === 'J' || key === 'j' || key === 'C' || key === 'c' || key === 'K' || key === 'k')) ||
        (e.ctrlKey && (key === 'u' || key === 'U' || key === 's' || key === 'S' || key === 'p' || key === 'P'))
      ) {
        e.preventDefault()
        e.stopPropagation()
        setIsDevToolsDetected(true)
        return false
      }
    }

    const checkDevToolsWithGetter = () => {
      try {
        const devtoolsCheck = new Image()
        Object.defineProperty(devtoolsCheck, 'id', {
          get: function () {
            setIsDevToolsDetected(true)
          },
        })
        console.log('%c', devtoolsCheck)
        console.clear()
      } catch (err) { }
    }

    const checkWindowDimensions = () => {
      const threshold = 140
      const widthDiff = window.outerWidth - window.innerWidth > threshold
      const heightDiff = window.outerHeight - window.innerHeight > threshold
      if (widthDiff || heightDiff) {
        setIsDevToolsDetected(true)
      }
    }

    window.addEventListener('keydown', blockShortcuts, true)
    document.addEventListener('keydown', blockShortcuts, true)
    window.addEventListener('contextmenu', (e) => e.preventDefault(), true)
    window.addEventListener('resize', checkWindowDimensions)

    const devToolsInterval = setInterval(() => {
      checkWindowDimensions()
      checkDevToolsWithGetter()
    }, 1000)

    return () => {
      window.removeEventListener('keydown', blockShortcuts, true)
      document.removeEventListener('keydown', blockShortcuts, true)
      window.removeEventListener('resize', checkWindowDimensions)
      clearInterval(devToolsInterval)
    }
  }, [])

  // Fullscreen Handler
  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return

    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true)
      }).catch((err) => console.log(err))
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
      }).catch((err) => console.log(err))
    }
  }

  // Native MP4 Handlers
  const togglePlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
  }

  const handleTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
  }

  const handleLoadedMetadata = () => {
    if (videoRef.current) setDuration(videoRef.current.duration)
  }

  const handleSeek = (e) => {
    const seekTime = parseFloat(e.target.value)
    if (videoRef.current) {
      videoRef.current.currentTime = seekTime
      setCurrentTime(seekTime)
    }
  }

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return '00:00'
    const minutes = Math.floor(timeInSeconds / 60)
    const seconds = Math.floor(timeInSeconds % 60)
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <div
      ref={playerContainerRef}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        return false
      }}
      onAuxClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        return false
      }}
      className="relative w-full aspect-video rounded-3xl overflow-hidden bg-slate-950 shadow-2xl border border-slate-800 select-none group font-ibm"
    >
      {/* 🚨 DEVTOOLS DETECTED SECURITY LOCK SCREEN */}
      {isDevToolsDetected ? (
        <div className="absolute inset-0 z-50 bg-red-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center space-y-4 text-white">
          <AlertOctagon className="w-16 h-16 text-red-500 animate-bounce" />
          <div className="space-y-2 max-w-md">
            <h3 className="text-xl font-bold font-messiri text-red-300">
              🚨 تم رصد أدوات الفحص (Inspect / DevTools)
            </h3>
            <p className="text-xs text-red-200 leading-relaxed font-bold">
              لحماية محتوى الدرس ومنع التسريب، تم قفل مشغل الفيديو تلقائياً. يُرجى إغلاق أدوات المطور (DevTools) ثم النقر على زر التحديث للمتابعة.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition"
          >
            <RefreshCw className="w-4 h-4" />
            <span>تحديث وتشغيل الدرس</span>
          </button>
        </div>
      ) : (
        <>
          {/* 🛡️ Semi-Transparent Static Watermark (Fixed Position, Non-Distracting) */}
          <div className="absolute bottom-12 right-6 pointer-events-none z-40 opacity-45 sm:opacity-55 hover:opacity-80 transition duration-300">
            <div className="bg-black/35 backdrop-blur-xs px-3.5 py-1.5 rounded-xl border border-white/10 text-white/80 text-xs font-mono font-bold flex flex-col items-end gap-0.5 shadow-lg select-none">
              <span className="text-[11px] text-white/90 font-bold">{studentInfo.name || 'طالب المنصة'}</span>
              <span className="text-[10px] tracking-wider dir-ltr text-amber-300/80">{studentInfo.phone || 'محمي ضد السرقة'}</span>
            </div>
          </div>


          {/* Fullscreen Button Toggle */}
          {(isDrive || isYouTube) && (
            <button
              onClick={toggleFullscreen}
              className="absolute bottom-3 left-3 z-30 bg-black/80 hover:bg-black text-white p-2.5 rounded-xl border border-white/20 backdrop-blur-md transition shadow-xl flex items-center gap-1 text-xs font-bold pointer-events-auto"
              title="ملء الشاشة"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          )}

          {/* ========================================================
              CASE 1: Google Drive Video Mode
             ======================================================== */}
          {isDrive && driveId && (
            <div className="relative w-full h-full">
              {/* 🔒 Top Header Shield: Height 60px across top to block Pop-Out Arrow & Title link completely */}
              <div
                className="absolute top-0 inset-x-0 h-16 z-30 bg-transparent cursor-default select-none pointer-events-auto"
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  return false
                }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
              />

              {/* Top-Right Extended Pop-Out Icon Blocker Shield */}
              <div
                className="absolute top-0 right-0 w-80 h-20 z-35 bg-transparent cursor-default pointer-events-auto"
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  return false
                }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
              />

              {/* Top-Left Extended Title Blocker Shield */}
              <div
                className="absolute top-0 left-0 w-80 h-20 z-35 bg-transparent cursor-default pointer-events-auto"
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  return false
                }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
              />

              <iframe
                src={`https://drive.google.com/file/d/${driveId}/preview`}
                className="w-full h-full border-0 pointer-events-auto"
                allow="autoplay; encrypted-media"
                title={title}
              />
            </div>
          )}

          {/* ========================================================
              CASE 2: YouTube Video Mode
             ======================================================== */}
          {isYouTube && ytId && (
            <div className="relative w-full h-full">
              <iframe
                src={`https://www.youtube.com/embed/${ytId}?autoplay=0&rel=0&modestbranding=1&controls=1`}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={title}
              />
            </div>
          )}

          {/* ========================================================
              CASE 3: Direct MP4 Video Mode
             ======================================================== */}
          {isDirectVideo && (
            <div className="relative w-full h-full">
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain cursor-pointer"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onClick={togglePlay}
                controlsList="nodownload noremoteplayback"
                disablePictureInPicture
                playsInline
              />

              {/* Center Big Play Button */}
              {!isPlaying && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 pointer-events-none">
                  <button
                    onClick={togglePlay}
                    className="pointer-events-auto p-5 rounded-full bg-yellow-400/90 hover:bg-yellow-300 text-black shadow-2xl hover:scale-110 transition duration-300 backdrop-blur-md border border-yellow-400/30"
                  >
                    <Play className="w-8 h-8 fill-current translate-x-0.5" />
                  </button>
                </div>
              )}

              {/* Controls Bar for MP4 */}
              <div className="absolute bottom-0 inset-x-0 z-30 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 space-y-2">
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-1.5 bg-white/20 hover:h-2 rounded-lg appearance-none cursor-pointer accent-yellow-400 transition-all"
                />

                <div className="flex items-center justify-between text-white text-xs">
                  <div className="flex items-center gap-3">
                    <button onClick={togglePlay} className="p-1.5 rounded-lg hover:bg-white/10">
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                    </button>
                    <span className="font-mono text-slate-300">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button onClick={toggleFullscreen} className="p-1.5 rounded-lg hover:bg-white/10">
                      {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
