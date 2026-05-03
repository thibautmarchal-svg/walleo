import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { useCardsStore } from './features/cards/store'
import { seedIfEmpty } from './shared/db/seed'

export default function App() {
  const loadAll = useCardsStore((s) => s.loadAll)

  useEffect(() => {
    void (async () => {
      await seedIfEmpty()
      await loadAll()
    })()
  }, [loadAll])

  return <RouterProvider router={router} />
}
