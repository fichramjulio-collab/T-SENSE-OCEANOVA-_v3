// T-SENSE · Mesin status potensi banjir rob (NORMAL / WASPADA / SIAGA)
// Rumus mengikuti proposal:
//   Z_air(t) = Z_acuan - d(t)                  d = jarak vertikal terkoreksi sensor ke air
//   R = (Z_t - Z_(t-1)) / dt                   m/jam, dt dari stempel waktu aktual
//   Status dari jarak ke ambang lokal, elevasi, dan laju.
//   Naik status butuh beberapa epoch berturut-turut; turun status memakai histeresis.
// Semua ambang adalah PARAMETER yang wajib dikalibrasi dengan data dan survei lokal.

export const LEVELS = ["NORMAL", "WASPADA", "SIAGA"];

export const DEFAULT_ROB_CONFIG = {
  terkalibrasi: false,
  zAcuanM: null,           // elevasi titik acuan sensor terhadap datum (m), hasil ikatan tinggi
  zAmbangM: null,          // elevasi ambang lokal: tanggul / permukaan tanah di titik pasang (m)
  marginWaspadaM: null,    // WASPADA bila (zAmbang - Z) <= nilai ini (m)
  marginSiagaM: null,      // SIAGA bila (zAmbang - Z) <= nilai ini (m)
  histeresisM: 0.03,       // status baru turun bila margin melebihi ambang + nilai ini (m)
  lajuCepatMPerJam: null,  // laju naik yang menaikkan status satu tingkat bila sudah dekat ambang; null = nonaktif
  koreksiDM: 0,            // koreksi d (m): offset pemasangan, suhu, dsb.
  dMinCm: 25,              // rentang valid pembacaan sensor (cm) - cek datasheet A01NYUB
  dMaxCm: 450,
  dSebaranMaksCm: 6,       // sebaran sampel dalam satu epoch (maks - min) yang masih diterima
  epochDetik: 10,          // satu epoch = median sampel dalam jendela ini
  minSampelValid: 5,       // sampel valid minimum per epoch
  maksCelahDetik: 30,      // celah waktu maksimum antar epoch agar laju dihitung
  nNaik: 3,                // epoch berturut-turut untuk menaikkan status
  nTurun: 4                // epoch berturut-turut untuk menurunkan status
};

export async function loadRobConfig(url = "assets/rob-config.json") {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return { ...DEFAULT_ROB_CONFIG, ...(await res.json()) };
  } catch (err) {
    console.warn("rob-config.json tidak terbaca, memakai bawaan (belum dikalibrasi)", err);
    return { ...DEFAULT_ROB_CONFIG };
  }
}

const isNum = v => typeof v === "number" && Number.isFinite(v);
const median = arr => {
  const s = [...arr].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function parametersReady(c) {
  return [c.zAcuanM, c.zAmbangM, c.marginWaspadaM, c.marginSiagaM].every(isNum);
}

// Tingkat dari jarak ke ambang (margin) dan laju. extra > 0 dipakai untuk histeresis turun.
export function levelOf(margin, rate, cfg, extra = 0) {
  const w = cfg.marginWaspadaM + extra, s = cfg.marginSiagaM + extra;
  let lvl = margin <= s ? 2 : margin <= w ? 1 : 0;
  const fast = isNum(cfg.lajuCepatMPerJam) && isNum(rate) && rate >= cfg.lajuCepatMPerJam;
  if (fast && margin <= 2 * cfg.marginWaspadaM + extra) lvl = Math.min(2, lvl + 1);
  return lvl;
}

export function createRobEngine(cfg) {
  const st = {};
  function reset() {
    Object.assign(st, {
      start: null, valid: [], total: 0, tLast: null,
      prev: null, level: 0, up: 0, pend: null, down: 0, last: null
    });
  }
  reset();

  function closeEpoch() {
    const ready = parametersReady(cfg);
    const base = { total: st.total, validCount: st.valid.length, ready, level: st.level };
    const bad = reason => {
      st.prev = null; // laju tidak dihitung bila data sebelumnya tidak valid
      return { ...base, ok: false, reason, status: ready ? "DATA TIDAK VALID" : "BELUM DIKALIBRASI",
               z: null, margin: null, rate: null };
    };
    if (st.valid.length < cfg.minSampelValid) return bad("Sampel valid kurang dari batas minimum");
    const spread = Math.max(...st.valid) - Math.min(...st.valid);
    if (spread > cfg.dSebaranMaksCm) return bad("Sebaran sampel dalam epoch terlalu besar");

    const dM = median(st.valid) / 100 + (cfg.koreksiDM || 0);
    if (!isNum(cfg.zAcuanM)) {
      return { ...base, ok: true, status: "BELUM DIKALIBRASI", dM, z: null, margin: null, rate: null };
    }
    const z = cfg.zAcuanM - dM;
    const t = st.tLast;
    let rate = null;
    if (st.prev) {
      const dt = (t - st.prev.t) / 1000;
      if (dt > 0 && dt <= cfg.maksCelahDetik) rate = (z - st.prev.z) / (dt / 3600);
    }
    st.prev = { t, z };
    if (!ready) return { ...base, ok: true, status: "BELUM DIKALIBRASI", dM, z, margin: null, rate };

    const margin = cfg.zAmbangM - z;
    const up = levelOf(margin, rate, cfg, 0);
    const downCand = levelOf(margin, rate, cfg, cfg.histeresisM);
    if (up > st.level) {
      st.up++; st.down = 0;
      st.pend = st.up === 1 ? up : Math.min(st.pend, up);
      if (st.up >= cfg.nNaik) { st.level = st.pend; st.up = 0; st.pend = null; }
    } else {
      st.up = 0; st.pend = null;
      if (downCand < st.level) {
        st.down++;
        if (st.down >= cfg.nTurun) { st.level -= 1; st.down = 0; }
      } else st.down = 0;
    }
    return { ...base, level: st.level, ok: true, status: LEVELS[st.level], dM, z, margin, rate,
             pendingUp: st.up, pendingDown: st.down };
  }

  return {
    config: cfg,
    // Dipanggil tiap pembacaan mentah. Mengembalikan hasil hanya saat satu epoch selesai.
    push(tMs, dCm) {
      let result = null;
      if (st.start === null) st.start = tMs;
      else if (tMs - st.start >= cfg.epochDetik * 1000) {
        result = closeEpoch();
        st.start = tMs; st.valid = []; st.total = 0; st.tLast = null;
      }
      st.total++;
      if (isNum(dCm) && dCm >= cfg.dMinCm && dCm <= cfg.dMaxCm) { st.valid.push(dCm); st.tLast = tMs; }
      if (result) st.last = result;
      return result;
    },
    reset,
    get last() { return st.last; }
  };
}
