// API do Spookywatch: inscrições, confirmação e painel da organização.
// Armazenamento: Netlify Blobs. Variável de ambiente: ADMIN_TOKEN.
import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, timingSafeEqual, scrypt } from "node:crypto";
import { promisify } from "node:util";
const scryptP = promisify(scrypt);

export const config = { path: "/api/*" };

const RANKS = ["Bronze", "Prata", "Ouro", "Platina", "Diamante", "Mestre", "Grão-Mestre", "Campeão"];
const COLORS = ["#ff9d1c", "#3fb6ff", "#ff6173", "#3ddc97", "#b78cff", "#ffd447", "#ff6fd8", "#7be0e0"];
const ROLES = ["tank", "dps", "dps", "sup", "sup"];
const BT = /^[^\s#@]{3,24}#\d{3,8}$/;
const DC = /^[A-Za-z0-9_.]{2,32}$/;
const DEFAULTS = {
  maxTeams: 16,
  open: true,
  startsAt: "2026-10-31T20:00:00-03:00",
  closesAt: "2026-10-24T23:59:00-03:00", // prazo das inscrições: até o fim do dia 24
  streamUrl: "", // link da transmissão (Twitch, YouTube ou Kick)
};

const STREAM_HOSTS = /^((www|m)\.)?(twitch\.tv|youtube\.com|kick\.com)$|^youtu\.be$/;
function cleanStream(v) { // "" = sem link; null = inválido
  const s = String(v ?? "").trim().slice(0, 200);
  if (!s) return "";
  try { const u = new URL(s); if (u.protocol === "https:" && STREAM_HOSTS.test(u.hostname)) return u.href; } catch { /* inválido */ }
  return null;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const clean = (s, max) =>
  String(s ?? "").replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").trim().slice(0, max);
const pub = ({ editHash, ...team }) => team;

function isAdmin(req) {
  const token = process.env.ADMIN_TOKEN || "";
  return token.length >= 8 && same(req.headers.get("x-admin-token") || "", token);
}

async function loadAll(st) {
  const [t, c, cfg, bracket] = await Promise.all([
    st.list({ prefix: "team/" }),
    st.list({ prefix: "ok/" }),
    st.get("config", { type: "json" }),
    st.get("bracket", { type: "json" }),
  ]);
  const teams = (await Promise.all(t.blobs.map((b) => st.get(b.key, { type: "json" })))).filter(Boolean);
  const confirmed = {};
  await Promise.all(
    c.blobs.map(async (b) => {
      const v = await st.get(b.key, { type: "json" });
      if (v) confirmed[b.key.slice(3)] = v.at;
    })
  );
  teams.sort((a, b) => a.createdAt - b.createdAt);
  return { teams, confirmed, bracket: bracket || null, cfg: { ...DEFAULTS, ...(cfg || {}) } };
}

/* capitães: conta com senha (scrypt) e sessão de 30 dias */
const SESSION_MS = 30 * 864e5;
const hashPw = async (pw, salt) => (await scryptP(String(pw), salt, 64)).toString("hex");
async function newSession(st, cap) {
  const token = randomBytes(32).toString("hex");
  await st.setJSON("sess/" + sha(token), { discord: cap.discord, exp: Date.now() + SESSION_MS });
  return { token, name: cap.name, discord: cap.discord };
}
async function captainFrom(req, st) {
  const t = req.headers.get("x-captain-token") || "";
  if (t.length < 32 || t.length > 100) return null;
  const s = await st.get("sess/" + sha(t), { type: "json" });
  if (!s || s.exp < Date.now()) return null;
  return (await st.get("cap/" + s.discord.toLowerCase(), { type: "json" })) || null;
}
const needCaptain = (msg) => json({ error: msg, code: "captain_auth" }, 401);

/* chaveamento: eliminação simples, byes para os melhores cabeças de chave */
function seedOrder(size) {
  let a = [1];
  while (a.length < size) { const L = a.length * 2; a = a.flatMap((x) => [x, L + 1 - x]); }
  return a;
}
function buildBracket(teams) {
  const order = teams.slice();
  for (let i = order.length - 1; i > 0; i--) { // sorteio
    const j = randomBytes(4).readUInt32BE() % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  let size = 2;
  while (size < order.length) size *= 2;
  const slots = seedOrder(size).map((s) => (order[s - 1] ? order[s - 1].id : null));
  const rounds = [];
  for (let r = 0, n = size / 2; n >= 1; r++, n /= 2)
    rounds.push(Array.from({ length: n }, (_, i) => ({ id: `r${r}m${i}`, a: null, b: null, winner: null, live: false })));
  rounds[0].forEach((m, i) => { m.a = slots[2 * i]; m.b = slots[2 * i + 1]; });
  const br = { generatedAt: Date.now(), teams: {}, rounds };
  order.forEach((t) => { br.teams[t.id] = { tag: t.tag, name: t.name, color: t.color }; });
  rounds[0].forEach((m, i) => { if (!m.a !== !m.b) { m.winner = m.a || m.b; propagate(br, 0, i); } }); // byes
  return br;
}
function propagate(br, r, i) {
  if (r + 1 >= br.rounds.length) return;
  const next = br.rounds[r + 1][i >> 1], key = i % 2 === 0 ? "a" : "b";
  const w = br.rounds[r][i].winner || null;
  if (next[key] === w) return;
  next[key] = w;
  next.winner = null; next.live = false; // mudou um adversário: o resultado antigo deixa de valer
  propagate(br, r + 1, i >> 1);
}

function validate(body, teams, selfId) {
  const errs = [];
  const name = clean(body.name, 24);
  const tag = clean(body.tag, 4).toUpperCase();
  if (name.length < 3) errs.push("Dê um nome ao time com pelo menos 3 caracteres.");
  if (!/^[A-Z0-9]{2,4}$/.test(tag)) errs.push("A sigla precisa de 2 a 4 letras ou números.");
  const rank = RANKS.includes(body.rank) ? body.rank : null;
  if (!rank) errs.push("Escolha o rank do time.");
  const color = COLORS.includes(body.color) ? body.color : null;
  if (!color) errs.push("Escolha a cor do time.");

  // capitão: quem entrou com nome e @ do Discord
  const ownerName = clean(body.owner && body.owner.name, 24);
  const ownerDc = clean(body.owner && body.owner.discord, 33).replace(/^@/, "");
  if (ownerName.length < 2) errs.push("Informe o seu nome.");
  if (!DC.test(ownerDc)) errs.push("Informe o seu @ do Discord.");
  else if (teams.some((t) => t.id !== selfId && t.owner && t.owner.discord.toLowerCase() === ownerDc.toLowerCase()))
    errs.push("Este @ do Discord já é capitão de outro time.");

  const taken = new Set();
  teams.forEach((t) => {
    if (t.id === selfId) return;
    t.players.concat(t.sub ? [t.sub] : []).forEach((p) => taken.add(p.battletag.toLowerCase()));
  });
  const seen = new Set();
  const input = Array.isArray(body.players) ? body.players : [];
  if (input.length !== 5) errs.push("A escalação precisa de 5 jogadores.");
  const players = ROLES.map((role, i) => {
    const battletag = clean((input[i] || {}).battletag, 32);
    if (!BT.test(battletag)) errs.push(`BattleTag do jogador ${i + 1} inválida. Use o formato Nome#1234.`);
    else {
      const k = battletag.toLowerCase();
      if (taken.has(k)) errs.push(`${battletag} já está inscrito em outro time.`);
      if (seen.has(k)) errs.push(`${battletag} aparece duas vezes.`);
      seen.add(k);
    }
    return { role, battletag };
  });
  let sub = null;
  const sb = clean(body.sub && body.sub.battletag, 32);
  if (sb) {
    const k = sb.toLowerCase();
    if (!BT.test(sb) || seen.has(k) || taken.has(k)) errs.push("Reserva: BattleTag inválida ou já inscrita.");
    else sub = { role: "dps", battletag: sb };
  }
  return { errs, team: { name, tag, rank, color, owner: { name: ownerName, discord: ownerDc }, players, sub } };
}

/* rotas */
export async function handle(req, st) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const m = req.method;
  try {
    if (m === "GET" && path === "/api/state") {
      const all = await loadAll(st);
      return json({ teams: all.teams.map(pub), confirmed: all.confirmed, cfg: all.cfg, bracket: all.bracket });
    }
    if (m === "GET" && path === "/api/admin/check") return json({ admin: isAdmin(req) });

    let body = {};
    if (m !== "GET" && m !== "HEAD") {
      const raw = await req.text();
      if (raw.length > 12000) return json({ error: "Pedido grande demais." }, 413);
      if (raw) {
        try { body = JSON.parse(raw); } catch { return json({ error: "Pedido inválido." }, 400); }
      }
    }

    /* capitão: criar conta, entrar, sessão */
    if (m === "POST" && path === "/api/captain/register") {
      if (body.website) return json({ ok: true });
      const name = clean(body.name, 24), dc = clean(body.discord, 33).replace(/^@/, ""), pw = String(body.password ?? "");
      if (name.length < 2) return json({ error: "Informe o seu nome." }, 422);
      if (!DC.test(dc)) return json({ error: "O @ do Discord deve ter de 2 a 32 letras, números, ponto ou sublinhado." }, 422);
      if (pw.length < 6 || pw.length > 72) return json({ error: "A senha precisa ter de 6 a 72 caracteres." }, 422);
      const key = "cap/" + dc.toLowerCase();
      if (await st.get(key, { type: "json" })) return json({ error: "Este @ já tem conta de capitão. Entre com a senha." }, 409);
      const salt = randomBytes(16).toString("hex");
      const cap = { discord: dc, name, salt, hash: await hashPw(pw, salt), createdAt: Date.now(), fails: 0, lockUntil: 0 };
      await st.setJSON(key, cap);
      return json(await newSession(st, cap));
    }
    if (m === "POST" && path === "/api/captain/login") {
      const dc = clean(body.discord, 33).replace(/^@/, ""), pw = String(body.password ?? "").slice(0, 72);
      const bad = () => json({ error: "@ ou senha incorretos.", code: "bad_login" }, 401);
      if (!DC.test(dc)) return bad();
      const key = "cap/" + dc.toLowerCase();
      const cap = await st.get(key, { type: "json" });
      if (!cap) return bad();
      if (cap.lockUntil > Date.now())
        return json({ error: `Muitas tentativas. Tente de novo em ${Math.ceil((cap.lockUntil - Date.now()) / 60000)} min.`, code: "locked" }, 429);
      if (!same(await hashPw(pw, cap.salt), cap.hash)) {
        cap.fails = (cap.fails || 0) + 1;
        if (cap.fails >= 5) { cap.fails = 0; cap.lockUntil = Date.now() + 10 * 60000; }
        await st.setJSON(key, cap);
        return bad();
      }
      if (cap.fails || cap.lockUntil) { cap.fails = 0; cap.lockUntil = 0; await st.setJSON(key, cap); }
      return json(await newSession(st, cap));
    }
    if (m === "GET" && path === "/api/captain/me") {
      const cap = await captainFrom(req, st);
      return cap ? json({ name: cap.name, discord: cap.discord }) : needCaptain("Sessão expirada.");
    }
    if (m === "POST" && path === "/api/captain/logout") {
      const t = req.headers.get("x-captain-token") || "";
      if (t) await st.delete("sess/" + sha(t));
      return json({ ok: true });
    }

    if (m === "POST" && path === "/api/teams") {
      if (body.website) return json({ ok: true }); // isca para robôs
      const cap = await captainFrom(req, st);
      if (!cap) return needCaptain("Entre como capitão para inscrever um time.");
      body.owner = { name: cap.name, discord: cap.discord };
      const all = await loadAll(st);
      if (!all.cfg.open) return json({ error: "As inscrições estão encerradas." }, 403);
      const closes = Date.parse(all.cfg.closesAt);
      if (!isNaN(closes) && Date.now() > closes) return json({ error: "O prazo de inscrição terminou." }, 403);
      if (all.teams.length >= all.cfg.maxTeams) return json({ error: "Todas as vagas foram preenchidas." }, 409);
      const { errs, team } = validate(body, all.teams, null);
      if (errs.length) return json({ error: errs[0], errors: errs }, 422);
      const id = randomBytes(5).toString("hex");
      await st.setJSON("team/" + id, { id, ...team, createdAt: Date.now() });
      return json({ id });
    }

    const tm = path.match(/^\/api\/teams\/([a-f0-9]{10})$/);
    if (tm && (m === "PUT" || m === "DELETE")) {
      const id = tm[1];
      const existing = await st.get("team/" + id, { type: "json" });
      if (!existing) return json({ error: "Time não encontrado." }, 404);
      const cap = await captainFrom(req, st);
      const isOwner = !!(cap && existing.owner && existing.owner.discord.toLowerCase() === cap.discord.toLowerCase());
      const legacyKey = !!(existing.editHash && body.editKey && same(sha(clean(body.editKey, 80)), existing.editHash)); // times antigos
      if (!isOwner && !legacyKey && !isAdmin(req))
        return cap ? json({ error: "Sem permissão para alterar este time." }, 403) : needCaptain("Entre como capitão para alterar o time.");
      if (m === "PUT") {
        body.owner = isOwner ? { name: cap.name, discord: cap.discord } : existing.owner;
        const all = await loadAll(st);
        const { errs, team } = validate(body, all.teams, id);
        if (errs.length) return json({ error: errs[0], errors: errs }, 422);
        await st.setJSON("team/" + id, { ...existing, ...team });
        return json({ id });
      }
      await Promise.all([st.delete("team/" + id), st.delete("ok/" + id)]);
      return json({ ok: true });
    }

    const rc = path.match(/^\/api\/admin\/captain\/([A-Za-z0-9_.]{2,32})$/);
    if (rc && m === "DELETE") { // resetar senha: apaga a conta, o capitão cria outra
      if (!isAdmin(req)) return json({ error: "Acesso negado." }, 401);
      await st.delete("cap/" + rc[1].toLowerCase());
      return json({ ok: true });
    }

    if (path === "/api/admin/bracket" && (m === "POST" || m === "DELETE")) {
      if (!isAdmin(req)) return json({ error: "Acesso negado." }, 401);
      if (m === "DELETE") { await st.delete("bracket"); return json({ ok: true }); }
      const all = await loadAll(st);
      const ok = all.teams.filter((t) => all.confirmed[t.id]);
      if (ok.length < 2) return json({ error: "Confirme pelo menos 2 times para gerar o chaveamento." }, 422);
      await st.setJSON("bracket", buildBracket(ok));
      return json({ ok: true });
    }
    const bm = path.match(/^\/api\/admin\/bracket\/match\/r(\d{1,2})m(\d{1,3})$/);
    if (bm && m === "POST") {
      if (!isAdmin(req)) return json({ error: "Acesso negado." }, 401);
      const br = await st.get("bracket", { type: "json" });
      const r = Number(bm[1]), i = Number(bm[2]);
      const match = br && br.rounds[r] && br.rounds[r][i];
      if (!match) return json({ error: "Confronto não encontrado." }, 404);
      if (!match.a || !match.b) return json({ error: "Aguardando os dois times deste confronto." }, 409);
      if ("winner" in body) {
        const w = body.winner === null ? null : String(body.winner);
        if (w !== null && w !== match.a && w !== match.b) return json({ error: "Vencedor inválido." }, 422);
        if (match.winner !== w) { match.winner = w; match.live = false; propagate(br, r, i); }
      }
      if ("live" in body) {
        if (body.live && match.winner) return json({ error: "Este confronto já tem vencedor." }, 409);
        match.live = !!body.live;
      }
      await st.setJSON("bracket", br);
      return json({ ok: true });
    }

    const cm = path.match(/^\/api\/admin\/confirm\/([a-f0-9]{10})$/);
    if (cm && m === "POST") {
      if (!isAdmin(req)) return json({ error: "Acesso negado." }, 401);
      const id = cm[1];
      if (!(await st.get("team/" + id, { type: "json" }))) return json({ error: "Time não encontrado." }, 404);
      if (body.on) await st.setJSON("ok/" + id, { at: Date.now() });
      else await st.delete("ok/" + id);
      return json({ ok: true });
    }

    if (m === "PUT" && path === "/api/admin/config") {
      if (!isAdmin(req)) return json({ error: "Acesso negado." }, 401);
      const max = Math.max(2, Math.min(64, Number(body.maxTeams) || DEFAULTS.maxTeams));
      const starts = new Date(body.startsAt);
      const closes = new Date(body.closesAt);
      const stream = cleanStream(body.streamUrl);
      if (stream === null) return json({ error: "Link inválido. Use um link https da Twitch, do YouTube ou da Kick." }, 422);
      await st.setJSON("config", {
        streamUrl: stream,
        maxTeams: Math.floor(max),
        open: body.open !== false,
        startsAt: isNaN(starts) ? DEFAULTS.startsAt : starts.toISOString(),
        closesAt: isNaN(closes) ? DEFAULTS.closesAt : closes.toISOString(),
      });
      return json({ ok: true });
    }

    return json({ error: "Rota não encontrada." }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "Erro no servidor. Tente de novo em instantes." }, 500);
  }
}

export default async (req) => handle(req, getStore({ name: "spookywatch", consistency: "strong" }));
