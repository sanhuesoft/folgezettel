import en from './locales/en.json';
import es from './locales/es.json';

export type LocaleMap = Record<string, string>;

const LOCALES: Record<string, LocaleMap> = {
  en: en as LocaleMap,
  es: es as LocaleMap,
};

export class I18n {
  strings: LocaleMap;
  lang: string;

  constructor(lang?: string) {
    let chosen = 'en';
    if (!lang || lang === 'auto') {
      const nav = typeof navigator !== 'undefined' ? navigator.language || 'en' : 'en';
      chosen = nav.split('-')[0];
    } else {
      chosen = lang;
    }

    if (!(chosen in LOCALES)) chosen = 'en';
    this.lang = chosen;
    this.strings = LOCALES[this.lang];
  }

  t(key: string, vars?: Record<string, string | number>) {
    let s = this.strings[key] ?? key;
    if (vars) {
      // Use split/join to avoid constructing a RegExp that requires
      // escaping braces (which ESLint may flag as unnecessary).
      for (const k in vars) {
        s = s.split(`{${k}}`).join(String(vars[k]));
      }
    }
    return s;
  }
}
