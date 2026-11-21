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
    gri = gri.resize((round(gri.width * 2), round(gri.height * 2)), Image.LANCZOS)   # küçük gövde yazısı için büyütülür
    gri = ImageOps.autocontrast(gri, cutoff=1)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        gri.save(f.name)
        yol = f.name
    try:
        # Her Tesseract tek iş parçacığıyla çalışır: aynı anda 4 sayfa okunurken birbirini yavaşlatmasın
        tsv = subprocess.run(["tesseract", yol, "stdout", "-l", "tur", "--psm", "3", "tsv"],
                             capture_output=True, text=True, timeout=600,
                             env={**os.environ, "OMP_THREAD_LIMIT": "1"}).stdout
    finally:
        os.unlink(yol)
    # 1) Kelimeler Tesseract'ın satırlarına toplanır; satır, sütun arasındaki boşluktan bölünür (Tesseract bazen
    #    yan yana iki sütunun satırını tek satır sayıyor, metin karışıyordu)
    satirlar, sira = {}, []
    for s in tsv.splitlines()[1:]:
        p = s.split("\t")
        if len(p) < 12 or p[0] != "5" or not p[11].strip():
            continue
        k = (int(p[2]), int(p[3]), int(p[4]))   # blok, paragraf, satır
        if k not in satirlar:
            satirlar[k] = []
            sira.append(k)
        satirlar[k].append({"x": int(p[6]), "y": int(p[7]), "w": int(p[8]), "h": int(p[9]), "c": float(p[10]), "t": p[11]})
    parcalar = []
    for k in sira:
        kel = sorted(satirlar[k], key=lambda w: w["x"])
        hs = statistics.median([w["h"] for w in kel])
        grup = [kel[0]]
        for w in kel[1:]:
            onceki = grup[-1]
            if w["x"] - (onceki["x"] + onceki["w"]) > 0.85 * hs:   # normal kelime arası ≈ 0,3 harf boyu
                parcalar.append(grup)
                grup = []
            grup.append(w)
        parcalar.append(grup)
    seg = []
    for g in parcalar:
        metin = temiz_satir(" ".join(w["t"] for w in g))
        harf = len(HARF.findall(metin))
        if len(metin) < 2 or harf < 0.5 * len(metin.replace(" ", "")) or statistics.mean(w["c"] for w in g) < 35:
            continue
        x0, y0 = min(w["x"] for w in g), min(w["y"] for w in g)
        x1, y1 = max(w["x"] + w["w"] for w in g), max(w["y"] + w["h"] for w in g)
        seg.append({"t": metin, "x0": x0, "y0": y0, "x1": x1, "y1": y1, "h": statistics.median(w["h"] for w in g)})
    if not seg:
        return []
    govde = statistics.median(s["h"] for s in seg)
    for s in seg:
        s["bas"] = s["h"] >= 1.45 * govde and len(s["t"]) >= 3

    # 2) Alt alta, aynı hizadaki satırlar "sütun parçası" olur (başlıklar ayrı toplanır)
    def ortusme(a, b):
        return max(0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))

    kosular = []
    for s in sorted(seg, key=lambda s: (s["y0"], s["x0"])):
        en, enfark = None, None
        for k in kosular:
            if k["bas"] != s["bas"]:
                continue
            son = k["s"][-1]
            fark = s["y0"] - son["y1"]
            if s["bas"]:
                uygun = -0.3 * s["h"] <= fark < 0.9 * s["h"] and ortusme(son, s) > 0.3 * min(son["x1"] - son["x0"], s["x1"] - s["x0"])
            else:
                uygun = (-0.3 * govde <= fark < 2.2 * govde and abs(s["x0"] - k["x0"]) < 1.6 * govde
                         and s["x1"] < k["x1"] + 2 * govde)
            if uygun and (enfark is None or fark < enfark):
                en, enfark = k, fark
        if en is None:
            kosular.append({"bas": s["bas"], "s": [s], "x0": s["x0"], "x1": s["x1"]})
        else:
            en["s"].append(s)
            en["x0"], en["x1"] = min(en["x0"], s["x0"]), max(en["x1"], s["x1"])
    for k in kosular:
        k["y0"], k["y1"] = k["s"][0]["y0"], k["s"][-1]["y1"]
        k["h"] = statistics.median(s["h"] for s in k["s"])
    basliklar = [k for k in kosular if k["bas"]]
    govdeler = [k for k in kosular if not k["bas"]]

    # 3) Her sütun parçası, üstündeki ve yatayda örtüşen en yakın başlığın haberine eklenir
    haber = {id(b): {"bas": b, "parca": []} for b in basliklar}
    sahipsiz = []
    for g in govdeler:
        gen = g["x1"] - g["x0"]
        aday = [b for b in basliklar if b["y1"] <= g["y0"] + 0.5 * govde and ortusme(b, g) >= 0.5 * gen]
        if aday:
            haber[id(max(aday, key=lambda b: b["y1"]))]["parca"].append(g)
        else:
            sahipsiz.append(g)

    def birlestir(parcalar):
        # sütunlar soldan sağa, her sütun yukarıdan aşağıya; satır sonu tireleri birleştirilir
        metin = ""
        for p in sorted(parcalar, key=lambda k: (round(k["x0"] / (3 * govde)), k["y0"])):
            for s in p["s"]:
                t = s["t"]
                if metin.endswith("-") and t[:1].islower():
                    metin = metin[:-1] + t
                else:
                    metin = (metin + " " + t).strip()
        return metin

    sonuc = []
    for b in sorted(basliklar, key=lambda b: (b["y0"], b["x0"])):
        h = haber[id(b)]
        bas = " ".join(s["t"] for s in b["s"]).strip()
        metin = birlestir(h["parca"])
        if not metin and len(bas) < 8:
            continue
        sonuc.append({"b": bas, "m": metin, "y": round(b["h"] / govde, 2)})
    for g in sahipsiz:   # başlıksız ama uzun metin parçaları (ör. sürmanşet, köşe yazısı girişi) da kaybolmasın
        metin = birlestir([g])
        if len(metin) >= 120:
            sonuc.append({"b": "", "m": metin, "y": 0})
    print(f"    okuma: {len(seg)} satır, gövde {govde}px, {len(basliklar)} başlık, {len(govdeler)} sütun parçası, "
          f"{len(sahipsiz)} sahipsiz, {len(sonuc)} yazı", flush=True)
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
    deneme = int(os.environ.get("DENEME") or 0)   # elle denemede yalnızca ilk N gazete (sonuç ayrı dala gider)
    if deneme:
        secilen = secilen[:deneme]
    with ThreadPoolExecutor(max_workers=4) as havuz:
        sonuc = [x for x in havuz.map(isle, secilen) if x]
    if not sonuc:
        sys.exit("Hiç gazete indirilemedi")
    with open(os.path.join(CIKTI, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"tarih": tarih, "guncelleme": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "gazeteler": sonuc},
                  f, ensure_ascii=False, indent=1)
    print("Tamam:", len(sonuc), "gazete", flush=True)


main()
