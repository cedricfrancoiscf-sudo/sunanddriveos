// Configuration i18next — langue française uniquement en V1
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './fr.json';

void i18n.use(initReactI18next).init({
  lng: 'fr',
  fallbackLng: 'fr',
  resources: { fr: { translation: fr } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
