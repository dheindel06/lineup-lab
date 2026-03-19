const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const Anthropic = require('@anthropic-ai/sdk');

// Load .env if present (local dev — Railway uses env vars directly)
try {
  const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
  env.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  });
} catch {}

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Server-side stats cache — persists for process lifetime
const statsCache = new Map();

// Current NBA season start year (update each October)
const CURRENT_SEASON = 2024; // 2024-25 season
const RECENT_SEASONS = new Set([2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015]);

// ── balldontlie.io helper ──────────────────────────────────────────────────
// Free tier, no API key needed for basic endpoints
function bdlGet(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.balldontlie.io',
      path: urlPath,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': process.env.BDL_API_KEY || '',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('BDL parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(6000, () => { req.destroy(); reject(new Error('BDL timeout')); });
    req.end();
  });
}

// Search for a player by name on balldontlie, return their id
async function bdlFindPlayer(name) {
  try {
    const parts = name.trim().split(' ');
    const query = encodeURIComponent(parts.slice(-1)[0]); // search by last name
    const data = await bdlGet(`/v1/players?search=${query}&per_page=25`);
    if (!data?.data?.length) return null;
    // Find best name match
    const lower = name.toLowerCase();
    const match = data.data.find(p =>
      `${p.first_name} ${p.last_name}`.toLowerCase() === lower
    ) || data.data.find(p =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(parts[0].toLowerCase())
    );
    return match || null;
  } catch { return null; }
}

// Fetch season averages from balldontlie for a player+season
async function bdlGetSeasonStats(playerId, season) {
  try {
    const data = await bdlGet(`/v1/season_averages?season=${season}&player_ids[]=${playerId}`);
    if (!data?.data?.length) return null;
    const s = data.data[0];
    return {
      ppg:       s.pts   ?? null,
      rpg:       s.reb   ?? null,
      apg:       s.ast   ?? null,
      spg:       s.stl   ?? null,
      bpg:       s.blk   ?? null,
      fg_pct:    s.fg_pct  ?? null,
      three_pct: s.fg3_pct ?? null,
      ft_pct:    s.ft_pct  ?? null,
      ts_pct:    null, // not in BDL free tier
      per:       null,
      ws:        null,
      ortg:      null,
      drtg:      null,
      mpg:       s.min ? parseFloat(s.min) : null,
      gp:        s.games_played ?? null,
      source:    'balldontlie.io (live)',
      bbref_season: `${season}-${String(season + 1).slice(2)}`,
      confidence: 'high',
    };
  } catch { return null; }
}

// ── Fetch stats for a single player+season (BDL → web search → AI) ────────
async function fetchOnePlayerStats(player, season) {
  const key = `${player}::${season}`;
  if (statsCache.has(key)) return statsCache.get(key);

  let stats = null;

  // 1. Try balldontlie for recent seasons
  if (RECENT_SEASONS.has(season)) {
    try {
      const bdlPlayer = await bdlFindPlayer(player);
      if (bdlPlayer) {
        stats = await bdlGetSeasonStats(bdlPlayer.id, season);
        if (stats) console.log(`[BDL] ${player} ${season}: ✓`);
      }
    } catch (e) {
      console.warn(`[BDL] ${player} ${season}: ${e.message}`);
    }
  }

  // 2. Fall back to web search for current/recent if BDL missed
  if (!stats && season >= 2015) {
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Search Basketball Reference for ${player}'s per-game stats in the ${season}-${String(season + 1).slice(2)} NBA season. Return ONLY a JSON object, no markdown. Keys: ppg, rpg, apg, spg, bpg, fg_pct, three_pct, ft_pct, ts_pct, per, ws, ortg, drtg, mpg, gp. All numbers or null.`,
        }],
      });
      const text = msg.content.map(c => c.type === 'text' ? c.text : '').join('');
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      stats = {
        ...parsed,
        source: 'Basketball Reference (web search)',
        bbref_season: `${season}-${String(season + 1).slice(2)}`,
        confidence: 'high',
      };
      console.log(`[WebSearch] ${player} ${season}: ✓`);
    } catch (e) {
      console.warn(`[WebSearch] ${player} ${season}: ${e.message}`);
    }
  }

  // 3. Final fallback: AI knowledge for historical seasons
  if (!stats) {
    // Will be handled in batch below — return null to signal batch needed
    return null;
  }

  if (stats) statsCache.set(key, stats);
  return stats;
}

// ── /api/claude ────────────────────────────────────────────────────────────
// model: 'haiku' = cheap utility calls, 'sonnet' = deep analysis
const MODELS = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-20250514',
};

app.post('/api/claude', async (req, res) => {
  const { prompt, maxTokens = 600, model = 'sonnet' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  try {
    const msg = await anthropic.messages.create({
      model: MODELS[model] || MODELS.sonnet,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ text: msg.content.map(c => c.type === 'text' ? c.text : '').join('') });
  } catch (err) {
    console.error('[/api/claude]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/stats/batch ───────────────────────────────────────────────────────
app.post('/api/stats/batch', async (req, res) => {
  const { players } = req.body;
  if (!players?.length) return res.status(400).json({ error: 'players array required' });

  const results = {};

  // Step 1: serve from cache & try BDL/web-search for each player
  const needsAI = [];
  await Promise.all(players.map(async ({ player, season }) => {
    const key = `${player}::${season}`;
    if (statsCache.has(key)) {
      results[key] = statsCache.get(key);
      return;
    }
    const stats = await fetchOnePlayerStats(player, season);
    if (stats) {
      results[key] = stats;
    } else {
      needsAI.push({ player, season, key });
    }
  }));

  // Step 2: batch remaining players into ONE AI call (historical seasons)
  if (needsAI.length > 0) {
    const playerList = needsAI
      .map(({ player, season }) => `- ${player} (${season}-${String(season + 1).slice(2)} season)`)
      .join('\n');
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Return per-game NBA stats for these players from Basketball Reference. Return ONLY a JSON object where each key is "PlayerName::season_year" (e.g. "Michael Jordan::1995").

Players:
${playerList}

Stats object keys: ppg, rpg, apg, spg, bpg, fg_pct, three_pct, ft_pct, ts_pct, per, ws, ortg, drtg, mpg, gp, confidence ("high"|"medium"|"low").
All values numbers or null. No markdown.`,
        }],
      });
      const text = msg.content.map(c => c.type === 'text' ? c.text : '').join('');
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      for (const { player, season, key } of needsAI) {
        const stats = parsed[key] || parsed[`${player}::${season}`] || null;
        if (stats) {
          stats.source = 'AI (Basketball Reference data)';
          stats.bbref_season = `${season}-${String(season + 1).slice(2)}`;
          statsCache.set(key, stats);
          results[key] = stats;
        }
      }
    } catch (err) {
      console.error('[AI batch]', err.message);
    }
  }

  res.json(results);
});

// ── Serve built frontend ───────────────────────────────────────────────────
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Build not found. Run npm run build first.'));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🏀 Lineup Lab on port ${PORT}`);
  console.log(`   Anthropic: ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗ MISSING'}`);
  console.log(`   BDL key:   ${process.env.BDL_API_KEY ? '✓' : 'none (free tier)'}\n`);
});
