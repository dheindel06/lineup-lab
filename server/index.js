const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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

// ── /api/claude ────────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  const { prompt, maxTokens = 600 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ text: msg.content.map(c => c.type === 'text' ? c.text : '').join('') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /api/stats ─────────────────────────────────────────────────────────────
app.post('/api/stats', async (req, res) => {
  const { player, season } = req.body;
  if (!player || season == null) return res.status(400).json({ error: 'player and season required' });
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search Basketball Reference for ${player}'s per-game stats in the ${season}-${season + 1} NBA season. Return ONLY a JSON object, no markdown. Keys: ppg,rpg,apg,spg,bpg,fg_pct,three_pct,ft_pct,ts_pct,per,ws,ortg,drtg,mpg,gp,source,bbref_season,confidence. source="Basketball Reference (web search)" if found, else "AI estimate". confidence="high"|"medium"|"low".`
      }],
    });
    const text = msg.content.map(c => c.type === 'text' ? c.text : '').join('');
    let stats;
    try {
      stats = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      const fallback = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{ role: 'user', content: `Return ONLY JSON with per-game stats for ${player} in ${season}-${season+1} NBA season. Keys: ppg,rpg,apg,spg,bpg,fg_pct,three_pct,ft_pct,ts_pct,per,ws,ortg,drtg,mpg,gp,source,bbref_season,confidence. source="AI estimate",confidence="low". No markdown.` }],
      });
      stats = JSON.parse(fallback.content.map(c => c.type === 'text' ? c.text : '').join('').replace(/```json|```/g, '').trim());
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  console.log(`\n🏀 Lineup Lab on port ${PORT} — key ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗ MISSING'}\n`);
});
