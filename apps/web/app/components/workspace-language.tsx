'use client'

import { useSyncExternalStore } from 'react'

const storageKey = 'aipollo-workspace-language'
const languageEvent = 'aipollo-workspace-language-changed'
type Language = 'en' | 'vi'

function readLanguage(): Language {
  try {
    return window.localStorage.getItem(storageKey) === 'vi' ? 'vi' : 'en'
  } catch {
    return 'en'
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(languageEvent, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(languageEvent, callback)
    window.removeEventListener('storage', callback)
  }
}

function serverLanguage(): Language {
  return 'en'
}

export function useWorkspaceLanguage() {
  const language = useSyncExternalStore(subscribe, readLanguage, serverLanguage)
  return {
    language,
    text: (english: string, vietnamese: string) => language === 'vi' ? vietnamese : english,
  }
}

export function WorkspaceLanguage() {
  const { language } = useWorkspaceLanguage()

  function choose(value: Language) {
    try {
      window.localStorage.setItem(storageKey, value)
      window.dispatchEvent(new Event(languageEvent))
    } catch {}
  }

  return <div className="workspace-language" role="group" aria-label="Workspace language">
    <button type="button" lang="en" aria-label="English" aria-pressed={language === 'en'} onClick={() => choose('en')}>EN</button>
    <button type="button" lang="vi" aria-label="Tiếng Việt" aria-pressed={language === 'vi'} onClick={() => choose('vi')}>VI</button>
  </div>
}
