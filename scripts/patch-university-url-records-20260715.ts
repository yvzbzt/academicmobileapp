import { readFile, writeFile } from "node:fs/promises";

type UnitType = "faculty" | "institute" | "school" | "vocational_school" | "academic_unit" | "department";

interface UniversityPatch {
  universityId: string;
  name: string;
  homepageUrl: string;
  treeHomepageLookup: string;
  facultyUrls: Record<string, string>;
  departmentUrls: Record<string, Record<string, string>>;
}

interface FacultyTreeRecord {
  name: string;
  url: string;
  unitType?: UnitType;
  sourcePageUrl?: string;
  confidence?: number;
  departments?: FacultyTreeRecord[];
  [key: string]: unknown;
}

interface FacultyTreeFile {
  generatedAt: string;
  summary?: Record<string, unknown>;
  universities: Array<{
    name?: string;
    homepageUrl?: string;
    finalHomepageUrl?: string;
    hostname?: string;
    status?: string;
    checkedPageCount?: number;
    facultyCount?: number;
    faculties?: FacultyTreeRecord[];
    errors?: string[];
    cleanup?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
}

interface SeedUniversity {
  name: string;
  slug: string;
  faculties: Array<{
    name: string;
    slug: string;
    departments: Array<{ name: string; slug: string }>;
  }>;
}

interface VerifiedAcademicUnitSource {
  scopeType: "faculty" | "department";
  universityId: string;
  universityName?: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  websiteUrl?: string;
  announcementUrl?: string;
  courseScheduleUrl?: string;
  examScheduleUrl?: string;
}

const treePath = "data/yok-university-faculty-tree.json";
const registryPath = "apps/api/src/bootstrap/verified-academic-unit-sources.json";
const catalogPath = "apps/api/src/bootstrap/turkiye-catalog-seed.json";

const patches: UniversityPatch[] = [
  {
    universityId: "ankara-bilim-universitesi",
    name: "ANKARA BİLİM ÜNİVERSİTESİ",
    homepageUrl: "https://www.ankarabilim.edu.tr/",
    treeHomepageLookup: "ankarabilim.edu.tr",
    facultyUrls: {
      "Güzel Sanatlar ve Tasarım Fakültesi": "https://ankarabilim.edu.tr/guzel-sanatlar-ve-tasarim-fakultesi",
      "Havacılık ve Uzay Bilimleri Fakültesi": "https://ankarabilim.edu.tr/havacilik-ve-uzay-bilimleri-fakultesi",
      "Hukuk Fakültesi": "https://ankarabilim.edu.tr/hukuk-fakultesi",
      "İnsan ve Toplum Bilimleri Fakültesi": "https://ankarabilim.edu.tr/insan-ve-toplum-bilimleri-fakultesi",
      "Mühendislik ve Mimarlık Fakültesi": "https://ankarabilim.edu.tr/muhendislik-ve-mimarlik-fakultesi",
      "Meslek Yüksekokulu": "https://ankarabilim.edu.tr/meslek-yuksekokulu",
      "Hazırlık Okulu": "https://ankarabilim.edu.tr/hazirlik-okulu"
    },
    departmentUrls: {
      "Güzel Sanatlar ve Tasarım Fakültesi": {
        "Film Tasarımı ve Yönetimi": "https://ankarabilim.edu.tr/film-tasarimi-ve-yonetimi",
        "Yeni Medya ve İletişim": "https://ankarabilim.edu.tr/yeni-medya-ve-iletisim-bolumu",
        "İç Mimarlık ve Çevre Tasarımı": "https://ankarabilim.edu.tr/ic-mimarlik-ve-cevre-tasarimi"
      },
      "Havacılık ve Uzay Bilimleri Fakültesi": {
        "Pilotaj": "https://ankarabilim.edu.tr/pilotaj",
        "Uçak Mühendisliği": "https://ankarabilim.edu.tr/ucak-muhendisligi",
        "Havacılık Yönetimi": "https://ankarabilim.edu.tr/havacilik-yonetimi",
        "Hava Trafik Kontrol": "https://ankarabilim.edu.tr/hava-trafik-kontrol/"
      },
      "İnsan ve Toplum Bilimleri Fakültesi": {
        "Psikoloji": "https://ankarabilim.edu.tr/psikoloji",
        "İngilizce Mütercim ve Tercümanlık": "https://ankarabilim.edu.tr/ingilizce-mutercim-tercumanlik-bolumu",
        "İşletme": "https://ankarabilim.edu.tr/isletme",
        "Yönetim Bilişim Sistemleri": "https://ankarabilim.edu.tr/yonetim-bilisim-sistemleri",
        "Siyaset Bilimi ve Kamu Yönetimi": "https://ankarabilim.edu.tr/siyaset-bilimi-ve-kamu-yonetimi"
      },
      "Mühendislik ve Mimarlık Fakültesi": {
        "Bilgisayar Mühendisliği": "https://ankarabilim.edu.tr/bilgisayar-muhendisligi",
        "Bilgisayar Mühendisliği (Türkçe)": "https://ankarabilim.edu.tr/bilgisayar-muhendisligi-turkce",
        "Bilişim Sistemleri Mühendisliği": "https://ankarabilim.edu.tr/bilisim-sistemleri-muhendisligi",
        "Endüstri Mühendisliği": "https://ankarabilim.edu.tr/endustri-muhendisigi",
        "Elektrik-Elektronik Mühendisliği": "https://ankarabilim.edu.tr/elektrik-elektronik-muhendisligi",
        "Yazılım Mühendisliği": "https://ankarabilim.edu.tr/yazilim-muhendisligi"
      },
      "Meslek Yüksekokulu": {
        "Bilgisayar Destekli Tasarım ve Animasyon": "https://ankarabilim.edu.tr/bilgisayar-destekli-tasarim-ve-animasyon",
        "Bilgisayar Programcılığı": "https://ankarabilim.edu.tr/bilgisayar-programciligi",
        "Bilişim Güvenliği Teknolojisi": "https://ankarabilim.edu.tr/bilisim-guvenligi-teknolojisi",
        "Elektronik Teknolojisi": "https://ankarabilim.edu.tr/elektronik-teknolojisi-programi",
        "İnsansız Hava Aracı Teknolojisi ve Operatörlüğü": "https://ankarabilim.edu.tr/insansiz-hava-araci-teknolojisi-ve-operatorlugu",
        "Uçak Teknolojisi": "https://ankarabilim.edu.tr/ucak-teknolojisi-programi",
        "Tıbbi Veri İşleme Teknikerliği": "https://ankarabilim.edu.tr/tibbi-veri-isleme-teknikerligi-programi",
        "Turizm ve Otel İşletmeciliği": "https://ankarabilim.edu.tr/turizm-ve-otel-isletmeciligi-programi",
        "Web Tasarımı ve Kodlama": "https://ankarabilim.edu.tr/web-tasarim-ve-kodlama"
      }
    }
  },
  {
    universityId: "ankara-haci-bayram-veli-universitesi",
    name: "ANKARA HACI BAYRAM VELİ ÜNİVERSİTESİ",
    homepageUrl: "https://hacibayram.edu.tr/",
    treeHomepageLookup: "hacibayram.edu.tr",
    facultyUrls: {
      "Edebiyat Fakültesi": "https://hacibayram.edu.tr/edebiyat",
      "Hukuk Fakültesi": "https://hacibayram.edu.tr/hukuk",
      "İletişim Fakültesi": "https://hacibayram.edu.tr/ilet",
      "Turizm Fakültesi": "https://hacibayram.edu.tr/turizm",
      "Finansal Bilimler Fakültesi": "https://hacibayram.edu.tr/fbf",
      "İktisadi ve İdari Bilimler Fakültesi": "https://hacibayram.edu.tr/iibf",
      "Polatlı Fen-Edebiyat Fakültesi": "https://hacibayram.edu.tr/polatlifef",
      "Güzel Sanatlar Fakültesi": "https://hacibayram.edu.tr/gsf",
      "İlahiyat Fakültesi": "https://hacibayram.edu.tr/ilahiyat",
      "Sanat ve Tasarım Fakültesi": "https://hacibayram.edu.tr/stf"
    },
    departmentUrls: {
      "Edebiyat Fakültesi": {
        "Arkeoloji": "https://hacibayram.edu.tr/arkeoloji",
        "Antropoloji": "https://hacibayram.edu.tr/antropoloji",
        "Batı Dilleri ve Edebiyatları": "https://hacibayram.edu.tr/bati-dilleri",
        "Coğrafya": "https://hacibayram.edu.tr/cografya",
        "Çağdaş Türk Lehçeleri ve Edebiyatları": "https://hacibayram.edu.tr/cagdas-turk",
        "Doğu Dilleri ve Edebiyatları": "https://hacibayram.edu.tr/dogudilleri",
        "Felsefe": "https://hacibayram.edu.tr/felsefe",
        "Mütercim ve Tercümanlık": "https://hacibayram.edu.tr/mtb",
        "Psikoloji": "https://hacibayram.edu.tr/psikoloji",
        "Rus Dili ve Edebiyatı": "https://hacibayram.edu.tr/rus-dili",
        "Sanat Tarihi": "https://hacibayram.edu.tr/sanat-tarihi",
        "Sosyoloji": "https://hacibayram.edu.tr/sosyoloji",
        "Tarih": "https://hacibayram.edu.tr/tarih",
        "Türk Dili ve Edebiyatı": "https://hacibayram.edu.tr/edebiyat-turkdili",
        "Türk Halkbilimi": "https://hacibayram.edu.tr/turk-halk-bilimi"
      },
      "İletişim Fakültesi": {
        "Radyo, Televizyon ve Sinema": "https://hacibayram.edu.tr/rts?lang=tr-TR",
        "Halkla İlişkiler ve Tanıtım": "https://hacibayram.edu.tr/hit?lang=tr-TR",
        "Gazetecilik": "https://hacibayram.edu.tr/gazetecilik?lang=tr-TR"
      },
      "Turizm Fakültesi": {
        "Gastronomi ve Mutfak Sanatları": "https://hacibayram.edu.tr/turizm-gastronomi",
        "Rekreasyon Yönetimi": "https://hacibayram.edu.tr/turizm-rekreasyon",
        "Turizm Rehberliği": "https://hacibayram.edu.tr/turizm-rehberlik",
        "Turizm İşletmeciliği": "https://hacibayram.edu.tr/turizm-isletme",
        "Seyahat İşletmeciliği": "https://hacibayram.edu.tr/seyahat-isletmeciligi?lang=tr-TR"
      },
      "Finansal Bilimler Fakültesi": {
        "Finans ve Bankacılık": "https://hacibayram.edu.tr/fbf/bankacilik-bolumu",
        "Sigortacılık": "https://hacibayram.edu.tr/fbf/sigortacilik-bolumu",
        "Sermaye Piyasası": "https://hacibayram.edu.tr/fbf/sermaye-piyasasi-bolumu"
      },
      "İktisadi ve İdari Bilimler Fakültesi": {
        "Çalışma Ekonomisi ve Endüstri İlişkileri": "https://hacibayram.edu.tr/iibf-ceei",
        "Ekonometri": "https://hacibayram.edu.tr/iibf-ekonometri",
        "İktisat": "https://hacibayram.edu.tr/iibf-iktisat",
        "İşletme": "https://hacibayram.edu.tr/iibf-isletme",
        "Maliye": "https://hacibayram.edu.tr/iibf-maliye",
        "Sağlık Yönetimi": "https://hacibayram.edu.tr/iibf-saglik",
        "Siyaset Bilimi ve Kamu Yönetimi": "https://hacibayram.edu.tr/iibf-kamu",
        "Uluslararası İlişkiler": "https://hacibayram.edu.tr/iibf-uluslar",
        "Uluslararası Ticaret ve Finansman": "https://hacibayram.edu.tr/iibf-utic",
        "Yönetim Bilişim Sistemleri": "https://hacibayram.edu.tr/iibf-ybs"
      },
      "Polatlı Fen-Edebiyat Fakültesi": {
        "Biyoloji": "https://hacibayram.edu.tr/pbiyoloji",
        "Fizik": "https://hacibayram.edu.tr/pfizik",
        "Kimya": "https://hacibayram.edu.tr/pkimya",
        "Matematik": "https://hacibayram.edu.tr/pmatematik",
        "Tarih": "https://hacibayram.edu.tr/ptarih",
        "Türk Dili ve Edebiyatı": "https://hacibayram.edu.tr/pturkdili"
      },
      "Güzel Sanatlar Fakültesi": {
        "Fotoğraf ve Video": "https://hacibayram.edu.tr/gsf-fov",
        "Görsel İletişim Tasarımı": "https://hacibayram.edu.tr/gsf-git",
        "Heykel": "https://hacibayram.edu.tr/gsf-hey",
        "Kültür Varlıklarını Koruma ve Onarım": "https://hacibayram.edu.tr/gsf-kob",
        "Resim": "https://hacibayram.edu.tr/gsf-res",
        "Tiyatro": "https://hacibayram.edu.tr/gsf-tiy"
      },
      "İlahiyat Fakültesi": {
        "Temel İslam Bilimleri": "https://hacibayram.edu.tr/temelislam",
        "Felsefe ve Din Bilimleri": "https://hacibayram.edu.tr/felsefedin",
        "İslam Tarihi ve Sanatları": "https://hacibayram.edu.tr/islamtarihi"
      },
      "Sanat ve Tasarım Fakültesi": {
        "El Sanatları": "https://hacibayram.edu.tr/stf-elsanatlari",
        "Geleneksel Türk Sanatları": "https://hacibayram.edu.tr/stf-gelenekselturksanatlari",
        "Görsel Sanatlar": "https://hacibayram.edu.tr/stf-gorselsanatlar",
        "Grafik Tasarımı": "https://hacibayram.edu.tr/stf-grafik",
        "Kuyumculuk ve Mücevher Tasarımı": "https://hacibayram.edu.tr/stf-kuyumculuk",
        "Moda Tasarımı": "https://hacibayram.edu.tr/stf-moda",
        "Seramik": "https://hacibayram.edu.tr/stf-seramik",
        "Tekstil Tasarımı": "https://hacibayram.edu.tr/stf-tekstil"
      }
    }
  },
  {
    universityId: "antalya-belek-universitesi",
    name: "ANTALYA BELEK ÜNİVERSİTESİ",
    homepageUrl: "https://www.belek.edu.tr/",
    treeHomepageLookup: "belek.edu.tr",
    facultyUrls: {
      "Sanat ve Tasarım Fakültesi": "https://stf.belek.edu.tr/",
      "İnsani Bilimler Fakültesi": "https://ibf.belek.edu.tr/",
      "İktisadi ve İdari Bilimler Fakültesi": "https://iibf.belek.edu.tr/",
      "Mühendislik-Mimarlık Fakültesi": "https://mmf.belek.edu.tr/",
      "Meslek Yüksekokulu": "https://myo.belek.edu.tr/"
    },
    departmentUrls: {
      "Sanat ve Tasarım Fakültesi": {
        "Gastronomi ve Mutfak Sanatları": "https://stf.belek.edu.tr/Home/Program/10",
        "İletişim ve Tasarımı": "https://stf.belek.edu.tr/Home/Program/14",
        "Radyo, Televizyon ve Sinema": "https://stf.belek.edu.tr/Home/Program/12",
        "İç Mimarlık ve Çevre Tasarımı": "https://stf.belek.edu.tr/Home/Program/15"
      },
      "İnsani Bilimler Fakültesi": {
        "Psikoloji": "https://ibf.belek.edu.tr/Home/Program/26",
        "Sosyoloji": "https://ibf.belek.edu.tr/Home/Program/27"
      },
      "İktisadi ve İdari Bilimler Fakültesi": {
        "Uluslararası Ticaret ve İşletmecilik": "https://iibf.belek.edu.tr/Home/Program/19",
        "Yönetim Bilişim Sistemleri": "https://iibf.belek.edu.tr/Home/Program/21"
      },
      "Mühendislik-Mimarlık Fakültesi": {
        "Yazılım Mühendisliği": "https://mmf.belek.edu.tr/Home/Program/7"
      },
      "Meslek Yüksekokulu": {
        "Aşçılık": "https://myo.belek.edu.tr/Home/MenuPage/99",
        "Bankacılık ve Sigortacılık": "https://myo.belek.edu.tr/Home/MenuPage/100",
        "Bilgisayar Destekli Tasarım ve Animasyon": "https://myo.belek.edu.tr/Home/MenuPage/101",
        "Bilişim Güvenliği Teknolojisi": "https://myo.belek.edu.tr/Home/MenuPage/111",
        "Eczane Hizmetleri": "https://myo.belek.edu.tr/Home/MenuPage/108",
        "İç Mekan Tasarımı": "https://myo.belek.edu.tr/Home/MenuPage/101",
        "İnşaat Teknolojisi": "https://myo.belek.edu.tr/Home/MenuPage/102",
        "Mahkeme Büro Hizmetleri": "https://myo.belek.edu.tr/Home/MenuPage/110",
        "Mimari Restorasyon": "https://myo.belek.edu.tr/Home/MenuPage/103",
        "Optisyenlik": "https://myo.belek.edu.tr/Home/MenuPage/109",
        "Sivil Hava Ulaştırma İşletmeciliği": "https://myo.belek.edu.tr/Home/MenuPage/104",
        "Sivil Havacılık Kabin Hizmetleri": "https://myo.belek.edu.tr/Home/MenuPage/104",
        "Turist Rehberliği": "https://myo.belek.edu.tr/Home/MenuPage/107",
        "Web Tasarımı ve Kodlama": "https://myo.belek.edu.tr/Home/MenuPage/111"
      }
    }
  },
  {
    universityId: "aydin-adnan-menderes-universitesi",
    name: "AYDIN ADNAN MENDERES ÜNİVERSİTESİ",
    homepageUrl: "https://www.adu.edu.tr/",
    treeHomepageLookup: "adu.edu.tr",
    facultyUrls: {
      "Diş Hekimliği Fakültesi": "https://dis.adu.edu.tr/tr/",
      "Eğitim Fakültesi": "https://fakulte.adu.edu.tr/egitim/",
      "Fen Fakültesi": "https://fakulte.adu.edu.tr/fen/tr",
      "Hemşirelik Fakültesi": "https://fakulte.adu.edu.tr/hemsirelik/tr",
      "İlahiyat Fakültesi": "https://fakulte.adu.edu.tr/ilahiyat/tr",
      "İletişim Fakültesi": "https://fakulte.adu.edu.tr/iletisim/tr",
      "İnsan ve Toplum Bilimleri Fakültesi": "https://fakulte.adu.edu.tr/insanvetoplum/tr",
      "Mühendislik Fakültesi": "https://fakulte.adu.edu.tr/muhendislik/tr",
      "Nazilli İktisadi ve İdari Bilimler Fakültesi": "https://fakulte.adu.edu.tr/nazilliiibf/tr",
      "Sağlık Bilimleri Fakültesi": "https://fakulte.adu.edu.tr/saglik/tr",
      "Siyasal Bilgiler Fakültesi": "https://fakulte.adu.edu.tr/sbf/tr",
      "Söke İşletme Fakültesi": "https://fakulte.adu.edu.tr/sokeisletme/tr",
      "Spor Bilimleri Fakültesi": "https://fakulte.adu.edu.tr/spor/tr",
      "Tıp Fakültesi": "https://fakulte.adu.edu.tr/med/tr",
      "Turizm Fakültesi (Kuşadası)": "https://fakulte.adu.edu.tr/turizm/tr",
      "Veteriner Fakültesi": "https://fakulte.adu.edu.tr/Veteriner/tr",
      "Ziraat Fakültesi": "https://fakulte.adu.edu.tr/ziraat/tr"
    },
    departmentUrls: {
      "Eğitim Fakültesi": {
        "Bilgisayar ve Öğretim Teknolojileri Öğretmenliği": "https://akademik.adu.edu.tr/bolum/egitim/bilgisayarteknolojileri/",
        "Rehberlik ve Psikolojik Danışmanlık": "https://akademik.adu.edu.tr/bolum/egitim/egitimbilimleri/",
        "Fen Bilgisi Öğretmenliği": "https://akademik.adu.edu.tr/bolum/egitim/oofenmatalan/",
        "Özel Eğitim Öğretmenliği": "https://akademik.adu.edu.tr/bolum/egitim/ozelegitim/",
        "Sosyal Bilgiler Öğretmenliği": "https://akademik.adu.edu.tr/bolum/egitim/oososyalalan/",
        "Sınıf Öğretmenliği": "https://akademik.adu.edu.tr/bolum/egitim/ilkogretim/",
        "İngilizce Öğretmenliği": "https://akademik.adu.edu.tr/bolum/egitim/yabancidilleregitimi/"
      },
      "Fen Fakültesi": {
        "Biyoloji": "https://akademik.adu.edu.tr/bolum/fef/biyoloji/",
        "Fizik": "https://akademik.adu.edu.tr/bolum/fef/fizik/",
        "Kimya": "https://akademik.adu.edu.tr/bolum/fef/kimya/",
        "Matematik": "https://akademik.adu.edu.tr/bolum/fef/matematik/"
      },
      "İletişim Fakültesi": {
        "Gazetecilik": "https://akademik.adu.edu.tr/bolum/iletisim/gazetecilik/",
        "Görsel İletişim Tasarımı": "https://akademik.adu.edu.tr/bolum/iletisim/git/",
        "Halkla İlişkiler ve Reklamcılık": "https://akademik.adu.edu.tr/bolum/iletisim/hir/",
        "Radyo, Televizyon ve Sinema": "https://akademik.adu.edu.tr/bolum/iletisim/rts/",
        "Yeni Medya ve İletişim": "https://akademik.adu.edu.tr/bolum/iletisim/ymi/"
      },
      "İnsan ve Toplum Bilimleri Fakültesi": {
        "Alman Dili ve Edebiyatı": "https://akademik.adu.edu.tr/bolum/fef/ade/",
        "Arkeoloji": "https://akademik.adu.edu.tr/bolum/fef/arkeoloji/",
        "Felsefe": "https://akademik.adu.edu.tr/bolum/fef/felsefe/",
        "Fransız Dili ve Edebiyatı": "https://akademik.adu.edu.tr/bolum/fef/fde/",
        "İngiliz Dili ve Edebiyatı": "https://fakulte.adu.edu.tr/insanvetoplum/tr/birimler/ingiliz-dili-ve-edebiyati-programi-11317",
        "Psikoloji": "https://akademik.adu.edu.tr/bolum/fef/psikoloji/",
        "Sanat Tarihi": "https://akademik.adu.edu.tr/bolum/fef/sanattarihi/",
        "Sosyoloji": "https://akademik.adu.edu.tr/bolum/fef/sosyoloji/",
        "Tarih": "https://akademik.adu.edu.tr/bolum/fef/tarih/",
        "Türk Dili ve Edebiyatı": "https://akademik.adu.edu.tr/bolum/fef/tde/"
      },
      "Mühendislik Fakültesi": {
        "Bilgisayar Mühendisliği": "https://akademik.adu.edu.tr/bolum/muhendislik/bilgisayar/",
        "Elektrik-Elektronik Mühendisliği": "https://akademik.adu.edu.tr/bolum/muhendislik/elektrik-elektronik/",
        "Gıda Mühendisliği": "https://akademik.adu.edu.tr/bolum/muhendislik/gida/",
        "İnşaat Mühendisliği": "https://akademik.adu.edu.tr/bolum/muhendislik/insaat/",
        "Makine Mühendisliği": "https://akademik.adu.edu.tr/bolum/muhendislik/makine/"
      },
      "Nazilli İktisadi ve İdari Bilimler Fakültesi": {
        "Çalışma Ekonomisi ve Endüstri İlişkileri": "https://akademik.adu.edu.tr/bolum/nazilliiibf/calismaekonomisi/",
        "İktisat": "https://akademik.adu.edu.tr/bolum/nazilliiibf/iktisat/",
        "İşletme": "https://akademik.adu.edu.tr/bolum/nazilliiibf/isletme/",
        "Maliye": "https://akademik.adu.edu.tr/bolum/nazilliiibf/maliye/",
        "Siyaset Bilimi ve Kamu Yönetimi": "https://akademik.adu.edu.tr/bolum/nazilliiibf/kamuyonetimi/",
        "Uluslararası İlişkiler": "https://akademik.adu.edu.tr/bolum/nazilliiibf/uluslararasiiliskiler/default.asp",
        "Uluslararası Ticaret ve Finansman": "https://akademik.adu.edu.tr/bolum/nazilliiibf/utf/"
      },
      "Sağlık Bilimleri Fakültesi": {
        "Beslenme ve Diyetetik": "https://akademik.adu.edu.tr/bolum/saglik/beslenmevediyetetik/",
        "Çocuk Gelişimi": "https://akademik.adu.edu.tr/bolum/saglik/cocukgelisimi/",
        "Ebelik": "https://akademik.adu.edu.tr/bolum/saglik/ebelik/",
        "Fizyoterapi ve Rehabilitasyon": "https://akademik.adu.edu.tr/bolum/saglik/ftr/"
      },
      "Siyasal Bilgiler Fakültesi": {
        "Ekonomi ve Finans": "https://akademik.adu.edu.tr/bolum/sbf/ekonomivefinans/",
        "İktisat": "https://akademik.adu.edu.tr/bolum/sbf/iktisat/",
        "Maliye": "https://akademik.adu.edu.tr/bolum/sbf/maliye/",
        "Uluslararası İlişkiler": "http://akademik.adu.edu.tr/bolum/sbf/ui/"
      },
      "Söke İşletme Fakültesi": {
        "Ekonomi": "https://akademik.adu.edu.tr/bolum/sokeisletme/ekonomi/default.asp?idx=313331",
        "İnsan Kaynakları Yönetimi": "https://akademik.adu.edu.tr/bolum/sokeisletme/iky/",
        "Kamu Yönetimi": "https://akademik.adu.edu.tr/bolum/sokeisletme/kamuyonetimi/",
        "Uluslararası Ticaret ve İşletmecilik": "https://akademik.adu.edu.tr/bolum/sokeisletme/uti/",
        "Yönetim Bilişim Sistemleri": "https://akademik.adu.edu.tr/bolum/sokeisletme/ybs/"
      },
      "Spor Bilimleri Fakültesi": {
        "Spor Yöneticiliği": "https://akademik.adu.edu.tr/bolum/spor/sporyoneticiligi/"
      },
      "Ziraat Fakültesi": {
        "Bahçe Bitkileri": "https://akademik.adu.edu.tr/bolum/ziraat/bahcebitkileri/",
        "Bitki Koruma": "https://akademik.adu.edu.tr/bolum/ziraat/bitkikoruma/default.asp",
        "Biyosistem Mühendisliği": "https://akademik.adu.edu.tr/bolum/ziraat/biyosistem/",
        "Peyzaj Mimarlığı": "https://akademik.adu.edu.tr/bolum/ziraat/peyzaj/default.asp?idx=313436",
        "Tarım Ekonomisi": "https://akademik.adu.edu.tr/bolum/ziraat/tarimekonomisi/default.asp?idx=313335",
        "Tarımsal Biyoteknoloji": "https://akademik.adu.edu.tr/bolum/ziraat/biyoteknoloji/default.asp",
        "Tarla Bitkileri": "https://akademik.adu.edu.tr/bolum/ziraat/tarlabitkileri/default.asp?idx=313335",
        "Toprak Bilimi ve Bitki Besleme": "https://akademik.adu.edu.tr/bolum/ziraat/toprakbitkibesleme/default.asp",
        "Zootekni": "https://akademik.adu.edu.tr/bolum/ziraat/zootekni/"
      }
    }
  },
  {
    universityId: "anadolu-universitesi-eskisehir",
    name: "ANADOLU ÜNİVERSİTESİ",
    homepageUrl: "https://www.anadolu.edu.tr/",
    treeHomepageLookup: "anadolu.edu.tr",
    facultyUrls: {
      "Açıköğretim Fakültesi": "https://www.anadolu.edu.tr/acikogretim",
      "Eczacılık Fakültesi": "https://eczacilik.anadolu.edu.tr/",
      "Edebiyat Fakültesi": "https://edebiyat.anadolu.edu.tr/",
      "Eğitim Fakültesi": "https://egitim.anadolu.edu.tr/",
      "Güzel Sanatlar Fakültesi": "https://gsf.anadolu.edu.tr/",
      "Hukuk Fakültesi": "https://hukuk.anadolu.edu.tr/",
      "İktisadi ve İdari Bilimler Fakültesi": "https://iibf.anadolu.edu.tr/",
      "Adalet Meslek Yüksekokulu": "https://adalet.anadolu.edu.tr/",
      "Bilişim Teknolojileri Meslek Yüksekokulu": "https://biltekmyo.anadolu.edu.tr/",
      "Eskişehir Meslek Yüksekokulu": "https://emyo.anadolu.edu.tr/",
      "Yunus Emre Sağlık Hizmetleri Meslek Yüksekokulu": "https://yemyo.anadolu.edu.tr/",
      "Devlet Konservatuvarı": "https://konservatuvar.anadolu.edu.tr/",
      "Engelliler Entegre Yüksekokulu": "https://eeyo.anadolu.edu.tr/",
      "Yabancı Diller Yüksekokulu": "https://ydyo.anadolu.edu.tr/"
    },
    departmentUrls: {
      "Edebiyat Fakültesi": {
        "Arkeoloji": "https://edebiyat.anadolu.edu.tr/akademik/arkeoloji-bolumu",
        "Felsefe": "https://edebiyat.anadolu.edu.tr/akademik/felsefe-bolumu",
        "Psikoloji": "https://edebiyat.anadolu.edu.tr/akademik/psikoloji-bolumu",
        "Rus Dili ve Edebiyatı": "https://edebiyat.anadolu.edu.tr/akademik/rus-dili-ve-edebiyati-bolumu-rusca",
        "Sanat Tarihi": "https://edebiyat.anadolu.edu.tr/akademik/sanat-tarihi-bolumu",
        "Sosyoloji": "https://edebiyat.anadolu.edu.tr/akademik/sosyoloji-bolumu",
        "Tarih": "https://edebiyat.anadolu.edu.tr/akademik/tarih-bolumu",
        "Türk Dili ve Edebiyatı": "https://edebiyat.anadolu.edu.tr/akademik/turk-dili-ve-edebiyati-bolumu"
      },
      "Eğitim Fakültesi": {
        "Bilgisayar ve Öğretim Teknolojileri Öğretmenliği": "https://egitim.anadolu.edu.tr/akademik/bilgisayar-ve-ogretim-teknolojileri-egitimi-programi",
        "Rehberlik ve Psikolojik Danışmanlık": "https://egitim.anadolu.edu.tr/akademik/rehberlik-ve-psikolojik-danismanlik-programi",
        "İlköğretim Matematik Öğretmenliği": "https://egitim.anadolu.edu.tr/akademik/ilkogretim-matematik-ogretmenligi-programi",
        "Özel Eğitim Öğretmenliği": "https://egitim.anadolu.edu.tr/akademik/ozel-egitim-ogretmenligi-programi",
        "Okul Öncesi Öğretmenliği": "https://egitim.anadolu.edu.tr/akademik/okuloncesi-ogretmenligi-programi",
        "Sınıf Öğretmenliği": "https://egitim.anadolu.edu.tr/akademik/sinif-ogretmenligi-programi",
        "Sosyal Bilgiler Öğretmenliği": "https://egitim.anadolu.edu.tr/akademik/sosyal-bilgiler-ogretmenligi-programi",
        "İngilizce Öğretmenliği": "https://egitim.anadolu.edu.tr/akademik/ingilizce-ogretmenligi-programi",
        "Almanca Öğretmenliği": "https://egitim.anadolu.edu.tr/akademik/almanca-ogretmenligi-programi",
        "Fransızca Öğretmenliği": "https://egitim.anadolu.edu.tr/akademik/fransizca-ogretmenligi-programi"
      },
      "Güzel Sanatlar Fakültesi": {
        "Dijital Oyun Tasarımı": "https://gsf.anadolu.edu.tr/akademik/dijital-oyun-tasarimi-bolumu-akademik"
      },
      "İktisadi ve İdari Bilimler Fakültesi": {
        "Çalışma Ekonomisi ve Endüstri İlişkileri": "https://iibf.anadolu.edu.tr/akademik/calisma-ekonomisi-ve-endustri-iliskileri-bolumu",
        "İktisat": "https://iibf.anadolu.edu.tr/akademik/iktisat-bolumu",
        "İşletme": "https://iibf.anadolu.edu.tr/akademik/isletme-bolumu",
        "Maliye": "https://iibf.anadolu.edu.tr/akademik/maliye-bolumu",
        "Siyaset Bilimi ve Kamu Yönetimi": "https://iibf.anadolu.edu.tr/akademik/siyaset-bilimi-ve-kamu-yonetimi-bolumu",
        "Uluslararası Ticaret ve Lojistik": "https://iibf.anadolu.edu.tr/akademik/uluslararasi-ticaret-ve-lojistik-bolumu",
        "Yönetim Bilişim Sistemleri": "https://iibf.anadolu.edu.tr/akademik/yonetim-bilisim-sistemleri-bolumu"
      },
      "Bilişim Teknolojileri Meslek Yüksekokulu": {
        "Büyük Veri Analistliği": "https://biltekmyo.anadolu.edu.tr/akademik/buyuk-veri-analistligi-programi",
        "Arka-Yüz Yazılım Geliştirme": "https://biltekmyo.anadolu.edu.tr/akademik/arka-yuz-yazilim-gelistirme-programi",
        "Ön-Yüz Yazılım Geliştirme": "https://biltekmyo.anadolu.edu.tr/akademik/on-yuz-yazilim-gelistirme-programi",
        "Oyun Geliştirme ve Programlama": "https://biltekmyo.anadolu.edu.tr/akademik/oyun-gelistirme-ve-programlama-programi"
      },
      "Eskişehir Meslek Yüksekokulu": {
        "Büro Yönetimi ve Yönetici Asistanlığı": "https://emyo.anadolu.edu.tr/akademik/buro-yonetimi-ve-yonetici-asistanligi-programi",
        "Dış Ticaret": "https://emyo.anadolu.edu.tr/akademik/dis-ticaret-programi",
        "Aşçılık": "https://emyo.anadolu.edu.tr/akademik/ascilik-programi",
        "Turizm ve Otel İşletmeciliği": "https://emyo.anadolu.edu.tr/akademik/turizm-ve-otel-isletmeciligi-programi",
        "Pazarlama": "https://emyo.anadolu.edu.tr/akademik/pazarlama-programi",
        "Emlak Yönetimi": "https://emyo.anadolu.edu.tr/akademik/emlak-yonetimi-programi"
      },
      "Yunus Emre Sağlık Hizmetleri Meslek Yüksekokulu": {
        "Çocuk Gelişimi": "https://yemyo.anadolu.edu.tr/akademik/cocuk-gelisimi-programi",
        "Eczane Hizmetleri": "https://yemyo.anadolu.edu.tr/akademik/eczane-hizmetleri-programi",
        "Saç Bakımı ve Güzellik Hizmetleri": "https://yemyo.anadolu.edu.tr/akademik/sac-bakimi-ve-guzellik-hizmetleri-programi",
        "Yaşlı Bakımı": "https://yemyo.anadolu.edu.tr/akademik/yasli-bakimi-programi",
        "Tıbbi Laboratuvar Teknikleri": "https://yemyo.anadolu.edu.tr/akademik/tibbi-laboratuvar-teknikleri-programi"
      }
    }
  }
];

async function main(): Promise<void> {
  const tree = JSON.parse(await readFile(treePath, "utf8")) as FacultyTreeFile;
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { universities: SeedUniversity[] };
  const registry = JSON.parse(await readFile(registryPath, "utf8")) as VerifiedAcademicUnitSource[];
  const seedById = new Map(catalog.universities.map((university) => [university.slug, university]));

  const additions: VerifiedAcademicUnitSource[] = [];
  for (const patch of patches) {
    mergeTreeRecord(tree, patch);
    const seed = seedById.get(patch.universityId);
    if (seed) additions.push(...buildRegistryRecords(patch, seed));
  }

  const mergedRegistry = mergeRegistry(registry, additions);
  tree.generatedAt = new Date().toISOString();
  tree.summary = buildTreeSummary(tree.universities);
  await writeFile(treePath, `${JSON.stringify(tree, null, 2)}\n`, "utf8");
  await writeFile(registryPath, `${JSON.stringify(mergedRegistry, null, 2)}\n`, "utf8");

  const result = patches.map((patch) => {
    const treeRecord = findTreeRecord(tree, patch);
    const records = mergedRegistry.filter((source) => source.universityId === patch.universityId);
    const newRecords = additions.filter((source) => source.universityId === patch.universityId);
    return {
      university: patch.name,
      treeFaculties: treeRecord?.facultyCount,
      treeDepartments: (treeRecord?.faculties ?? []).reduce((total, faculty) => total + (faculty.departments?.length ?? 0), 0),
      suppliedFacultyGroups: Object.keys(patch.facultyUrls).length,
      suppliedDepartmentUrls: Object.values(patch.departmentUrls).reduce((total, departments) => total + Object.keys(departments).length, 0),
      matchedRegistryUpdates: newRecords.length,
      runtimeRegistryTotal: records.length
    };
  });
  console.log(JSON.stringify(result, null, 2));
}

function mergeTreeRecord(tree: FacultyTreeFile, patch: UniversityPatch): void {
  const university = findTreeRecord(tree, patch);
  if (!university) throw new Error(`University not found in tree: ${patch.name}`);
  const beforeFacultyCount = university.faculties?.length ?? 0;
  const faculties = new Map((university.faculties ?? []).map((faculty) => [treeKey(faculty.name), faculty]));

  for (const [facultyName, facultyUrl] of Object.entries(patch.facultyUrls)) {
    const key = treeKey(facultyName);
    const current = faculties.get(key);
    faculties.set(key, {
      ...(current ?? {}),
      name: facultyName,
      url: normalizeDisplayUrl(facultyUrl),
      unitType: current?.unitType ?? inferUnitType(facultyName),
      sourcePageUrl: patch.homepageUrl,
      confidence: Math.max(current?.confidence ?? 0, 150),
      departments: mergeDepartmentTree(current?.departments ?? [], facultyName, patch.departmentUrls[facultyName] ?? {}, facultyUrl)
    });
  }

  for (const [facultyName, departments] of Object.entries(patch.departmentUrls)) {
    const key = treeKey(facultyName);
    if (faculties.has(key)) continue;
    const firstDepartmentUrl = Object.values(departments)[0] ?? patch.homepageUrl;
    faculties.set(key, {
      name: facultyName,
      url: normalizeDisplayUrl(firstDepartmentUrl),
      unitType: inferUnitType(facultyName),
      sourcePageUrl: patch.homepageUrl,
      confidence: 120,
      departments: mergeDepartmentTree([], facultyName, departments, firstDepartmentUrl)
    });
  }

  const merged = [...faculties.values()].sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
  university.name = patch.name;
  university.homepageUrl = patch.homepageUrl;
  university.finalHomepageUrl = patch.homepageUrl;
  university.hostname = new URL(patch.homepageUrl).hostname;
  university.status = "manual_seeded";
  university.checkedPageCount = Math.max(Number(university.checkedPageCount ?? 0), 1);
  university.faculties = merged;
  university.facultyCount = merged.length;
  university.errors = [];
  university.cleanup = {
    ...(university.cleanup ?? {}),
    beforeFacultyCount,
    afterFacultyCount: merged.length,
    removedFacultyCount: Math.max(0, beforeFacultyCount - merged.length),
    manuallySeededFrom: "User-provided URL correction batch 2026-07-15"
  };
}

function mergeDepartmentTree(existing: FacultyTreeRecord[], facultyName: string, departments: Record<string, string>, sourcePageUrl: string): FacultyTreeRecord[] {
  const byName = new Map(existing.map((department) => [treeKey(department.name), department]));
  for (const [departmentName, departmentUrl] of Object.entries(departments)) {
    const key = treeKey(departmentName);
    const current = byName.get(key);
    byName.set(key, {
      ...(current ?? {}),
      name: departmentName,
      url: normalizeDisplayUrl(departmentUrl),
      unitType: "department",
      sourcePageUrl: normalizeDisplayUrl(sourcePageUrl),
      confidence: Math.max(current?.confidence ?? 0, 145)
    });
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
}

function buildRegistryRecords(patch: UniversityPatch, seed: SeedUniversity): VerifiedAcademicUnitSource[] {
  const records: VerifiedAcademicUnitSource[] = [];
  for (const [facultyName, facultyUrl] of Object.entries(patch.facultyUrls)) {
    const facultySeed = findByName(seed.faculties, facultyName);
    if (!facultySeed) continue;
    const facultyId = `${seed.slug}__${facultySeed.slug}`;
    records.push({
      scopeType: "faculty",
      universityId: seed.slug,
      universityName: seed.name,
      facultyId,
      facultyName: facultySeed.name,
      websiteUrl: normalizeDisplayUrl(facultyUrl)
    });

    for (const [departmentName, departmentUrl] of Object.entries(patch.departmentUrls[facultyName] ?? {})) {
      const departmentSeed = findByName(facultySeed.departments, departmentName);
      if (!departmentSeed) continue;
      records.push({
        scopeType: "department",
        universityId: seed.slug,
        universityName: seed.name,
        facultyId,
        facultyName: facultySeed.name,
        departmentId: `${facultyId}__${departmentSeed.slug}`,
        departmentName: departmentSeed.name,
        websiteUrl: normalizeDisplayUrl(departmentUrl)
      });
    }
  }
  return dedupeRegistry(records);
}

function mergeRegistry(existing: VerifiedAcademicUnitSource[], additions: VerifiedAcademicUnitSource[]): VerifiedAcademicUnitSource[] {
  const byKey = new Map(existing.map((record) => [registryKey(record), record]));
  for (const record of additions) byKey.set(registryKey(record), { ...byKey.get(registryKey(record)), ...record });
  return [...byKey.values()];
}

function dedupeRegistry(records: VerifiedAcademicUnitSource[]): VerifiedAcademicUnitSource[] {
  const byKey = new Map<string, VerifiedAcademicUnitSource>();
  for (const record of records) byKey.set(registryKey(record), { ...byKey.get(registryKey(record)), ...record });
  return [...byKey.values()];
}

function registryKey(record: VerifiedAcademicUnitSource): string {
  return record.scopeType === "faculty" ? `faculty:${record.facultyId}` : `department:${record.departmentId}`;
}

function findTreeRecord(tree: FacultyTreeFile, patch: UniversityPatch): FacultyTreeFile["universities"][number] | undefined {
  return tree.universities.find((university) => {
    const homepage = String(university.homepageUrl ?? "");
    const name = String(university.name ?? "");
    return homepage.includes(patch.treeHomepageLookup) || foldText(name) === foldText(patch.name);
  });
}

function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  const folded = foldText(name);
  const compact = compactText(name);
  return items.find((item) => foldText(item.name) === folded)
    ?? items.find((item) => compactText(item.name) === compact)
    ?? items.find((item) => compactText(item.name).includes(compact) || compact.includes(compactText(item.name)));
}

function buildTreeSummary(universities: FacultyTreeFile["universities"]): Record<string, unknown> {
  return {
    totalUniversities: universities.length,
    completedUniversities: universities.filter((university) => university.status !== "pending").length,
    okUniversities: universities.filter((university) => university.status === "ok").length,
    manualSeededUniversities: universities.filter((university) => university.status === "manual_seeded").length,
    partialUniversities: universities.filter((university) => university.status === "partial").length,
    failedUniversities: universities.filter((university) => university.status === "failed").length,
    universitiesWithFaculties: universities.filter((university) => Number(university.facultyCount ?? 0) > 0).length,
    totalFacultyLinks: universities.reduce((total, university) => total + Number(university.facultyCount ?? 0), 0)
  };
}

function inferUnitType(name: string): UnitType {
  const folded = foldText(name);
  if (folded.includes("meslek yuksekokulu")) return "vocational_school";
  if (folded.includes("yuksekokulu") || folded.includes("okulu")) return "school";
  if (folded.includes("enstitu")) return "institute";
  if (folded.includes("fakulte")) return "faculty";
  return "academic_unit";
}

function normalizeDisplayUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

function compactText(value: string): string {
  return foldText(value).replace(/[^a-z0-9]+/gu, "");
}

function treeKey(value: string): string {
  return compactText(value);
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .replace(/\u011f/gu, "g")
    .replace(/\u011e/gu, "G")
    .replace(/\u00fc/gu, "u")
    .replace(/\u00dc/gu, "U")
    .replace(/\u015f/gu, "s")
    .replace(/\u015e/gu, "S")
    .replace(/\u00f6/gu, "o")
    .replace(/\u00d6/gu, "O")
    .replace(/\u00e7/gu, "c")
    .replace(/\u00c7/gu, "C")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
