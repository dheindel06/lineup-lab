import { useState, useCallback, useRef } from "react";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const DEPTH_LABELS = ["Starter", "2nd", "3rd"];

const POS_COLORS = {
  PG: { bg: "#0d2340", accent: "#4f9eff", text: "#a8d4ff" },
  SG: { bg: "#2a0f0f", accent: "#ff6b4f", text: "#ffb8a8" },
  SF: { bg: "#0d2415", accent: "#4fc97e", text: "#a8ffcc" },
  PF: { bg: "#2a1f0a", accent: "#f0b429", text: "#ffe0a8" },
  C:  { bg: "#1e0d2a", accent: "#b57bee", text: "#ddb8ff" },
};

const OPPONENT_TEAMS = [
  "2016 Golden State Warriors (73-9 season)",
  "1996 Chicago Bulls (72-10 season)",
  "1986 Boston Celtics",
  "1987 Los Angeles Lakers (Showtime)",
  "2014 San Antonio Spurs",
  "2004 Detroit Pistons",
  "2016 Cleveland Cavaliers",
  "2017 Golden State Warriors",
  "2013 Miami Heat",
  "2023 Denver Nuggets",
  "2024 Boston Celtics",
  "2024 Oklahoma City Thunder",
  "Average NBA Contender",
  "Average NBA Team",
];

const QUICK_PICKS = [
  "1996 Chicago Bulls", "2016 Golden State Warriors", "1987 Los Angeles Lakers",
  "1986 Boston Celtics", "2013 Miami Heat", "2014 San Antonio Spurs",
  "2000 Los Angeles Lakers", "2004 Detroit Pistons", "2016 Cleveland Cavaliers",
  "2017 Golden State Warriors", "2003 San Antonio Spurs", "1992 Chicago Bulls",
  "2012 Oklahoma City Thunder", "2011 Dallas Mavericks", "2023 Denver Nuggets",
  "2024 Boston Celtics", "1993 Phoenix Suns", "2019 Toronto Raptors",
  "2001 Philadelphia 76ers", "1994 New York Knicks", "2007 Phoenix Suns",
  "1999 San Antonio Spurs", "2010 Los Angeles Lakers", "2015 Golden State Warriors",
  "1997 Utah Jazz", "2008 Boston Celtics", "2022 Golden State Warriors",
  "2024 Oklahoma City Thunder", "1989 Detroit Pistons", "1995 Orlando Magic",
];

const C = {
  bg: "#08090f", surface: "#0e1018", card: "#131520", cardHover: "#181c2a",
  border: "#1c2035", borderMid: "#283060", accent: "#e8500a",
  text: "#dde2f0", muted: "#55658a", dim: "#2a3055",
  success: "#30c97e", warn: "#f0b429", danger: "#e24b4a",
  swap: "#22c55e", swapBg: "#0a1f0f",
  bbref: "#1a6b3a", bbrefText: "#5dba8a",
  estimate: "#3a2800", estimateText: "#c4860a",
};

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1c2035; border-radius: 3px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  input { outline: none; } select { outline: none; }
  .slot:hover { border-color: #283060 !important; }
  .slot-swapped:hover { border-color: #22c55e88 !important; }
  .ri:hover { background: #181c2a !important; }
  .yr:hover { opacity: 0.8; }
  .analyze:hover:not(:disabled) { background: #ff6520 !important; }
  .analyze:active:not(:disabled) { transform: scale(0.98); }
  .tab:hover { color: #dde2f0 !important; }
  .rmv { opacity:0; transition: opacity 0.15s; }
  .chip:hover .rmv { opacity:1; }
  .qp:hover { background: #181c2a !important; border-color: #283060 !important; }
  .clear-btn:hover { color: #f09595 !important; border-color: #5a1515 !important; }
  .revert-btn:hover { color: #dde2f0 !important; border-color: #283060 !important; }
  .search-result:hover { background: #181c2a !important; }
`;

// ── API helpers — all routed through local proxy ───────────────────────────
// Haiku for cheap utility calls
async function callHaiku(prompt, maxTokens = 400) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, maxTokens, model: 'haiku' }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error);
  return d.text || '';
}

// Sonnet for deep analysis only
async function callClaude(prompt, maxTokens = 600) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, maxTokens, model: 'sonnet' }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error);
  return d.text || '';
}

// Fetch stats for multiple players in ONE API call
async function fetchStatsBatch(players) {
  const res = await fetch('/api/stats/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ players }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error);
  return d; // { "Player::season": statsObj, ... }
}

function parseJSON(text) {
  const cleaned = text
    .replace(/```json[\s\S]*?```/g, m => m.replace(/```json\n?/, '').replace(/\n?```/, ''))
    .replace(/```/g, '')
    .trim();
  return JSON.parse(cleaned);
}

// ── Spinner ────────────────────────────────────────────────────────────────
function Spinner({ size = 12, color }) {
  return (
    <div style={{
      width: size, height: size,
      border: `2px solid ${C.dim}`, borderTopColor: color || C.accent,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0,
    }} />
  );
}

// ── SourceBadge ────────────────────────────────────────────────────────────
function SourceBadge({ stats }) {
  if (!stats) return null;
  const src = stats.source || '';
  const isBDL    = src.includes('balldontlie');
  const isBBRef  = src.includes('Basketball Reference') && src.includes('web search');
  const isAI     = src.includes('AI');
  const label    = isBDL ? '✓ Live (BDL)' : isBBRef ? '✓ BBRef live' : '~ AI / BBRef';
  const bg       = isBDL ? '#0a2a1a' : isBBRef ? C.bbref : C.estimate;
  const color    = isBDL ? '#4ade80' : isBBRef ? C.bbrefText : C.estimateText;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span style={{
        fontSize: 8, padding: '1px 6px', borderRadius: 3,
        background: bg, color,
        fontFamily: "'Barlow',sans-serif", fontWeight: 700, letterSpacing: '0.3px',
      }}>{label}</span>
      {stats.confidence && (
        <span style={{
          fontSize: 8, fontFamily: "'Barlow',sans-serif",
          color: stats.confidence === 'high' ? C.success : stats.confidence === 'medium' ? C.warn : C.muted,
        }}>
          {stats.confidence} conf.
        </span>
      )}
    </div>
  );
}

// ── DisclaimerBanner ───────────────────────────────────────────────────────
function DisclaimerBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div style={{
      background: '#12100a', border: `1px solid ${C.warn}33`,
      borderRadius: 8, padding: '10px 14px', marginBottom: 14,
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: C.warn, fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: '0.5px', marginBottom: 3 }}>
          AI-POWERED SIMULATION
        </div>
        <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Barlow',sans-serif", lineHeight: 1.5 }}>
          Current season stats sourced live from balldontlie.io. Recent seasons use Basketball Reference web search. Historical seasons use AI knowledge.
          Numbers marked <span style={{ color: C.bbrefText }}>✓ BBRef</span> have higher confidence;{' '}
          <span style={{ color: C.estimateText }}>~ AI Estimate</span> means less certainty.
          All projections are for entertainment — this is a what-if simulator, not an official stats product.
        </div>
      </div>
      <button onClick={() => setDismissed(true)}
        style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, flexShrink: 0, padding: '0 2px' }}>✕</button>
    </div>
  );
}

// ── TeamSearch ─────────────────────────────────────────────────────────────
function TeamSearch({ onLoadTeam, loadingTeam, currentPreset }) {
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [sugLoading, setSugLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  const fetchSuggestions = async (val) => {
    if (val.trim().length < 2) { setSuggestions([]); return; }
    setSugLoading(true);
    try {
      const txt = await callHaiku(
        `The user typed "${val}" into an NBA team search box. Return ONLY a JSON array of up to 6 matching NBA team-season strings. Format: "YYYY Team Name" e.g. ["1996 Chicago Bulls"]. Show most famous matching seasons. No markdown.`,
        200
      );
      setSuggestions(parseJSON(txt));
    } catch { setSuggestions([]); }
    setSugLoading(false);
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setQ(val);
    setOpen(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchSuggestions(val), 380);
  };

  const handlePick = (teamStr) => { setQ(''); setSuggestions([]); setOpen(false); onLoadTeam(teamStr); };
  const handleSubmit = (e) => {
    e.preventDefault();
    if (q.trim().length > 1) { setOpen(false); onLoadTeam(q.trim()); setQ(''); }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} style={{ position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <input value={q} onChange={handleChange}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
            placeholder="e.g. Showtime Lakers, 2001 Sixers…"
            style={{
              width: '100%', background: '#090b13', border: `1px solid ${C.borderMid}`,
              borderRadius: 8, color: C.text, padding: '10px 44px 10px 14px',
              fontSize: 13, fontFamily: "'Barlow', sans-serif",
            }}
          />
          <button type="submit" style={{
            position: 'absolute', right: 0, top: 0, bottom: 0, width: 40,
            background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>→</button>
          {sugLoading && (
            <div style={{
              position: 'absolute', right: 44, top: '50%', transform: 'translateY(-50%)',
              width: 13, height: 13, border: `2px solid ${C.dim}`, borderTopColor: C.accent,
              borderRadius: '50%', animation: 'spin 0.7s linear infinite',
            }} />
          )}
        </div>
        {open && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 300,
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
            overflow: 'hidden', boxShadow: '0 16px 48px #000000bb',
          }}>
            {suggestions.map(s => (
              <div key={s} className="search-result" onMouseDown={() => handlePick(s)}
                style={{
                  padding: '9px 14px', fontSize: 13, fontFamily: "'Barlow',sans-serif",
                  borderBottom: `1px solid ${C.border}`, color: C.text,
                  cursor: 'pointer', background: C.card, display: 'flex', alignItems: 'center', gap: 10,
                }}>
                <span>🏀</span>{s}
              </div>
            ))}
          </div>
        )}
      </form>

      {loadingTeam && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Spinner size={14} />
          <div>
            <div style={{ fontSize: 12, color: C.text, fontFamily: "'Barlow',sans-serif", fontWeight: 600 }}>Loading {loadingTeam}…</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Fetching roster · stats load via web search after</div>
          </div>
        </div>
      )}

      {currentPreset && !loadingTeam && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: '#130f02', borderRadius: 8, border: `1px solid ${C.warn}33`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>◆</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.warn, fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif" }}>{currentPreset}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>Loaded — swap players freely</div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 9, color: C.dim, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, letterSpacing: '1px', marginBottom: 8 }}>TRY THESE</div>
        {['1994 New York Knicks', '2001 Philadelphia 76ers', '1995 Orlando Magic', '1989 Detroit Pistons', '1998 Utah Jazz', '2007 Phoenix Suns'].map(eg => (
          <div key={eg} className="qp" onClick={() => onLoadTeam(eg)}
            style={{ padding: '5px 8px', fontSize: 10, fontFamily: "'Barlow',sans-serif", borderRadius: 4, cursor: 'pointer', color: C.muted, border: '1px solid transparent', transition: 'all 0.1s', marginBottom: 2 }}>
            {eg}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── QuickPicks ─────────────────────────────────────────────────────────────
function QuickPicks({ onLoadTeam, currentPreset }) {
  const [filter, setFilter] = useState('');
  const filtered = QUICK_PICKS.filter(t => t.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…"
        style={{ width: '100%', background: '#090b12', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '6px 10px', fontSize: 11, fontFamily: "'Barlow', sans-serif", marginBottom: 6 }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filtered.map(t => {
          const isActive = currentPreset === t;
          return (
            <div key={t} className="qp" onClick={() => onLoadTeam(t)}
              style={{ padding: '7px 10px', fontSize: 11, fontFamily: "'Barlow',sans-serif", borderRadius: 5, cursor: 'pointer', transition: 'all 0.1s', background: isActive ? '#1a1e30' : 'transparent', color: isActive ? C.text : C.muted, border: `1px solid ${isActive ? C.borderMid : 'transparent'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{t}</span>
              {isActive && <span style={{ fontSize: 9, color: C.accent, fontWeight: 800, fontFamily: "'Barlow Condensed',sans-serif" }}>LOADED</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PlayerSearch ───────────────────────────────────────────────────────────
function PlayerSearch({ onSelect }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  const search = async (val) => {
    if (val.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const txt = await callHaiku(
        `List up to 8 real NBA players whose names match or contain "${val}". Return ONLY a JSON array of canonical full names. No markdown. If none, return [].`,
        180
      );
      setResults(parseJSON(txt));
    } catch { setResults([]); }
    setLoading(false);
  };

  const onChange = (e) => {
    const val = e.target.value; setQ(val); setOpen(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(val), 380);
  };
  const pick = (name) => { setQ(''); setResults([]); setOpen(false); onSelect(name); };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input value={q} onChange={onChange}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          placeholder="Search any NBA player…"
          style={{ width: '100%', background: '#090b12', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '7px 30px 7px 10px', fontSize: 12, fontFamily: "'Barlow', sans-serif" }}
        />
        {loading && <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 11, height: 11, border: `2px solid ${C.dim}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, zIndex: 200, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 40px #000000aa' }}>
          {results.map(name => (
            <div key={name} className="ri" onMouseDown={() => pick(name)}
              style={{ padding: '8px 12px', fontSize: 12, fontFamily: "'Barlow',sans-serif", borderBottom: `1px solid ${C.border}`, color: C.text, cursor: 'pointer', background: C.card }}>
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SlotCard ───────────────────────────────────────────────────────────────
function SlotCard({ pos, di, slot, isSwapped, originalSlot, onAssign, onRemove, onSeason, onRevert, statsCache, loadingKeys, minutesOverride, onSetMinutes, adjustedStats }) {
  const [busy, setBusy] = useState(false);
  const pc = POS_COLORS[pos];
  const isStarter = di === 0;

  const handleSelect = async (name) => {
    setBusy(true);
    try {
      const txt = await callHaiku(
        `Return ONLY a JSON object for NBA player "${name}". Keys: "found" (bool), "canonical" (string), "positions" (array from PG/SG/SF/PF/C), "seasons" (array of ints — every NBA season start-year on roster). No markdown.`,
        300
      );
      const info = parseJSON(txt);
      if (info.found && info.seasons?.length > 0) {
        const sorted = info.seasons.sort((a, b) => a - b);
        onAssign(pos, di, { canonical: info.canonical, positions: info.positions, seasons: sorted }, sorted[sorted.length - 1]);
      }
    } catch {}
    setBusy(false);
  };

  const statKey = slot?.player ? `${slot.player.canonical}-${slot.season}` : null;
  const stats = statKey ? statsCache[statKey] : null;
  const statsLoading = statKey ? loadingKeys.has(statKey) : false;
  const isBBRef = stats?.source?.toLowerCase().includes('basketball reference');

  return (
    <div className={`slot${isSwapped ? ' slot-swapped' : ''}`} style={{
      background: isSwapped ? C.swapBg : slot ? C.card : '#0b0d16',
      border: `1px solid ${isSwapped ? `${C.swap}66` : slot ? C.border : '#10131e'}`,
      borderRadius: 8, padding: '9px 10px',
      minHeight: isStarter ? 104 : 86,
      transition: 'border-color 0.15s', position: 'relative',
    }}>
      {isSwapped && (
        <div style={{ position: 'absolute', top: 5, right: 7, fontSize: 8, fontWeight: 800, letterSpacing: '1px', color: C.swap, fontFamily: "'Barlow Condensed',sans-serif", display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: C.swap, display: 'inline-block' }} />
          SWAPPED
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
        <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: '1.5px', fontFamily: "'Barlow Condensed',sans-serif", background: pc.bg, color: pc.accent, padding: '2px 6px', borderRadius: 3 }}>{pos}</span>
        <span style={{ fontSize: 9, color: C.muted, fontFamily: "'Barlow',sans-serif" }}>{DEPTH_LABELS[di]}</span>
        {stats && (
          <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 3, marginLeft: 2, background: isBBRef ? C.bbref : C.estimate, color: isBBRef ? C.bbrefText : C.estimateText, fontFamily: "'Barlow',sans-serif", fontWeight: 700 }}>
            {_src.includes('balldontlie') ? '✓ Live' : isBBRef ? '✓ BBRef' : '~Est'}
          </span>
        )}
        {slot && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
            {isSwapped && originalSlot && (
              <button className="revert-btn" onClick={() => onRevert(pos, di)}
                style={{ background: 'none', border: `1px solid ${C.dim}`, color: C.muted, cursor: 'pointer', fontSize: 8, padding: '1px 5px', borderRadius: 3, fontFamily: "'Barlow',sans-serif", fontWeight: 700, lineHeight: 1.5, transition: 'all 0.15s' }}>↩</button>
            )}
            <button className="rmv" onClick={() => onRemove(pos, di)}
              style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1 }}>✕</button>
          </div>
        )}
      </div>

      {busy ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0' }}>
          <Spinner size={11} color={pc.accent} />
          <span style={{ fontSize: 10, color: C.muted, fontFamily: "'Barlow',sans-serif" }}>Looking up…</span>
        </div>
      ) : slot ? (
        <div className="chip">
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: isStarter ? 13 : 11, color: isSwapped ? C.swap : C.text, lineHeight: 1.2, marginBottom: 2 }}>
            {slot.player.canonical}
          </div>
          {isSwapped && originalSlot && (
            <div style={{ fontSize: 9, color: C.muted, fontFamily: "'Barlow',sans-serif", marginBottom: 2, opacity: 0.6 }}>↩ {originalSlot.player.canonical}</div>
          )}
          {statsLoading ? (
            <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, animation: 'pulse 1.2s infinite' }}>loading stats…</div>
          ) : adjustedStats && (
            <>
              <div style={{ fontSize: 9, color: isSwapped ? `${C.swap}cc` : pc.text, fontFamily: "'Barlow',sans-serif", marginBottom: 3 }}>
                {adjustedStats.ppg?.toFixed(1)} pts · {adjustedStats.rpg?.toFixed(1)} reb · {adjustedStats.apg?.toFixed(1)} ast
                {adjustedStats._adjusted && <span style={{ color: C.warn, marginLeft: 4 }}>({minutesOverride} mpg)</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span style={{ fontSize: 8, color: C.dim, fontFamily: "'Barlow',sans-serif", whiteSpace: 'nowrap' }}>
                  MPG
                </span>
                <input type="range" min={10} max={48} step={1}
                  value={minutesOverride || Math.round(adjustedStats.mpg || 28)}
                  onChange={e => onSetMinutes(pos, di, Number(e.target.value))}
                  style={{ flex: 1, height: 3, accentColor: isSwapped ? C.swap : pc.accent, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 8, color: minutesOverride ? C.warn : C.muted, fontFamily: "'Barlow',sans-serif", minWidth: 14, textAlign: 'right' }}>
                  {minutesOverride || Math.round(adjustedStats.mpg || 28)}
                </span>
              </div>
            </>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {slot.player.seasons.map(yr => (
              <span key={yr} className="yr" onClick={() => onSeason(pos, di, yr)}
                style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, fontFamily: "'Barlow',sans-serif", fontWeight: 600, cursor: 'pointer', background: slot.season === yr ? (isSwapped ? C.swap : pc.accent) : C.surface, color: slot.season === yr ? '#fff' : C.muted, border: `1px solid ${slot.season === yr ? (isSwapped ? C.swap : pc.accent) : C.border}`, transition: 'all 0.1s' }}>
                {yr}–{String(yr + 1).slice(2)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <PlayerSearch onSelect={handleSelect} />
      )}
    </div>
  );
}

// ── StatBadge ──────────────────────────────────────────────────────────────
function StatBadge({ label, value, pct }) {
  const display = value == null ? '—' : pct ? `${(value * 100).toFixed(1)}%` : value.toFixed(1);
  return (
    <div style={{ textAlign: 'center', padding: '9px 4px', background: C.surface, borderRadius: 6, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif", color: C.accent, lineHeight: 1 }}>{display}</div>
      <div style={{ fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.8px', marginTop: 3, fontFamily: "'Barlow',sans-serif" }}>{label}</div>
    </div>
  );
}

// ── CompatibilityCard ──────────────────────────────────────────────────────
function ScoreBar({ label, score, note, color }) {
  const pct = Math.round((score / 10) * 100);
  const barColor = score >= 8 ? C.success : score >= 6 ? C.warn : score >= 4 ? '#f0a029' : C.danger;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.text, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: '0.5px' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: barColor, fontFamily: "'Barlow Condensed',sans-serif" }}>{score}/10</span>
      </div>
      <div style={{ height: 5, background: C.surface, borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Barlow',sans-serif", lineHeight: 1.4 }}>{note}</div>
    </div>
  );
}

function CompatibilityCard({ compat }) {
  if (!compat) return null;
  const overall = compat.overall || 0;
  const overallColor = overall >= 80 ? C.success : overall >= 65 ? C.warn : overall >= 50 ? '#f0a029' : C.danger;
  const grade = overall >= 90 ? 'A+' : overall >= 80 ? 'A' : overall >= 70 ? 'B+' : overall >= 60 ? 'B' : overall >= 50 ? 'C' : 'D';
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px', marginBottom: 16, animation: 'fadeIn 0.4s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 900, fontFamily: "'Barlow Condensed',sans-serif", color: overallColor, lineHeight: 1 }}>{overall}</div>
          <div style={{ fontSize: 9, color: C.muted, fontFamily: "'Barlow',sans-serif", textTransform: 'uppercase', letterSpacing: '1px' }}>Chemistry</div>
        </div>
        <div style={{ width: 1, height: 40, background: C.border }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: overallColor, fontFamily: "'Barlow Condensed',sans-serif", marginBottom: 2 }}>
            GRADE: {grade}
          </div>
          <div style={{ fontSize: 11, color: C.text, fontFamily: "'Barlow',sans-serif", lineHeight: 1.5 }}>{compat.headline}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
        <ScoreBar label="OFFENSIVE FIT" score={compat.offensive_fit?.score || 0} note={compat.offensive_fit?.note} />
        <ScoreBar label="DEFENSIVE FIT" score={compat.defensive_fit?.score || 0} note={compat.defensive_fit?.note} />
        <ScoreBar label="SPACING" score={compat.spacing?.score || 0} note={compat.spacing?.note} />
        <ScoreBar label="ERA / PACE FIT" score={compat.era_fit?.score || 0} note={compat.era_fit?.note} />
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const emptySlots = () => {
    const s = {};
    POSITIONS.forEach(p => { s[p] = [null, null, null]; });
    return s;
  };

  const [slots, setSlots] = useState(emptySlots);
  const [originalSlots, setOriginalSlots] = useState(emptySlots);
  const [currentPreset, setCurrentPreset] = useState(null);
  const [loadingTeam, setLoadingTeam] = useState(null);
  const [teamError, setTeamError] = useState(null);
  const [statsCache, setStatsCache] = useState({});
  const statsCacheRef = useRef({});  // mirror for callbacks — avoids stale closure
  const [loadingKeys, setLoadingKeys] = useState(new Set());
  const [opponent, setOpponent] = useState('');
  const [tab, setTab] = useState('depth');
  const [analysis, setAnalysis] = useState(null);
  const [compatibility, setCompatibility] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisErr, setAnalysisErr] = useState(null);
  const [showPresets, setShowPresets] = useState(true);
  const [sideTab, setSideTab] = useState('search');
  // minutesOverride[pos-di] = number (custom MPG) or undefined (use actual)
  const [minutesOverride, setMinutesOverride] = useState({});

  const setMinutes = useCallback((pos, di, mpg) => {
    setMinutesOverride(prev => ({ ...prev, [`${pos}-${di}`]: mpg }));
  }, []);

  // Scale counting stats by minutes ratio
  const getAdjustedStats = useCallback((stats, pos, di) => {
    if (!stats) return null;
    const override = minutesOverride[`${pos}-${di}`];
    if (!override || !stats.mpg || stats.mpg <= 0) return stats;
    const ratio = override / stats.mpg;
    return {
      ...stats,
      ppg:  stats.ppg  != null ? +(stats.ppg  * ratio).toFixed(1) : null,
      rpg:  stats.rpg  != null ? +(stats.rpg  * ratio).toFixed(1) : null,
      apg:  stats.apg  != null ? +(stats.apg  * ratio).toFixed(1) : null,
      spg:  stats.spg  != null ? +(stats.spg  * ratio).toFixed(1) : null,
      bpg:  stats.bpg  != null ? +(stats.bpg  * ratio).toFixed(1) : null,
      mpg:  override,
      _adjusted: true,
    };
  }, [minutesOverride]);

  // Load stats for one player (queues into a batch that fires after 300ms idle)
  const batchQueue = useRef([]);
  const batchTimer = useRef(null);

  const flushBatch = useCallback(async () => {
    const batch = [...batchQueue.current];
    batchQueue.current = [];
    if (!batch.length) return;

    // Filter out already-cached (use ref to avoid stale closure)
    const toFetch = batch.filter(({ key }) => !statsCacheRef.current[key]);
    if (!toFetch.length) return;

    toFetch.forEach(({ key }) => setLoadingKeys(prev => new Set([...prev, key])));
    try {
      const results = await fetchStatsBatch(toFetch.map(({ canonical, season }) => ({ player: canonical, season })));
      const updates = {};
      for (const { canonical, season, key } of toFetch) {
        const batchKey = `${canonical}::${season}`;
        const stats = results[batchKey];
        if (stats) updates[key] = stats;
        setLoadingKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
      }
      if (Object.keys(updates).length) {
        statsCacheRef.current = { ...statsCacheRef.current, ...updates };
        setStatsCache(prev => ({ ...prev, ...updates }));
      }
    } catch (e) {
      console.warn('Batch stats failed:', e.message);
      toFetch.forEach(({ key }) => setLoadingKeys(prev => { const n = new Set(prev); n.delete(key); return n; }));
    }
  }, []);

  const loadStats = useCallback((canonical, season) => {
    const key = `${canonical}-${season}`;
    if (statsCacheRef.current[key]) return;
    batchQueue.current.push({ canonical, season, key });
    clearTimeout(batchTimer.current);
    batchTimer.current = setTimeout(() => flushBatch(), 300);
  }, [flushBatch]);

  const handleLoadTeam = useCallback(async (query) => {
    setLoadingTeam(query);
    setTeamError(null);
    try {
      const txt = await callClaude(
        `The user wants to load NBA team: "${query}"
Return ONLY a JSON object (no markdown):
{
  "label": "YEAR Team Name",
  "season_year": <int start year, e.g. 1995 for 1995-96>,
  "found": true,
  "roster": {
    "PG": [{"canonical":"Name","seasons":[...],"positions":["PG"]}, <2nd or null>, <3rd or null>],
    "SG": [...], "SF": [...], "PF": [...], "C": [...]
  }
}
Use the actual historical roster. Every player needs all their NBA season start-years.
If can't be identified: {"found":false,"label":"${query}"}`,
        1000
      );
      const data = parseJSON(txt);
      if (!data.found) {
        setTeamError(`Couldn't find "${query}". Try adding a year, e.g. "1994 New York Knicks".`);
        setLoadingTeam(null);
        return;
      }
      const newSlots = emptySlots();
      const yr = data.season_year;
      for (const pos of POSITIONS) {
        const players = data.roster?.[pos] || [];
        for (let di = 0; di < 3; di++) {
          const p = players[di];
          if (p?.canonical) {
            const sorted = (p.seasons || [yr]).sort((a, b) => a - b);
            const defaultSeason = sorted.includes(yr) ? yr : sorted.reduce((c, s) => Math.abs(s - yr) < Math.abs(c - yr) ? s : c, sorted[0]);
            newSlots[pos][di] = { player: { canonical: p.canonical, positions: p.positions || [pos], seasons: sorted }, season: defaultSeason };
            // Stats lazy-load
          }
        }
      }
      setSlots(newSlots);
      setOriginalSlots(JSON.parse(JSON.stringify(newSlots)));
      setCurrentPreset(data.label);
      setAnalysis(null);
    } catch (e) {
      console.error(e);
      setTeamError('Failed to load team. Please try again.');
    }
    setLoadingTeam(null);
  }, [loadStats]);

  const handleAssign = useCallback((pos, di, player, season) => {
    setSlots(prev => { const col = [...prev[pos]]; col[di] = { player, season }; return { ...prev, [pos]: col }; });
    // Stats lazy-load on Stats tab or Analyze
  }, []);

  const handleRemove = useCallback((pos, di) => {
    setSlots(prev => { const col = [...prev[pos]]; col[di] = null; return { ...prev, [pos]: col }; });
  }, []);

  const handleSeason = useCallback((pos, di, season) => {
    setSlots(prev => {
      const col = [...prev[pos]];
      if (col[di]) { col[di] = { ...col[di], season }; }
      return { ...prev, [pos]: col };
    });
    // Stats lazy-load
  }, []);

  const handleRevert = useCallback((pos, di) => {
    const orig = originalSlots[pos]?.[di];
    if (!orig) return;
    setSlots(prev => { const col = [...prev[pos]]; col[di] = JSON.parse(JSON.stringify(orig)); return { ...prev, [pos]: col }; });
  }, [originalSlots]);

  const handleRevertAll = useCallback(() => { setSlots(JSON.parse(JSON.stringify(originalSlots))); setAnalysis(null); }, [originalSlots]);
  const handleClearAll = useCallback(() => { setSlots(emptySlots()); setOriginalSlots(emptySlots()); setCurrentPreset(null); setTeamError(null); setAnalysis(null); }, []);

  const isSlotSwapped = (pos, di) => {
    const orig = originalSlots[pos]?.[di];
    const curr = slots[pos]?.[di];
    if (!orig || !curr) return false;
    return orig.player.canonical !== curr.player.canonical;
  };

  const loadAllCurrentStats = useCallback(() => {
    POSITIONS.forEach(pos => {
      [0, 1, 2].forEach(di => {
        const slot = slots[pos][di];
        if (slot) loadStats(slot.player.canonical, slot.season);
      });
    });
  }, [slots, loadStats]);

  const totalPlayers = POSITIONS.reduce((a, p) => a + slots[p].filter(Boolean).length, 0);
  const starterCount = POSITIONS.filter(p => slots[p][0]).length;
  const canAnalyze = starterCount >= 3 && !analyzing;
  const swapCount = POSITIONS.reduce((a, p) => a + [0, 1, 2].filter(di => isSlotSwapped(p, di)).length, 0);

  const runAnalysis = async () => {
    setAnalyzing(true); setAnalysisErr(null); setAnalysis(null); setCompatibility(null); setTab('analysis');
    loadAllCurrentStats();
    await new Promise(r => setTimeout(r, 900));
    try {
      const starters = POSITIONS.map(pos => {
        const s = slots[pos][0]; if (!s) return null;
        const key = `${s.player.canonical}-${s.season}`;
        const st = getAdjustedStats(statsCache[key], pos, 0);
        return { pos, name: s.player.canonical, season: s.season, stats: st };
      }).filter(Boolean);

      const starterNames = starters.map(s => `${s.pos}: ${s.name} (${s.season}-${Number(s.season)+1})`).join(', ');

      const allSlots = POSITIONS.flatMap(pos =>
        [0,1,2].map(di => {
          const s = slots[pos][di]; if (!s) return null;
          const key = `${s.player.canonical}-${s.season}`;
          const st = getAdjustedStats(statsCache[key], pos, di);
          const swapped = isSlotSwapped(pos, di);
          const origName = originalSlots[pos]?.[di]?.player?.canonical;
          const mpgNote = minutesOverride[`${pos}-${di}`] ? ` @ ${minutesOverride[`${pos}-${di}`]} MPG` : '';
          const perNote = st?.per ? ` PER:${st.per.toFixed(1)}` : '';
          return `  ${DEPTH_LABELS[di]} ${pos}: ${s.player.canonical} (${s.season}-${Number(s.season)+1})${swapped ? ` [SWAPPED from ${origName}]` : ''}${mpgNote}${st ? ` — ${st.ppg?.toFixed(1)} PPG / ${st.rpg?.toFixed(1)} RPG / ${st.apg?.toFixed(1)} APG${perNote}` : ''}`;
        }).filter(Boolean)
      ).join('\n');

      const presetNote = currentPreset ? `Base team: ${currentPreset}.${swapCount > 0 ? ` ${swapCount} swapped.` : ''}` : 'Custom roster.';

      // Compatibility scores — Haiku (cheap)
      const compatTxt = await callHaiku(
        `NBA analytics expert. Score this starting lineup's chemistry. Return ONLY JSON, no markdown.\nStarters: ${starterNames}\n\nReturn: {"overall":<0-100>,"offensive_fit":{"score":<0-10>,"label":"<2-4 words>","note":"<one sharp sentence on usage overlap/ball dominance/role conflicts>"},"defensive_fit":{"score":<0-10>,"label":"<2-4 words>","note":"<one sentence on paint protection, perimeter D, defensive PER>"},"spacing":{"score":<0-10>,"label":"<2-4 words>","note":"<one sentence on 3PT shooting, floor spacing, drive lanes>"},"era_fit":{"score":<0-10>,"label":"<2-4 words>","note":"<one sentence on pace compatibility, era mismatches>"},"headline":"<one punchy sentence summarizing chemistry>"}\nBe brutally honest. Two post-dominant bigs or two ball-dominant guards score low.`,
        500
      );
      try { setCompatibility(parseJSON(compatTxt)); } catch {}

      // Deep analysis — Sonnet (quality matters)
      const txt = await callClaude(
        `Elite NBA analyst. Deep what-if analysis for this roster playing ${opponent || 'a full NBA season'}.\n${presetNote}\n\nFULL ROSTER:\n${allSlots}\n\nFocus on:\n- How each starter's offensive AND defensive PER shapes their role together\n- Specific compatibility pairs: who elevates whom, who conflicts (e.g. Shaq + Magic both need post touches = conflict; Shaq + Curry = spacing paradise)\n- Usage rate conflicts between ball-dominant stars\n- How defensive assignments and rotations actually work\n\n1. **Starting Five Chemistry** — pair-by-pair compatibility, usage conflicts, who defers\n2. **Offensive System** — best scheme for this group, who runs it, what breaks down\n3. **Defensive Identity** — paint protection, perimeter coverage, weak links\n4. **Projected Stats Per Game** — pts, reb, ast, stl, blk, FG%, 3P%, pace\n5. **Bench & Rotations** — second unit, key subs\n6. **Key Strengths** (top 3, specific to this lineup)\n7. **Key Weaknesses** (top 3, specific)\n${swapCount > 0 ? '8. **Swap Impact** — how do changes alter chemistry?\n9.' : '8.'} **Matchup** ${opponent ? `vs ${opponent}` : 'vs average contender'}\n${swapCount > 0 ? '10.' : '9.'} **Projection** — wins/82, seed, title odds, letter grade\n\nBe direct. Cite real player tendencies and historical context.`,
        1600
      );
      setAnalysis(txt);
    } catch (e) { console.error(e); setAnalysisErr('Analysis failed. Please try again.'); }
    setAnalyzing(false);
  };;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'Barlow', sans-serif" }}>
      <style>{globalCss}</style>

      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 13, position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ width: 34, height: 34, background: C.accent, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🏀</div>
        <div>
          <h1 style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 900, letterSpacing: '0.5px', lineHeight: 1 }}>LINEUP LAB</h1>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>Any team · Any era · Swap & compare · AI simulation</div>
        </div>
        {swapCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
            <div style={{ background: C.swapBg, border: `1px solid ${C.swap}44`, borderRadius: 6, padding: '3px 9px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.swap, display: 'inline-block' }} />
              <span style={{ fontSize: 10, color: C.swap, fontWeight: 800, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: '0.5px' }}>{swapCount} SWAP{swapCount !== 1 ? 'S' : ''}</span>
            </div>
            <button className="revert-btn" onClick={handleRevertAll}
              style={{ background: 'none', border: `1px solid ${C.dim}`, color: C.muted, borderRadius: 6, padding: '3px 9px', fontSize: 10, cursor: 'pointer', fontFamily: "'Barlow',sans-serif", fontWeight: 600, transition: 'all 0.15s' }}>
              ↩ Revert All
            </button>
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {currentPreset && <div style={{ fontSize: 10, color: C.warn, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>◆ {currentPreset}</div>}
          <span style={{ fontSize: 10, color: C.muted }}><span style={{ color: C.text, fontWeight: 700 }}>{totalPlayers}</span>/15</span>
          {totalPlayers > 0 && (
            <button className="clear-btn" onClick={handleClearAll}
              style={{ background: 'none', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '5px 10px', fontSize: 10, cursor: 'pointer', fontFamily: "'Barlow',sans-serif", fontWeight: 600, transition: 'all 0.15s' }}>
              Clear
            </button>
          )}
          <button className="analyze" onClick={runAnalysis} disabled={!canAnalyze}
            style={{ background: canAnalyze ? C.accent : C.dim, color: canAnalyze ? '#fff' : C.muted, border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 11, fontWeight: 800, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: '0.8px', cursor: canAnalyze ? 'pointer' : 'not-allowed', transition: 'background 0.15s' }}>
            {analyzing ? 'ANALYZING…' : '⚡ ANALYZE'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '0 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex' }}>
          {[['depth', 'DEPTH CHART'], ['stats', 'PLAYER STATS'], ['analysis', 'ANALYSIS']].map(([id, label]) => (
            <button key={id} className="tab" onClick={() => { setTab(id); if (id === 'stats') loadAllCurrentStats(); }}
              style={{ background: 'none', border: 'none', borderBottom: `2px solid ${tab === id ? C.accent : 'transparent'}`, color: tab === id ? C.text : C.muted, padding: '10px 14px', fontSize: 10, fontWeight: 800, letterSpacing: '1px', fontFamily: "'Barlow Condensed',sans-serif", cursor: 'pointer', transition: 'color 0.15s' }}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowPresets(v => !v)}
          style={{ background: 'none', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 5, padding: '4px 10px', fontSize: 9, cursor: 'pointer', fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, letterSpacing: '0.5px' }}>
          {showPresets ? '◀ HIDE' : 'TEAMS ▶'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {showPresets && (
          <div style={{ width: 230, flexShrink: 0, borderRight: `1px solid ${C.border}`, height: 'calc(100vh - 88px)', position: 'sticky', top: 88, display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
            <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, padding: '0 4px', flexShrink: 0 }}>
              {[['search', 'SEARCH'], ['quick', 'QUICK PICKS']].map(([id, label]) => (
                <button key={id} className="tab" onClick={() => setSideTab(id)}
                  style={{ background: 'none', border: 'none', flex: 1, borderBottom: `2px solid ${sideTab === id ? C.accent : 'transparent'}`, color: sideTab === id ? C.text : C.muted, padding: '9px 4px', fontSize: 9, fontWeight: 800, letterSpacing: '0.8px', fontFamily: "'Barlow Condensed',sans-serif", cursor: 'pointer' }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 16px' }}>
              {sideTab === 'search'
                ? <TeamSearch onLoadTeam={handleLoadTeam} loadingTeam={loadingTeam} currentPreset={currentPreset} />
                : <QuickPicks onLoadTeam={handleLoadTeam} currentPreset={currentPreset} />
              }
            </div>
          </div>
        )}

        <div style={{ flex: 1, padding: '16px', minWidth: 0, overflowX: 'auto' }}>
          {/* Opponent strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px', background: C.surface, borderRadius: 7, border: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: C.muted, fontFamily: "'Barlow',sans-serif", fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Analyze vs:</span>
            <select value={opponent} onChange={e => setOpponent(e.target.value)}
              style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: '4px 8px', fontSize: 11, fontFamily: "'Barlow',sans-serif", cursor: 'pointer', flex: 1, maxWidth: 300 }}>
              <option value="">Average NBA Opponent</option>
              {OPPONENT_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* DEPTH CHART */}
          {tab === 'depth' && (
            <div style={{ animation: 'fadeIn 0.25s ease' }}>
              <DisclaimerBanner />
              {totalPlayers === 0 && !loadingTeam && (
                <div style={{ textAlign: 'center', padding: '40px 20px', background: C.surface, borderRadius: 10, border: `1px dashed ${C.border}`, marginBottom: 14 }}>
                  <div style={{ fontSize: 30, marginBottom: 10 }}>🏀</div>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 6 }}>SEARCH ANY TEAM IN HISTORY</div>
                  <div style={{ fontSize: 11, color: C.muted, maxWidth: 340, margin: '0 auto' }}>
                    Try <span style={{ color: C.text }}>"1986 Celtics"</span>, <span style={{ color: C.text }}>"Showtime Lakers"</span>, or build from scratch.
                  </div>
                </div>
              )}
              {loadingTeam && (
                <div style={{ padding: '14px 16px', background: C.surface, borderRadius: 9, border: `1px solid ${C.border}`, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Spinner size={16} />
                  <div>
                    <div style={{ fontSize: 12, color: C.text, fontFamily: "'Barlow',sans-serif", fontWeight: 600 }}>Loading {loadingTeam}…</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>AI fetching roster · stats load via web search</div>
                  </div>
                </div>
              )}
              {teamError && (
                <div style={{ padding: '10px 14px', background: '#1a0808', border: `1px solid ${C.danger}44`, borderRadius: 7, fontSize: 11, color: '#f09595', fontFamily: "'Barlow',sans-serif", marginBottom: 12 }}>
                  {teamError}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 9 }}>
                {POSITIONS.map(pos => {
                  const pc = POS_COLORS[pos];
                  return (
                    <div key={pos}>
                      <div style={{ textAlign: 'center', paddingBottom: 6, borderBottom: `2px solid ${pc.accent}`, marginBottom: 7 }}>
                        <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: 13, color: pc.accent, letterSpacing: '1px' }}>{pos}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {[0, 1, 2].map(di => (
                          <SlotCard key={di} pos={pos} di={di}
                            slot={slots[pos][di]} isSwapped={isSlotSwapped(pos, di)}
                            originalSlot={originalSlots[pos]?.[di]}
                            onAssign={handleAssign} onRemove={handleRemove}
                            onSeason={handleSeason} onRevert={handleRevert}
                            statsCache={statsCache} loadingKeys={loadingKeys}
                            minutesOverride={minutesOverride[`${pos}-${di}`]}
                            onSetMinutes={setMinutes}
                            adjustedStats={getAdjustedStats(statsCache[slots[pos][di] ? `${slots[pos][di].player.canonical}-${slots[pos][di].season}` : ''], pos, di)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {[
                  { color: C.accent, label: 'Starter', round: false },
                  { color: C.muted, label: '2nd string', round: false },
                  { color: C.dim, label: '3rd string', round: false },
                  ...(currentPreset ? [{ color: C.swap, label: 'Swapped', round: true }] : []),
                  { color: C.bbrefText, label: '✓ BBRef sourced', round: false },
                  { color: C.estimateText, label: '~ AI estimated', round: false },
                ].map(({ color, label, round }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: C.muted, fontFamily: "'Barlow',sans-serif" }}>
                    <div style={{ width: 6, height: 6, borderRadius: round ? '50%' : 2, background: color }} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STATS */}
          {tab === 'stats' && (
            <div style={{ animation: 'fadeIn 0.25s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <h2 style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 800 }}>Player Stats by Season</h2>
                <span style={{ fontSize: 10, color: C.muted }}>· live BDL → BBRef web search → AI fallback · adjust minutes to scale stats</span>
              </div>
              {totalPlayers === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: C.muted }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 6 }}>NO PLAYERS YET</div>
                  <div style={{ fontSize: 12 }}>Load a team or add players in the Depth Chart tab</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {POSITIONS.flatMap(pos =>
                    [0, 1, 2].map(di => {
                      const slot = slots[pos][di]; if (!slot) return null;
                      const key = `${slot.player.canonical}-${slot.season}`;
                      const rawStats = statsCache[key];
                      const stats = getAdjustedStats(rawStats, pos, di);
                      const loading = loadingKeys.has(key);
                      const mpgOverride = minutesOverride[`${pos}-${di}`];
                      const pc = POS_COLORS[pos];
                      const swapped = isSlotSwapped(pos, di);
                      const origName = originalSlots[pos]?.[di]?.player?.canonical;
                      return (
                        <div key={`${pos}-${di}`} style={{ background: swapped ? C.swapBg : C.card, border: `1px solid ${swapped ? `${C.swap}44` : C.border}`, borderLeft: `3px solid ${swapped ? C.swap : pc.accent}`, borderRadius: 8, padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 9, letterSpacing: '1.5px', background: pc.bg, color: pc.accent, padding: '1px 7px', borderRadius: 3 }}>{pos}</span>
                            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 15, color: swapped ? C.swap : C.text }}>{slot.player.canonical}</span>
                            <span style={{ fontSize: 11, color: C.muted }}>{slot.season}–{slot.season + 1}</span>
                            {swapped && origName && <span style={{ fontSize: 9, color: C.muted, background: C.surface, borderRadius: 3, padding: '1px 6px', border: `1px solid ${C.border}` }}>↩ was {origName}</span>}
                            {rawStats && <SourceBadge stats={rawStats} />}
                            {mpgOverride && <span style={{ fontSize: 9, color: C.warn, fontFamily: "'Barlow',sans-serif" }}>⏱ {mpgOverride} MPG</span>}
                            <span style={{ fontSize: 9, color: C.dim, marginLeft: 'auto' }}>{DEPTH_LABELS[di]}</span>
                          </div>
                          {loading ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: C.muted, fontSize: 11 }}>
                              <Spinner size={11} color={pc.accent} /> Searching Basketball Reference…
                            </div>
                          ) : stats ? (
                            <>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 5, marginBottom: 8 }}>
                                <StatBadge label="PPG" value={stats.ppg} />
                                <StatBadge label="RPG" value={stats.rpg} />
                                <StatBadge label="APG" value={stats.apg} />
                                <StatBadge label="SPG" value={stats.spg} />
                                <StatBadge label="BPG" value={stats.bpg} />
                                <StatBadge label="FG%" value={stats.fg_pct} pct />
                                <StatBadge label="3P%" value={stats.three_pct} pct />
                                <StatBadge label="PER" value={stats.per} />
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: C.surface, borderRadius: 6, border: `1px solid ${C.border}` }}>
                                <span style={{ fontSize: 10, color: C.muted, fontFamily: "'Barlow',sans-serif", whiteSpace: 'nowrap' }}>Minutes per game:</span>
                                <input type="range" min={10} max={48} step={1}
                                  value={mpgOverride || Math.round(rawStats?.mpg || 28)}
                                  onChange={e => setMinutes(pos, di, Number(e.target.value))}
                                  style={{ flex: 1, accentColor: swapped ? C.swap : pc.accent, cursor: 'pointer' }}
                                />
                                <span style={{ fontSize: 12, fontWeight: 700, color: mpgOverride ? C.warn : C.text, fontFamily: "'Barlow Condensed',sans-serif", minWidth: 20 }}>
                                  {mpgOverride || Math.round(rawStats?.mpg || 28)}
                                </span>
                                {mpgOverride && <button onClick={() => setMinutes(pos, di, undefined)} style={{ background: 'none', border: `1px solid ${C.dim}`, color: C.muted, borderRadius: 4, padding: '2px 7px', fontSize: 9, cursor: 'pointer', fontFamily: "'Barlow',sans-serif" }}>reset</button>}
                                {stats._adjusted && <span style={{ fontSize: 9, color: C.warn, fontFamily: "'Barlow',sans-serif" }}>stats scaled to {mpgOverride} MPG</span>}
                              </div>
                            </>
                          ) : (
                            <div style={{ fontSize: 11, color: C.muted }}>Stats unavailable</div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {/* ANALYSIS */}
          {tab === 'analysis' && (
            <div style={{ animation: 'fadeIn 0.25s ease', maxWidth: 820 }}>
              {analyzing && (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '48px 40px', textAlign: 'center' }}>
                  <div style={{ width: 38, height: 38, border: `3px solid ${C.dim}`, borderTopColor: C.accent, borderRadius: '50%', margin: '0 auto 18px', animation: 'spin 0.8s linear infinite' }} />
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 17, fontWeight: 800, marginBottom: 7 }}>RUNNING DEEP ANALYSIS</div>
                  <div style={{ fontSize: 12, color: C.muted }}>Scoring chemistry · analyzing fit · projecting stats{swapCount > 0 ? ` · comparing ${swapCount} swap${swapCount > 1 ? 's' : ''}` : ''}…</div>
                </div>
              )}
              {analysisErr && <div style={{ background: C.card, border: `1px solid ${C.danger}`, borderRadius: 10, padding: 18, color: '#f09595', fontSize: 13 }}>{analysisErr}</div>}
              {!analyzing && !analysis && !analysisErr && (
                <div style={{ textAlign: 'center', padding: '70px 20px', color: C.muted }}>
                  <div style={{ fontSize: 44, marginBottom: 12 }}>⚡</div>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 7 }}>NO ANALYSIS YET</div>
                  <div style={{ fontSize: 12 }}>Add 3+ starters and hit Analyze</div>
                </div>
              )}
              {analysis && (
                <>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    {currentPreset && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#130f02', color: C.warn, border: `1px solid ${C.warn}33`, fontFamily: "'Barlow',sans-serif", fontWeight: 700 }}>◆ {currentPreset}</span>}
                    {swapCount > 0 && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: C.swapBg, color: C.swap, border: `1px solid ${C.swap}33`, fontFamily: "'Barlow',sans-serif", fontWeight: 700 }}>{swapCount} swap{swapCount > 1 ? 's' : ''}</span>}
                    {POSITIONS.map(pos => {
                      const s = slots[pos][0]; if (!s) return null;
                      const pc = POS_COLORS[pos]; const swapped = isSlotSwapped(pos, 0);
                      return <span key={pos} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: swapped ? C.swapBg : pc.bg, color: swapped ? C.swap : pc.accent, border: `1px solid ${swapped ? `${C.swap}33` : `${pc.accent}33`}`, fontFamily: "'Barlow',sans-serif", fontWeight: 600 }}>
                        {pos}: {s.player.canonical.split(' ').slice(-1)[0]} '{String(s.season).slice(2)}
                      </span>;
                    })}
                    {opponent && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#221500', color: C.warn, border: `1px solid ${C.warn}33`, fontFamily: "'Barlow',sans-serif", fontWeight: 600 }}>vs {opponent}</span>}
                  </div>
                  <CompatibilityCard compat={compatibility} />
                  <div style={{ background: '#0e0c08', border: `1px solid ${C.warn}22`, borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 10, color: C.muted, fontFamily: "'Barlow',sans-serif", lineHeight: 1.5 }}>
                    ⚠️ <strong style={{ color: C.estimateText }}>Simulation:</strong> AI-generated analysis for entertainment. Current season stats from balldontlie.io; historical from BBRef/AI. Projections are speculative.
                  </div>
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '22px 26px', lineHeight: 1.78, fontSize: 13, fontFamily: "'Barlow',sans-serif", whiteSpace: 'pre-wrap', color: C.text, animation: 'fadeIn 0.4s ease' }}>
                    {analysis}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
