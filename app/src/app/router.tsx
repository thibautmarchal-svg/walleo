import { createBrowserRouter } from 'react-router-dom'
import { Dashboard } from './Dashboard'
import { CardDetail } from './CardDetail'
import { CardForm } from './CardForm'
import { Settings } from './Settings'

export const router = createBrowserRouter([
  { path: '/', element: <Dashboard /> },
  { path: '/card/:id', element: <CardDetail /> },
  { path: '/card/:id/edit', element: <CardForm mode="edit" /> },
  { path: '/add', element: <CardForm mode="add" /> },
  { path: '/settings', element: <Settings /> },
])
