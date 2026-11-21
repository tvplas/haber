// 2026-11-21 kullanıcı: "görseldeki bu bölüm olduğu gibi eksiksiz Facebook paylaşımında çıksın, düğme herkese açık olsun".
// 2026-11-22 kullanıcı: "manşet kapağının sadece bu kısmı Facebook'ta çıksın": yalnızca manşet kartı (#manset: fotoğraf,
// başlık, oklar ve sayfa numaraları) çekilir; logo, yayın akışı, hava, döviz ve eczane kapağa girmez.
// Portal (tvplas.html?kapakcek=1) gerçek bir tarayıcıda açılır; her manşetin kartı çekilir ve 1200x630 Facebook kapağı yapılır.
// Kapaklar "manset-kapak" dalına (tek commit, depo büyümez), her haberin paylaşım sayfası m/<kimlik>.html ana dala yazılır.
// Kullanım: node manset_kapak.mjs <kapak dizini> <sayfa dizini>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const SITE = "https://tvplas.github.io/haber/";
const HAM = "https://raw.githubusercontent.com/tvplas/haber/manset-kapak/";
const [, , KAPAK = "kapak", SAYFA = "m"] = process.argv;
const SAKLA = 7 * 864e5;   // kapaklar 7 gün saklanır

fs.mkdirSync(KAPAK, { recursive: true });
fs.mkdirSync(SAYFA, { recursive: true });
const kayitYolu = path.join(KAPAK, "kayit.json");
let kayit = {};
try { kayit = JSON.parse(fs.readFileSync(kayitYolu, "utf8")); } catch (e) { }
const SURUM = 8; if (kayit.surum !== SURUM) kayit = { surum: SURUM };   // çekim biçimi değişince bütün kapaklar yeniden çekilir
const kacis = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const tarayici = await chromium.launch();
const sayfa = await tarayici.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2, locale: "tr-TR", timezoneId: "Asia/Famagusta" });
await sayfa.goto(SITE + "tvplas.html?kapakcek=1", { waitUntil: "load", timeout: 120000 });
await sayfa.waitForFunction(() => typeof mansetler !== "undefined" && mansetler.length > 0, null, { timeout: 120000 });
await sayfa.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
await sayfa.evaluate(() => document.fonts.ready);
await sayfa.waitForTimeout(5000);   // hava, döviz, eczane ve yayın akışı dolsun

const liste = await sayfa.evaluate(() => mansetler.map(h => ({ k: kimlik(h), b: h.b, o: String(h.o || "").replace(/\s+/g, " ").slice(0, 220) })));
const birlestir = await tarayici.newPage({ viewport: { width: 1200, height: 630 } });
let yeni = 0;
for (let i = 0; i < liste.length; i++) {
  const h = liste[i];
  if (kayit[h.k] && fs.existsSync(path.join(KAPAK, h.k + ".jpg"))) continue;   // bu haberin kapağı zaten var
  await sayfa.evaluate(n => { mansetGoster(n); window.scrollTo(0, 0); }, i);
  await sayfa.waitForFunction(n => {
    const im = document.querySelectorAll(".manset-kare")[n]?.querySelector("img.mg-foto");
    return !im || !im.isConnected || (im.complete && im.naturalWidth > 0);
  }, i, { timeout: 30000 }).catch(() => { });
  await sayfa.waitForTimeout(700);
  const kes = await sayfa.evaluate(() => { const r = document.getElementById("manset").getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.left + scrollX)), y: Math.max(0, Math.floor(r.top + scrollY)), width: Math.ceil(r.width), height: Math.ceil(r.height) }; });   // yalnızca manşet kartı
  const png = (await sayfa.screenshot({ clip: kes })).toString("base64");
  // Facebook bağlantı görselini 1200x630 gösterir: ekran görüntüsü kesilmeden ortalanır, kenarlar aynı görüntünün bulanık hâliyle dolar
  await birlestir.setContent(`<body style="margin:0;width:1200px;height:630px;overflow:hidden;background:#0a0d14;position:relative">
    <img src="data:image/png;base64,${png}" style="position:absolute;inset:-40px;width:1280px;height:710px;object-fit:cover;filter:blur(28px) brightness(.55)">
    <img id="ana" src="data:image/png;base64,${png}" style="position:absolute;left:50%;top:0;height:630px;transform:translateX(-50%);box-shadow:0 0 40px rgba(0,0,0,.6)">
  </body>`);
  await birlestir.waitForFunction(() => document.getElementById("ana").complete);
  await birlestir.screenshot({ path: path.join(KAPAK, h.k + ".jpg"), type: "jpeg", quality: 88 });
  // 2026-11-22: Facebook bağlantının görselini kendi tarafında uzun süre saklar; kapak biçimi değişince (SURUM) paylaşım adresi ve
  // görsel adresi de değişir (?v=SURUM), Facebook yeni görseli okur. tvplas.html'deki KAPAK_SURUM bununla aynı olmalı.
  const adres = SITE + "m/" + h.k + ".html?v=" + SURUM, hedef = "../tvplas.html?h=" + h.k;
  fs.writeFileSync(path.join(SAYFA, h.k + ".html"), `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${kacis(h.b)} – TVPLAS</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="TVPLAS">
<meta property="og:title" content="${kacis(h.b)}">
<meta property="og:description" content="${kacis(h.o)}">
<meta property="og:url" content="${adres}">
<meta property="og:image" content="${HAM}${h.k}.jpg?v=${SURUM}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script>location.replace("${hedef}");</script>
</head>
<body>
<p style="font:16px sans-serif;text-align:center;margin-top:40px"><a href="${hedef}">TVPLAS açılıyor…</a></p>
</body>
</html>
`);
  kayit[h.k] = Date.now();
  yeni++;
  console.log("kapak:", h.k, h.b);
}
await tarayici.close();

// 7 günden eski kapaklar daldan silinir (paylaşım sayfaları ana dalda kalır)
for (const [k, t] of Object.entries(kayit)) {
  if (k === "surum" || Date.now() - t < SAKLA) continue;
  delete kayit[k];
  fs.rmSync(path.join(KAPAK, k + ".jpg"), { force: true });
}
fs.writeFileSync(kayitYolu, JSON.stringify(kayit));
console.log("yeni kapak:", yeni, "· toplam:", Object.keys(kayit).length);
