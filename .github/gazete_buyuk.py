# Günün Kıbrıs gazetelerinin birinci sayfalarını büyük boy (≈1114×1700) indirir ve sayfadaki yazıları okur (OCR).
# Kaynak: kibrisgazeteleri.com; sitedeki "İncele" düğmesinin kullandığı /Home/getPhotoCode adresi.
# Çıktı: cikti/ klasöründe gNN.jpg dosyaları ve index.json (gazete adı -> dosya, manşet ve yazılar).
# GitHub Actions'ta her gün çalışır (.github/workflows/gazete-buyuk.yml); sonuç "gazete-buyuk" dalına konur.
# 2026-11-21 kullanıcı: "gazete görsellerinin yazıları daha okunaklı olacak" ve "ön sayfadaki manşet ve bütün yazılar
# aynen, başlıklarıyla gazete görselinin altında yer alacak" -> Tesseract (Türkçe) ile okunur, büyük puntolu satırlar başlık sayılır.
import base64, html, io, json, os, re, statistics, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps

SITE = "http://kibrisgazeteleri.com"
CIKTI = sys.argv[1] if len(sys.argv) > 1 else "cikti"
UA = {"User-Agent": "Mozilla/5.0 (TVPLAS gazete arsivi)"}
HARF = re.compile(r"[A-Za-zÇĞİÖŞÜçğıöşü]")


def al(url, veri=None, sure=90):
    istek = urllib.request.Request(url, data=veri, headers=UA)
    for deneme in range(3):
        try:
            with urllib.request.urlopen(istek, timeout=sure) as y:
                return y.read()
        except Exception as e:
            print("  hata:", e, "| yeniden deneniyor", flush=True)
            time.sleep(5 * (deneme + 1))
    return None


def anahtar(ad):
    # Portalla aynı karşılaştırma: HTML kodları çözülür, Türkçe büyük harf, fazla boşluk yok
    return re.sub(r"\s+", " ", html.unescape(ad)).strip().replace("i", "İ").upper()


def temiz_satir(s):
    s = re.sub(r"\s+", " ", s).strip()
    s = s.replace("|", "").replace("¦", "").strip(" _~")
    return s


def oku(resim):
    """Sayfayı Tesseract ile okur; [{b: başlık, m: metin, y: başlık yüksekliği}] döner (okuma sırasıyla)."""
    gri = ImageOps.grayscale(resim)
    gri = gri.resize((gri.width * 2, gri.height * 2), Image.LANCZOS)   # küçük gövde yazısı için 2 kat büyütülür
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        gri.save(f.name)
        yol = f.name
    try:
        tsv = subprocess.run(["tesseract", yol, "stdout", "-l", "tur", "--psm", "1", "tsv"],
                             capture_output=True, text=True, timeout=600).stdout
    finally:
        os.unlink(yol)
    satirlar, sira = {}, []
    for s in tsv.splitlines()[1:]:
        p = s.split("\t")
        if len(p) < 12 or p[0] != "5" or not p[11].strip():
            continue
        k = (int(p[2]), int(p[3]), int(p[4]))   # blok, paragraf, satır
        if k not in satirlar:
            satirlar[k] = {"k": [], "h": [], "c": [], "blok": int(p[2])}
            sira.append(k)
        satirlar[k]["k"].append(p[11])
        satirlar[k]["h"].append(int(p[9]))
        satirlar[k]["c"].append(float(p[10]))
    liste = []
    for k in sira:
        s = satirlar[k]
        metin = temiz_satir(" ".join(s["k"]))
        harf = len(HARF.findall(metin))
        if len(metin) < 3 or harf < 0.55 * len(metin.replace(" ", "")) or statistics.mean(s["c"]) < 50:
            continue
        liste.append({"t": metin, "h": statistics.median(s["h"]), "blok": s["blok"]})
    if not liste:
        return []
    govde = statistics.median([x["h"] for x in liste])
    yazilar, cur = [], None
    for x in liste:
        baslik = x["h"] >= 1.7 * govde and len(x["t"]) >= 4
        if baslik:
            if cur and not cur["m"] and cur["b"] and abs(cur["y"] - x["h"]) < 0.45 * x["h"]:
                cur["b"].append(x["t"])          # çok satırlı başlık
                continue
            if cur:
                yazilar.append(cur)
            cur = {"b": [x["t"]], "m": [], "y": x["h"]}
        else:
            if cur is None:
                cur = {"b": [], "m": [], "y": 0}
            cur["m"].append(x["t"])
    if cur:
        yazilar.append(cur)
    sonuc = []
    for y in yazilar:
        metin = ""
        for s in y["m"]:   # satır sonundaki tirelerle bölünmüş kelimeler birleştirilir
            if metin.endswith("-") and s[:1].islower():
                metin = metin[:-1] + s
            else:
                metin = (metin + " " + s).strip()
        b = " ".join(y["b"]).strip()
        if not b and len(metin) < 60:
            continue
        if b and not metin and len(b) < 8:
            continue
        sonuc.append({"b": b, "m": metin, "y": round(y["y"] / govde, 2)})
    return sonuc


def isle(oge):
    no, ad, gun = oge
    veri = urllib.parse.urlencode({"name": f"{no}-{html.unescape(ad)}", "date": gun}).encode()
    yanit = al(SITE + "/Home/getPhotoCode", veri)
    if not yanit:
        print("  alınamadı:", no, ad, flush=True)
        return None
    try:
        resim = Image.open(io.BytesIO(base64.b64decode(yanit.decode().strip().strip('"')))).convert("RGB")
    except Exception as e:
        print("  çözülemedi:", no, ad, e, flush=True)
        return None
    if resim.width > 1200:
        resim = resim.resize((1200, round(resim.height * 1200 / resim.width)), Image.LANCZOS)
    dosya = f"g{int(no):02d}.jpg"
    resim.save(os.path.join(CIKTI, dosya), "JPEG", quality=78, optimize=True, progressive=True)
    try:
        yazilar = oku(resim)
    except Exception as e:
        print("  okunamadı:", no, ad, e, flush=True)
        yazilar = []
    # Manşet: en büyük puntolu başlık; geri kalanlar sayfadaki okuma sırasıyla
    if yazilar:
        en = max(range(len(yazilar)), key=lambda i: (yazilar[i]["y"] if yazilar[i]["b"] else 0))
        yazilar.insert(0, yazilar.pop(en))
    print(" ", dosya, resim.width, "x", resim.height, html.unescape(ad), "|", len(yazilar), "yazı", flush=True)
    return {"ad": html.unescape(ad), "anahtar": anahtar(ad), "dosya": dosya, "w": resim.width, "h": resim.height,
            "yazilar": [{"b": y["b"], "m": y["m"]} for y in yazilar]}


def main():
    os.makedirs(CIKTI, exist_ok=True)
    ana = al(SITE + "/")
    if not ana:
        sys.exit("Ana sayfa alınamadı")
    metin = ana.decode("utf-8", "replace")
    # <a data-src="..." data-name="3-ADA NEWS" data-date="21-11-2026" class="main-btn view-btn">
    liste = re.findall(r'data-name="(\d+)-([^"]+)"\s+data-date="(\d\d-\d\d-\d{4})"', metin)
    if not liste:
        sys.exit("Gazete listesi bulunamadı")
    tarih = liste[0][2]
    print(len(liste), "gazete,", tarih, flush=True)
    secilen, gorulen = [], set()
    for no, ad, gun in liste:
        k = anahtar(ad)
        if k in gorulen:          # aynı adlı ikinci baskı (ör. iki BAĞIMSIZ): ilki alınır
            continue
        gorulen.add(k)
        secilen.append((no, ad, gun))
    with ThreadPoolExecutor(max_workers=4) as havuz:
        sonuc = [x for x in havuz.map(isle, secilen) if x]
    if not sonuc:
        sys.exit("Hiç gazete indirilemedi")
    with open(os.path.join(CIKTI, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"tarih": tarih, "guncelleme": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "gazeteler": sonuc},
                  f, ensure_ascii=False, indent=1)
    print("Tamam:", len(sonuc), "gazete", flush=True)


main()
