/* Countries, languages, categories — shared static data */

export type Edition = { hl: string; ceid: string };
export type Country = {
  code: string;
  flag: string;
  ja: string;
  en: string;
  def: string;
  ed: Record<string, Edition>;
};

export const COUNTRIES: Country[] = [
  { code: "US", flag: "🇺🇸", ja: "アメリカ", en: "United States", def: "en", ed: { en: { hl: "en-US", ceid: "US:en" }, es: { hl: "es-419", ceid: "US:es-419" } } },
  { code: "JP", flag: "🇯🇵", ja: "日本", en: "Japan", def: "ja", ed: { ja: { hl: "ja", ceid: "JP:ja" } } },
  { code: "GB", flag: "🇬🇧", ja: "イギリス", en: "United Kingdom", def: "en", ed: { en: { hl: "en-GB", ceid: "GB:en" } } },
  { code: "CN", flag: "🇨🇳", ja: "中国", en: "China", def: "zh", ed: { zh: { hl: "zh-CN", ceid: "CN:zh-Hans" } } },
  { code: "TW", flag: "🇹🇼", ja: "台湾", en: "Taiwan", def: "zh", ed: { zh: { hl: "zh-TW", ceid: "TW:zh-Hant" } } },
  { code: "KR", flag: "🇰🇷", ja: "韓国", en: "South Korea", def: "ko", ed: { ko: { hl: "ko", ceid: "KR:ko" } } },
  { code: "DE", flag: "🇩🇪", ja: "ドイツ", en: "Germany", def: "de", ed: { de: { hl: "de", ceid: "DE:de" } } },
  { code: "FR", flag: "🇫🇷", ja: "フランス", en: "France", def: "fr", ed: { fr: { hl: "fr", ceid: "FR:fr" } } },
  { code: "IN", flag: "🇮🇳", ja: "インド", en: "India", def: "en", ed: { en: { hl: "en-IN", ceid: "IN:en" }, hi: { hl: "hi", ceid: "IN:hi" } } },
  { code: "CA", flag: "🇨🇦", ja: "カナダ", en: "Canada", def: "en", ed: { en: { hl: "en-CA", ceid: "CA:en" }, fr: { hl: "fr-CA", ceid: "CA:fr" } } },
  { code: "AU", flag: "🇦🇺", ja: "オーストラリア", en: "Australia", def: "en", ed: { en: { hl: "en-AU", ceid: "AU:en" } } },
  { code: "IT", flag: "🇮🇹", ja: "イタリア", en: "Italy", def: "it", ed: { it: { hl: "it", ceid: "IT:it" } } },
  { code: "ES", flag: "🇪🇸", ja: "スペイン", en: "Spain", def: "es", ed: { es: { hl: "es", ceid: "ES:es" } } },
  { code: "BR", flag: "🇧🇷", ja: "ブラジル", en: "Brazil", def: "pt", ed: { pt: { hl: "pt-BR", ceid: "BR:pt-419" } } },
  { code: "MX", flag: "🇲🇽", ja: "メキシコ", en: "Mexico", def: "es", ed: { es: { hl: "es-419", ceid: "MX:es-419" } } },
  { code: "ID", flag: "🇮🇩", ja: "インドネシア", en: "Indonesia", def: "id", ed: { id: { hl: "id", ceid: "ID:id" } } },
  { code: "SG", flag: "🇸🇬", ja: "シンガポール", en: "Singapore", def: "en", ed: { en: { hl: "en-SG", ceid: "SG:en" } } },
  { code: "RU", flag: "🇷🇺", ja: "ロシア", en: "Russia", def: "ru", ed: { ru: { hl: "ru", ceid: "RU:ru" } } },
];

export const NEWSLANGS: { code: string; ja: string; en: string }[] = [
  { code: "auto", ja: "各国の現地語", en: "Local language" },
  { code: "ja", ja: "日本語", en: "Japanese" },
  { code: "en", ja: "英語", en: "English" },
  { code: "zh", ja: "中国語", en: "Chinese" },
  { code: "ko", ja: "韓国語", en: "Korean" },
  { code: "de", ja: "ドイツ語", en: "German" },
  { code: "fr", ja: "フランス語", en: "French" },
  { code: "es", ja: "スペイン語", en: "Spanish" },
  { code: "pt", ja: "ポルトガル語", en: "Portuguese" },
  { code: "hi", ja: "ヒンディー語", en: "Hindi" },
  { code: "it", ja: "イタリア語", en: "Italian" },
  { code: "id", ja: "インドネシア語", en: "Indonesian" },
  { code: "ru", ja: "ロシア語", en: "Russian" },
];

export const CATS = ["TOP", "WORLD", "BUSINESS", "TECHNOLOGY", "SCIENCE", "HEALTH", "SPORTS", "ENTERTAINMENT", "GROWTH"] as const;
export type Cat = (typeof CATS)[number];

export const GROWTH_QUERY: Record<string, string> = {
  ja: "生成AI OR 半導体 OR 脱炭素 OR バイオテクノロジー OR 宇宙ビジネス OR 量子コンピュータ",
  en: '"generative AI" OR semiconductor OR "clean energy" OR biotechnology OR "space industry" OR "quantum computing"',
  zh: "生成式AI OR 半导体 OR 清洁能源 OR 生物技术",
  ko: "생성형 AI OR 반도체 OR 청정에너지 OR 바이오",
  de: '"generative KI" OR Halbleiter OR "erneuerbare Energie" OR Biotechnologie',
  fr: '"IA générative" OR semi-conducteurs OR "énergie propre" OR biotechnologie',
  es: '"IA generativa" OR semiconductores OR "energía limpia" OR biotecnología',
  pt: '"IA generativa" OR semicondutores OR "energia limpa" OR biotecnologia',
};

export type Prefs = {
  onboarded: boolean;
  uiLang: "ja" | "en";
  newsLang: string;
  countries: string[];
  cats: Cat[];
  digestOn: boolean;
  digestTime: string; // "HH:MM"
  digestCats: Cat[];
  theme: "auto" | "light" | "dark";
  lastDigestDate: string;
};

export const DEFAULT_PREFS: Prefs = {
  onboarded: false,
  uiLang: "ja",
  newsLang: "auto",
  countries: ["JP", "US"],
  cats: ["TOP", "WORLD", "BUSINESS", "TECHNOLOGY"],
  digestOn: false,
  digestTime: "07:30",
  digestCats: ["TOP", "BUSINESS", "TECHNOLOGY"],
  theme: "auto",
  lastDigestDate: "",
};
