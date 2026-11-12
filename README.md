# T-SENSE by OCEANOVA — Firebase Login Dashboard

Dashboard frontend statis untuk GitHub Pages dengan:
- Login email/password (alamat Gmail boleh digunakan)
- Registrasi akun dan verifikasi email
- Google Sign-In
- Reset password
- Proteksi tampilan dashboard berdasarkan status login
- Preview GNSS, grafik jarak sensor, indikator rob belum dikalibrasi, diagnostics, tabel dan ekspor CSV/TXT/GeoJSON

## A. Konfigurasi Firebase

1. Buka Firebase Console dan pilih project T-SENSE.
2. Authentication → Sign-in method / Sign-in providers:
   - Aktifkan Email/Password.
   - Aktifkan Google dan pilih support email.
3. Authentication → Settings → Authorized domains:
   - Tambahkan `USERNAME.github.io` (tanpa https:// dan tanpa path repository).
   - Tambahkan `localhost` untuk pengujian lokal jika belum ada.
4. Project settings → Your apps → pilih aplikasi Web → SDK setup and configuration → Config.
5. Buka `assets/firebase-config.js` dan ganti semua nilai `PASTE_...` dengan konfigurasi Firebase milikmu.

Contoh bentuk (gunakan nilai dari project milikmu, jangan gunakan contoh literal):
```js
export const firebaseConfig = {
  apiKey: "nilai-dari-firebase",
  authDomain: "project-id.firebaseapp.com",
  projectId: "project-id",
  storageBucket: "nilai-dari-firebase",
  messagingSenderId: "nilai-dari-firebase",
  appId: "nilai-dari-firebase"
};
```

Firebase Web API key bukan password akun. Jangan pernah menaruh password Gmail, service-account private key, atau credential server di website. Atur Security Rules sebelum menyimpan data pengguna/perangkat.

## B. Jalankan lokal

Jangan membuka `index.html` langsung dengan `file://`. Jalankan server lokal, misalnya:
- VS Code: install extension Live Server, klik kanan `index.html` → Open with Live Server.
- Atau di terminal folder proyek jalankan `python -m http.server 5500`, lalu buka `http://localhost:5500`.

Untuk Firebase Authentication, `localhost` harus terdaftar di Authorized domains.

## C. Upload ke GitHub Pages

1. Upload isi folder ini ke root repository GitHub (index.html harus di root).
2. Repository → Settings → Pages.
3. Build and deployment → Deploy from a branch.
4. Branch `main`, folder `/(root)`, lalu Save.
5. Tambahkan domain `USERNAME.github.io` ke Firebase Authorized domains.

## D. Batasan versi ini — penting

- Grafik, GNSS, koordinat, jumlah satelit, dan jarak sensor saat ini adalah **SIMULASI** untuk demonstrasi antarmuka. Bukan data dari ESP32/A01NYUB/NEO-M8N.
- Data rekaman hanya tersimpan sementara di memori browser; refresh halaman menghapusnya.
- Grafik per jam/hari merangkum sampel yang tersedia pada sesi browser, bukan arsip historis sungguhan.
- Ekspor CSV, TXT, GeoJSON tersedia; CSV dapat dibuka dengan Excel.
- Belum ada integrasi ESP32, database cloud, atau penyimpanan historis. Untuk menerima telemetry perangkat diperlukan backend/API atau Firebase Realtime Database/Firestore beserta Authentication dan Security Rules.
- Indikator potensi banjir rob (NORMAL / WASPADA / SIAGA) dihitung oleh `assets/rob.js` dari parameter di `assets/rob-config.json`. Nilai bawaan hanyalah CONTOH untuk simulasi dan bertanda `terkalibrasi: false`. Elevasi acuan sensor, datum, ambang lokal, dan laju cepat wajib dikalibrasi dengan survei serta validasi lapangan sebelum status dipakai untuk keputusan.
- NEO-M8N adalah GNSS standar, bukan receiver RTK centimeter-level.

## E. Jika login gagal

- `auth/unauthorized-domain`: tambahkan domain website pada Authentication → Settings → Authorized domains.
- `auth/operation-not-allowed`: aktifkan provider yang sesuai pada Sign-in method.
- Google popup error: pastikan Google provider aktif dan Support email sudah dipilih.
- Pastikan `firebase-config.js` tidak lagi berisi nilai placeholder.

## F. Fitur versi 3

- **Navigasi sidebar:** satu halaman panjang. Klik menu untuk menggulir ke bagian yang dipilih, dan menu menyorot bagian yang sedang terlihat. Tombol hamburger (tiga garis) melipat sidebar menjadi deretan ikon; pilihan terakhir diingat di browser.
- **Profil akun:** ubah nama tampilan (Firebase Auth), kirim tautan ganti password, dan pilih salah satu dari 7 ikon animasi bertema OCEANOVA. Pilihan ikon disimpan di browser (localStorage) per akun. Untuk menyimpan lintas perangkat diperlukan Firestore dan Security Rules.
- **Logo gambar:** `assets/img/` berisi logo terang, logo gelap, ikon 512, favicon, dan apple-touch-icon. Mengganti gambar cukup menimpa file dengan nama yang sama.
- Untuk menambah ikon avatar baru, tambahkan satu entri di array `AVATARS` pada `assets/app.js` dan animasinya di `assets/style.css`.
