// Vercel serverless function  ->  GET /api/plugins?ids=<acode ids>&repos=<repo names>
//
// 1) Live Acode stats (installs + votes) for each plugin id.
//    Done server-side because acode.app only sends CORS headers to its own
//    origins, so the browser can't call it directly from this site.
// 2) Whether each GitHub repo (under OWNER) is PUBLIC.
//    Checked WITHOUT any auth token, so a private repo can never look public.
//    The portfolio only shows a "Source" button when this says true, so making
//    a repo public is enough - no site changes needed.
//
// Responses are cached on Vercel's CDN for 5 minutes.

const OWNER = 'heyitsaadin';
const UA = 'aadinkc-portfolio';
const ID_RE = /^[a-z][a-z0-9._]{3,49}$/i;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_ITEMS = 20;

async function acodeStats(id) {
  try {
    const r = await fetch('https://acode.app/api/plugin/' + encodeURIComponent(id), {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      downloads: Number(d.downloads) || 0,
      votesUp: Number(d.votes_up) || 0,
      votesDown: Number(d.votes_down) || 0,
      paid: Boolean(d.price),
    };
  } catch (e) {
    return null;
  }
}

async function isPublicRepo(repo) {
  const headers = { 'User-Agent': UA };
  try {
    // Unauthenticated page request: 200 = public, 404 = private / missing.
    const page = await fetch(`https://github.com/${OWNER}/${repo}`, { method: 'HEAD', redirect: 'manual', headers });
    if (page.status === 200) return true;
    if (page.status === 404) return false;
    // Rate-limited or odd response: ask the unauthenticated API instead.
    const api = await fetch(`https://api.github.com/repos/${OWNER}/${repo}`, { headers });
    return api.status === 200;
  } catch (e) {
    return false; // fail closed - never expose a button we can't verify
  }
}

function list(value, re) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => re.test(s))
    .slice(0, MAX_ITEMS);
}

module.exports = async (req, res) => {
  const ids = list(req.query.ids, ID_RE);
  const repos = list(req.query.repos, REPO_RE);

  const [stats, visibility] = await Promise.all([
    Promise.all(ids.map(acodeStats)),
    Promise.all(repos.map(isPublicRepo)),
  ]);

  const out = { plugins: {}, repos: {} };
  ids.forEach((id, i) => { if (stats[i]) out.plugins[id] = stats[i]; });
  repos.forEach((repo, i) => { out.repos[repo] = visibility[i]; });

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).json(out);
};
