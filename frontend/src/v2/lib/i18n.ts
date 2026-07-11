import { useSyncExternalStore } from 'react';

/**
 * Socle i18n (backlog P2 10.G — préparation EN). Sans dépendance : le FR est la
 * langue de référence (il définit l'ensemble des clés) ; l'EN est partiel et toute
 * clé absente retombe sur le FR. Migration incrémentale : les écrans passent un à
 * un de littéraux à `t('…')` (surface auth migrée en premier, pattern à suivre).
 */
export type Locale = 'fr' | 'en';

const fr = {
  'auth.tagline': 'Review collaborative de médias pour studios VFX & post-production.',
  'auth.language': 'Langue',
  'login.title': 'Bon retour.',
  'login.subtitle': 'Connectez-vous pour retrouver vos reviews, tâches et boards.',
  'login.heading': 'Connexion',
  'login.lead': 'Accédez à votre espace studio.',
  'login.email': 'Email',
  'login.password': 'Mot de passe',
  'login.submit': 'Se connecter',
  'login.submitting': 'Connexion…',
  'login.error.credentials': 'Email ou mot de passe incorrect.',
  'login.error.network': 'Connexion au serveur impossible. Réessayez dans un instant.',
  'login.error.generic': 'Échec de connexion',
  'setup.title': 'Bienvenue sur ReView.',
  'setup.subtitle': 'Configurons votre studio en deux étapes. Vous pourrez tout ajuster ensuite.',
  'setup.step.studio': 'Studio',
  'setup.step.admin': 'Compte admin',
  'setup.studioName': 'Nom du studio',
  'setup.studioName.placeholder': 'Mon Studio',
  'setup.studioName.hint': 'Le nom affiché à votre équipe.',
  'setup.studioName.required': 'Indiquez le nom de votre studio.',
  'setup.continue': 'Continuer',
  'setup.adminName': 'Votre nom',
  'setup.adminName.placeholder': 'Jean Dupont',
  'setup.adminEmail': 'Email admin',
  'setup.password': 'Mot de passe',
  'setup.password.placeholder': '8+ car., 1 lettre, 1 chiffre',
  'setup.submit': 'Créer le studio',
  'setup.submitting': 'Création…',
  'setup.error.generic': 'Échec de configuration',
} as const;

/** L'ensemble des clés de traduction — dérivé du dictionnaire FR de référence. */
export type MessageKey = keyof typeof fr;

const en: Partial<Record<MessageKey, string>> = {
  'auth.tagline': 'Collaborative media review for VFX & post-production studios.',
  'auth.language': 'Language',
  'login.title': 'Welcome back.',
  'login.subtitle': 'Sign in to get back to your reviews, tasks and boards.',
  'login.heading': 'Sign in',
  'login.lead': 'Access your studio workspace.',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.error.credentials': 'Incorrect email or password.',
  'login.error.network': 'Cannot reach the server. Please try again in a moment.',
  'login.error.generic': 'Sign-in failed',
  'setup.title': 'Welcome to ReView.',
  'setup.subtitle': 'Let’s set up your studio in two steps. You can adjust everything later.',
  'setup.step.studio': 'Studio',
  'setup.step.admin': 'Admin account',
  'setup.studioName': 'Studio name',
  'setup.studioName.placeholder': 'My Studio',
  'setup.studioName.hint': 'The name shown to your team.',
  'setup.studioName.required': 'Please enter your studio name.',
  'setup.continue': 'Continue',
  'setup.adminName': 'Your name',
  'setup.adminName.placeholder': 'Jane Doe',
  'setup.adminEmail': 'Admin email',
  'setup.password': 'Password',
  'setup.password.placeholder': '8+ chars, 1 letter, 1 digit',
  'setup.submit': 'Create studio',
  'setup.submitting': 'Creating…',
  'setup.error.generic': 'Setup failed',
};

const LOCALES: readonly Locale[] = ['fr', 'en'];
const STORAGE_KEY = 'locale';

function readInitial(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (LOCALES.includes(v as Locale)) return v as Locale;
  } catch {
    /* stockage indisponible (SSR/tests) */
  }
  return 'fr';
}

let current: Locale = readInitial();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  if (!LOCALES.includes(l) || l === current) return;
  current = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* stockage indisponible */
  }
  document.documentElement.lang = l;
  listeners.forEach((fn) => fn());
}

/** Traduit une clé dans la langue courante (repli FR si la clé n'est pas traduite). */
export function t(key: MessageKey): string {
  return (current === 'fr' ? undefined : en[key]) ?? fr[key];
}

/** `t` réactif : le composant se re-rend au changement de langue. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLocale);
  return t;
}

// Aligne l'attribut lang du document au chargement (index.html est neutre).
document.documentElement.lang = current;
