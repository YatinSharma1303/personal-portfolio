import { useState, useEffect, useCallback, useRef } from 'react';
import site from './config/siteConfig';
import useReveal from './hooks/useReveal';
import useTheme from './hooks/useTheme';

import Intro from './components/Intro';
import Topbar from './components/Topbar';
import MusicPlayer from './components/MusicPlayer';
import MusicPanel from './components/MusicPanel';
import Hero from './components/Hero';
import About from './components/About';
import Skills from './components/Skills';
import Projects from './components/Projects';
import LastFM from './components/LastFM';
import AniList from './components/AniList';
import Interests from './components/Interests';
import AMA from './components/AMA';
import Footer from './components/Footer';
import GamesOverlay from './components/games/GamesOverlay';

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [entered, setEntered] = useState(false);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [player, setPlayer] = useState({ playing: false, title: site.music.title, artist: site.music.artist });
  const [volume, setVolume] = useState(site.music.defaultVolume);
  const [progress, setProgress] = useState({ current: 0, duration: 0 });
  const seekRef = useRef(null);
  useReveal();

  useEffect(() => {
    const sync = () => setGamesOpen(/^#(games|playground)$/i.test(location.hash));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const openGames = useCallback(() => { location.hash = '#games'; }, []);
  const closeGames = useCallback(() => { history.replaceState(null, '', '#hero'); setGamesOpen(false); }, []);

  return (
    <>
      {!entered && <Intro onEnter={() => {
        setEntered(true);
        setPlayer((p) => ({ ...p, playing: true }));
        // Reveal the player panel briefly so the music UI "initializes" on entry.
        setPanelOpen(true);
        setTimeout(() => setPanelOpen(false), 3500);
      }} />}

      <div className="grid-bg" />
      <div className="orb" style={{ top: '-10%', left: '-5%', width: 480, height: 480, background: 'var(--accent)' }} />
      <div className="orb" style={{ bottom: '0%', right: '-8%', width: 520, height: 520, background: 'var(--accent2)' }} />

      <Topbar
        theme={theme}
        toggleTheme={toggleTheme}
        player={player}
        setPlayer={setPlayer}
        onGames={openGames}
        onOpenPanel={() => setPanelOpen(true)}
      />

      <MusicPlayer player={player} setPlayer={setPlayer} volume={volume} setProgress={setProgress} seekRef={seekRef} />
      <MusicPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        player={player}
        setPlayer={setPlayer}
        progress={progress}
        volume={volume}
        setVolume={setVolume}
        onSeek={(s) => seekRef.current && seekRef.current(s)}
      />

      <main className="relative z-10">
        <Hero onGames={openGames} />
        <About />
        <Skills />
        <Projects />
        {site.widgets.lastfm && <LastFM />}
        {site.widgets.anilist && <AniList />}
        <Interests />
        {site.ama.mode !== 'off' && <AMA />}
      </main>

      <Footer onGames={openGames} />

      {gamesOpen && <GamesOverlay onClose={closeGames} />}
    </>
  );
}
