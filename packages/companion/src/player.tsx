import React, { useEffect, useRef, useState } from 'react'
import { clips, poster, type Clip } from './media'
import type { Action, CompanionStore } from './state'
import { afterClip, entryClip, isCurrentAction, isLoop, returnSpeed } from './transitions'

/** Decoders feed one persistent surface, which holds the last frame during loads/seeks. */
export function PetPlayer({ action, animate, store }: { action: Action; animate: boolean; store: CompanionStore }) {
  const [clip, setClip] = useState<Clip>(entryClip(action))
  const [shown, setShown] = useState(-1)
  const [failed, setFailed] = useState(false)
  const videos = useRef<(HTMLVideoElement | null)[]>([])
  const surface = useRef<HTMLCanvasElement | null>(null)
  const active = useRef(-1)
  const preparing = useRef(-1)
  const request = useRef(0)
  const latest = useRef({ action, animate })
  latest.current = { action, animate }
  useEffect(() => {
    const token = ++request.current
    const nextIndex = active.current === 0 ? 1 : 0
    const video = videos.current[nextIndex]
    if (!video) return
    preparing.current = nextIndex
    let frameCallback: number | undefined
    setFailed(false)
    const fail = () => {
      if (request.current !== token) return
      for (const v of videos.current) v?.pause()
      setFailed(true); store.mediaError('动画暂时无法播放，已使用静态立绘。重新显示桌宠可重试。')
    }
    const timeout = setTimeout(fail, 10000)
    video.onloadeddata = () => {
      if (request.current !== token) return
      video.dataset.clip = clip
      const reveal = () => {
        if (request.current !== token) return
        clearTimeout(timeout)
        if (active.current !== nextIndex) {
          videos.current[active.current]?.pause()
          preparing.current = -1
          active.current = nextIndex; setShown(nextIndex); store.mediaError('')
        }
      }
      const paint = () => {
        const canvas = surface.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context || video.readyState < 2) return
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(video, 0, 0)
      }
      const present = () => {
        if (request.current !== token) return
        paint(); reveal()
        frameCallback = video.requestVideoFrameCallback(present)
      }
      // Keep the canvas untouched while a decoder loads or seeks at a loop seam.
      frameCallback = video.requestVideoFrameCallback(present)
      if (latest.current.animate) {
        void video.play().catch(error => { if (error?.name !== 'AbortError') fail() })
      } else { paint(); reveal() }
    }
    video.onerror = fail
    video.onended = () => {
      if (request.current !== token) return
      const requested = latest.current.action
      if ((clip === 'complete' || clip === 'interact') && requested === clip) store.finishPreview()
      else setClip(afterClip(clip, requested))
    }
    video.muted = true
    video.loop = isLoop(clip)
    video.playbackRate = 1
    video.src = clips[clip]
    video.load()
    return () => {
      clearTimeout(timeout)
      if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback)
      if (preparing.current === nextIndex) preparing.current = -1
      video.pause(); video.onloadeddata = null; video.onerror = null; video.onended = null
    }
  }, [clip, store])
  useEffect(() => {
    const returning = !isCurrentAction(clip, action)
    let fallback: ReturnType<typeof setTimeout> | undefined
    for (const [i, video] of videos.current.entries()) {
      if (!video) continue
      if (!animate || failed) { video.pause(); continue }
      if (i !== active.current) { if (i !== preparing.current) video.pause(); continue }
      if (video.dataset.clip !== clip) continue
      video.loop = !returning && isLoop(clip)
      video.playbackRate = returning ? returnSpeed(video.duration, video.currentTime) : 1
      if (returning) {
        if (video.ended) { setClip(afterClip(clip, action)); continue }
        // A stalled decoder must not hold an obsolete action indefinitely.
        fallback = setTimeout(() => setClip(afterClip(clip, latest.current.action)), 1100)
      }
      const token = request.current
      void video.play().catch(error => {
        if (error?.name === 'AbortError' || token !== request.current || !latest.current.animate) return
        setFailed(true); store.mediaError('动画暂时无法播放，已使用静态立绘。')
      })
    }
    if (!animate && returning) setClip(entryClip(action))
    return () => clearTimeout(fallback)
  }, [action, clip, shown, animate, failed, store])
  useEffect(() => {
    const owned = [...videos.current]
    return () => {
      request.current++
      for (const video of owned) { if (video) { video.pause(); video.removeAttribute('src'); video.load() } }
    }
  }, [])
  return <div className="whale-media" aria-hidden="true" data-clip={clip} data-static={failed || !animate || undefined}>
    <img src={poster} alt="" draggable={false} style={{ opacity: shown < 0 || failed || !animate ? 1 : 0 }} />
    <canvas ref={surface} width={288} height={384} style={{ opacity: shown >= 0 && !failed && animate ? 1 : 0 }} />
    {[0, 1].map(i => <video key={i} ref={node => { videos.current[i] = node }} muted playsInline preload="auto" disablePictureInPicture
      data-presenting={shown === i ? 'true' : undefined} style={{ opacity: 0 }} />)}
  </div>
}
