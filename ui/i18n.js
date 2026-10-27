import ruLocale from "./locale-ru.js?v=active-games4";
import enLocale from "./locale-en.js?v=active-games4";

const dictionaries = Object.freeze({ ru: ruLocale, en: enLocale });
const supportedLanguages = Object.keys(dictionaries);
const storageKey = "viruses.language";

function readSavedLanguage() {
  try {
    const savedLanguage = localStorage.getItem(storageKey);
    return supportedLanguages.includes(savedLanguage) ? savedLanguage : "ru";
  } catch {
    return "ru";
  }
}

let language = readSavedLanguage();

export function getLanguage() {
  return language;
}

export function t(key, params = {}) {
  const template = dictionaries[language][key] ?? dictionaries.ru[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}

export function pieceForm(count) {
  if (language === "en") return t(count === 1 ? "plural.piece.one" : "plural.piece.few");

  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return t("plural.piece.many");
  const mod10 = count % 10;
  return t(mod10 === 1 ? "plural.piece.one" : mod10 >= 2 && mod10 <= 4 ? "plural.piece.few" : "plural.piece.many");
}

export function setLanguage(nextLanguage) {
  if (!supportedLanguages.includes(nextLanguage) || nextLanguage === language) return;

  language = nextLanguage;
  try {
    localStorage.setItem(storageKey, language);
  } catch {
    // Language switching still works for this session when storage is unavailable.
  }
  document.documentElement.lang = language;
  document.dispatchEvent(new CustomEvent("languagechange", { detail: { language } }));
}

export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
  root.querySelectorAll("[data-i18n-alt]").forEach((element) => {
    element.setAttribute("alt", t(element.dataset.i18nAlt));
  });
  root.querySelectorAll("[data-i18n-content]").forEach((element) => {
    element.setAttribute("content", t(element.dataset.i18nContent));
  });
  root.querySelectorAll("[data-i18n-player]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel, { player: element.dataset.i18nPlayer }));
  });

  document.title = t("brand.title");
  document.documentElement.lang = language;
}
