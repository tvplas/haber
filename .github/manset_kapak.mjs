// 2026-11-21 kullanıcı: "görseldeki bu bölüm olduğu gibi eksiksiz Facebook paylaşımında çıksın, düğme herkese açık olsun".
// 2026-11-22 kullanıcı: "manşet kapağının sadece bu kısmı Facebook'ta çıksın": yalnızca manşet kartı (#manset: fotoğraf,
// başlık, oklar ve sayfa numaraları) çekilir; logo, yayın akışı, hava, döviz ve eczane kapağa girmez.
// 2026-11-22 kullanıcı: "tüm menülerdeki haber görsellerinde paylaş denildiğinde Facebook'ta manşet kapakları gibi çıksın":
// manşetlerden sonra bütün menülerin haberleri de (reklamlar ve Facebook Sayfası paylaşımları hariç) manşet kartında
// gösterilip çekilir; bu kapaklarda sayfa numaraları gizlenir. Bir çalışmada en çok SINIR yeni kapak çekilir, kalanlar sonraki çalışmada.
// Portal (tvplas.html?kapakcek=1) gerçek bir tarayıcıda açılır; her haberin kartı çekilir ve 1200x630 Facebook kapağı yapılır.
// Kapaklar "manset-kapak" dalına (tek commit, depo büyümez), her haberin paylaşım sayfası m/<kimlik>.html ana dala yazılır.
// Kullanım: node manset_kapak.mjs <kapak dizini> <sayfa dizini>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const SITE = "https://tvplas.github.io/haber/";
const HAM = "https://raw.githubusercontent.com/tvplas/haber/manset-kapak/";
const [, , KAPAK = "kapak", SAYFA = "m"] = process.argv;
const SAKLA = 7 * 864e5;   // kapaklar 7 gün saklanır
const SINIR = 150;         // bir çalışmada en çok bu kadar yeni kapak (manşetler her zaman önce)

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

const ozet = h => ({ k: kimlik(h), b: h.b, o: String(h.o || "").replace(/\s+/g, " ").slice(0, 220) });
const mansetListe = await sayfa.evaluate("mansetler.map(" + ozet + ")");
// Manşette olmayan bütün haberler, en yeniden eskiye (aynı haber iki menüdeyse bir kez)
const digerListe = await sayfa.evaluate("(() => { const goruldu = new Set(mansetler.map(kimlik));" +
  " return haberler.filter(h => h.kat && !h.fb && h.b).sort((x, y) => (y.t || '').localeCompare(x.t || ''))" +
  ".filter(h => { const k = kimlik(h); if (goruldu.has(k)) return false; goruldu.add(k); return true; })" +
  ".map(" + ozet + "); })()");
const liste = [...mansetListe.map((h, i) => ({ ...h, n: i })), ...digerListe];
console.log("manşet:", mansetListe.length, "· diğer haber:", digerListe.length);

const birlestir = await tarayici.newPage({ viewport: { width: 1200, height: 630 } });
let yeni = 0, mansetKurulu = true;
for (const h of liste) {
  if (kayit[h.k] && fs.existsSync(path.join(KAPAK, h.k + ".jpg"))) continue;   // bu haberin kapağı zaten var
  if (yeni >= SINIR) { console.log("sınır doldu, kalanlar sonraki çalışmada"); break; }
  if (h.n !== undefined) {
    if (!mansetKurulu) { await sayfa.evaluate(() => { mansetSayfalar.style.display = ""; mansetCiz(true); }); mansetKurulu = true; }
    await sayfa.evaluate(n => { mansetGoster(n); window.scrollTo(0, 0); }, h.n);
  } else {
    // Menü haberi: manşet kartında tek başına gösterilir (sayfa numaraları gizli)
    const var_ = await sayfa.evaluate(k => {
      const x = haberler.find(y => kimlik(y) === k);
      if (!x) return false;
      const kare = mansetKareYap(x, 0);
      kare.classList.add("aktif"); kare.inert = false;
      mansetSahne.replaceChildren(kare);
      mansetSayfalar.style.display = "none";
      mansetSigdir(); window.scrollTo(0, 0);
      return true;
    }, h.k);
    mansetKurulu = false;
    if (!var_) continue;
  }
  await sayfa.waitForFunction(() => {
    const im = document.querySelector(".manset-kare.aktif img.mg-foto");
    return !im || !im.isConnected || (im.complete && im.naturalWidth > 0);
  }, null, { timeout: 30000 }).catch(() => { });
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
// 2026-11-22 kullanıcı: "gazetelerin altına Facebook için paylaş düğmesi ekle": günün her gazetesi için de 1200x630 kapak
// (gazetenin birinci sayfasının üst kısmı ortada, kenarlar aynı sayfanın bulanık hâli) ve m/gz-<kimlik>.html paylaşım sayfası
// yazılır. Liste Apps Script'ten gelir (?islem=gazeteler; kaynak bugunkibris.com); kimlik o günkü sayfanın dosya adıdır.
const GAZETE_API = "https://script.google.com/macros/s/AKfycbxB5rIkSgfjGzjRGLnAyvz72DFYdCCpEc2PtzZo5xxS65w5SrEeNZltzILxQG7FUetUIg/exec?islem=gazeteler";
let gzVeri = { gazeteler: [] };
try { gzVeri = await (await fetch(GAZETE_API)).json(); } catch (e) { console.log("gazete listesi alınamadı:", e.message); }
const gzTarih = (() => { const [g, a, y] = String(gzVeri.tarih || "").split("-").map(Number); return y ? new Date(y, a - 1, g).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) : ""; })();
for (const g of gzVeri.gazeteler || []) {
  const k = "gz-" + String(g.id || "").replace(/[^\w-]/g, ""), resim = g.buyuk || g.g;
  if (k === "gz-" || !resim) continue;
  // kapak zaten varsa yeniden çekilmez, yalnızca paylaşım sayfası yeniden yazılır (hedef adresi değişirse eski sayfalar da güncellensin)
  const kapakVar = kayit[k] && fs.existsSync(path.join(KAPAK, k + ".jpg"));
  if (!kapakVar) try {
    await birlestir.setContent(`<body style="margin:0;width:1200px;height:630px;overflow:hidden;background:#0a0d14;position:relative">
    <img src="${kacis(resim)}" referrerpolicy="no-referrer" style="position:absolute;inset:-40px;width:1280px;height:710px;object-fit:cover;filter:blur(28px) brightness(.5)">
    <img src="${kacis(resim)}" referrerpolicy="no-referrer" style="position:absolute;left:50%;top:0;width:560px;height:630px;object-fit:cover;object-position:top;transform:translateX(-50%);box-shadow:0 0 40px rgba(0,0,0,.7)">
  </body>`, { waitUntil: "load", timeout: 60000 });
    await birlestir.screenshot({ path: path.join(KAPAK, k + ".jpg"), type: "jpeg", quality: 88 });
  } catch (e) { console.log("gazete kapağı çekilemedi:", g.ad, e.message); continue; }
  const b = g.ad + " gazetesi" + (gzTarih ? " · " + gzTarih : "") + " birinci sayfası";
  const o = (g.basliklar || []).slice(0, 4).join(" · ").slice(0, 220);
  const adres = SITE + "m/" + k + ".html?v=" + SURUM, hedef = "../tvplas.html?b=Gazeteler&gz=" + k.slice(3);   // 2026-11-22: tıklayan okur gazetenin kartını (büyük sayfa) görür
  fs.writeFileSync(path.join(SAYFA, k + ".html"), `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${kacis(b)} – TVPLAS</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="TVPLAS">
<meta property="og:title" content="${kacis(b)}">
<meta property="og:description" content="${kacis(o)}">
<meta property="og:url" content="${adres}">
<meta property="og:image" content="${HAM}${k}.jpg?v=${SURUM}">
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
  if (!kapakVar) { kayit[k] = Date.now(); yeni++; console.log("gazete kapağı:", k, g.ad); }
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
