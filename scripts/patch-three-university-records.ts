import { readFile, writeFile } from "node:fs/promises";

type UnitType = "faculty" | "institute" | "school" | "vocational_school" | "academic_unit" | "department";

interface DepartmentSpec {
  name: string;
  url?: string;
  announcementUrl?: string;
  courseScheduleUrl?: string;
  examScheduleUrl?: string;
}

interface FacultySpec {
  name: string;
  url: string;
  unitType?: UnitType;
  departments?: DepartmentSpec[];
}

interface UniversitySpec {
  name: string;
  homepageUrl: string;
  universityId: string;
  faculties: FacultySpec[];
}

interface FacultyTreeFile {
  generatedAt: string;
  summary?: Record<string, unknown>;
  universities: Array<Record<string, unknown>>;
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

const specs: UniversitySpec[] = [
  {
    name: "ADANA ALPARSLAN TÜRKEŞ BİLİM VE TEKNOLOJİ ÜNİVERSİTESİ",
    homepageUrl: "https://www.atu.edu.tr/",
    universityId: "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi",
    faculties: [
      {
        name: "Bilgisayar ve Bilişim Fakültesi",
        url: "https://bbf.atu.edu.tr/",
        departments: [
          { name: "Bilgisayar Mühendisliği", url: "https://compeng.atu.edu.tr/" },
          { name: "Yazılım Mühendisliği", url: "https://yazilim.atu.edu.tr/" },
          { name: "Yapay Zeka Mühendisliği", url: "https://yapayzeka.atu.edu.tr/" },
          { name: "Veri Bilimi ve Analitiği", url: "https://vba.atu.edu.tr/" },
          { name: "Bilişim Sistemleri ve Teknolojileri", url: "https://bst.atu.edu.tr/" },
          { name: "Bilgi Güvenliği Teknolojisi", url: "https://bgt.atu.edu.tr/" }
        ]
      },
      {
        name: "Havacılık ve Uzay Bilimleri Fakültesi",
        url: "https://hubf.atu.edu.tr/",
        departments: [
          { name: "Havacılık ve Uzay Mühendisliği", url: "https://havacilik.atu.edu.tr/" },
          { name: "İklim Bilimi ve Meteoroloji Mühendisliği", url: "https://meteoroloji.atu.edu.tr/" },
          { name: "Havacılık Yönetimi", url: "https://havacilikyonetimi.atu.edu.tr/" }
        ]
      },
      {
        name: "İktisadi, İdari ve Sosyal Bilimler Fakültesi",
        url: "https://iisbf.atu.edu.tr/",
        departments: [
          { name: "Yönetim Bilişim Sistemleri", url: "https://mis.atu.edu.tr/" },
          { name: "Uluslararası Ticaret ve Finansman", url: "https://intf.atu.edu.tr/" },
          { name: "İşletme", url: "https://isletme.atu.edu.tr/" },
          { name: "Turizm İşletmeciliği", url: "https://tourism.atu.edu.tr/" },
          { name: "Siyaset Bilimi ve Kamu Yönetimi", url: "https://psapa.atu.edu.tr/" },
          { name: "Uluslararası İlişkiler", url: "https://intrel.atu.edu.tr/" },
          { name: "Psikoloji", url: "https://psych.atu.edu.tr/" },
          { name: "İngilizce Mütercim ve Tercümanlık", url: "https://mtb.atu.edu.tr/" },
          { name: "Gastronomi ve Mutfak Sanatları", url: "https://gastronomi.atu.edu.tr/" }
        ]
      },
      {
        name: "Mimarlık ve Tasarım Fakültesi",
        url: "https://mtf.atu.edu.tr/",
        departments: [{ name: "Mimarlık", url: "https://mimarlik.atu.edu.tr/" }]
      },
      {
        name: "Mühendislik Fakültesi",
        url: "https://mf.atu.edu.tr/",
        departments: [
          { name: "Endüstri Mühendisliği", url: "https://ieng.atu.edu.tr/" },
          { name: "Elektrik-Elektronik Mühendisliği", url: "https://eee.atu.edu.tr/" },
          { name: "Enerji Sistemleri Mühendisliği", url: "https://enerji.atu.edu.tr/" },
          { name: "Gıda Mühendisliği", url: "https://food.atu.edu.tr/" },
          { name: "İnşaat Mühendisliği", url: "https://civeng.atu.edu.tr/" },
          { name: "Makine Mühendisliği", url: "https://mech.atu.edu.tr/" },
          { name: "Malzeme Bilimi ve Mühendisliği", url: "https://mateng.atu.edu.tr/" }
        ]
      },
      { name: "Bilişim Teknolojileri Meslek Yüksekokulu", url: "https://bilisimtekmyo.atu.edu.tr/", unitType: "vocational_school" },
      { name: "Yabancı Diller Yüksekokulu", url: "https://yadyo.atu.edu.tr/", unitType: "school" }
    ]
  },
  {
    name: "AFYON KOCATEPE ÜNİVERSİTESİ",
    homepageUrl: "https://www.aku.edu.tr/",
    universityId: "afyon-kocatepe-universitesi-afyonkarahisar",
    faculties: [
      { name: "Afyon Meslek Yüksekokulu", url: "http://afyonmyo.aku.edu.tr/", unitType: "vocational_school" },
      { name: "Başmakçı Meslek Yüksekokulu", url: "http://basmakcimyo.aku.edu.tr/", unitType: "vocational_school" },
      { name: "Bayat Meslek Yüksekokulu", url: "http://bayatmyo.aku.edu.tr/", unitType: "vocational_school" },
      { name: "Bilişim Teknolojileri Meslek Yüksekokulu", url: "http://btmyo.aku.edu.tr/", unitType: "vocational_school" },
      { name: "Bolvadin Meslek Yüksekokulu", url: "http://bolvadinmyo.aku.edu.tr/", unitType: "vocational_school" },
      { name: "Bolvadin Uygulamalı Bilimler Fakültesi", url: "http://bubfa.aku.edu.tr/" },
      { name: "Çay Meslek Yüksekokulu", url: "http://caymyo.aku.edu.tr/", unitType: "vocational_school" },
      { name: "Dazkırı Meslek Yüksekokulu", url: "http://dazkirimyo.aku.edu.tr/", unitType: "vocational_school" },
      { name: "Dinar Meslek Yüksekokulu", url: "http://dinarmyo.aku.edu.tr/", unitType: "vocational_school" },
      { name: "Dinar Uygulamalı Bilimler Yüksekokulu", url: "https://dubyo.aku.edu.tr/", unitType: "school" },
      {
        name: "Eğitim Fakültesi",
        url: "http://afegitim.aku.edu.tr/",
        departments: [
          { name: "Fen Bilgisi Öğretmenliği", url: "https://mfb.aku.edu.tr/" },
          { name: "İlköğretim Matematik Öğretmenliği", url: "https://mfb.aku.edu.tr/" },
          { name: "İngilizce Öğretmenliği", url: "http://fled.aku.edu.tr/" },
          { name: "Özel Eğitim Öğretmenliği", url: "https://ozelegitim.aku.edu.tr/" },
          { name: "Türkçe Öğretmenliği", url: "https://tsb.aku.edu.tr/" }
        ]
      },
      { name: "Emirdağ Meslek Yüksekokulu", url: "http://emirdagmyo.aku.edu.tr/", unitType: "vocational_school" },
      {
        name: "Fen-Edebiyat Fakültesi",
        url: "http://fef.aku.edu.tr/",
        departments: [
          { name: "Coğrafya", url: "https://cografya.aku.edu.tr/" },
          { name: "Çağdaş Türk Lehçeleri ve Edebiyatları", url: "http://ctle.aku.edu.tr/" },
          { name: "Felsefe", url: "http://felsefe.aku.edu.tr/" },
          { name: "İngilizce Mütercim ve Tercümanlık", url: "https://imt.aku.edu.tr/" },
          { name: "Kimya", url: "http://kimya.aku.edu.tr/" },
          { name: "Matematik", url: "http://matematik.aku.edu.tr/" },
          { name: "Moleküler Biyoloji ve Genetik", url: "https://mbg.aku.edu.tr/" },
          { name: "Psikoloji", url: "https://psikoloji.aku.edu.tr/" },
          { name: "Sanat Tarihi", url: "https://sanattarihi.aku.edu.tr/" },
          { name: "Sosyoloji", url: "http://sosyoloji.aku.edu.tr/" },
          { name: "Tarih", url: "http://tarih.aku.edu.tr/" },
          { name: "Türk Dili ve Edebiyatı", url: "https://tde.aku.edu.tr/" }
        ]
      },
      {
        name: "Güzel Sanatlar Fakültesi",
        url: "https://gsf.aku.edu.tr/",
        departments: [
          { name: "İç Mimarlık ve Çevre Tasarımı", url: "https://imct.aku.edu.tr/" },
          { name: "Sinema ve Televizyon", url: "https://gsf.aku.edu.tr/sinema-ve-televizyon-bolumu/" }
        ]
      },
      { name: "Hukuk Fakültesi", url: "http://hukuk.aku.edu.tr/" },
      {
        name: "İktisadi ve İdari Bilimler Fakültesi",
        url: "https://iibf.aku.edu.tr/",
        departments: [
          { name: "İktisat", url: "https://iktisat.aku.edu.tr/" },
          { name: "İşletme", url: "http://isletme.aku.edu.tr/" },
          { name: "Maliye", url: "http://maliye.aku.edu.tr/" },
          { name: "Siyaset Bilimi ve Kamu Yönetimi", url: "http://sbky.aku.edu.tr/" },
          { name: "Uluslararası Ticaret ve Finansman", url: "http://utf.aku.edu.tr/" },
          { name: "Yönetim Bilişim Sistemleri", url: "http://ybs.aku.edu.tr/" }
        ]
      },
      { name: "İlahiyat Fakültesi", url: "https://ilahiyat.aku.edu.tr/" },
      { name: "İscehisar Meslek Yüksekokulu", url: "http://iscehisarmyo.aku.edu.tr/", unitType: "vocational_school" },
      {
        name: "Mühendislik Fakültesi",
        url: "https://muhendislik.aku.edu.tr/",
        departments: [
          { name: "Bilgisayar Mühendisliği", url: "https://bilgisayar.aku.edu.tr/" },
          { name: "Biyomedikal Mühendisliği", url: "https://biyomedikal.aku.edu.tr/" },
          { name: "Elektrik Mühendisliği", url: "https://elektrik.aku.edu.tr/" },
          { name: "Gıda Mühendisliği", url: "https://gidamuh.aku.edu.tr/" },
          { name: "Harita Mühendisliği", url: "https://harita.aku.edu.tr/" },
          { name: "İnşaat Mühendisliği", url: "https://insaat.aku.edu.tr/" },
          { name: "Jeoloji Mühendisliği", url: "https://jeoloji.aku.edu.tr/" },
          { name: "Kimya Mühendisliği", url: "https://kimmuh.aku.edu.tr/" },
          { name: "Maden Mühendisliği", url: "https://maden.aku.edu.tr/" },
          { name: "Malzeme Bilimi ve Mühendisliği", url: "https://malzeme.aku.edu.tr/" },
          { name: "Yazılım Mühendisliği", url: "https://yazilim.aku.edu.tr/" }
        ]
      },
      { name: "Sandıklı Meslek Yüksekokulu", url: "http://sandiklimyo.aku.edu.tr/", unitType: "vocational_school" },
      { name: "Sandıklı Uygulamalı Bilimler Yüksekokulu", url: "http://subyo.aku.edu.tr/", unitType: "school" },
      { name: "Sultandağı Meslek Yüksekokulu", url: "http://sultandagimyo.aku.edu.tr/", unitType: "vocational_school" },
      { name: "Şuhut Meslek Yüksekokulu", url: "http://suhutmyo.aku.edu.tr/", unitType: "vocational_school" },
      {
        name: "Teknoloji Fakültesi",
        url: "https://teknoloji.aku.edu.tr/",
        departments: [
          { name: "Elektrik-Elektronik Mühendisliği", url: "https://eem.aku.edu.tr/" },
          { name: "Makine Mühendisliği", url: "https://makine.aku.edu.tr/" },
          { name: "Mekatronik Mühendisliği", url: "https://mekatronik.aku.edu.tr/" },
          { name: "Metalurji ve Malzeme Mühendisliği", url: "https://metalurji.aku.edu.tr/" },
          { name: "Otomotiv Mühendisliği", url: "https://otomotiv.aku.edu.tr/" }
        ]
      },
      { name: "Turizm Fakültesi", url: "https://turizm.aku.edu.tr/" },
      { name: "Veteriner Fakültesi", url: "https://veteriner.aku.edu.tr/", departments: [{ name: "Veteriner", url: "https://veteriner.aku.edu.tr/" }] },
      { name: "Devlet Konservatuvarı", url: "https://konservatuvar.aku.edu.tr/", unitType: "academic_unit" },
      { name: "Yabancı Diller Yüksekokulu", url: "http://ydy.aku.edu.tr/", unitType: "school" }
    ]
  },
  {
    name: "AKDENİZ ÜNİVERSİTESİ",
    homepageUrl: "https://www.akdeniz.edu.tr/",
    universityId: "akdeniz-universitesi-antalya",
    faculties: [
      { name: "Demre Dr. Hasan Ünal Meslek Yüksekokulu", url: "https://demre.akdeniz.edu.tr/", unitType: "vocational_school" },
      { name: "Diş Hekimliği Fakültesi", url: "https://dishekimlik.akdeniz.edu.tr/", departments: [{ name: "Diş Hekimliği", url: "https://dishekimlik.akdeniz.edu.tr/" }] },
      {
        name: "Edebiyat Fakültesi",
        url: "https://edebiyat.akdeniz.edu.tr/",
        departments: [
          { name: "Alman Dili ve Edebiyatı", url: "http://ade.akdeniz.edu.tr/" },
          { name: "Arkeoloji", url: "http://arkeoloji.akdeniz.edu.tr/" },
          { name: "Coğrafya", url: "http://cografya.akdeniz.edu.tr/" },
          { name: "Felsefe", url: "http://felsefe.akdeniz.edu.tr/" },
          { name: "İngiliz Dili ve Edebiyatı", url: "http://ide.akdeniz.edu.tr/" },
          { name: "Psikoloji", url: "http://psikoloji.akdeniz.edu.tr/" },
          { name: "Rus Dili ve Edebiyatı", url: "http://rde.akdeniz.edu.tr/" },
          { name: "Sanat Tarihi", url: "http://sanattarihi.akdeniz.edu.tr/" },
          { name: "Sosyoloji", url: "http://sosyoloji.akdeniz.edu.tr/" },
          { name: "Tarih", url: "http://tarih.akdeniz.edu.tr/" },
          { name: "Türk Dili ve Edebiyatı", url: "http://tde.akdeniz.edu.tr/" }
        ]
      },
      { name: "Eğitim Fakültesi", url: "https://egitim.akdeniz.edu.tr/" },
      {
        name: "Fen Fakültesi",
        url: "https://fen.akdeniz.edu.tr/",
        departments: [
          { name: "Biyoloji", url: "http://biyoloji.akdeniz.edu.tr/" },
          { name: "Kimya", url: "http://kimya.akdeniz.edu.tr/" },
          { name: "Matematik", url: "http://matematik.akdeniz.edu.tr/" },
          { name: "Fizik", url: "http://fizik.akdeniz.edu.tr/" },
          { name: "Uzay Bilimleri ve Teknolojileri", url: "http://uzaybilimleri.akdeniz.edu.tr/" }
        ]
      },
      {
        name: "Güzel Sanatlar Fakültesi",
        url: "https://gsf.akdeniz.edu.tr/",
        departments: [
          { name: "Resim", url: "https://gsf.akdeniz.edu.tr/tr/resim_bolumu-2992" },
          { name: "Heykel", url: "https://gsf.akdeniz.edu.tr/tr/heykel_bolumu-2993" },
          { name: "Grafik", url: "https://gsf.akdeniz.edu.tr/tr/grafik_bolumu-2994" },
          { name: "Seramik", url: "https://gsf.akdeniz.edu.tr/tr/seramik_bolumu-2995" },
          { name: "Müzik", url: "https://gsf.akdeniz.edu.tr/tr/muzik_bolumu-2996" },
          { name: "Fotoğraf", url: "https://gsf.akdeniz.edu.tr/tr/fotograf_bolumu-2997" },
          { name: "Sinema ve Televizyon", url: "https://gsf.akdeniz.edu.tr/tr/sinematv_bolumu-2998" },
          { name: "Geleneksel Türk Sanatları", url: "https://gsf.akdeniz.edu.tr/tr/geleneksel_turk_sanatlari_bolumu-2999" },
          { name: "Tekstil ve Moda Tasarımı", url: "https://gsf.akdeniz.edu.tr/tr/tekstil_ve_moda_tasarimi_bolumu-3001" },
          { name: "Kültür Varlıklarını Koruma ve Onarımı", url: "https://gsf.akdeniz.edu.tr/tr/kultur_varliklarini_koruma_ve_onarimi_bolumu-3002" },
          { name: "Temel Eğitim", url: "https://gsf.akdeniz.edu.tr/tr/temel_egitim_bolumu-3003" },
          { name: "Sahne Dekorları ve Kostümü", url: "https://gsf.akdeniz.edu.tr/tr/sahne_dekorlari_ve_kostumu_bolumu-3004" }
        ]
      },
      { name: "Göynük Mutfak Sanatları Meslek Yüksekokulu", url: "https://goynuk.akdeniz.edu.tr/", unitType: "vocational_school", departments: [
        { name: "Aşçılık", url: "https://goynuk.akdeniz.edu.tr/tr/ascilik-6227" },
        { name: "İkram Hizmetleri", url: "https://goynuk.akdeniz.edu.tr/tr/ikram_hizmetleri-6293" },
        { name: "Pastacılık ve Ekmekçilik", url: "https://goynuk.akdeniz.edu.tr/tr/pastacilik_ve_ekmekcilik-6297" }
      ] },
      { name: "Hemşirelik Fakültesi", url: "https://hemsirelik.akdeniz.edu.tr/", departments: [{ name: "Hemşirelik", url: "https://hemsirelik.akdeniz.edu.tr/" }] },
      { name: "Hukuk Fakültesi", url: "https://hukuk.akdeniz.edu.tr/" },
      {
        name: "İktisadi ve İdari Bilimler Fakültesi",
        url: "https://iibf.akdeniz.edu.tr/",
        departments: [
          { name: "Çalışma Ekonomisi ve Endüstri İlişkileri", url: "https://ceko.akdeniz.edu.tr/" },
          { name: "Ekonometri", url: "https://ekonometribolumu.akdeniz.edu.tr/" },
          { name: "İktisat", url: "https://iktisatbolumu.akdeniz.edu.tr/" },
          { name: "İşletme", url: "https://isletmebolumu.akdeniz.edu.tr/" },
          { name: "Maliye", url: "https://maliyebolumu.akdeniz.edu.tr/" },
          { name: "Siyaset Bilimi ve Kamu Yönetimi", url: "https://kamuyonetimibolumu.akdeniz.edu.tr/" },
          { name: "Uluslararası İlişkiler", url: "https://uluslararasiiliskiler.akdeniz.edu.tr/" }
        ]
      },
      { name: "İlahiyat Fakültesi", url: "https://ilahiyat.akdeniz.edu.tr/" },
      {
        name: "İletişim Fakültesi",
        url: "https://iletisim.akdeniz.edu.tr/",
        departments: [
          { name: "Halkla İlişkiler ve Tanıtım", url: "https://iletisim.akdeniz.edu.tr/tr/halkla_iliskiler_ve_tanitim_bolumu-6372" },
          { name: "Gazetecilik", url: "https://iletisim.akdeniz.edu.tr/tr/gazetecilik_bolumu-6363" },
          { name: "Radyo, Televizyon ve Sinema", url: "https://iletisim.akdeniz.edu.tr/tr/radyo_televizyon_ve_sinema_bolumu-6369" },
          { name: "Reklamcılık", url: "https://iletisim.akdeniz.edu.tr/tr/reklamcilik_bolumu-6374" }
        ]
      },
      { name: "Kemer Denizcilik Fakültesi", url: "https://denizcilik.akdeniz.edu.tr/" },
      { name: "Kumluca Meslek Yüksekokulu", url: "https://kumlucamyo.akdeniz.edu.tr/", unitType: "vocational_school" },
      { name: "Kumluca Sağlık Bilimleri Fakültesi", url: "https://kumlucasbf.akdeniz.edu.tr/" },
      { name: "Manavgat Meslek Yüksekokulu", url: "https://manavgat.akdeniz.edu.tr/", unitType: "vocational_school" },
      { name: "Manavgat Sosyal ve Beşeri Bilimler Fakültesi", url: "https://sobef.akdeniz.edu.tr/" },
      { name: "Manavgat Turizm Fakültesi", url: "https://mtf.akdeniz.edu.tr/" },
      { name: "Manavgat Yabancı Diller Fakültesi", url: "https://manavgatydf.akdeniz.edu.tr/" },
      {
        name: "Mimarlık Fakültesi",
        url: "https://mimarlik.akdeniz.edu.tr/",
        departments: [
          { name: "Mimarlık", url: "http://mimarlikbolumu.akdeniz.edu.tr/" },
          { name: "İç Mimarlık", url: "http://icmimarlik.akdeniz.edu.tr/" },
          { name: "Peyzaj Mimarlığı", url: "http://peyzajmimarligi.akdeniz.edu.tr/" },
          { name: "Şehir ve Bölge Planlama", url: "http://sbp.akdeniz.edu.tr/" }
        ]
      },
      {
        name: "Mühendislik Fakültesi",
        url: "https://muhendislik.akdeniz.edu.tr/",
        departments: [
          { name: "Bilgisayar Mühendisliği", url: "http://cse.akdeniz.edu.tr/" },
          { name: "Çevre Mühendisliği", url: "http://cevre.akdeniz.edu.tr/" },
          { name: "Elektrik-Elektronik Mühendisliği", url: "http://eem.akdeniz.edu.tr/" },
          { name: "Gıda Mühendisliği", url: "http://gida.akdeniz.edu.tr/" },
          { name: "İnşaat Mühendisliği", url: "http://insaat.akdeniz.edu.tr/" },
          { name: "Jeoloji Mühendisliği", url: "http://jeoloji.akdeniz.edu.tr/" },
          { name: "Makine Mühendisliği", url: "http://makine.akdeniz.edu.tr/" },
          { name: "Yapay Zeka ve Veri Mühendisliği", url: "https://ai.akdeniz.edu.tr/" }
        ]
      },
      { name: "Sağlık Bilimleri Fakültesi", url: "https://sbf.akdeniz.edu.tr/", departments: [{ name: "Beslenme ve Diyetetik", url: "https://bdb.akdeniz.edu.tr/" }] },
      { name: "Sağlık Hizmetleri Meslek Yüksekokulu", url: "https://shmyo.akdeniz.edu.tr/", unitType: "vocational_school" },
      { name: "Serik Gülsün-Süleyman Süral Meslek Yüksekokulu", url: "https://serik.akdeniz.edu.tr/", unitType: "vocational_school" },
      { name: "Serik İşletme Fakültesi", url: "https://sif.akdeniz.edu.tr/" },
      { name: "Sosyal Bilimler Meslek Yüksekokulu", url: "https://sosyal.akdeniz.edu.tr/", unitType: "vocational_school" },
      { name: "Spor Bilimleri Fakültesi", url: "https://sporbilimleri.akdeniz.edu.tr/", departments: [{ name: "Spor Yöneticiliği", url: "https://sporyoneticiligi.akdeniz.edu.tr/" }] },
      { name: "Su Ürünleri Fakültesi", url: "https://sufak.akdeniz.edu.tr/" },
      { name: "Teknik Bilimler Meslek Yüksekokulu", url: "https://teknik.akdeniz.edu.tr/", unitType: "vocational_school" },
      { name: "Tıp Fakültesi", url: "https://tip.akdeniz.edu.tr/" },
      {
        name: "Turizm Fakültesi",
        url: "https://turizm.akdeniz.edu.tr/",
        departments: [
          { name: "Turizm İşletmeciliği", courseScheduleUrl: "https://turizm.akdeniz.edu.tr/tr/ders_programi-2517", examScheduleUrl: "https://turizm.akdeniz.edu.tr/tr/turizm_isletmeciligi_bolumu_sinav_programi-5949", announcementUrl: "https://turizm.akdeniz.edu.tr/tr/bolum_duyurulari-9996" },
          { name: "Gastronomi ve Mutfak Sanatları", courseScheduleUrl: "https://turizm.akdeniz.edu.tr/tr/ders_programi-2533", examScheduleUrl: "https://turizm.akdeniz.edu.tr/tr/gastronomi_ve_mutfak_sanatlari_bolumu_sinav_programi-5945", announcementUrl: "https://turizm.akdeniz.edu.tr/tr/bolum_duyurulari-2536" },
          { name: "Turizm Rehberliği", courseScheduleUrl: "https://turizm.akdeniz.edu.tr/tr/ders_programi-2526", examScheduleUrl: "https://turizm.akdeniz.edu.tr/tr/turizm_rehberligi_bolumu_sinav_programi-5948", announcementUrl: "https://turizm.akdeniz.edu.tr/tr/bolum_duyurulari-9997" },
          { name: "Rekreasyon Yönetimi", courseScheduleUrl: "https://turizm.akdeniz.edu.tr/tr/ders_programi-2539", examScheduleUrl: "https://turizm.akdeniz.edu.tr/tr/rekreasyon_yonetimi_bolumu_sinav_programi-5946", announcementUrl: "https://turizm.akdeniz.edu.tr/tr/bolum_duyurulari-2543" }
        ]
      },
      { name: "Uygulamalı Bilimler Fakültesi", url: "https://ubf.akdeniz.edu.tr/" },
      {
        name: "Ziraat Fakültesi",
        url: "https://ziraat.akdeniz.edu.tr/",
        departments: [
          { name: "Bahçe Bitkileri", url: "https://bahce.akdeniz.edu.tr/" },
          { name: "Bitki Koruma", url: "https://bitkikoruma.akdeniz.edu.tr/tr" },
          { name: "Tarım Ekonomisi", url: "https://tarimekonomisi.akdeniz.edu.tr/tr" },
          { name: "Tarım Makineleri ve Teknolojileri Mühendisliği", url: "http://tarmaktek.akdeniz.edu.tr/" },
          { name: "Tarımsal Biyoteknoloji", url: "https://tarimsalbiyoteknoloji.akdeniz.edu.tr/tr" },
          { name: "Tarımsal Yapılar ve Sulama", url: "http://tarimsalyapilar.akdeniz.edu.tr/" },
          { name: "Tarla Bitkileri", url: "http://tarlabitkileri.akdeniz.edu.tr/" },
          { name: "Toprak Bilimi ve Bitki Besleme", url: "http://toprak.akdeniz.edu.tr/" },
          { name: "Zootekni", url: "https://zootekni.akdeniz.edu.tr/" }
        ]
      },
      { name: "Antalya Devlet Konservatuvarı", url: "https://konservatuvar.akdeniz.edu.tr/", unitType: "academic_unit" },
      { name: "Yabancı Diller Yüksekokulu", url: "https://ydy.akdeniz.edu.tr/", unitType: "school" },
      { name: "Adalet Meslek Yüksekokulu", url: "https://adaletmyo.akdeniz.edu.tr/", unitType: "vocational_school" },
      { name: "Elmalı Meslek Yüksekokulu", url: "https://elmali.akdeniz.edu.tr/", unitType: "vocational_school" },
      { name: "Finike Meslek Yüksekokulu", url: "https://finike.akdeniz.edu.tr/", unitType: "vocational_school", departments: [
        { name: "Deniz ve Liman İşletmeciliği", url: "https://finike.akdeniz.edu.tr/tr/deniz_ve_liman_isletmeciligi_programi-3428" },
        { name: "Turizm ve Otel İşletmeciliği", url: "https://finike.akdeniz.edu.tr/tr/turizm_ve_otel_isletmeciligi_programi-3430" },
        { name: "Dış Ticaret", url: "https://finike.akdeniz.edu.tr/tr/dis_ticaret_programi-3438" },
        { name: "Bahçe Tarımı", url: "https://finike.akdeniz.edu.tr/tr/bahce_tarimi_programi-3439" },
        { name: "Meyve ve Sebze İşleme Teknolojisi", url: "https://finike.akdeniz.edu.tr/tr/meyve_ve_sebze_isleme_teknolojisi_programi-3440" }
      ] }
    ]
  }
];

async function main(): Promise<void> {
  const tree = JSON.parse(await readFile(treePath, "utf8")) as FacultyTreeFile;
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { universities: SeedUniversity[] };
  const registry = JSON.parse(await readFile(registryPath, "utf8")) as VerifiedAcademicUnitSource[];
  const seedById = new Map(catalog.universities.map((university) => [university.slug, university]));

  for (const spec of specs) {
    patchTreeRecord(tree, spec);
  }
  tree.generatedAt = new Date().toISOString();
  tree.summary = buildTreeSummary(tree.universities);
  await writeFile(treePath, `${JSON.stringify(tree, null, 2)}\n`, "utf8");

  const affectedIds = new Set(specs.map((spec) => spec.universityId));
  const firstAffectedIndex = registry.findIndex((source) => affectedIds.has(source.universityId));
  const retained = registry.filter((source) => !affectedIds.has(source.universityId));
  const additions = specs.flatMap((spec) => buildRegistryRecords(spec, seedById.get(spec.universityId)));
  const insertionIndex = firstAffectedIndex >= 0 ? Math.min(firstAffectedIndex, retained.length) : retained.length;
  retained.splice(insertionIndex, 0, ...additions);
  await writeFile(registryPath, `${JSON.stringify(retained, null, 2)}\n`, "utf8");

  const result = specs.map((spec) => {
    const treeRecord = tree.universities.find((university) => university.homepageUrl === spec.homepageUrl);
    const records = additions.filter((source) => source.universityId === spec.universityId);
    return {
      university: spec.name,
      treeFaculties: treeRecord?.facultyCount,
      treeDepartments: spec.faculties.reduce((total, faculty) => total + (faculty.departments?.length ?? 0), 0),
      registryRecords: records.length,
      registryFaculties: records.filter((record) => record.scopeType === "faculty").length,
      registryDepartments: records.filter((record) => record.scopeType === "department").length
    };
  });
  console.log(JSON.stringify(result, null, 2));
}

function patchTreeRecord(tree: FacultyTreeFile, spec: UniversitySpec): void {
  const index = tree.universities.findIndex((university) => normalizeUrlForLookup(String(university.homepageUrl ?? "")) === normalizeUrlForLookup(spec.homepageUrl));
  if (index < 0) throw new Error(`University not found in tree: ${spec.homepageUrl}`);
  const current = tree.universities[index]!;
  const beforeFacultyCount = Array.isArray(current.faculties) ? current.faculties.length : 0;
  tree.universities[index] = {
    ...current,
    name: spec.name,
    homepageUrl: spec.homepageUrl,
    finalHomepageUrl: spec.homepageUrl,
    hostname: new URL(spec.homepageUrl).hostname,
    status: "manual_seeded",
    checkedPageCount: 1,
    facultyCount: spec.faculties.length,
    faculties: spec.faculties.map((faculty) => ({
      name: faculty.name,
      url: normalizeDisplayUrl(faculty.url),
      unitType: faculty.unitType ?? inferUnitType(faculty.name),
      sourcePageUrl: spec.homepageUrl,
      confidence: 150,
      ...(faculty.departments?.length
        ? {
            departments: faculty.departments.map((department) => ({
              name: department.name,
              url: normalizeDisplayUrl(department.url ?? department.announcementUrl ?? department.courseScheduleUrl ?? department.examScheduleUrl ?? faculty.url),
              unitType: "department",
              sourcePageUrl: normalizeDisplayUrl(faculty.url),
              confidence: 145,
              ...(department.announcementUrl ? { announcementUrl: normalizeDisplayUrl(department.announcementUrl) } : {}),
              ...(department.courseScheduleUrl ? { courseScheduleUrl: normalizeDisplayUrl(department.courseScheduleUrl) } : {}),
              ...(department.examScheduleUrl ? { examScheduleUrl: normalizeDisplayUrl(department.examScheduleUrl) } : {})
            }))
          }
        : {})
    })),
    errors: [],
    cleanup: {
      beforeFacultyCount,
      afterFacultyCount: spec.faculties.length,
      removedFacultyCount: Math.max(0, beforeFacultyCount - spec.faculties.length),
      manuallySeededFrom: "User-provided ATU/AKU links and attachment e79efe37-92bc-4130-8b2f-18244e0204ce for Akdeniz"
    }
  };
}

function buildRegistryRecords(spec: UniversitySpec, seed?: SeedUniversity): VerifiedAcademicUnitSource[] {
  if (!seed) throw new Error(`Catalog seed not found: ${spec.universityId}`);
  const records: VerifiedAcademicUnitSource[] = [];
  const seedFaculties = new Map(seed.faculties.map((faculty) => [foldText(faculty.name), faculty]));

  for (const facultySpec of spec.faculties) {
    const facultySeed = seedFaculties.get(foldText(facultySpec.name));
    if (!facultySeed) continue;
    const facultyId = `${seed.slug}__${facultySeed.slug}`;
    records.push({
      scopeType: "faculty",
      universityId: seed.slug,
      universityName: seed.name,
      facultyId,
      facultyName: facultySeed.name,
      websiteUrl: normalizeDisplayUrl(facultySpec.url)
    });

    const departmentsByName = new Map(facultySeed.departments.map((department) => [foldText(department.name), department]));
    for (const departmentSpec of facultySpec.departments ?? []) {
      const departmentSeed = departmentsByName.get(foldText(departmentSpec.name));
      if (!departmentSeed) continue;
      records.push({
        scopeType: "department",
        universityId: seed.slug,
        universityName: seed.name,
        facultyId,
        facultyName: facultySeed.name,
        departmentId: `${facultyId}__${departmentSeed.slug}`,
        departmentName: departmentSeed.name,
        ...(departmentSpec.url ? { websiteUrl: normalizeDisplayUrl(departmentSpec.url) } : {}),
        ...(departmentSpec.announcementUrl ? { announcementUrl: normalizeDisplayUrl(departmentSpec.announcementUrl) } : {}),
        ...(departmentSpec.courseScheduleUrl ? { courseScheduleUrl: normalizeDisplayUrl(departmentSpec.courseScheduleUrl) } : {}),
        ...(departmentSpec.examScheduleUrl ? { examScheduleUrl: normalizeDisplayUrl(departmentSpec.examScheduleUrl) } : {})
      });
    }
  }

  return dedupeRegistry(records);
}

function dedupeRegistry(records: VerifiedAcademicUnitSource[]): VerifiedAcademicUnitSource[] {
  const byKey = new Map<string, VerifiedAcademicUnitSource>();
  for (const record of records) {
    const key = record.scopeType === "faculty" ? `faculty:${record.facultyId}` : `department:${record.departmentId}`;
    byKey.set(key, { ...byKey.get(key), ...record });
  }
  return [...byKey.values()];
}

function buildTreeSummary(universities: Array<Record<string, unknown>>): Record<string, unknown> {
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
  if (folded.includes("yuksekokulu")) return "school";
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

function normalizeUrlForLookup(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/u, "/");
    return url.toString().toLocaleLowerCase("en-US");
  } catch {
    return input.trim().toLocaleLowerCase("en-US");
  }
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
