// API do Spookywatch: inscrições, confirmação e painel da organização.
// Armazenamento: Netlify Blobs. Variável de ambiente: ADMIN_TOKEN.
import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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
};

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
  const [t, c, cfg] = await Promise.all([
    st.list({ prefix: "team/" }),
    st.list({ prefix: "ok/" }),
    st.get("config", { type: "json" }),
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
  return { teams, confirmed, cfg: { ...DEFAULTS, ...(cfg || {}) } };
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
      return json({ teams: all.teams.map(pub), confirmed: all.confirmed, cfg: all.cfg });
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

    if (m === "POST" && path === "/api/teams") {
      if (body.website) return json({ ok: true }); // isca para robôs
      const all = await loadAll(st);
      if (!all.cfg.open) return json({ error: "As inscrições estão encerradas." }, 403);
      const closes = Date.parse(all.cfg.closesAt);
      if (!isNaN(closes) && Date.now() > closes) return json({ error: "O prazo de inscrição terminou." }, 403);
      if (all.teams.length >= all.cfg.maxTeams) return json({ error: "Todas as vagas foram preenchidas." }, 409);
      const editKey = clean(body.editKey, 80);
      if (editKey.length < 16) return json({ error: "Pedido inválido." }, 400);
      const { errs, team } = validate(body, all.teams, null);
      if (errs.length) return json({ error: errs[0], errors: errs }, 422);
      const id = randomBytes(5).toString("hex");
      await st.setJSON("team/" + id, { id, ...team, createdAt: Date.now(), editHash: sha(editKey) });
      return json({ id });
    }

    const tm = path.match(/^\/api\/teams\/([a-f0-9]{10})$/);
    if (tm && (m === "PUT" || m === "DELETE")) {
      const id = tm[1];
      const existing = await st.get("team/" + id, { type: "json" });
      if (!existing) return json({ error: "Time não encontrado." }, 404);
      const okKey = same(sha(clean(body.editKey, 80)), existing.editHash);
      if (!okKey && !isAdmin(req)) return json({ error: "Sem permissão para alterar este time." }, 403);
      if (m === "PUT") {
        const all = await loadAll(st);
        const { errs, team } = validate(body, all.teams, id);
        if (errs.length) return json({ error: errs[0], errors: errs }, 422);
        await st.setJSON("team/" + id, { ...existing, ...team });
        return json({ id });
      }
      await Promise.all([st.delete("team/" + id), st.delete("ok/" + id)]);
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
      await st.setJSON("config", {
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
