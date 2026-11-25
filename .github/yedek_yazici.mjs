// TVplas yedek yazıcı (2026-11-25 kullanıcı: "haberlerin TVplas formatında yazılmaya devam etmesi için GitHub üzerinde ikinci bir yedek yazıcı kur")
// Asıl yazıcı Hetzner sunucusundadır (/haber/tvplas_tum.json). O durursa (son yazdığı Kıbrıs haberi 90 dakikadan eski ve
// akışta daha yeni haber varsa) bu betik yazılmamış Kıbrıs haberlerini kaynağından okur, GitHub Models ile TVplas Haber
// formatında yeniden yazar ve tvplas_yedek.json'a koyar. Portal bu dosyayı sunucunun yazılarıyla birlikte okur.
// Kullanım: node .github/yedek_yazici.mjs tvplas_yedek.json   (DENEME=1: 2 haber yazar, günlüğe döker, dosyaya yazmaz)
import fs from "node:fs";

const API = "https://script.google.com/macros/s/AKfycbxB5rIkSgfjGzjRGLnAyvz72DFYdCCpEc2PtzZo5xxS65w5SrEeNZltzILxQG7FUetUIg/exec";
const SUNUCU = "https://2-29-142-134.sslip.io/haber/tvplas_tum.json";
const MODELLER = ["openai/gpt-4.1-mini", "openai/gpt-4o-mini"];
const KIBRIS_TUR = new Set(["Haber sitesi", "Arama"]);
const DURMA_DK = 90, TUR_BASINA = 8, SAKLA_GUN = 3, EN_COK = 150;
const DOSYA = process.argv[2] || "tvplas_yedek.json";
const DENEME = !!process.env.DENEME;
const TOKEN = process.env.GITHUB_TOKEN;

// Portaldaki kimlik() ile aynı (tvplas.html)
function kimlik(h) {
  const s = String(h.gl || h.l || ("tv:" + h.b));
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = (Math.imul(x, 33) + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
}

async function getir(url, ms = 20000, secenek = {}) {
  const r = await fetch(url, { ...secenek, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(url + " → " + r.status);
  return r;
}

const ADLAR = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "–", mdash: "—",
  ccedil: "ç", Ccedil: "Ç", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü", acirc: "â", Acirc: "Â", icirc: "î", ucirc: "û" };
const coz = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&([a-z]+);/gi, (m, a) => ADLAR[a] ?? m);
const temizle = s => coz(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const COP = /çerez|cookie|tüm hakları|abone ol|whatsapp|telegram|instagram|facebook'ta|twitter|e-posta adresiniz|yorum yap|reklam|copyright|©|okumaya devam|ilgili haber/i;

// Kaynak sayfadan haberin paragrafları ve fotoğrafı
function sayfaOku(html) {
  html = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, "");
  const foto = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i) || [])[1] || "";
  const pler = alan => [...alan.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => temizle(m[1])).filter(t => t.length >= 40 && !COP.test(t));
  const makaleler = (html.match(/<article[\s\S]*?<\/article>/gi) || []).sort((a, b) => b.length - a.length);
  let p = makaleler.length ? pler(makaleler[0]) : [];
  if (p.join(" ").length < 300) p = pler(html);
  const gorulen = new Set();
  p = p.filter(t => !gorulen.has(t) && gorulen.add(t));
  let toplam = 0;
  p = p.filter(t => (toplam += t.length) <= 7000);
  return { p, foto: coz(foto) };
}

async function kaynakMetni(h) {
  let p = [], foto = "";
  try {
    const html = await (await getir(h.l, 20000, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept-Language": "tr-TR,tr;q=0.9" } })).text();
    ({ p, foto } = sayfaOku(html));
  } catch (e) { console.log("  kaynak okunamadı:", e.message); }
  if (p.join(" ").length < 300) {
    try {
      const o = await (await getir(API + "?islem=ozet&u=" + encodeURIComponent(h.l), 30000)).json();
      const q = (o.paragraflar || []).map(s => String(s).trim()).filter(Boolean);
      if (q.join(" ").length > p.join(" ").length) p = q;
      foto = foto || o.g || "";
    } catch (e) { console.log("  özet alınamadı:", e.message); }
  }
  if (p.join(" ").length < (h.o || "").length) p = [h.o];
  return { metin: p.join("\n\n"), foto };
}

const SISTEM = `Sen TVplas Haber'in editörüsün. Sana verilen kaynak haberi TVplas Haber formatında, Türkçe olarak yeniden yazarsın.
Kurallar:
- Olguları değiştirme: kişi adları, unvanlar, kurumlar, sayılar, tarihler, yerler ve alıntılar kaynaktaki gibi kalır.
- Kaynakta olmayan hiçbir bilgi, tahmin ya da yorum ekleme.
- Kaynak haber sitesinin, gazetenin ya da muhabirin adını yazma; "habere göre", "sitemize konuşan" gibi ifadeler kullanma.
- Metni kopyalama, kendi cümlelerinle yeniden yaz. Doğrudan alıntılar tırnak içinde aynen kalabilir.
- Başlık (b): en çok 100 karakter, normal yazımla (tamamı büyük harf değil), tıklama tuzağı olmadan.
- Spot (s): haberin özünü veren 1-2 cümle.
- Paragraflar (p): haberin bütün ayrıntılarını veren 3-6 paragraf; kaynaktaki önemli ayrıntıların hiçbirini atlama.
- Neden önemli? (n): haberin okur için önemini anlatan 2-3 kısa madde.
Yalnızca şu biçimde JSON ver: {"b":"...","s":"...","p":["..."],"n":["..."]}`;

class SinirAsildi extends Error {}

async function yaz(h, metin) {
  const kullanici = "Başlık: " + h.b + "\nTarih: " + h.t + "\n\nHaber metni:\n" + metin;
  let son;
  for (const model of MODELLER) {
    const r = await fetch("https://models.github.ai/inference/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(90000),
      headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ model, temperature: 0.3, response_format: { type: "json_object" },
        messages: [{ role: "system", content: SISTEM }, { role: "user", content: kullanici }] })
    });
    const govde = await r.text();
    if (r.status === 429) { son = new SinirAsildi(model + " sınırı: " + govde.slice(0, 200)); continue; }
    if (!r.ok) { son = new Error(model + " → " + r.status + " " + govde.slice(0, 300)); continue; }
    const icerik = JSON.parse(govde).choices?.[0]?.message?.content || "";
    const x = JSON.parse(icerik.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const p = (x.p || []).map(s => String(s).trim()).filter(Boolean), n = (x.n || []).map(s => String(s).trim()).filter(Boolean);
    if (!x.b || !x.s || !p.length) { son = new Error(model + ": eksik yanıt"); continue; }
    return { b: String(x.b).trim(), s: String(x.s).trim(), p, n, model };
  }
  throw son;
}

async function main() {
  if (!TOKEN) throw new Error("GITHUB_TOKEN yok");
  const simdi = Date.now();
  const eski = fs.existsSync(DOSYA) ? JSON.parse(fs.readFileSync(DOSYA, "utf8")) : { haberler: [] };
  const veri = await (await getir(API + "?ziyaret=0", 60000)).json();
  const ham = (veri.haberler || []).filter(h => KIBRIS_TUR.has(h.tur) && /^https?:/i.test(h.l || "")).sort((a, b) => (b.t || "").localeCompare(a.t || ""));
  let sunucu = [];
  try { sunucu = (await (await getir(SUNUCU)).json()).haberler || []; } catch (e) { console.log("sunucu okunamadı:", e.message); }
  const sunucuKapsar = new Set(sunucu.flatMap(x => x.u || []));
  const sonSunucu = sunucu.filter(x => x.kat === "Kıbrıs").map(x => x.t || "").sort().pop() || "";
  const esik = new Date(simdi - DURMA_DK * 60000).toISOString();
  const durdu = !sonSunucu || (sonSunucu < esik && ham.some(h => (h.t || "") > sonSunucu));
  console.log("sunucunun son Kıbrıs yazısı:", sonSunucu || "yok", "· akışın en yenisi:", ham[0]?.t, "· sunucu durmuş:", durdu);

  // eskiyen ve sunucunun sonradan yazdığı yedek haberler atılır
  const sinir = new Date(simdi - SAKLA_GUN * 86400000).toISOString();
  let liste = (eski.haberler || []).filter(x => (x.t || "") >= sinir && !(x.u || []).some(k => sunucuKapsar.has(k)));
  const yazilan = new Set(liste.flatMap(x => x.u || []));

  const adaylar = DENEME ? ham.slice(0, 2)
    : !durdu ? []
    : ham.filter(h => (h.t || "") > sonSunucu && !sunucuKapsar.has(kimlik(h)) && !yazilan.has(kimlik(h))).slice(0, TUR_BASINA);
  console.log("yazılacak:", adaylar.length);

  const yeni = [];
  let model = eski.model || "";
  for (const h of adaylar) {
    console.log("•", h.t, h.b);
    try {
      const { metin, foto } = await kaynakMetni(h);
      const y = await yaz(h, metin);
      model = y.model;
      const g = h.g || foto || "";
      yeni.push({ id: "gh-" + kimlik(h), kat: "Kıbrıs", b: y.b, s: y.s, p: y.p, n: y.n, t: h.t, g, gk: g ? "Fotoğraf: " + h.k : "", u: [kimlik(h)] });
      console.log("  ✓", y.b, "(" + [y.s, ...y.p].join(" ").length + " harf, " + y.model + ")");
    } catch (e) {
      console.log("  ✗", e.message);
      if (e instanceof SinirAsildi) break;
    }
  }
  if (DENEME) { console.log(JSON.stringify(yeni, null, 1)); return; }

  liste = [...yeni, ...liste].sort((a, b) => (b.t || "").localeCompare(a.t || "")).slice(0, EN_COK);
  const onceki = JSON.stringify(eski.haberler || []);
  if (fs.existsSync(DOSYA) && JSON.stringify(liste) === onceki) { console.log("değişiklik yok"); return; }
  fs.writeFileSync(DOSYA, JSON.stringify({ guncel: new Date().toISOString(), model, haberler: liste }, null, 1) + "\n");
  console.log("kaydedildi:", liste.length, "haber");
}

main().catch(e => { console.error(e); process.exit(1); });
