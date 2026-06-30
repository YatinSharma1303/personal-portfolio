import { useEffect, useRef } from 'react';
import site from '../config/siteConfig';

// Hidden YouTube IFrame that drives the topbar player + slide-out panel.
export default function MusicPlayer({ player, setPlayer, volume, setProgress, seekRef }) {
  const ytRef = useRef(null);
  const ready = useRef(false);
  const wantPlay = useRef(false);

  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
    const init = () => {
      ytRef.current = new window.YT.Player('yt-music-frame', {
        videoId: site.music.videoId,
        playerVars: { autoplay: 0, controls: 0, loop: 1, playlist: site.music.videoId, playsinline: 1 },
        events: {
          onReady: (e) => {
            ready.current = true;
            e.target.setVolume(volume);
            if (wantPlay.current) { try { e.target.playVideo(); } catch {} }
          },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.PLAYING) setPlayer((p) => ({ ...p, playing: true }));
            if (e.data === window.YT.PlayerState.PAUSED) setPlayer((p) => ({ ...p, playing: false }));
          },
        },
      });
    };
    if (window.YT && window.YT.Player) init();
    else window.onYouTubeIframeAPIReady = init;
  }, [setPlayer]);

  // expose a seek function to the parent
  useEffect(() => {
    if (seekRef) {
      seekRef.current = (sec) => {
        if (ready.current && ytRef.current) { try { ytRef.current.seekTo(sec, true); } catch {} }
      };
    }
  }, [seekRef]);

  useEffect(() => {
    wantPlay.current = player.playing;
    if (!ready.current || !ytRef.current) return;
    try {
      if (player.playing) ytRef.current.playVideo();
      else ytRef.current.pauseVideo();
    } catch {}
  }, [player.playing]);

  useEffect(() => {
    if (ready.current && ytRef.current) { try { ytRef.current.setVolume(volume); } catch {} }
  }, [volume]);

  useEffect(() => {
    const iv = setInterval(() => {
      if (ready.current && ytRef.current && setProgress) {
        try {
          setProgress({
            current: ytRef.current.getCurrentTime() || 0,
            duration: ytRef.current.getDuration() || 0,
          });
        } catch {}
      }
    }, 500);
    return () => clearInterval(iv);
  }, [setProgress]);

  return (
    <div style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: -9999 }}>
      <div id="yt-music-frame" />
    </div>
  );
}
