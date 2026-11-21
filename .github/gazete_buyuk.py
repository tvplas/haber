# Günün Kıbrıs gazetelerinin birinci sayfalarını büyük boy (≈1114×1700) indirir.
# Kaynak: kibrisgazeteleri.com; sitedeki "İncele" düğmesinin kullandığı /Home/getPhotoCode adresi.
# Çıktı: cikti/ klasöründe gNN.jpg dosyaları ve index.json (gazete adı -> dosya).
# GitHub Actions'ta her gün çalışır (.github/workflows/gazete-buyuk.yml); sonuç "gazete-buyuk" dalına konur.
# 2026-11-21 kullanıcı: "gazete görsellerinin yazıları daha okunaklı olacak"
import base64, html, io, json, os, re, sys, time, urllib.parse, urllib.request
from PIL import Image

SITE = "http://kibrisgazeteleri.com"
CIKTI = sys.argv[1] if len(sys.argv) > 1 else "cikti"
UA = {"User-Agent": "Mozilla/5.0 (TVPLAS gazete arsivi)"}


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
    sonuc, gorulen = [], set()
    for no, ad, gun in liste:
        k = anahtar(ad)
        if k in gorulen:          # aynı adlı ikinci baskı (ör. iki BAĞIMSIZ): ilki alınır
            continue
        veri = urllib.parse.urlencode({"name": f"{no}-{html.unescape(ad)}", "date": gun}).encode()
        yanit = al(SITE + "/Home/getPhotoCode", veri)
        if not yanit:
            print("  alınamadı:", no, ad, flush=True)
            continue
        try:
            resim = Image.open(io.BytesIO(base64.b64decode(yanit.decode().strip().strip('"')))).convert("RGB")
        except Exception as e:
            print("  çözülemedi:", no, ad, e, flush=True)
            continue
        if resim.width > 1200:
            resim = resim.resize((1200, round(resim.height * 1200 / resim.width)), Image.LANCZOS)
        dosya = f"g{int(no):02d}.jpg"
        resim.save(os.path.join(CIKTI, dosya), "JPEG", quality=78, optimize=True, progressive=True)
        gorulen.add(k)
        sonuc.append({"ad": html.unescape(ad), "anahtar": k, "dosya": dosya, "w": resim.width, "h": resim.height})
        print(" ", dosya, resim.width, "x", resim.height, html.unescape(ad), flush=True)
    if not sonuc:
        sys.exit("Hiç gazete indirilemedi")
    with open(os.path.join(CIKTI, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"tarih": tarih, "guncelleme": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "gazeteler": sonuc},
                  f, ensure_ascii=False, indent=1)
    print("Tamam:", len(sonuc), "gazete", flush=True)


main()
