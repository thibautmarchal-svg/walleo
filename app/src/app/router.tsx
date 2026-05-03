import { createBrowserRouter } from 'react-router-dom'
import { Dashboard } from './Dashboard'
import { CardDetail } from './CardDetail'
import { AddCard } from './AddCard'

export const router = createBrowserRouter([
  { path: '/', element: <Dashboard /> },
  { path: '/card/:id', element: <CardDetail /> },
  { path: '/add', element: <AddCard /> },
])
