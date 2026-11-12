import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, sendEmailVerification,
  sendPasswordResetEmail, onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { loadRobConfig, createRobEngine, parametersReady } from "./rob.js";

const authScreen = document.getElementById("authScreen");
const dashboard = document.getElementById("dashboard");
const authMessage = document.getElementById("authMessage");
const configNotice = document.getElementById("configNotice");
const configReady = firebaseConfig.apiKey !== "PASTE_API_KEY_HERE" &&
  firebaseConfig.projectId !== "PASTE_PROJECT_ID" &&
  firebaseConfig.apiKey && firebaseConfig.projectId;
let auth = null;

function showMessage(message, type="info") {
  authMessage.textContent = message;
  authMessage.className = `message ${type}`;
}
function setMode(mode) {
  const login = mode === "login";
  document.getElementById("loginForm").classList.toggle("hidden", !login);
  document.getElementById("registerForm").classList.toggle("hidden", login);
  document.getElementById("showRegister").classList.toggle("hidden", !login);
  document.getElementById("showLogin").classList.toggle("hidden", login);
  document.getElementById("forgotPassword").classList.toggle("hidden", !login);
  document.getElementById("authEyebrow").textContent = login ? "SECURE ACCESS" : "JOIN OCEANOVA";
  document.getElementById("authTitle").textContent = login ? "Selamat datang kembali" : "Buat akun T-SENSE";
  document.getElementById("authDescription").textContent = login
    ? "Masuk untuk membuka pusat pemantauan pesisir T-SENSE."
    : "Daftarkan email dan buat password untuk mengakses dashboard.";
  showMessage("");
}
document.getElementById("showRegister").addEventListener("click", () => setMode("register"));
document.getElementById("showLogin").addEventListener("click", () => setMode("login"));

function friendlyError(error) {
  const code = error?.code || "";
  const map = {
    "auth/email-already-in-use":"Email ini sudah terdaftar. Silakan masuk.",
    "auth/invalid-email":"Format email tidak valid.",
    "auth/weak-password":"Password terlalu lemah. Gunakan minimal 6 karakter.",
    "auth/user-not-found":"Akun tidak ditemukan. Periksa email atau daftar dahulu.",
    "auth/wrong-password":"Password tidak sesuai.",
    "auth/invalid-credential":"Email atau password tidak sesuai.",
    "auth/popup-closed-by-user":"Jendela Google ditutup sebelum proses selesai.",
    "auth/unauthorized-domain":"Domain website belum ditambahkan ke Authorized domains Firebase.",
    "auth/operation-not-allowed":"Metode login belum diaktifkan di Firebase Authentication.",
    "auth/network-request-failed":"Koneksi internet bermasalah. Coba kembali."
  };
  return map[code] || `Terjadi kendala (${code || "unknown"}). Periksa pengaturan Firebase dan coba kembali.`;
}

if (!configReady) {
  configNotice.classList.remove("hidden");
  document.querySelectorAll("#loginForm button, #registerForm button, #googleButton, #forgotPassword").forEach(el => el.disabled = true);
  showMessage("Lengkapi konfigurasi Firebase terlebih dahulu pada assets/firebase-config.js.", "error");
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
  } catch (error) {
    showMessage("Konfigurasi Firebase belum benar: " + error.message, "error");
  }
}

document.getElementById("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth) return;
  const name = document.getElementById("registerName").value.trim();
  const email = document.getElementById("registerEmail").value.trim();
  const password = document.getElementById("registerPassword").value;
  const confirm = document.getElementById("registerConfirm").value;
  if (password !== confirm) return showMessage("Password dan konfirmasi password tidak sama.", "error");
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(credential.user, { displayName: name });
    await sendEmailVerification(credential.user);
    await signOut(auth);
    setMode("login");
    showMessage("Akun berhasil dibuat. Silakan verifikasi email melalui tautan yang dikirim, lalu masuk kembali.", "success");
  } catch (error) { showMessage(friendlyError(error), "error"); }
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth) return;
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    if (!credential.user.emailVerified) {
      await signOut(auth);
      return showMessage("Email belum diverifikasi. Buka email verifikasi dari Firebase, lalu coba masuk kembali.", "error");
    }
  } catch (error) { showMessage(friendlyError(error), "error"); }
});

document.getElementById("googleButton").addEventListener("click", async () => {
  if (!auth) return;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  } catch (error) { showMessage(friendlyError(error), "error"); }
});

document.getElementById("forgotPassword").addEventListener("click", async () => {
  if (!auth) return;
  const email = document.getElementById("loginEmail").value.trim();
  if (!email) return showMessage("Masukkan alamat email pada kolom Gmail terlebih dahulu.", "error");
  try {
    await sendPasswordResetEmail(auth, email);
    showMessage("Tautan untuk mengatur ulang password telah dikirim jika email terdaftar.", "success");
  } catch (error) { showMessage(friendlyError(error), "error"); }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  if (auth) await signOut(auth);
});
if (auth) onAuthStateChanged(auth, user => {
  if (user) {
    authScreen.classList.add("hidden");
    dashboard.classList.remove("hidden");
    applyProfile(user);
    startDashboard();
  } else {
    dashboard.classList.add("hidden");
    authScreen.classList.remove("hidden");
    stopDashboard();
  }
});

// Dashboard preview data. Replace this generator with authenticated backend telemetry
// before using the dashboard for actual field monitoring.
let timer = null, records = [], paused = false, period = "second", chart = null;
let scenarioTarget = 0, scenarioOffset = 0; // cm; dipakai tombol "Air naik" pada panel rob
const canvas = document.getElementById("waterChart");
const ctx = canvas.getContext("2d");
function nowLabel() { return new Date().toLocaleString("id-ID", { timeZone:"Asia/Jakarta" }); }
function sample() {
  const t = new Date();
  // Skenario air naik/surut: offset bergerak 0,2 cm per detik menuju target
  scenarioOffset = scenarioOffset < scenarioTarget ? Math.min(scenarioTarget, scenarioOffset + 0.2) : Math.max(scenarioTarget, scenarioOffset - 0.2);
  const distance = +(48 + Math.sin(Date.now()/95000)*1.0 + (Math.random()-.5)*.5 - scenarioOffset).toFixed(2);
  const lat = -2.9900 + (Math.random()-.5)*0.0002;
  const lon = 104.7600 + (Math.random()-.5)*0.0002;
  return { timestamp:t.toISOString(), localTime:nowLabel(), distance_cm:distance, latitude:+lat.toFixed(6), longitude:+lon.toFixed(6), source:"SIMULATION" };
}
function addSample() {
  const r = sample(); records.push(r); if (records.length > 5000) records.shift();
  document.getElementById("distanceValue").innerHTML = `${r.distance_cm.toFixed(2)} <small>cm</small>`;
  document.getElementById("latestReading").textContent = `${r.distance_cm.toFixed(2)} cm`;
  document.getElementById("changeValue").innerHTML = `${(r.distance_cm-records[0].distance_cm).toFixed(2)} <small>cm</small>`;
  document.getElementById("satelliteValue").innerHTML = `${Math.floor(8+Math.random()*5)} <small>SV</small>`;
  document.getElementById("latitude").textContent = `${r.latitude.toFixed(6)}°`;
  document.getElementById("longitude").textContent = `${r.longitude.toFixed(6)}°`;
  document.getElementById("gnssTime").textContent = new Date().toLocaleTimeString("id-ID");
  document.getElementById("recordCount").textContent = `${records.length} rekaman`;
  document.getElementById("chartCount").textContent = `${records.length} titik data`;
  updateMap(r.latitude, r.longitude); renderWater(r); renderTable(); drawChart(); feedRob(r);
}
function renderTable() {
  const body = document.getElementById("historyBody");
  body.innerHTML = "";
  records.slice(-8).reverse().forEach(r => {
    const tr = document.createElement("tr");
    [new Date(r.timestamp).toLocaleTimeString("id-ID"), r.distance_cm.toFixed(2), r.latitude.toFixed(6), r.longitude.toFixed(6), r.source].forEach(v => {
      const td=document.createElement("td"); td.textContent=v; tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}
function aggregate() {
  if (period==="second") return records.slice(-60).map(r=>({label:new Date(r.timestamp).toLocaleTimeString("id-ID"), value:r.distance_cm}));
  const buckets = new Map();
  records.forEach(r => {
    const d=new Date(r.timestamp);
    const key=period==="hour" ? new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours()).toISOString() : new Date(d.getFullYear(),d.getMonth(),d.getDate()).toISOString();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r.distance_cm);
  });
  return [...buckets.entries()].slice(period==="hour"?-24:-7).map(([k,vals])=>({label:new Date(k).toLocaleString("id-ID",period==="hour"?{hour:"2-digit",day:"2-digit",month:"short"}:{day:"2-digit",month:"short"}), value:vals.reduce((a,b)=>a+b,0)/vals.length}));
}
function drawChart() {
  const rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  if(!rect.width) return; // halaman sedang tersembunyi
  canvas.width=Math.max(300,rect.width*dpr); canvas.height=250*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const w=rect.width,h=250,pad={l:42,r:16,t:18,b:34};
  ctx.clearRect(0,0,w,h);
  const points=aggregate(); if(!points.length) return;
  const vals=points.map(p=>p.value), min=Math.min(...vals)-1, max=Math.max(...vals)+1;
  ctx.font="11px Inter,Arial"; ctx.strokeStyle="#e7edf1"; ctx.fillStyle="#8495a2"; ctx.lineWidth=1;
  for(let i=0;i<5;i++){const y=pad.t+(h-pad.t-pad.b)*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText((max-(max-min)*i/4).toFixed(1),4,y+4);}
  const x=i=>pad.l+(w-pad.l-pad.r)*(points.length===1?.5:i/(points.length-1));
  const y=v=>pad.t+(h-pad.t-pad.b)*(max-v)/(max-min);
  const grad=ctx.createLinearGradient(0,pad.t,0,h-pad.b);grad.addColorStop(0,"rgba(25,166,184,.24)");grad.addColorStop(1,"rgba(25,166,184,0)");
  ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(x(i),y(p.value)):ctx.moveTo(x(i),y(p.value)));ctx.lineTo(x(points.length-1),h-pad.b);ctx.lineTo(x(0),h-pad.b);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(x(i),y(p.value)):ctx.moveTo(x(i),y(p.value)));ctx.strokeStyle="#159eae";ctx.lineWidth=2.5;ctx.stroke();
  ctx.fillStyle="#82939f";ctx.textAlign="center";
  const step=Math.max(1,Math.ceil(points.length/5));points.forEach((p,i)=>{if(i%step===0||i===points.length-1)ctx.fillText(p.label,x(i),h-10);});
  document.getElementById("chartRange").textContent=period==="second"?"60 detik terakhir":period==="hour"?"Ringkasan per jam":"Ringkasan per hari";
}

/* =====================================================================
   REFERENSI PASUT BIG
   Data stasiun : assets/tide-stations.json
   Data tinggi  : file CSV yang disebut di "dataFile" pada JSON tersebut
   ===================================================================== */
let tideRows = [];
let tideLoaded = false;

// Jarak antar dua titik (km) - rumus Haversine
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Zona waktu data CSV pasut. 7 = WIB. Ubah jadi 0 kalau data dari BIG ternyata UTC.
const TIDE_UTC_OFFSET_HOURS = 7;

// Membaca CSV pasut. Mendukung dua format:
// 1) Lat,Lon,tanggal(M/D/YYYY),jam(H:MM:SS),z(m)  -> format CSV Muntok dari BIG
// 2) waktu,tinggi                                  -> format sederhana 2 kolom
function parseTideCsv(text) {
  const clean = text.replace(/^\uFEFF/, "").trim();
  const lines = clean.split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  return lines.slice(1).map(line => {
    const p = line.split(delimiter).map(s => s.trim().replace(/^"|"$/g, ""));
    if (p.length >= 5) {
      const [mo, d, y] = p[2].split("/").map(Number);
      const [hh, mi, ss] = p[3].split(":").map(Number);
      const t = new Date(Date.UTC(y, mo - 1, d, hh, mi, ss || 0) - TIDE_UTC_OFFSET_HOURS * 3600000);
      return { t, h: parseFloat(p[4].replace(",", ".")) };
    }
    const h = parseFloat((p[1] || "").replace(",", "."));
    return { t: new Date(p[0]), h };
  }).filter(r => !isNaN(r.t.getTime()) && Number.isFinite(r.h));
}

function setTideText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function loadTideReference(myLat, myLon) {
  try {
    const res = await fetch("assets/tide-stations.json", { cache: "no-store" });
    if (!res.ok) throw new Error("tide-stations.json tidak ditemukan (" + res.status + ")");
    const { stations } = await res.json();
    if (!stations || !stations.length) throw new Error("Daftar stasiun kosong");

    // pilih stasiun terdekat
    const nearest = stations
      .map(s => ({ ...s, dist: haversine(myLat, myLon, s.lat, s.lon) }))
      .sort((a, b) => a.dist - b.dist)[0];

    setTideText("tideName", nearest.name);
    setTideText("tideDistance", nearest.dist.toFixed(1) + " km");
    setTideText("tideDatum", nearest.datum || "BELUM DIKETAHUI");
    setTideText("tideSourceTag", nearest.source || "BIG");
    showTideOnMap(nearest);

    const csvRes = await fetch(nearest.dataFile, { cache: "no-store" });
    if (!csvRes.ok) throw new Error("File CSV pasut tidak ditemukan (" + csvRes.status + ")");
    tideRows = parseTideCsv(await csvRes.text());
    if (!tideRows.length) throw new Error("CSV pasut kosong atau formatnya salah");

    setTideText("tideLatest", tideRows[tideRows.length - 1].h.toFixed(2) + " m");
    tideLoaded = true;
    drawTideChart(tideRows);
  } catch (err) {
    console.error("Gagal memuat data pasut", err);
    setTideText("tideName", "Data tidak tersedia");
    setTideText("tideLatest", "-- m");
  }
}

function drawTideChart(rows = tideRows) {
  const c = document.getElementById("tideChart");
  if (!c || !rows.length) return;
  c.style.width = "100%"; c.style.height = "250px";
  const rect = c.getBoundingClientRect();
  if (!rect.width) return; // dashboard masih tersembunyi
  const cx = c.getContext("2d"), dpr = window.devicePixelRatio || 1;
  c.width = Math.max(300, rect.width * dpr); c.height = 250 * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = 250, pad = { l: 42, r: 16, t: 18, b: 34 };
  cx.clearRect(0, 0, w, h);

  const vals = rows.map(r => r.h);
  const min = Math.min(...vals) - 0.1, max = Math.max(...vals) + 0.1;
  cx.font = "11px Inter,Arial"; cx.strokeStyle = "#e7edf1"; cx.fillStyle = "#8495a2"; cx.lineWidth = 1; cx.textAlign = "left";
  for (let i = 0; i < 5; i++) {
    const yy = pad.t + (h - pad.t - pad.b) * i / 4;
    cx.beginPath(); cx.moveTo(pad.l, yy); cx.lineTo(w - pad.r, yy); cx.stroke();
    cx.fillText((max - (max - min) * i / 4).toFixed(2), 4, yy + 4);
  }
  const x = i => pad.l + (w - pad.l - pad.r) * (rows.length === 1 ? .5 : i / (rows.length - 1));
  const y = v => pad.t + (h - pad.t - pad.b) * (max - v) / (max - min);

  const grad = cx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, "rgba(30,90,200,.22)"); grad.addColorStop(1, "rgba(30,90,200,0)");
  cx.beginPath();
  rows.forEach((r, i) => i ? cx.lineTo(x(i), y(r.h)) : cx.moveTo(x(i), y(r.h)));
  cx.lineTo(x(rows.length - 1), h - pad.b); cx.lineTo(x(0), h - pad.b); cx.closePath();
  cx.fillStyle = grad; cx.fill();

  cx.beginPath();
  rows.forEach((r, i) => i ? cx.lineTo(x(i), y(r.h)) : cx.moveTo(x(i), y(r.h)));
  cx.strokeStyle = "#1e5ac8"; cx.lineWidth = 2.5; cx.stroke();

  cx.fillStyle = "#82939f"; cx.textAlign = "center";
  const step = Math.max(1, Math.ceil(rows.length / 5));
  rows.forEach((r, i) => {
    if (i % step === 0 || i === rows.length - 1) {
      const label = r.t.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      cx.fillText(label, x(i), h - 10);
    }
  });
}
/* ===================== AKHIR BAGIAN PASUT BIG ===================== */

/* =====================================================================
   PETA INTERAKTIF (Leaflet + OpenStreetMap) dan VISUAL AIR
   ===================================================================== */
let map = null, tsenseMarker = null, tideMarker = null, pendingTide = null;

function mapIcon(kind) {
  return L.divIcon({ className: "", html: '<span class="map-dot ' + kind + '"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
}

function initMap() {
  const last = records[records.length - 1];
  const lat = last ? last.latitude : -2.99, lon = last ? last.longitude : 104.76;
  const el = document.getElementById("map");
  if (!el || map) return;
  if (typeof L === "undefined") {
    el.innerHTML = '<div class="map-fallback">Peta tidak dapat dimuat. Periksa koneksi internet lalu muat ulang halaman.</div>';
    return;
  }
  map = L.map(el, { zoomControl: true }).setView([lat, lon], 15);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  tsenseMarker = L.marker([lat, lon], { icon: mapIcon("tsense"), title: "T-SENSE-001" })
    .addTo(map).bindTooltip("T-SENSE-001 · koordinat simulasi");
  // Scroll halaman tidak terganggu: zoom dengan roda mouse aktif setelah peta diklik
  map.scrollWheelZoom.disable();
  map.on("click", () => map.scrollWheelZoom.enable());
  map.on("mouseout", () => map.scrollWheelZoom.disable());
  setTimeout(() => map.invalidateSize(), 250);
  if (pendingTide) showTideOnMap(pendingTide);
}

function updateMap(lat, lon) {
  if (map && tsenseMarker) tsenseMarker.setLatLng([lat, lon]);
}

function showTideOnMap(st) {
  if (!map) { pendingTide = st; return; }
  if (tideMarker) return;
  tideMarker = L.marker([st.lat, st.lon], { icon: mapIcon("tide"), title: st.name })
    .addTo(map).bindTooltip(st.name + " · stasiun pasut BIG");
}

function centerMap() {
  if (map && tsenseMarker) map.setView(tsenseMarker.getLatLng(), Math.max(map.getZoom(), 15));
}
function fitMapAll() {
  if (!map || !tsenseMarker) return;
  if (!tideMarker) return centerMap();
  map.fitBounds(L.latLngBounds([tsenseMarker.getLatLng(), tideMarker.getLatLng()]).pad(0.3));
}
document.getElementById("mapCenter")?.addEventListener("click", centerMap);
document.getElementById("mapFit")?.addEventListener("click", fitMapAll);

// Visual air: makin besar jarak sensor ke air, makin turun permukaan air.
const WV = { top: 60, bottom: 190, dLo: 20, dHi: 70 }; // px posisi permukaan air dan rentang cm yang digambar
function renderWater(r) {
  const water = document.getElementById("wvWater");
  if (!water) return;
  const frac = Math.min(1, Math.max(0, (r.distance_cm - WV.dLo) / (WV.dHi - WV.dLo)));
  const y = Math.round(WV.top + frac * (WV.bottom - WV.top));
  water.style.top = y + "px";
  const line = document.getElementById("wvLine");
  if (line) line.style.height = Math.max(0, y - 44) + "px";
  const txt = r.distance_cm.toFixed(1);
  const dist = document.getElementById("wvDist"); if (dist) dist.textContent = txt + " cm";
  const val = document.getElementById("wvValue"); if (val) val.textContent = txt;
  const change = r.distance_cm - records[0].distance_cm;
  const delta = document.getElementById("wvDelta");
  if (delta) {
    const sign = change > 0 ? "+" : change < 0 ? "\u2212" : "";
    delta.innerHTML = "<b>" + (change > 0 ? "\u2197" : "\u2198") + " " + sign + Math.abs(change).toFixed(1) + " cm</b> perubahan dari awal simulasi";
  }
}
/* ===================== AKHIR BAGIAN PETA & AIR ===================== */

/* =====================================================================
   INDIKATOR POTENSI BANJIR ROB  (NORMAL / WASPADA / SIAGA)
   Mesin hitung : assets/rob.js     Parameter : assets/rob-config.json
   ===================================================================== */
let robEngine = null, robCfg = null;

function robSetText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

async function initRob() {
  robCfg = await loadRobConfig();
  robEngine = createRobEngine(robCfg);
  const tag = document.getElementById("robCalTag");
  if (tag) {
    const ready = parametersReady(robCfg);
    tag.textContent = !ready ? "BELUM DIKALIBRASI" : robCfg.terkalibrasi ? "TERKALIBRASI" : "PARAMETER CONTOH · BELUM DIKALIBRASI";
    tag.className = "tag " + (robCfg.terkalibrasi && ready ? "ok" : "warning");
  }
}

function feedRob(r) {
  if (!robEngine) return;
  const res = robEngine.push(new Date(r.timestamp).getTime(), r.distance_cm);
  if (res) renderRob(res);
}

function renderRob(res) {
  const active = res.status === "NORMAL" || res.status === "WASPADA" || res.status === "SIAGA" ? res.level : -1;
  document.querySelectorAll(".rob-level").forEach(el => el.classList.toggle("active", Number(el.dataset.level) === active));
  robSetText("robZ", res.z == null ? "-- m" : res.z.toFixed(2) + " m");
  robSetText("robMargin", res.margin == null ? "-- cm" : (res.margin * 100).toFixed(0) + " cm" + (res.margin < 0 ? " (di atas ambang)" : ""));
  robSetText("robRate", res.rate == null ? "-- m/jam" : (res.rate >= 0 ? "▲ " : "▼ ") + Math.abs(res.rate).toFixed(2) + " m/jam");
  robSetText("robQuality", res.validCount + "/" + res.total + " sampel valid");
  let note;
  if (res.status === "BELUM DIKALIBRASI") note = "Parameter acuan dan ambang belum lengkap di assets/rob-config.json, sehingga status belum dapat ditentukan.";
  else if (!res.ok) note = "Data tidak valid: " + res.reason + ". Status terakhir ditahan dan laju tidak dihitung.";
  else {
    const c = robCfg;
    note = "Status " + res.status + " · ambang waspada ≤ " + (c.marginWaspadaM * 100).toFixed(0) + " cm, siaga ≤ " + (c.marginSiagaM * 100).toFixed(0) +
      " cm dari ambang lokal." + (res.pendingUp ? " Menunggu konfirmasi naik status (" + res.pendingUp + "/" + c.nNaik + ")." : "") +
      (res.pendingDown ? " Menunggu konfirmasi turun status (" + res.pendingDown + "/" + c.nTurun + ")." : "");
  }
  robSetText("robNote", note);
}

function setScenario(target) {
  scenarioTarget = target;
  document.getElementById("robRise")?.classList.toggle("on", target > 0);
  document.getElementById("robFall")?.classList.toggle("on", target === 0);
}
document.getElementById("robRise")?.addEventListener("click", () => setScenario(18));
document.getElementById("robFall")?.addEventListener("click", () => setScenario(0));
/* ===================== AKHIR BAGIAN ROB ===================== */

const AVATARS = [
  { id: "gelombang", name: "Gelombang", svg: "<svg class=\"av\" viewBox=\"0 0 100 100\" role=\"img\" aria-label=\"Gelombang\"><rect width=\"100\" height=\"100\" fill=\"#0d3041\"/><circle class=\"a-bob\" cx=\"72\" cy=\"28\" r=\"9\" fill=\"#C9A96E\"/><g class=\"a-wave\"><path d=\"M-100 60q25-12 50 0t50 0 50 0 50 0V100h-200z\" fill=\"#53c7ce\" opacity=\".55\"/></g><g class=\"a-wave2\"><path d=\"M-100 70q25-12 50 0t50 0 50 0 50 0V100h-200z\" fill=\"#159eae\"/></g></svg>" },
  { id: "nova", name: "Nova", svg: "<svg class=\"av\" viewBox=\"0 0 100 100\" role=\"img\" aria-label=\"Nova\"><rect width=\"100\" height=\"100\" fill=\"#071d2b\"/><circle class=\"a-b1\" cx=\"22\" cy=\"26\" r=\"2\" fill=\"#f4f8f9\"/><circle class=\"a-b2\" cx=\"78\" cy=\"72\" r=\"2\" fill=\"#f4f8f9\"/><circle class=\"a-b1\" style=\"animation-delay:1s\" cx=\"80\" cy=\"22\" r=\"1.5\" fill=\"#53c7ce\"/><circle class=\"a-b2\" cx=\"24\" cy=\"76\" r=\"1.5\" fill=\"#53c7ce\"/><g class=\"a-twk\"><path d=\"M50 16l7 27 27 7-27 7-7 27-7-27-27-7 27-7z\" fill=\"#C9A96E\"/></g></svg>" },
  { id: "ubur", name: "Ubur-ubur", svg: "<svg class=\"av\" viewBox=\"0 0 100 100\" role=\"img\" aria-label=\"Ubur-ubur\"><rect width=\"100\" height=\"100\" fill=\"#12344a\"/><g class=\"a-bob\"><g class=\"a-bell\"><path d=\"M27 52a23 23 0 0 1 46 0z\" fill=\"#53c7ce\"/><circle cx=\"42\" cy=\"40\" r=\"3\" fill=\"#fff\" opacity=\".5\"/></g><g fill=\"none\" stroke=\"#a8e6e2\" stroke-width=\"3\" stroke-linecap=\"round\"><path class=\"a-tent\" d=\"M35 55q-5 10 0 20\"/><path class=\"a-tent\" style=\"animation-delay:.3s\" d=\"M45 55q5 10 0 24\"/><path class=\"a-tent\" style=\"animation-delay:.6s\" d=\"M55 55q-5 10 0 24\"/><path class=\"a-tent\" style=\"animation-delay:.9s\" d=\"M65 55q5 10 0 20\"/></g></g></svg>" },
  { id: "paus", name: "Paus", svg: "<svg class=\"av\" viewBox=\"0 0 100 100\" role=\"img\" aria-label=\"Paus\"><rect width=\"100\" height=\"100\" fill=\"#0d3041\"/><g class=\"a-spout\"><path d=\"M45 36V22M39 28l6-6 6 6\" stroke=\"#f4f8f9\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/></g><g class=\"a-bob\"><ellipse cx=\"46\" cy=\"58\" rx=\"30\" ry=\"18\" fill=\"#53c7ce\"/><path d=\"M72 56l17-15v32z\" fill=\"#53c7ce\"/><path d=\"M20 64q26 14 54 0\" stroke=\"#a8e6e2\" stroke-width=\"3\" fill=\"none\" stroke-linecap=\"round\"/><circle cx=\"31\" cy=\"54\" r=\"2.5\" fill=\"#071d2b\"/></g><path d=\"M0 80q12-8 25 0t25 0 25 0 25 0V100H0z\" fill=\"#159eae\"/></svg>" },
  { id: "sonar", name: "Sonar", svg: "<svg class=\"av\" viewBox=\"0 0 100 100\" role=\"img\" aria-label=\"Sonar\"><rect width=\"100\" height=\"100\" fill=\"#071d2b\"/><circle class=\"a-ping\" cx=\"50\" cy=\"50\" r=\"7\" fill=\"none\" stroke=\"#53c7ce\" stroke-width=\"2\"/><circle class=\"a-ping\" style=\"animation-delay:1s\" cx=\"50\" cy=\"50\" r=\"7\" fill=\"none\" stroke=\"#53c7ce\" stroke-width=\"2\"/><circle class=\"a-ping\" style=\"animation-delay:2s\" cx=\"50\" cy=\"50\" r=\"7\" fill=\"none\" stroke=\"#53c7ce\" stroke-width=\"2\"/><circle cx=\"50\" cy=\"50\" r=\"7\" fill=\"#C9A96E\"/></svg>" },
  { id: "mercusuar", name: "Mercusuar", svg: "<svg class=\"av\" viewBox=\"0 0 100 100\" role=\"img\" aria-label=\"Mercusuar\"><rect width=\"100\" height=\"100\" fill=\"#0d3041\"/><path class=\"a-b1\" d=\"M50 34L100 20V46z\" fill=\"#C9A96E\" opacity=\".4\"/><path class=\"a-b2\" d=\"M50 34L0 20V46z\" fill=\"#C9A96E\" opacity=\".4\"/><path d=\"M42 86l4-44h8l4 44z\" fill=\"#f4f8f9\"/><path d=\"M44.5 62h11l.8 9H43.7z\" fill=\"#d6453d\"/><rect x=\"45\" y=\"32\" width=\"10\" height=\"10\" rx=\"2\" fill=\"#C9A96E\"/><path d=\"M43 33l7-9 7 9z\" fill=\"#53c7ce\"/><path d=\"M0 84q12-6 25 0t25 0 25 0 25 0V100H0z\" fill=\"#159eae\"/></svg>" },
  { id: "ikan", name: "Ikan", svg: "<svg class=\"av\" viewBox=\"0 0 100 100\" role=\"img\" aria-label=\"Ikan\"><rect width=\"100\" height=\"100\" fill=\"#12344a\"/><circle class=\"a-rise\" cx=\"70\" cy=\"62\" r=\"2.5\" fill=\"#fff\" opacity=\".6\"/><circle class=\"a-rise\" style=\"animation-delay:1.2s\" cx=\"62\" cy=\"70\" r=\"2\" fill=\"#fff\" opacity=\".6\"/><g class=\"a-swim\"><ellipse cx=\"46\" cy=\"50\" rx=\"21\" ry=\"13\" fill=\"#C9A96E\"/><path class=\"a-tail\" d=\"M64 50l17-13v26z\" fill=\"#C9A96E\"/><path d=\"M40 38q6-8 14 0z\" fill=\"#b39358\"/><circle cx=\"35\" cy=\"47\" r=\"2.6\" fill=\"#071d2b\"/></g></svg>" }
];
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};
const avatarKey = u => "tsense:avatar:" + (u && u.uid ? u.uid : "anon");
const avatarSvg = id => (AVATARS.find(x => x.id === id) || AVATARS[0]).svg;
let currentUser = null, currentAvatar = AVATARS[0].id;

/* =====================================================================
   NAVIGASI HALAMAN (sidebar) dan PROFIL AKUN
   ===================================================================== */
const PAGES = ["overview", "gnss", "water", "tide", "risk", "diagnostics", "data", "profile"];
function showPage(name, push = true) {
  if (!PAGES.includes(name)) name = "overview";
  document.querySelectorAll("[data-page]").forEach(el => el.classList.toggle("hidden", el.dataset.page !== name));
  document.querySelectorAll(".nav-item[data-view]").forEach(n => n.classList.toggle("active", n.dataset.view === name));
  if (push && location.hash !== "#" + name) history.pushState(null, "", "#" + name);
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    if (name === "water") drawChart();
    if (name === "tide") drawTideChart();
    if (name === "gnss") { initMap(); if (map) map.invalidateSize(); }
  });
}
document.querySelectorAll(".nav-item[data-view]").forEach(n => n.addEventListener("click", e => { e.preventDefault(); showPage(n.dataset.view); }));
window.addEventListener("popstate", () => showPage(location.hash.slice(1), false));
document.getElementById("profileChip")?.addEventListener("click", () => showPage("profile"));

function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function applyAvatar(id) {
  currentAvatar = id;
  const svg = avatarSvg(id);
  ["chipAvatar", "profAvatar"].forEach(t => { const el = document.getElementById(t); if (el) el.innerHTML = svg; });
  document.querySelectorAll(".avatar-opt").forEach(b => b.setAttribute("aria-checked", String(b.dataset.av === id)));
}
function applyProfile(user) {
  currentUser = user;
  const name = (user.displayName || (user.email || "").split("@")[0] || "Operator").trim();
  const first = name.split(/\s+/)[0];
  setText("userName", first); setText("chipName", first); setText("profName", name); setText("profEmail", user.email || "");
  setText("profVerified", user.emailVerified ? "EMAIL TERVERIFIKASI" : "EMAIL BELUM TERVERIFIKASI");
  const input = document.getElementById("profNameInput"); if (input) input.value = name;
  const grid = document.getElementById("avatarGrid");
  if (grid) grid.innerHTML = AVATARS.map(a => '<button type="button" class="avatar-opt" role="radio" aria-checked="false" data-av="' + a.id + '"><span class="av-wrap">' + a.svg + '</span>' + a.name + '</button>').join("");
  applyAvatar(store.get(avatarKey(user)) || AVATARS[0].id);
}
document.getElementById("avatarGrid")?.addEventListener("click", e => {
  const b = e.target.closest(".avatar-opt");
  if (!b || !currentUser) return;
  store.set(avatarKey(currentUser), b.dataset.av);
  applyAvatar(b.dataset.av);
});
function profMessage(text, type) { const el = document.getElementById("profMsg"); if (el) { el.textContent = text; el.className = "message " + type; } }
document.getElementById("profileForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const u = auth && auth.currentUser; if (!u) return;
  const name = document.getElementById("profNameInput").value.trim();
  if (!name) return profMessage("Nama tidak boleh kosong.", "error");
  try { await updateProfile(u, { displayName: name }); applyProfile(u); profMessage("Nama berhasil disimpan.", "success"); }
  catch (err) { profMessage(friendlyError(err), "error"); }
});
document.getElementById("profReset")?.addEventListener("click", async () => {
  const u = auth && auth.currentUser; if (!u || !u.email) return;
  try { await sendPasswordResetEmail(auth, u.email); profMessage("Tautan ganti password dikirim ke " + u.email + ".", "success"); }
  catch (err) { profMessage(friendlyError(err), "error"); }
});
document.getElementById("profLogout")?.addEventListener("click", () => { if (auth) signOut(auth); });
/* ===================== AKHIR BAGIAN NAVIGASI & PROFIL ===================== */

function tickClock() {
  const el = document.getElementById("clock");
  if (el) el.textContent = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
}
function startDashboard() {
  if(timer) return;
  tickClock();
  addSample();
  showPage(location.hash.slice(1), false);
  timer = setInterval(() => { tickClock(); if (!paused) addSample(); }, 1000);
  if (!robEngine) initRob();
  // Muat referensi pasut BIG sekali saja, memakai posisi GNSS terakhir (simulasi)
  if (!tideLoaded) {
    const last = records[records.length - 1];
    loadTideReference(last ? last.latitude : -2.99, last ? last.longitude : 104.76);
  } else {
    drawTideChart();
  }
}
function stopDashboard(){if(timer){clearInterval(timer);timer=null;}}
document.getElementById("pauseSimulation").addEventListener("click", e=>{paused=!paused;e.currentTarget.textContent=paused?"▶ Lanjutkan simulasi":"Ⅱ Jeda simulasi";});
document.getElementById("resetSimulation").addEventListener("click",()=>{records=[];scenarioOffset=0;setScenario(0);if(robEngine)robEngine.reset();addSample();});
document.querySelectorAll(".period").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".period").forEach(x=>x.classList.remove("active"));b.classList.add("active");period=b.dataset.period;drawChart();}));
window.addEventListener("resize",()=>{if(!dashboard.classList.contains("hidden")){drawChart();drawTideChart();if(map)map.invalidateSize();}});
function download(name, content, type) {
  const blob=new Blob([content],{type}), url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}
document.querySelectorAll("[data-export]").forEach(b=>b.addEventListener("click",()=>{
  if(!records.length)return alert("Belum ada data untuk diunduh.");
  const format=b.dataset.export;
  if(format==="csv"){
    const rows=[["timestamp","waktu_wib","distance_cm","latitude","longitude","source"],...records.map(r=>[r.timestamp,r.localTime,r.distance_cm,r.latitude,r.longitude,r.source])];
    download("tsense-data-simulasi.csv",rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n"),"text/csv;charset=utf-8");
  } else if(format==="txt") download("tsense-data-simulasi.txt",records.map(r=>`${r.localTime} | Jarak: ${r.distance_cm} cm | Lat: ${r.latitude} | Lon: ${r.longitude} | ${r.source}`).join("\n"),"text/plain;charset=utf-8");
  else download("tsense-data-simulasi.geojson",JSON.stringify({type:"FeatureCollection",features:records.map(r=>({type:"Feature",geometry:{type:"Point",coordinates:[r.longitude,r.latitude]},properties:{timestamp:r.timestamp,distance_cm:r.distance_cm,source:r.source}}))},null,2),"application/geo+json");
}));