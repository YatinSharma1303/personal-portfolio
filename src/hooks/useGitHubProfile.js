import { useEffect, useState } from 'react';

export default function useGitHubProfile(username) {
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    if (!username) return;
    fetch(`https://api.github.com/users/${username}`)
      .then((r) => r.json())
      .then((d) => { if (d && d.login) setProfile(d); })
      .catch(() => {});
  }, [username]);
  return profile;
}
