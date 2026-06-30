import { useEffect, useState } from 'react';

export default function useGitHub(username) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!username) return;
    fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=pushed`)
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        const top = data
          .filter((r) => !r.fork)
          .sort((a, b) => b.stargazers_count - a.stargazers_count || new Date(b.pushed_at) - new Date(a.pushed_at))
          .slice(0, 6);
        setRepos(top);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [username]);
  return { repos, loading };
}
