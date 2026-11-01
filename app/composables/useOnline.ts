/** Reactive browser connectivity (navigator.onLine + online/offline events). */
export function useOnline() {
  const online = useState('net.online', () => true)
  if (import.meta.client && !(globalThis as any).__hrOnlineBound) {
    ;(globalThis as any).__hrOnlineBound = true
    online.value = navigator.onLine
    window.addEventListener('online', () => (online.value = true))
    window.addEventListener('offline', () => (online.value = false))
  }
  return online
}
